const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b64 = fs.readFileSync('/tmp/main_cookie.txt','utf8').trim();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: {width:1560,height:1050} });
  await ctx.addCookies([{name:'sb-mpxvegyzpybnipokztbz-auth-token', value:b64, domain:'carrybee-lead-crm.vercel.app', path:'/', secure:true, sameSite:'Lax'}]);
  const page = await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.goto('https://carrybee-lead-crm.vercel.app/', {waitUntil:'domcontentloaded', timeout:90000});
  await page.waitForTimeout(2500);
  await page.click('text=Team & system'); await page.waitForTimeout(3000);
  const t = await page.innerText('body');
  console.log('ADMIN VIEW>>>', t.split('Members')[1]?.slice(0,700).split('\n').filter(x=>x.trim()).join(' | '));
  await page.screenshot({path:'/home/user/main-admin-grants.png'});
  await page.click('text=Assign old book'); await page.waitForTimeout(3000);
  console.log('P2 KPIs>>>', (await page.innerText('body')).split('Phase 2')[1].slice(0,240).split('\n').filter(x=>x.trim()).join(' | '));
  console.log('ERRS', errs.slice(0,3));
  await browser.close();
})();
