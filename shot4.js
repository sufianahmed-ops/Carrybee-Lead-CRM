const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b64 = fs.readFileSync('/tmp/cookie_val.txt','utf8').trim();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: {width:1600,height:1100} });
  await ctx.addCookies([{name:'sb-mpxvegyzpybnipokztbz-auth-token', value:b64, domain:'carrybee-lead-crm.vercel.app', path:'/', secure:true, sameSite:'Lax'}]);
  const page = await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.goto('https://carrybee-lead-crm.vercel.app/', {waitUntil:'domcontentloaded', timeout:90000});
  await page.waitForTimeout(2500);
  for (const view of ['Follow Up','CNR','New Leads','New to LQT','Old follow-ups','Care Period','Incubation Queue','Handover Inbox','Onboarding tracker']) {
    await page.click(`text=${view}`);
    await page.waitForTimeout(2200);
    const heads = await page.$$eval('table thead th', els => els.map(e => e.innerText.trim()));
    const firstRow = await page.$$eval('table tbody tr:first-child td', els => els.map(e => e.innerText.trim().slice(0,12)));
    const idx = heads.indexOf('Registration date');
    console.log(view.padEnd(20), '| regCol:', idx >= 0 ? 'YES @' + idx : 'MISSING', '| cols:', heads.slice(1,7).join(','), '| row:', firstRow.slice(1,7).join(','));
  }
  console.log('ERRS', errs.slice(0,3));
  await page.screenshot({path:'/home/user/reg-date-column.png'});
  await browser.close();
})();
