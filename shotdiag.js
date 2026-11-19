const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b64 = fs.readFileSync('/tmp/main_cookie3.txt','utf8').trim();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: {width:1400,height:900} });
  await ctx.addCookies([{name:'sb-mpxvegyzpybnipokztbz-auth-token', value:b64, domain:'carrybee-lead-crm.vercel.app', path:'/', secure:true, sameSite:'Lax'}]);
  const page = await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  page.on('console', m => { if (m.type()==='error') errs.push('console: '+m.text().slice(0,200)); });
  const resp = await page.goto('https://carrybee-lead-crm.vercel.app/', {waitUntil:'domcontentloaded', timeout:120000});
  console.log('status', resp.status(), page.url());
  await page.waitForTimeout(12000);
  const t = await page.innerText('body');
  console.log('BODY>>>', t.slice(0,400).replace(/\n/g,' | '));
  console.log('ERRS', errs.slice(0,5));
  await page.screenshot({path:'/home/user/diag.png'});
  await browser.close();
})();
