import './env';
import { runBackup } from '../lib/backup';

runBackup('manual-script').then(r => console.log(r)).catch(e => { console.error(e); process.exit(1); });
