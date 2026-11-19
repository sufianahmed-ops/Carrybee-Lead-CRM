/** Carrybee CRM input spreadsheet. Bound to the INPUT spreadsheet, not the backup spreadsheet. */
const CRM_BASE_URL = 'https://carrybee-lead-crm.vercel.app';
const CRM_BACKUP_SECRET = 'PASTE_CRON_SECRET';
const RAW_HEADERS = ['Phone','Source','Business ID','Business Name','Merchant Name','Email','Fb Link','Product Category','Parcel Volume','Zone','Area','Existing Courier','Call Time','Status','Reason','Channel','Next Date','Note','Points Covered'];
const QUEUE_HEADERS = ['Call ID','Assigned To','Ready'].concat(RAW_HEADERS).concat(['CRM Lead ID','Sync Status','Error','Last Synced','Raw Key']);
const CARE_HEADERS = ['Reporting Date','Business ID','Business Name','Consignment ID','First Order Date','Care Days','Care State','CRM Lead ID','Sync Status','Error','Last Synced'];
const AUTO_STATUS_HEADERS = ['Type','Source Row','Row Key','Business ID','Consignment ID','Status','CRM Lead ID','Message','Last Synced','Content Hash'];
const ORGANIC_HEADERS = ['Business ID','Business Name','Business Phone','Registration Date (Local)','1st Order Date','Business Email','Merchant Name','Store Address','Profile Completed Flag','Active Payment Method'];
const ORDER_DUMP_HEADERS = ['Business ID','Business Name','Consignment ID','First Order Date'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Carrybee CRM').addItem('Setup / refresh dropdowns','setupCarrybeeInput').addItem('Sync now','testCarrybeeInput').addItem('Activate 30-minute input sync','activateCarrybeeInputSchedule').addToUi();
}

function setupCarrybeeInput() {
  validateInputConfig_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss,'Data_Dump',RAW_HEADERS);
  ensureSheet_(ss,'Call_Queue',QUEUE_HEADERS);
  ensureSheet_(ss,'Care_Period',CARE_HEADERS);
  ensureSheet_(ss,'Auto_Sync_Status',AUTO_STATUS_HEADERS);
  const config = inputRequest_('GET');
  applyDropdowns_(ss,config);
  SpreadsheetApp.getUi().alert('Input tabs and automatic dumps are ready. Run Sync now, review all results, then activate the 30-minute sync.');
}

function testCarrybeeInput() {
  syncCarrybeeInput();
  SpreadsheetApp.getUi().alert('Sync finished. Review Call_Queue, Care_Period, Auto_Sync_Status, and Input_Status before activating the schedule.');
}

function activateCarrybeeInputSchedule() {
  const status = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Input_Status');
  if (!status || status.getRange('A2').getValue() !== 'SUCCESS') throw new Error('Run Sync now and obtain SUCCESS before activating the schedule.');
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'syncCarrybeeInput') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncCarrybeeInput').timeBased().everyMinutes(30).create();
  SpreadsheetApp.getUi().alert('Input sync is active every 30 minutes. Approved calls, new self-registered rows, and changed first-order reports will synchronize automatically. You no longer need to press Sync now manually.');
}

function syncCarrybeeInput() {
  validateInputConfig_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    const config = inputRequest_('GET');
    applyDropdowns_(ss,config);
    const autoSheet = ensureSheet_(ss,'Auto_Sync_Status',AUTO_STATUS_HEADERS);
    const autoExisting = readAutoStatus_(autoSheet);
    const added = buildCallQueue_(ss);
    const calls = collectReadyCalls_(ss,config);
    const care = collectCareReports_(ss,config.careDays);
    const organic = collectOrganicRows_(ss,config.legacyCutoff,autoExisting);
    const orders = collectOrderDumpRows_(ss,autoExisting);
    const response = syncRequests_(calls.payload,care.payload.concat(orders.payload),organic.payload);
    updateCallResults_(ss,calls.rows,Object.assign(calls.localResults,response.calls));
    updateCareResults_(ss,care.rows,Object.assign(care.localResults,response.careReports),config.careDays);
    updateAutoStatus_(autoSheet,autoExisting,organic.tracked.concat(orders.tracked),Object.assign(organic.localResults,response.organic),Object.assign(orders.localResults,response.careReports));
    const errors = countErrors_(ss);
    const counts = Object.assign({},response.counts,{errors:errors});
    const message = 'Self Registered: ' + counts.organicImported + ' new, ' + counts.organicSkipped + ' existing preserved; ' + organic.legacySkipped + ' legacy cutoff rows skipped; ' + (organic.unchanged + orders.unchanged) + ' unchanged automatic rows.';
    writeInputStatus_(ss,errors ? 'ATTENTION' : 'SUCCESS',added,counts,errors ? 'Review row-level Error/Message columns; errored rows were not imported. ' + message : message);
  } catch (error) {
    writeInputStatus_(ss,'ATTENTION',0,{errors:1},String(error && error.message ? error.message : error));
    throw error;
  } finally { lock.releaseLock(); }
}

function syncRequests_(callRows,careRows,organicRows) {
  const combined = {calls:{},careReports:{},organic:{},counts:{callsImported:0,careImported:0,organicImported:0,organicSkipped:0,errors:0}};
  let callIndex = 0, careIndex = 0, organicIndex = 0;
  while (callIndex < callRows.length || careIndex < careRows.length || organicIndex < organicRows.length) {
    const calls = callRows.slice(callIndex,callIndex+100);
    const care = careRows.slice(careIndex,careIndex+200);
    const organic = organicRows.slice(organicIndex,organicIndex+200);
    callIndex += calls.length; careIndex += care.length; organicIndex += organic.length;
    const response = inputRequest_('POST',{action:'sync',calls:calls,careReports:care,organicRows:organic});
    Object.assign(combined.calls,response.calls || {});
    Object.assign(combined.careReports,response.careReports || {});
    Object.assign(combined.organic,response.organic || {});
    Object.keys(combined.counts).forEach(key => { combined.counts[key] += Number(response.counts && response.counts[key] || 0); });
  }
  return combined;
}

function collectOrganicRows_(ss,cutoff,existing) {
  const sheet = ss.getSheetByName('Data_Dump_2');
  const result = {payload:[],tracked:[],localResults:{},legacySkipped:0,unchanged:0};
  if (!sheet) return result;
  rowObjects_(sheet).forEach(item => {
    const value = name => cell_(item.values[item.index[name]]);
    const bid = value('Business ID'), phone = value('Business Phone');
    if (!bid && !phone) return;
    const registrationDate = isoDate_(item.values[item.index['Registration Date (Local)']]);
    if (validDate_(registrationDate) && cutoff && registrationDate <= cutoff) { result.legacySkipped++; return; }
    const normalized = ORGANIC_HEADERS.map(name => normalizedCell_(item.values[item.index[name]]));
    const hash = hashValue_(normalized);
    const rowKey = 'DD2-' + (bid || phone || item.row);
    if (existing[rowKey] && existing[rowKey].hash === hash) { result.unchanged++; return; }
    result.tracked.push({kind:'organic',rowKey:rowKey,hash:hash,sourceRow:item.row,businessId:bid,consignmentId:''});
    try {
      if (!bid) throw new Error('Business ID is required for self-registered intake.');
      if (!phone) throw new Error('Business Phone is required.');
      if (!validDate_(registrationDate)) throw new Error('Registration Date must be a valid date.');
      if (cutoff && registrationDate <= cutoff) throw new Error('Registration Date is on or before the legacy cutoff.');
      result.payload.push({rowKey:rowKey,registrationDate:registrationDate,phone:phone,businessId:bid,businessName:value('Business Name'),merchantName:value('Merchant Name'),email:value('Business Email'),storeAddress:value('Store Address'),profileCompleted:value('Profile Completed Flag'),activePaymentMethod:value('Active Payment Method')});
    } catch (error) { result.localResults[rowKey] = {ok:false,error:String(error && error.message ? error.message : error)}; }
  });
  return result;
}

function collectOrderDumpRows_(ss,existing) {
  const sheet = ss.getSheetByName('1st_Order_Date_Dump');
  const result = {payload:[],tracked:[],localResults:{},unchanged:0};
  if (!sheet) return result;
  const today = Utilities.formatDate(new Date(),'Asia/Dhaka','yyyy-MM-dd');
  rowObjects_(sheet).forEach(item => {
    const value = name => cell_(item.values[item.index[name]]);
    const bid = value('Business ID'), cid = value('Consignment ID');
    if (!bid && !cid) return;
    const normalized = ORDER_DUMP_HEADERS.map(name => normalizedCell_(item.values[item.index[name]]));
    const hash = hashValue_(normalized);
    const rowKey = 'ORDER-' + (cid || item.row);
    if (existing[rowKey] && existing[rowKey].hash === hash) { result.unchanged++; return; }
    result.tracked.push({kind:'care',rowKey:rowKey,hash:hash,sourceRow:item.row,businessId:bid,consignmentId:cid});
    try {
      const firstOrderDate = isoDate_(item.values[item.index['First Order Date']]);
      if (!bid || !cid) throw new Error('Business ID and Consignment ID are required.');
      if (!validDate_(firstOrderDate)) throw new Error('First Order Date must be a valid date.');
      result.payload.push({reportingDate:today,businessId:bid,businessName:value('Business Name'),consignmentId:cid,firstOrderDate:firstOrderDate,sourceRow:'1st_Order_Date_Dump!'+item.row});
    } catch (error) { result.localResults[rowKey] = {ok:false,error:String(error && error.message ? error.message : error)}; }
  });
  return result;
}

function readAutoStatus_(sheet) {
  const existing = {};
  if (sheet.getLastRow() < 2) return existing;
  sheet.getRange(2,1,sheet.getLastRow()-1,AUTO_STATUS_HEADERS.length).getValues().forEach((row,index) => {
    if (row[2]) existing[row[2]] = {row:index+2,hash:String(row[9] || '')};
  });
  return existing;
}

function updateAutoStatus_(sheet,existing,tracked,organicResults,careResults) {
  const unique = {};
  tracked.forEach(track => { unique[track.rowKey] = track; });
  const additions = [];
  Object.keys(unique).forEach(key => {
    const track = unique[key];
    const result = track.kind === 'organic' ? (organicResults[key] || {ok:false,error:'No result returned.'}) : (careResults[track.consignmentId] || careResults[key] || {ok:false,error:'No result returned.'});
    let status = 'ERROR', message = result.error || '';
    if (result.ok) {
      status = track.kind === 'organic' && result.status && result.status !== 'inserted' ? 'SKIPPED' : 'SYNCED';
      message = status === 'SKIPPED' ? 'Existing CRM lead preserved; no overwrite or duplicate.' : 'Synchronized.';
    }
    const values = [track.kind === 'organic' ? 'Self Registered' : 'First Order',track.sourceRow,track.rowKey,track.businessId,track.consignmentId,status,result.leadId || '',message,new Date(),track.hash];
    if (existing[key]) sheet.getRange(existing[key].row,1,1,AUTO_STATUS_HEADERS.length).setValues([values]);
    else additions.push(values);
  });
  if (additions.length) {
    const required = sheet.getLastRow() + additions.length;
    if (required > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(),required-sheet.getMaxRows());
    sheet.getRange(sheet.getLastRow()+1,1,additions.length,AUTO_STATUS_HEADERS.length).setValues(additions);
  }
  SpreadsheetApp.flush();
}

function buildCallQueue_(ss) {
  const raw = ss.getSheetByName('Data_Dump');
  const queue = ss.getSheetByName('Call_Queue');
  ensureHeaders_(raw,RAW_HEADERS); ensureHeaders_(queue,QUEUE_HEADERS);
  const rawRows = rowObjects_(raw);
  const existing = {};
  if (queue.getLastRow() > 1) queue.getRange(2,1,queue.getLastRow()-1,QUEUE_HEADERS.length).getValues().forEach(row => { if (row[QUEUE_HEADERS.indexOf('Raw Key')]) existing[row[QUEUE_HEADERS.indexOf('Raw Key')]] = true; });
  const additions = [];
  rawRows.forEach(item => {
    if (!String(item.values[item.index.Phone] || '').trim()) return;
    const normalized = RAW_HEADERS.map(h => normalizedCell_(item.values[item.index[h]]));
    const key = hashValue_(normalized);
    if (existing[key]) return;
    const output = Array(QUEUE_HEADERS.length).fill('');
    output[0] = 'SQ-' + key.slice(0,24); output[2] = 'NO';
    RAW_HEADERS.forEach(h => { output[QUEUE_HEADERS.indexOf(h)] = item.values[item.index[h]]; });
    output[QUEUE_HEADERS.indexOf('Raw Key')] = key;
    additions.push(output); existing[key] = true;
  });
  if (additions.length) queue.getRange(queue.getLastRow()+1,1,additions.length,QUEUE_HEADERS.length).setValues(additions);
  queue.setFrozenRows(1); queue.autoResizeColumns(1,Math.min(8,QUEUE_HEADERS.length));
  return additions.length;
}

function collectReadyCalls_(ss,config) {
  const sheet = ss.getSheetByName('Call_Queue');
  const data = rowObjects_(sheet); const rows = []; const payload = []; const localResults = {};
  const members = {}; config.members.forEach(m => { members[memberLabel_(m)] = m; });
  data.forEach(item => {
    if (String(item.values[item.index.Ready] || '').toUpperCase() !== 'YES') return;
    const agent = members[String(item.values[item.index['Assigned To']] || '').trim()];
    const row = item.row; rows.push(row); const id = String(item.values[item.index['Call ID']] || '').trim();
    try {
      if (!agent) throw new Error('Choose an active agent from Assigned To.');
      if (!cell_(item.values[item.index.Status])) throw new Error('Choose a call Status.');
      if (!isoDateTime_(item.values[item.index['Call Time']])) throw new Error('Enter a valid Call Time.');
      if (item.values[item.index['Next Date']] && !validDate_(isoDate_(item.values[item.index['Next Date']]))) throw new Error('Next Date must be YYYY-MM-DD or M/D/YYYY.');
      const points = String(item.values[item.index['Points Covered']] || '').split(/[|,]/).map(x => Number(x.trim())).filter(n => Number.isInteger(n) && n>=1 && n<=7);
      payload.push({
      logId:id,phone:cell_(item.values[item.index.Phone]),source:cell_(item.values[item.index.Source]),
      businessId:cell_(item.values[item.index['Business ID']]),businessName:cell_(item.values[item.index['Business Name']]),merchantName:cell_(item.values[item.index['Merchant Name']]),email:cell_(item.values[item.index.Email]),fbLink:cell_(item.values[item.index['Fb Link']]),productCategory:cell_(item.values[item.index['Product Category']]),parcelVolume:cell_(item.values[item.index['Parcel Volume']]),zone:cell_(item.values[item.index.Zone]),area:cell_(item.values[item.index.Area]),existingCourier:cell_(item.values[item.index['Existing Courier']]),
      assignedTo:agent.id,assignDate:'',callTime:isoDateTime_(item.values[item.index['Call Time']]),status:cell_(item.values[item.index.Status]),reason:cell_(item.values[item.index.Reason]),channel:cell_(item.values[item.index.Channel]),nextDate:isoDate_(item.values[item.index['Next Date']]),note:cell_(item.values[item.index.Note]),points:points,
      });
    } catch (error) { localResults[id] = {ok:false,error:String(error && error.message ? error.message : error)}; }
  });
  return {rows:rows,payload:payload,localResults:localResults};
}

function collectCareReports_(ss,careDays) {
  const sheet = ss.getSheetByName('Care_Period'); const data = rowObjects_(sheet); const rows = []; const payload = []; const localResults = {};
  data.forEach(item => {
    const businessId = cell_(item.values[item.index['Business ID']]); const cid = cell_(item.values[item.index['Consignment ID']]);
    if (!businessId && !cid) return;
    rows.push(item.row);
    try {
      const report = {reportingDate:isoDate_(item.values[item.index['Reporting Date']]),businessId:businessId,businessName:cell_(item.values[item.index['Business Name']]),consignmentId:cid,firstOrderDate:isoDate_(item.values[item.index['First Order Date']]),sourceRow:String(item.row)};
      if (!businessId || !cid) throw new Error('Business ID and Consignment ID are required.');
      if (!validDate_(report.reportingDate) || !validDate_(report.firstOrderDate)) throw new Error('Reporting Date and First Order Date must be valid dates.');
      payload.push(report); updateCareCalculation_(sheet,item.row,report.firstOrderDate,careDays);
    } catch (error) { localResults[cid || ('ROW-'+item.row)] = {ok:false,error:String(error && error.message ? error.message : error)}; }
  });
  return {rows:rows,payload:payload,localResults:localResults};
}

function updateCallResults_(ss,rows,results) {
  const sheet = ss.getSheetByName('Call_Queue');
  rows.forEach(row => {
    const id = sheet.getRange(row,1).getValue(); const result = results[id] || {ok:false,error:'No result returned.'};
    sheet.getRange(row,QUEUE_HEADERS.indexOf('CRM Lead ID')+1).setValue(result.leadId || '');
    sheet.getRange(row,QUEUE_HEADERS.indexOf('Sync Status')+1).setValue(result.ok ? 'SYNCED' : 'ERROR');
    sheet.getRange(row,QUEUE_HEADERS.indexOf('Error')+1).setValue(result.error || '');
    sheet.getRange(row,QUEUE_HEADERS.indexOf('Last Synced')+1).setValue(new Date());
  });
}

function updateCareResults_(ss,rows,results,careDays) {
  const sheet = ss.getSheetByName('Care_Period');
  rows.forEach(row => {
    const cid = sheet.getRange(row,4).getValue(); const result = results[cid] || results['ROW-'+row] || {ok:false,error:'No result returned.'};
    sheet.getRange(row,8).setValue(result.leadId || ''); sheet.getRange(row,9).setValue(result.ok ? 'SYNCED' : 'ERROR');
    sheet.getRange(row,10).setValue(result.error || ''); sheet.getRange(row,11).setValue(new Date());
    updateCareCalculation_(sheet,row,isoDate_(sheet.getRange(row,5).getValue()),careDays);
  });
}

function updateCareCalculation_(sheet,row,firstOrder,careDays) {
  if (!firstOrder) return;
  const start = new Date(firstOrder+'T00:00:00Z'); const today = Utilities.formatDate(new Date(),'Asia/Dhaka','yyyy-MM-dd');
  const days = Math.floor((new Date(today+'T00:00:00Z')-start)/86400000);
  sheet.getRange(row,6).setValue(days); sheet.getRange(row,7).setValue(days>=careDays ? 'Care Completed' : Math.max(0,careDays-days)+' days left');
}

function applyDropdowns_(ss,config) {
  const queue = ss.getSheetByName('Call_Queue'); const n = Math.max(queue.getMaxRows()-1,1000);
  const labels = config.members.map(memberLabel_);
  queue.getRange(2,2,n).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(labels,true).setAllowInvalid(false).build());
  queue.getRange(2,3,n).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['NO','YES'],true).setAllowInvalid(false).build());
  queue.getRange(2,QUEUE_HEADERS.indexOf('Status')+1,n).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(config.rules.map(r=>r.status),true).setAllowInvalid(false).build());
  queue.getRange(2,QUEUE_HEADERS.indexOf('Channel')+1,n).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(config.channels,true).setAllowInvalid(false).build());
  queue.hideColumns(QUEUE_HEADERS.indexOf('Raw Key')+1);
}

function countErrors_(ss) {
  let count = 0;
  [['Call_Queue',QUEUE_HEADERS.indexOf('Sync Status')+1],['Care_Period',9],['Auto_Sync_Status',6]].forEach(pair => {
    const sheet=ss.getSheetByName(pair[0]); if(sheet && sheet.getLastRow()>1) sheet.getRange(2,pair[1],sheet.getLastRow()-1).getValues().forEach(r=>{if(r[0]==='ERROR')count++;});
  }); return count;
}
function writeInputStatus_(ss,status,added,counts,message) {
  const sheet=ensureSheet_(ss,'Input_Status',['Status','Finished At','New Queue Rows','Calls Imported','Care Reports Imported','Errors','Message','Organic Imported','Organic Skipped']);
  sheet.getRange(2,1,1,9).setValues([[status,new Date(),added||0,counts.callsImported||0,counts.careImported||0,counts.errors||0,message,counts.organicImported||0,counts.organicSkipped||0]]); SpreadsheetApp.flush();
}
function ensureSheet_(ss,name,headers) { const sheet=ss.getSheetByName(name)||ss.insertSheet(name); ensureHeaders_(sheet,headers); sheet.setFrozenRows(1); return sheet; }
function ensureHeaders_(sheet,headers) { if(sheet.getLastRow()===0) sheet.getRange(1,1,1,headers.length).setValues([headers]); else { const actual=sheet.getRange(1,1,1,headers.length).getValues()[0]; headers.forEach((h,i)=>{if(!actual[i])sheet.getRange(1,i+1).setValue(h);}); } }
function rowObjects_(sheet) { if(sheet.getLastRow()<2)return []; const headers=sheet.getRange(1,1,1,sheet.getLastColumn()).getDisplayValues()[0]; const index={};headers.forEach((h,i)=>index[h]=i); return sheet.getRange(2,1,sheet.getLastRow()-1,sheet.getLastColumn()).getValues().map((values,i)=>({values:values,index:index,row:i+2})); }
function normalizedCell_(v) { return Object.prototype.toString.call(v)==='[object Date]' ? Utilities.formatDate(v,'Asia/Dhaka',"yyyy-MM-dd'T'HH:mm:ss") : String(v==null?'':v).trim(); }
function hashValue_(value) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(value)).map(b => ('0'+((b+256)%256).toString(16)).slice(-2)).join('').toUpperCase(); }
function cell_(v) { return normalizedCell_(v); }
function isoDate_(v) { if(!v)return ''; if(Object.prototype.toString.call(v)==='[object Date]')return Utilities.formatDate(v,'Asia/Dhaka','yyyy-MM-dd'); const s=String(v).trim(); const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m)return m[1]+'-'+m[2]+'-'+m[3]; const slash=s.match(/^(\d{1,2})\/(\\d{1,2})\/(\\d{4})$/); if(slash)return slash[3]+'-'+('0'+slash[1]).slice(-2)+'-'+('0'+slash[2]).slice(-2); return s; }
function isoDateTime_(v) { if(Object.prototype.toString.call(v)==='[object Date]')return v.toISOString(); if(!v)return ''; const s=String(v).trim(); if(/^\d{4}-\d{2}-\d{2}T/.test(s)){const exact=new Date(s);if(isNaN(exact.getTime()))return 'INVALID';return exact.toISOString();} const date=isoDate_(s); if(!validDate_(date))return 'INVALID'; const time=s.match(/(\d{1,2}):(\d{2})/); if(time&&(Number(time[1])>23||Number(time[2])>59))return 'INVALID'; return new Date(date+'T'+(time?('0'+time[1]).slice(-2)+':'+time[2]:'00:00')+':00+06:00').toISOString(); }
function validDate_(value) { if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false; const d=new Date(value+'T00:00:00Z'); return !isNaN(d.getTime()) && d.toISOString().slice(0,10)===value && value>='2000-01-01'; }
function memberLabel_(m) { return m.name+' | '+m.team+' | '+m.id.slice(0,8); }
function inputRequest_(method,payload) { const response=UrlFetchApp.fetch(CRM_BASE_URL+'/api/sheets-intake',{method:method,contentType:'application/json',payload:payload?JSON.stringify(payload):undefined,headers:{Authorization:'Bearer '+CRM_BACKUP_SECRET},muteHttpExceptions:true}); const text=response.getContentText(); let body;try{body=JSON.parse(text);}catch(e){throw new Error('CRM HTTP '+response.getResponseCode()+': '+text.slice(0,300));} if(response.getResponseCode()<200||response.getResponseCode()>=300)throw new Error(body.error||'CRM request failed.');return body; }
function validateInputConfig_() { if(!CRM_BACKUP_SECRET||CRM_BACKUP_SECRET.indexOf('PASTE_')===0)throw new Error('Set CRM_BACKUP_SECRET in the input script.'); }
