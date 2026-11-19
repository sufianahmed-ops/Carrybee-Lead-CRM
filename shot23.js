const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b64 = fs.readFileSync('/tmp/main_cookie3.txt','utf8').trim();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: {width:1560,height:1000} });
  await ctx.addCookies([{name:'sb-mpxvegyzpybnipokztbz-auth-token', value:b64, domain:'carrybee-lead-crm.vercel.app', path:'/', secure:true, sameSite:'Lax'}]);
  const page = await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.goto('https://carrybee-lead-crm.vercel.app/', {waitUntil:'domcontentloaded', timeout:120000});
  await page.waitForSelector('text=New to LQT', {timeout:120000});
  await page.locator('.sidebar >> text=New to LQT').click(); await page.waitForTimeout(3000);
  await page.locator('tbody tr').first().click();
  await page.waitForSelector('.drawer', {timeout:30000});
  await page.locator('.drawer >> text=Lead details').click(); await page.waitForTimeout(500);
  const label = page.locator('label:has-text("Product Category")').first();
  await label.locator('.searchable-trigger').click(); await page.waitForTimeout(400);
  await page.locator('.searchable-search input').fill('gadget'); await page.waitForTimeout(300);
  console.log('gadget ->', (await page.locator('.searchable-list .searchable-option').allTextContents()).join(' | '));
  await page.keyboard.press('Enter'); await page.waitForTimeout(500);
  console.log('after Enter, field =', (await label.locator('.searchable-trigger').innerText()).trim(),
              '| menu still open?', await page.locator('.searchable-menu').count());
  // persisted through save? check the payload path: click Save details only and read the toast/error
  await page.locator('button:has-text("Save details only")').click(); await page.waitForTimeout(2500);
  const body = await page.innerText('body');
  console.log('save result:', /Saved to Supabase/.test(body) ? 'saved' : (body.match(/error[^\n]*/i)?.[0] || 'no toast'));
  console.log('ERRS', errs.slice(0,2));
  await page.screenshot({path:'/home/user/category-search.png'});
  await browser.close();
})();
