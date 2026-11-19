const { chromium } = require('playwright');
const fs = require('fs');
const USERS = { mahmudul:'Md.Mahmudul Hasan', sazzad:'Mohammad Sazzad Haider' };
(async () => {
  const browser = await chromium.launch();
  for (const [u,name] of Object.entries(USERS)) {
    const b64 = fs.readFileSync(`/tmp/${u}_cookie.txt`,'utf8').trim();
    const ctx = await browser.newContext({ viewport:{width:1560,height:1000} });
    await ctx.addCookies([{name:'sb-mpxvegyzpybnipokztbz-auth-token', value:b64, domain:'carrybee-lead-crm.vercel.app', path:'/', secure:true, sameSite:'Lax'}]);
    const page = await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
    await page.goto('https://carrybee-lead-crm.vercel.app/', {waitUntil:'domcontentloaded', timeout:120000});
    await page.waitForSelector('.sidebar', {timeout:120000}); await page.waitForTimeout(6000);
    const nav = await page.locator('.sidebar .nav-btn').evaluateAll(els=>els.map(e=>({t:e.innerText.replace(/\n/g,' ').trim()})));
    console.log(`\n=== ${name} (${u}) — ${nav.length} nav items`);
    for (const item of nav) {
      const label = item.t.replace(/\s+\d+$/,'');
      await page.locator(`.sidebar .nav-btn:has-text("${label}")`).first().click().catch(()=>{});
      await page.waitForTimeout(2200);
      const sub = await page.locator('.main .subtitle, .main h1 + *').first().innerText().catch(()=>'');
      const rows = await page.locator('tbody tr').count();
      const empty = await page.locator('text=/nothing|no leads|empty/i').count().catch(()=>0);
      console.log(`  ${item.t.slice(0,34).padEnd(34)} rows=${String(rows).padStart(4)}  sub="${sub.slice(0,58).replace(/\n/g,' ')}"`);
    }
    await page.screenshot({path:`/home/user/nav-audit-${u}.png`, fullPage:false});
    console.log('  page errors:', errs.slice(0,3));
    await ctx.close();
  }
  await browser.close();
})();
