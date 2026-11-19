/**
 * Carrybee CRM keyless Google Sheets backup.
 * Bound to the backup spreadsheet; runs under the Google account that authorizes it.
 * Supabase is always the source of truth. Never write CRM changes back through this script.
 */
const CRM_BASE_URL = 'https://carrybee-lead-crm.vercel.app';
const BACKUP_SPREADSHEET_ID = '1AFVVi9uajJfZGyOVu1YAZRUBZ0k7obH90bEVWIoYF8I';
const CRM_BACKUP_SECRET = 'd09112e0ed61564afc131ad8807774b7a944ba2aebf0d46c28d9ddd41b5b8c42';
const STAGING_PREFIX = 'CB_NEW_';

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Carrybee Backup').addItem('Setup authorization','setupCarrybeeBackup').addItem('Run manual backup','testCarrybeeBackup').addItem('Activate backup schedule','activateCarrybeeSchedule').addToUi();
}

function setupCarrybeeBackup() {
  validateCarrybeeConfig_();
  SpreadsheetApp.openById(BACKUP_SPREADSHEET_ID);
  SpreadsheetApp.getUi().alert('Authorization is ready. Run testCarrybeeBackup next. Activate the schedule separately only after that backup succeeds.');
}

function testCarrybeeBackup() {
  runCarrybeeBackup();
  SpreadsheetApp.getUi().alert('Manual backup succeeded. Verify the tabs and Backup_Status, then run activateCarrybeeSchedule.');
}

function activateCarrybeeSchedule() {
  const sheet = SpreadsheetApp.openById(BACKUP_SPREADSHEET_ID).getSheetByName('Backup_Status');
  if (!sheet || sheet.getRange('A2').getValue() !== 'SUCCESS') throw new Error('A successful manual backup is required before schedule activation.');
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'scheduledCarrybeeBackup') ScriptApp.deleteTrigger(trigger);
  });
  for (let hour = 10; hour <= 20; hour++) {
    ScriptApp.newTrigger('scheduledCarrybeeBackup').timeBased().atHour(hour).nearMinute(0).everyDays(1).create();
  }
  SpreadsheetApp.getUi().alert('Backup schedule active (Dhaka): Sat–Thu 10 AM–8 PM hourly; Friday 10 AM, 3 PM and 8 PM. The 8 PM run saves a dated final copy.');
}

function scheduledCarrybeeBackup() {
  const now = new Date();
  const date = Utilities.formatDate(now, 'Asia/Dhaka', 'yyyy-MM-dd');
  const hour = Number(Utilities.formatDate(now, 'Asia/Dhaka', 'HH'));
  const day = new Date(date + 'T00:00:00Z').getUTCDay();
  const allowed = day === 5 ? [10,15,20] : [10,11,12,13,14,15,16,17,18,19,20];
  if (allowed.indexOf(hour) < 0) return;
  runCarrybeeBackup();
  if (hour === 20) archiveFinalBackup_(date);
}

function archiveFinalBackup_(date) {
  const file = DriveApp.getFileById(BACKUP_SPREADSHEET_ID);
  const parents = file.getParents();
  const name = 'Carrybee CRM Final - ' + date;
  const copy = parents.hasNext() ? file.makeCopy(name, parents.next()) : file.makeCopy(name);
  const ss = SpreadsheetApp.openById(BACKUP_SPREADSHEET_ID);
  let log = ss.getSheetByName('Daily_Archives');
  if (!log) log = ss.insertSheet('Daily_Archives');
  if (log.getLastRow() === 0) log.appendRow(['Backup Date','Archived At','File Name','File URL']);
  log.appendRow([date,new Date(),name,copy.getUrl()]);
}

function runCarrybeeBackup() {
  validateCarrybeeConfig_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another Carrybee backup is already running. Try again after it finishes.');
  const spreadsheet = SpreadsheetApp.openById(BACKUP_SPREADSHEET_ID);
  let runId = null;
  try {
    removeStagingSheets_(spreadsheet);
    writeBackupStatus_(spreadsheet, 'RUNNING', new Date(), 0, 0, 'Downloading a frozen server-side Supabase snapshot.');
    const begun = carrybeeRequest_('POST', '', { action: 'begin' });
    runId = begun.runId;
    const totals = {};

    begun.sheets.forEach(sheetInfo => {
      const staging = spreadsheet.insertSheet(STAGING_PREFIX + sheetInfo.name);
      let outputRow = 1;
      for (let chunk = 0; chunk < sheetInfo.chunks; chunk++) {
        const path = '?runId=' + encodeURIComponent(runId) +
          '&sheet=' + encodeURIComponent(sheetInfo.name) + '&chunk=' + chunk;
        const page = carrybeeRequest_('GET', path);
        const matrix = chunk === 0 ? [page.headers].concat(page.rows) : page.rows;
        if (matrix.length) {
          staging.getRange(outputRow, 1, matrix.length, matrix[0].length).setValues(matrix);
          outputRow += matrix.length;
        }
      }
      totals[sheetInfo.name] = sheetInfo.totalRows;
      staging.setFrozenRows(1);
      SpreadsheetApp.flush();
    });

    // Replace tabs only after every page has downloaded successfully. The swap
    // function restores the old names if Google fails partway through.
    replaceBackupTabs_(spreadsheet, begun.sheets.map(sheetInfo => sheetInfo.name));
    const finished = new Date();
    const leads = totals.Leads || 0;
    const logs = totals.Call_Log || 0;
    writeBackupStatus_(spreadsheet, 'SUCCESS', finished, leads, logs, 'Supabase → Google Sheets; Supabase is the source of truth.');
    carrybeeRequest_('POST', '', {
      action: 'complete', runId: runId, success: true, leads: leads, logs: logs,
      message: 'Apps Script wrote the full snapshot to Google Sheets.',
    });
  } catch (error) {
    writeBackupStatus_(spreadsheet, 'FAILED', new Date(), 0, 0, String(error && error.message ? error.message : error));
    if (runId) {
      try {
        carrybeeRequest_('POST', '', {
          action: 'complete', runId: runId, success: false, leads: 0, logs: 0,
          message: String(error && error.message ? error.message : error),
        });
      } catch (ignored) {}
    }
    removeStagingSheets_(spreadsheet);
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function carrybeeRequest_(method, path, payload) {
  const response = UrlFetchApp.fetch(CRM_BASE_URL + '/api/backup/apps-script' + (path || ''), {
    method: method,
    contentType: 'application/json',
    payload: payload ? JSON.stringify(payload) : undefined,
    headers: { Authorization: 'Bearer ' + CRM_BACKUP_SECRET },
    muteHttpExceptions: true,
  });
  const text = response.getContentText();
  let body;
  try { body = JSON.parse(text); } catch (error) { throw new Error('CRM returned HTTP ' + response.getResponseCode() + ': ' + text.slice(0, 300)); }
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error(body.error || ('CRM returned HTTP ' + response.getResponseCode()));
  }
  return body;
}

function replaceBackupTabs_(spreadsheet, names) {
  const oldPrefix = 'CB_OLD_';
  names.forEach(name => {
    const old = spreadsheet.getSheetByName(name);
    if (old) old.setName(oldPrefix + name);
  });
  try {
    names.forEach(name => {
      spreadsheet.getSheetByName(STAGING_PREFIX + name).setName(name);
    });
    names.forEach(name => {
      const old = spreadsheet.getSheetByName(oldPrefix + name);
      if (old) spreadsheet.deleteSheet(old);
    });
  } catch (error) {
    // Best-effort rollback: a failed run must not silently discard the last
    // successful backup. New tabs are returned to staging before restoring.
    names.forEach(name => {
      const current = spreadsheet.getSheetByName(name);
      if (current) current.setName(STAGING_PREFIX + name);
    });
    names.forEach(name => {
      const old = spreadsheet.getSheetByName(oldPrefix + name);
      if (old) old.setName(name);
    });
    throw error;
  }
}

function removeStagingSheets_(spreadsheet) {
  spreadsheet.getSheets().forEach(sheet => {
    if (sheet.getName().indexOf(STAGING_PREFIX) === 0) spreadsheet.deleteSheet(sheet);
  });
}

function writeBackupStatus_(spreadsheet, status, at, leads, logs, message) {
  let sheet = spreadsheet.getSheetByName('Backup_Status');
  if (!sheet) sheet = spreadsheet.insertSheet('Backup_Status');
  sheet.clear();
  sheet.getRange(1, 1, 2, 5).setValues([
    ['Status', 'Finished At', 'Leads', 'Call Logs', 'Message'],
    [status, at, leads, logs, message],
  ]);
  SpreadsheetApp.flush();
}

function validateCarrybeeConfig_() {
  if (!BACKUP_SPREADSHEET_ID || BACKUP_SPREADSHEET_ID.indexOf('PASTE_') === 0) {
    throw new Error('Set BACKUP_SPREADSHEET_ID in the script.');
  }
  if (!CRM_BACKUP_SECRET || CRM_BACKUP_SECRET.indexOf('PASTE_') === 0) {
    throw new Error('Set CRM_BACKUP_SECRET in the script.');
  }
}
