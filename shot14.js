const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b64 = fs.readFileSync('/tmp/main_cookie3.txt','utf8').trim();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: {width:1560,height:1150} });
  await ctx.addCookies([{name:'sb-mpxvegyzpybnipokztbz-auth-token', value:b64, domain:'carrybee-lead-crm.vercel.app', path:'/', secure:true, sameSite:'Lax'}]);
  const page = await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.goto('https://carrybee-lead-crm.vercel.app/', {waitUntil:'domcontentloaded', timeout:120000});
  await page.waitForSelector('text=All leads', {timeout:120000});
  await page.waitForTimeout(1500);
  await page.click('text=All leads'); await page.waitForTimeout(3000);
  console.log('rows', await page.locator('tbody tr').count());
  await page.locator('tbody tr').first().click(); await page.waitForSelector('.drawer', {timeout:30000});
  await page.waitForTimeout(1500);
  const opts = await page.locator('label:has-text("Outcome / status") select option').allTextContents();
  const pick = opts.find(o => /Follow Up Need|Contacted/.test(o));
  await page.locator('label:has-text("Outcome / status") select').selectOption({label: pick});
  await page.waitForTimeout(900);
  const boxCount = await page.locator('.callback-hold').count();
  console.log('status picked:', pick, '| checkbox blocks:', boxCount);
  if (boxCount) {
    await page.locator('.callback-hold input[type=checkbox]').check();
    await page.waitForTimeout(400);
    console.log('hint:', (await page.locator('.callback-hold').innerText()).replace(/\n/g,' | '));
    console.log('date max after tick:', await page.locator('input[name=nextDate]').getAttribute('max'));
    await page.screenshot({path:'/home/user/callback-drawer.png'});
    await page.locator('.callback-hold input[type=checkbox]').uncheck();
    await page.waitForTimeout(300);
    console.log('date max unticked:', await page.locator('input[name=nextDate]').getAttribute('max'));
  }
  await page.locator('.drawer-head button').click(); await page.waitForTimeout(1200);
  await page.click('.sidebar >> text=Callback requested'); await page.waitForTimeout(3000);
  await page.screenshot({path:'/home/user/callback-view.png'});
  console.log('view ok', (await page.innerText('body')).includes('Merchants who asked to be called on a later date'));
  console.log('ERRS', errs.slice(0,3));
  await browser.close();
})();
