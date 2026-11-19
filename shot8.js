const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b64 = fs.readFileSync('/tmp/main_cookie.txt','utf8').trim();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: {width:1640,height:1020} });
  await ctx.addCookies([{name:'sb-mpxvegyzpybnipokztbz-auth-token', value:b64, domain:'carrybee-lead-crm.vercel.app', path:'/', secure:true, sameSite:'Lax'}]);
  const page = await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.goto('https://carrybee-lead-crm.vercel.app/', {waitUntil:'domcontentloaded', timeout:90000});
  await page.waitForTimeout(2500);
  await page.click('text=Team & system'); await page.waitForTimeout(3000);
  const t = await page.innerText('body');
  console.log('BORROWED ROW>>>', t.split('Eyaliduzzaman')[1]?.slice(0,220).split('\n').filter(x=>x.trim()).join(' | '));
  await page.screenshot({path:'/home/user/lending.png'});
  await page.click('text=Assign old book'); await page.waitForTimeout(3000);
  console.log('ROTATION>>>', (await page.innerText('body')).split('1 · Rotation')[1]?.slice(0,300).split('\n').filter(x=>x.trim()).join(' | '));
  console.log('ERRS', errs.slice(0,2));
  await browser.close();
})();
