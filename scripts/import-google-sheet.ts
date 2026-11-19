import './env';
import { sheetsClient } from '../lib/google';
import { importCrmRows } from '../lib/import-rows';

const sourceId = process.env.GOOGLE_SOURCE_SPREADSHEET_ID;
if (!sourceId) throw new Error('Set GOOGLE_SOURCE_SPREADSHEET_ID in .env.local');
const sheets = sheetsClient();
const text = (value: unknown) => String(value ?? '').trim();

async function tab(name: string) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: sourceId!, range: `'${name}'`,
    valueRenderOption: 'FORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING',
  });
  const values = data.values || [];
  if (!values.length) return [];
  const headers = values[0].map(text);
  return values.slice(1)
    .map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])))
    .filter(row => Object.values(row).some(value => text(value)));
}

importCrmRows(tab).catch(error => { console.error(error); process.exit(1); });
