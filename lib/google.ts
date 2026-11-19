import { google } from 'googleapis';

export function googleAuth(scopes = ['https://www.googleapis.com/auth/spreadsheets']) {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !privateKey) throw new Error('Google service-account environment variables are not configured.');
  return new google.auth.JWT({ email, key: privateKey, scopes });
}
export function sheetsClient() {
  return google.sheets({ version: 'v4', auth: googleAuth() });
}
