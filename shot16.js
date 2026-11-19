const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b64 = fs.readFileSync('/tmp/main_cookie3.txt','utf8').trim();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: {width:1560,height:1000} });
  await ctx.addCookies([{name:'sb-mpxvegyzpybnipokztbz-auth-token', value:b64, domain:'carrybee-lead-crm.vercel.app', path:'/', secure:true, sameSite:'Lax'}]);
  const page = await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.goto('https://carrybee-lead-crm.vercel.app/', {waitUntil:'domcontentloaded', timeout:120000});
  await page.waitForSelector('text=Callback requested', {timeout:120000});
  await page.waitForTimeout(1000);
  await page.locator('.sidebar >> text=Callback requested').first().click();
  await page.waitForTimeout(3500);
  console.log('MAIN>>>', (await page.innerText('main')).slice(0,260).replace(/\n/g,' | '));
  await page.screenshot({path:'/home/user/callback-view.png'});
  // rulebook shows the two new rules
  await page.locator('.sidebar >> text=Follow-up rulebook').first().click(); await page.waitForTimeout(3000);
  const rb = await page.innerText('main');
  console.log('rulebook has max days:', rb.includes('Longest customer-requested wait'), '| override gate:', rb.includes('Allow customer-requested later callbacks'));
  await page.screenshot({path:'/home/user/rulebook-callback.png'});
  console.log('ERRS', errs.slice(0,2));
  await browser.close();
})();
