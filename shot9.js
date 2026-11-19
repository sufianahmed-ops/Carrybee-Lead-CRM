const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b64 = fs.readFileSync('/tmp/eyal_cookie.txt','utf8').trim();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: {width:1500,height:1000} });
  await ctx.addCookies([{name:'sb-mpxvegyzpybnipokztbz-auth-token', value:b64, domain:'carrybee-lead-crm.vercel.app', path:'/', secure:true, sameSite:'Lax'}]);
  const page = await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.goto('https://carrybee-lead-crm.vercel.app/', {waitUntil:'domcontentloaded', timeout:90000});
  await page.waitForTimeout(3000);
  await page.click('text=All leads'); await page.waitForTimeout(2000);
  // open the first lead row
  await page.click('table tbody tr >> nth=0'); await page.waitForTimeout(2500);
  const t = await page.innerText('aside.drawer');
  console.log('DRAWER NOTE>>>', t.split('Log this call')[1]?.slice(0,260).split('\n').filter(x=>x.trim()).join(' | '));
  await page.screenshot({path:'/home/user/borrowed-log-call.png'});
  console.log('ERRS', errs.slice(0,2));
  await browser.close();
})();
