const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b64 = fs.readFileSync('/tmp/main_cookie3.txt','utf8').trim();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: {width:1600,height:1000} });
  await ctx.addCookies([{name:'sb-mpxvegyzpybnipokztbz-auth-token', value:b64, domain:'carrybee-lead-crm.vercel.app', path:'/', secure:true, sameSite:'Lax'}]);
  const page = await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.goto('https://carrybee-lead-crm.vercel.app/', {waitUntil:'domcontentloaded', timeout:120000});
  await page.waitForSelector('text=New to LQT', {timeout:120000});
  await page.waitForTimeout(1200);
  for (const view of ['Qualified by me','Qualified (team)','Incubation Queue']) {
    await page.locator(`.sidebar >> text=${view}`).click(); await page.waitForTimeout(2500);
    const head = await page.innerText('main');
    const rows = await page.locator('tbody tr').count();
    console.log(`[${view}] rows=${rows} ::`, head.split('\n').slice(0,4).join(' | ').slice(0,220));
    await page.screenshot({path:`/home/user/qualified-${view.replace(/[^a-z]/gi,'')}.png`});
  }
  console.log('ERRS', errs.slice(0,3));
  await browser.close();
})();
