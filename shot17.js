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
  await page.waitForTimeout(1200);
  const nav = await page.innerText('.sidebar');
  console.log('callback nav count:', (nav.match(/Callback requested/g)||[]).length);
  await page.locator('.sidebar >> text=Callback requested').first().click();
  await page.waitForTimeout(3500);
  console.log('MAIN>>>', (await page.innerText('main')).slice(0,300).replace(/\n/g,' | '));
  await page.screenshot({path:'/home/user/callback-view.png'});
  // make sure a lead drawer still works end to end (read only)
  await page.locator('.sidebar >> text=New to LQT').first().click(); await page.waitForTimeout(3000);
  await page.locator('tbody tr').first().click(); await page.waitForSelector('.drawer', {timeout:30000});
  await page.waitForTimeout(1500);
  console.log('drawer open ok:', (await page.innerText('.drawer')).slice(0,80).replace(/\n/g,' | '));
  console.log('ERRS', errs.slice(0,2));
  await browser.close();
})();
