import './env';
import { readFile } from 'node:fs/promises';
import { importCrmRows } from '../lib/import-rows';

const requiredTabs = ['Settings', 'Status_Rules', 'Call_Script', 'Team', 'Lists', 'Leads', 'Call_Log'];

async function main() {
  const path = process.env.IMPORT_WORKBOOK_JSON || 'import-data.json';
  const workbook = JSON.parse(await readFile(path, 'utf8'));
  const missing = requiredTabs.filter(name => !Array.isArray(workbook[name]));
  if (missing.length) throw new Error(`Workbook is missing required tabs: ${missing.join(', ')}`);
  console.log(`Read ${path}; starting workbook migration…`);
  await importCrmRows(async name => workbook[name] || []);
}

main().catch(error => { console.error(error); process.exit(1); });
