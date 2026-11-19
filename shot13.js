const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b64 = fs.readFileSync('/tmp/main_cookie2.txt','utf8').trim();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: {width:1560,height:1100} });
  await ctx.addCookies([{name:'sb-mpxvegyzpybnipokztbz-auth-token', value:b64, domain:'carrybee-lead-crm.vercel.app', path:'/', secure:true, sameSite:'Lax'}]);
  const page = await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.goto('https://carrybee-lead-crm.vercel.app/', {waitUntil:'domcontentloaded', timeout:90000});
  await page.waitForTimeout(3000);
  await page.click('text=Follow-up rulebook'); await page.waitForTimeout(3500);
  const t = await page.innerText('body');
  console.log('RULEBOOK>>>', t.split('Follow-up rulebook')[1]?.slice(0,420).split('\n').filter(x=>x.trim()).join(' | '));
  // change one value and save
  const first = page.locator('input[type=number]').first();
  await first.fill('2');
  await page.waitForTimeout(400);
  await page.click('text=/^Save 1 change$/');
  await page.waitForTimeout(2500);
  const after = await page.innerText('body');
  console.log('AFTER SAVE>>>', after.split('Follow-up rulebook')[1]?.slice(0,180).split('\n').filter(x=>x.trim()).join(' | '));
  // put it back
  await page.locator('input[type=number]').first().fill('1');
  await page.waitForTimeout(300);
  await page.click('text=/^Save 1 change$/'); await page.waitForTimeout(2000);
  console.log('ERRS', errs.slice(0,2));
  await page.screenshot({path:'/home/user/rulebook.png', fullPage:false});
  await browser.close();
})();
