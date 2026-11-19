#!/usr/bin/env python3
"""Create blank, production-compatible Google Sheets/Excel templates."""
from pathlib import Path
import json
import os
import urllib.request

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "templates"
OUT.mkdir(exist_ok=True)

RAW_HEADERS = ['Phone','Source','Business ID','Business Name','Merchant Name','Email','Fb Link','Product Category','Parcel Volume','Zone','Area','Existing Courier','Call Time','Status','Reason','Channel','Next Date','Note','Points Covered']
QUEUE_HEADERS = ['Call ID','Assigned To','Ready'] + RAW_HEADERS + ['CRM Lead ID','Sync Status','Error','Last Synced','Raw Key']
CARE_HEADERS = ['Reporting Date','Business ID','Business Name','Consignment ID','First Order Date','Care Days','Care State','CRM Lead ID','Sync Status','Error','Last Synced']
AUTO_STATUS_HEADERS = ['Type','Source Row','Row Key','Business ID','Consignment ID','Status','CRM Lead ID','Message','Last Synced','Content Hash']
ORGANIC_HEADERS = ['Business ID','Business Name','Business Phone','Registration Date (Local)','1st Order Date','Business Email','Merchant Name','Store Address','Profile Completed Flag','Active Payment Method']
ORDER_DUMP_HEADERS = ['Business ID','Business Name','Consignment ID','First Order Date']
STATUS_HEADERS = ['Status','Finished At','New Queue Rows','Calls Imported','Care Reports Imported','Errors','Message','Organic Imported','Organic Skipped']
BACKUP_STATUS_HEADERS = ['Status','Finished At','Leads','Call Logs','Message']
ARCHIVE_HEADERS = ['Backup Date','Archived At','File Name','File URL']

NAVY = '14213D'
TEAL = '0F8B8D'
PALE = 'E8F4F4'
GRAY = 'E9EDF2'
WHITE = 'FFFFFF'
ORANGE = 'F4A261'
THIN = Side(style='thin', color='D8DEE6')


def load_env():
    env = dict(os.environ)
    path = ROOT / '.env.local'
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            env.setdefault(key.strip(), value)
    return env


def get_config():
    env = load_env()
    secret = env.get('CRON_SECRET', '')
    if not secret:
        return {'members': [], 'rules': [], 'channels': ['Phone'], 'careDays': 30}
    request = urllib.request.Request(
        'https://carrybee-lead-crm.vercel.app/api/sheets-intake',
        headers={'Authorization': f'Bearer {secret}'},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def title(wb, text, subtitle):
    ws = wb.active
    ws.title = 'START_HERE'
    ws.sheet_view.showGridLines = False
    ws.column_dimensions['A'].width = 4
    ws.column_dimensions['B'].width = 30
    ws.column_dimensions['C'].width = 100
    ws.row_dimensions[1].height = 36
    ws.merge_cells('B2:C2')
    ws['B2'] = text
    ws['B2'].font = Font(size=20, bold=True, color=WHITE)
    ws['B2'].fill = PatternFill('solid', fgColor=NAVY)
    ws['B2'].alignment = Alignment(vertical='center')
    ws.row_dimensions[2].height = 42
    ws.merge_cells('B3:C3')
    ws['B3'] = subtitle
    ws['B3'].font = Font(size=11, italic=True, color='42526A')
    ws['B3'].alignment = Alignment(wrap_text=True, vertical='center')
    ws.row_dimensions[3].height = 36
    ws.freeze_panes = 'B5'
    return ws


def instruction_rows(ws, rows):
    row = 5
    for heading, detail in rows:
        ws.cell(row, 2, heading)
        ws.cell(row, 3, detail)
        ws.cell(row, 2).font = Font(bold=True, color=NAVY)
        ws.cell(row, 2).fill = PatternFill('solid', fgColor=PALE)
        ws.cell(row, 3).fill = PatternFill('solid', fgColor='F8FAFC')
        for col in (2, 3):
            cell = ws.cell(row, col)
            cell.alignment = Alignment(wrap_text=True, vertical='top')
            cell.border = Border(bottom=THIN)
        ws.row_dimensions[row].height = max(32, 16 * (detail.count('\n') + 1))
        row += 1


def make_table(wb, name, headers, widths=None, output_from=None):
    ws = wb.create_sheet(name)
    ws.sheet_view.showGridLines = False
    ws.append(headers)
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = f'A1:{get_column_letter(len(headers))}1'
    ws.row_dimensions[1].height = 34
    for index, header in enumerate(headers, 1):
        cell = ws.cell(1, index)
        cell.font = Font(bold=True, color=WHITE)
        cell.fill = PatternFill('solid', fgColor=GRAY if output_from and index >= output_from else TEAL)
        if output_from and index >= output_from:
            cell.font = Font(bold=True, color=NAVY)
        cell.alignment = Alignment(wrap_text=True, vertical='center')
        cell.border = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
        width = (widths or {}).get(header, min(max(len(header) + 4, 13), 28))
        ws.column_dimensions[get_column_letter(index)].width = width
    return ws


def add_list_validation(wb, list_ws, column, values, range_name, target_ws, target_column):
    list_ws.cell(1, column, range_name)
    for row, value in enumerate(values, 2):
        list_ws.cell(row, column, value)
    letter = get_column_letter(column)
    ref = f"'_Lists'!${letter}$2:${letter}${len(values) + 1}"
    wb.defined_names.add(DefinedName(range_name, attr_text=ref))
    validation = DataValidation(type='list', formula1=f'={range_name}', allow_blank=True)
    validation.error = 'Choose a value from the dropdown.'
    validation.errorTitle = 'Invalid selection'
    validation.prompt = 'Select from the list. The Apps Script refreshes these choices from the CRM.'
    validation.promptTitle = 'Carrybee CRM'
    validation.showErrorMessage = True
    validation.showInputMessage = True
    target_ws.add_data_validation(validation)
    target_letter = get_column_letter(target_column)
    validation.add(f'{target_letter}2:{target_letter}1000')


def build_input(config):
    wb = Workbook()
    ws = title(wb, 'Carrybee CRM — Input Template', 'Upload this workbook to Google Sheets as the dedicated INPUT spreadsheet. Do not use it as the backup spreadsheet.')
    instruction_rows(ws, [
        ('1. Upload', 'In Google Drive: New → File upload → select this file. Open with Google Sheets, then use File → Save as Google Sheets if needed.'),
        ('2. Install script', 'Extensions → Apps Script. Replace the editor contents with CarrybeeInput.gs from the setup package. Replace PASTE_CRON_SECRET with the private CRON_SECRET from Vercel. Save.'),
        ('3. Authorize/setup', 'Run setupCarrybeeInput and approve Google’s permissions. Reload the sheet. The Carrybee CRM menu will appear.'),
        ('4. Paste raw leads', 'Use Data_Dump only for raw pasted rows. Keep every header unchanged. Phone and Call Time are especially important; do not paste fake/example data.'),
        ('5. Approve calls', 'Run Sync now to move new raw rows into Call_Queue. Choose Assigned To, confirm Call Time/Status, then set Ready = YES only for approved rows.'),
        ('6. Automatic feeds', 'Data_Dump_2 supplies new Self Registered merchants after the legacy cutoff; 1st_Order_Date_Dump supplies first-order reports. Keep these feeds connected and do not bulk-paste legacy rows.'),
        ('7. Care Period', 'Fill Reporting Date, Business ID, Business Name, Consignment ID, and First Order Date for manual reports. The remaining six columns are script outputs.'),
        ('8. Review', 'After Sync now, check Input_Status, Call_Queue, Care_Period, and Auto_Sync_Status. Valid rows import even when another row has an error.'),
        ('9. Activate', 'Only after a clean real manual sync, use Carrybee CRM → Activate 5-minute input sync. Rows marked Ready = NO are never imported.'),
        ('Date format', 'Prefer real spreadsheet date cells. Typed dates may use YYYY-MM-DD or legacy M/D/YYYY. Date-times without a timezone are interpreted as Asia/Dhaka.'),
        ('Color key', 'Teal headers = enter/review data. Gray headers = script output; do not edit. Raw Key is a hidden internal deduplication column.'),
    ])
    widths = {'Phone': 18, 'Business ID': 22, 'Business Name': 28, 'Merchant Name': 25, 'Email': 28, 'Fb Link': 32, 'Call Time': 23, 'Next Date': 16, 'Note': 45, 'Points Covered': 20, 'Call ID': 30, 'Assigned To': 38, 'Ready': 12, 'CRM Lead ID': 20, 'Sync Status': 16, 'Error': 45, 'Last Synced': 23, 'Raw Key': 28, 'Consignment ID': 25, 'First Order Date': 18, 'Reporting Date': 18, 'Care Days': 14, 'Care State': 22, 'Message': 70, 'Finished At': 23}
    dump = make_table(wb, 'Data_Dump', RAW_HEADERS, widths)
    queue = make_table(wb, 'Call_Queue', QUEUE_HEADERS, widths, output_from=QUEUE_HEADERS.index('CRM Lead ID') + 1)
    care = make_table(wb, 'Care_Period', CARE_HEADERS, widths, output_from=6)
    make_table(wb, 'Data_Dump_2', ORGANIC_HEADERS, widths)
    make_table(wb, '1st_Order_Date_Dump', ORDER_DUMP_HEADERS, widths)
    make_table(wb, 'Auto_Sync_Status', AUTO_STATUS_HEADERS, widths, output_from=6)
    status = make_table(wb, 'Input_Status', STATUS_HEADERS, widths)
    status.append(['', '', '', '', '', '', 'Run setupCarrybeeInput, then Sync now.', '', ''])
    status.column_dimensions['G'].width = 80

    comments = {
        'Phone': 'Bangladeshi mobile number. The CRM normalizes local and +880 forms.',
        'Call ID': 'Generated by the script. Do not change or reuse it for another lead.',
        'Assigned To': 'Choose an active agent from the dropdown.',
        'Ready': 'Only YES rows are submitted. Keep NO until the row is reviewed.',
        'Call Time': 'Required for call import. Use a spreadsheet date-time cell when possible.',
        'Points Covered': 'Optional numbers 1–7, separated by commas or vertical bars.',
        'Consignment ID': 'Required unique Care report key. Retrying the same ID updates rather than duplicates.',
        'First Order Date': 'Required. The earliest valid report for a unique Business ID starts Care Period.',
        'Raw Key': 'Internal raw-row deduplication hash. Do not edit.',
    }
    for sheet in (dump, queue, care):
        for cell in sheet[1]:
            if cell.value in comments:
                cell.comment = Comment(comments[cell.value], 'Carrybee CRM')

    lists = wb.create_sheet('_Lists')
    labels = [f"{m['name']} | {m['team']} | {m['id'][:8]}" for m in config.get('members', [])]
    statuses = [r['status'] for r in config.get('rules', [])]
    channels = config.get('channels') or ['Phone']
    if labels:
        add_list_validation(wb, lists, 1, labels, 'TeamLabels', queue, 2)
    if statuses:
        add_list_validation(wb, lists, 2, statuses, 'CallStatuses', queue, QUEUE_HEADERS.index('Status') + 1)
    add_list_validation(wb, lists, 3, channels, 'CallChannels', queue, QUEUE_HEADERS.index('Channel') + 1)
    add_list_validation(wb, lists, 4, ['NO', 'YES'], 'ReadyChoices', queue, 3)
    lists.sheet_state = 'hidden'

    for row in range(2, 1001):
        queue.cell(row, QUEUE_HEADERS.index('Call Time') + 1).number_format = 'yyyy-mm-dd hh:mm'
        queue.cell(row, QUEUE_HEADERS.index('Next Date') + 1).number_format = 'yyyy-mm-dd'
        queue.cell(row, QUEUE_HEADERS.index('Last Synced') + 1).number_format = 'yyyy-mm-dd hh:mm'
        care.cell(row, 1).number_format = 'yyyy-mm-dd'
        care.cell(row, 5).number_format = 'yyyy-mm-dd'
        care.cell(row, 11).number_format = 'yyyy-mm-dd hh:mm'
    queue.column_dimensions[get_column_letter(len(QUEUE_HEADERS))].hidden = True
    wb.active = 0
    path = OUT / 'Carrybee_Input_Template.xlsx'
    wb.save(path)
    return path, len(labels), len(statuses), len(channels)


def build_backup():
    wb = Workbook()
    ws = title(wb, 'Carrybee CRM — Backup Template', 'Upload this workbook to Google Sheets as a separate BACKUP spreadsheet. Supabase remains the only live operational database.')
    instruction_rows(ws, [
        ('1. Upload', 'Upload this file separately from the Input template and open it with Google Sheets.'),
        ('2. Copy spreadsheet ID', 'Copy the long ID between /d/ and the next / in the backup spreadsheet URL.'),
        ('3. Install script', 'Extensions → Apps Script. Replace the editor contents with CarrybeeBackup.gs from the setup package.'),
        ('4. Private settings', 'Replace PASTE_BACKUP_SPREADSHEET_ID with this sheet’s ID and PASTE_CRON_SECRET with the private CRON_SECRET from Vercel. Save.'),
        ('5. Authorize', 'Run setupCarrybeeBackup using a Google account that can edit this sheet and create Drive copies.'),
        ('6. Manual backup', 'Run testCarrybeeBackup. Wait for completion. Confirm Backup_Status!A2 = SUCCESS, 11,119 leads, 15,469 call logs, and the expected data tabs.'),
        ('7. Activate separately', 'Only after the real manual backup succeeds, run activateCarrybeeSchedule once. Do not activate based only on an API test.'),
        ('Dhaka schedule', 'Saturday–Thursday: hourly 10:00–20:00. Friday: 10:00, 15:00, 20:00. The 20:00 run creates a dated final Drive copy.'),
        ('Automatic data tabs', 'Leads, Call_Log, Care_Period, Team, Settings, Status_Rules, Lists, Lead_Sources, Call_Script, and Dashboard are created/replaced by the script. Do not create or edit them manually.'),
        ('Failure safety', 'New data is staged in temporary tabs. The previous successful tabs are replaced only after all chunks download. See APPS_SCRIPT_BACKUP.md for recovery details.'),
    ])
    status = make_table(wb, 'Backup_Status', BACKUP_STATUS_HEADERS, {'Status': 18, 'Finished At': 24, 'Leads': 16, 'Call Logs': 16, 'Message': 85})
    status.append(['NOT RUN', '', '', '', 'Run setupCarrybeeBackup, then testCarrybeeBackup. Do not activate the schedule yet.'])
    status['A2'].fill = PatternFill('solid', fgColor=ORANGE)
    status['A2'].font = Font(bold=True, color=NAVY)
    archives = make_table(wb, 'Daily_Archives', ARCHIVE_HEADERS, {'Backup Date': 18, 'Archived At': 24, 'File Name': 40, 'File URL': 80})
    archives['A2'] = 'Created automatically after the 20:00 Dhaka backup.'
    archives.merge_cells('A2:D2')
    archives['A2'].font = Font(italic=True, color='667085')
    wb.active = 0
    path = OUT / 'Carrybee_Backup_Template.xlsx'
    wb.save(path)
    return path


if __name__ == '__main__':
    config = get_config()
    input_path, teams, statuses, channels = build_input(config)
    backup_path = build_backup()
    print(json.dumps({'input': str(input_path), 'backup': str(backup_path), 'dropdowns': {'teamMembers': teams, 'statuses': statuses, 'channels': channels}}, indent=2))
