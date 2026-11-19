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
  await page.waitForTimeout(1200);
  await page.locator('a:has-text("Callback requested"), button:has-text("Callback requested"), .sidebar >> text=Callback requested').first().click();
  await page.waitForTimeout(4000);
  const t = await page.innerText('main').catch(()=>page.innerText('body'));
  console.log('MAIN>>>', t.slice(0,300).replace(/\n/g,' | '));
  await page.screenshot({path:'/home/user/callback-view.png'});
  console.log('ERRS', errs.slice(0,2));
  await browser.close();
})();
