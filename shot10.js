const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b64 = fs.readFileSync('/tmp/main_cookie.txt','utf8').trim();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: {width:1560,height:1000} });
  await ctx.addCookies([{name:'sb-mpxvegyzpybnipokztbz-auth-token', value:b64, domain:'carrybee-lead-crm.vercel.app', path:'/', secure:true, sameSite:'Lax'}]);
  const page = await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.goto('https://carrybee-lead-crm.vercel.app/', {waitUntil:'domcontentloaded', timeout:90000});
  await page.waitForTimeout(3000);
  await page.click('text=Handover Inbox'); await page.waitForTimeout(3500);
  const t = await page.innerText('body');
  console.log('INBOX>>>', t.split('Handover Inbox')[1]?.slice(0,320).split('\n').filter(x=>x.trim()).join(' | '));
  console.log('ERRS', errs.slice(0,2));
  await page.screenshot({path:'/home/user/handover-inbox.png'});
  await browser.close();
})();
