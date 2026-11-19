import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const baseUrl = (process.env.APP_URL || 'https://carrybee-lead-crm.vercel.app').replace(/\/$/, '');
const credentials = readFileSync(new URL('../temporary-team-passwords.md', import.meta.url), 'utf8')
  .split('\n').find(line => line.includes('| Mohammad Sazzad Haider |'))
  ?.split('|').map(value => value.trim());
assert(credentials?.length >= 4, 'Team-lead QA credentials were not found');
const email = credentials[2];
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: link, error: linkError } = await admin.auth.admin.generateLink({
  type: 'magiclink', email, options: { redirectTo: `${baseUrl}/auth/callback` },
});
assert.ifError(linkError);
assert(link.properties?.action_link, 'A one-time QA sign-in link was not generated');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));

try {
  await page.goto(link.properties.action_link, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const fragment = new URLSearchParams(new URL(page.url()).hash.slice(1));
  const accessToken = fragment.get('access_token');
  const refreshToken = fragment.get('refresh_token');
  assert(accessToken && refreshToken, 'The one-time link did not return a browser session');
  const userResponse = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, authorization: `Bearer ${accessToken}` },
  });
  assert.equal(userResponse.status, 200, 'The one-time session could not be verified');
  const session = {
    access_token: accessToken, refresh_token: refreshToken, token_type: 'bearer',
    expires_in: Number(fragment.get('expires_in') || 3600), expires_at: Number(fragment.get('expires_at')),
    user: await userResponse.json(),
  };
  const encoded = `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
  const cookieName = 'sb-mpxvegyzpybnipokztbz-auth-token';
  const context = page.context();
  await context.clearCookies();
  const chunks = encoded.match(/.{1,3180}/g) || [];
  await context.addCookies(chunks.map((value, index) => ({
    name: chunks.length === 1 ? cookieName : `${cookieName}.${index}`, value,
    domain: new URL(baseUrl).hostname, path: '/', secure: true, sameSite: 'Lax',
  })));
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByText('Live operational metrics from Supabase', { exact: false }).waitFor({ timeout: 120_000 });

  await page.getByRole('button', { name: /^Care Period/ }).click();
  await page.getByRole('heading', { name: 'Care Period', exact: true }).waitFor({ timeout: 30_000 });
  const careView = await page.locator('main').innerText();
  assert(careView.includes('First order') || careView.includes('Nothing here right now'), 'Care Period table did not render');

  await page.getByRole('button', { name: 'Team & system', exact: true }).click();
  const careInput = page.getByLabel('Care duration (days)');
  await careInput.waitFor({ timeout: 30_000 });
  assert.equal(await careInput.inputValue(), '30');
  await page.getByRole('button', { name: 'Save care setting', exact: true }).click();
  await page.getByText('Care period updated to 30 days.', { exact: false }).waitFor({ timeout: 30_000 });
  await page.getByText('Run the first manual backup from the bound backup spreadsheet before activating its schedule.', { exact: false }).waitFor();

  await page.getByRole('button', { name: /^All leads/ }).click();
  await page.getByRole('heading', { name: 'All leads', exact: true }).waitFor({ timeout: 30_000 });
  await page.locator('main tbody tr').first().waitFor({ timeout: 30_000 });
  const search = page.getByPlaceholder('Search business, merchant, phone or ID');
  await search.fill('CB-000001');
  await page.locator('main tbody tr').first().waitFor({ timeout: 30_000 });
  assert((await page.locator('main').innerText()).includes('CB-000001'), 'Lead search did not return the expected migrated lead');

  assert.deepEqual(pageErrors, [], `Browser runtime errors: ${pageErrors.join('; ')}`);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.waitForURL(/\/login$/, { timeout: 30_000 });
  console.log(JSON.stringify({ ok: true, checks: ['one-time team-lead sign-in without changing password', 'dashboard bootstrap', 'Care Period view', 'Care Days admin save at unchanged value 30', 'backup activation instructions', 'All leads table', 'migrated-lead search', 'sign-out'], pageErrors: 0 }, null, 2));
} finally {
  await browser.close();
}
