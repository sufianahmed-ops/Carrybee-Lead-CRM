const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch();
  for (const u of ['mahmudul','sazzad']) {
    const b64 = fs.readFileSync(`/tmp/${u}_cookie.txt`,'utf8').trim();
    const ctx = await browser.newContext({ viewport:{width:1560,height:1050} });
    await ctx.addCookies([{name:'sb-mpxvegyzpybnipokztbz-auth-token', value:b64, domain:'carrybee-lead-crm.vercel.app', path:'/', secure:true, sameSite:'Lax'}]);
    const page = await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
    await page.goto('https://carrybee-lead-crm.vercel.app/', {waitUntil:'domcontentloaded', timeout:120000});
    await page.waitForSelector('.sidebar', {timeout:120000}); await page.waitForTimeout(6000);
    const nav = await page.locator('.sidebar .nav-btn').evaluateAll(els=>els.map(e=>e.innerText.replace(/\n/g,' ').trim()));
    console.log(`\n=== ${u}: ${nav.length} items`);
    console.log('   ' + nav.join(' | '));
    for (const label of ['Old book — due now','Closed leads','Callback requested']) {
      const btn = page.locator(`.sidebar .nav-btn:has-text("${label}")`).first();
      if (!await btn.count()) { console.log(`   ${label}: MISSING`); continue; }
      await btn.click(); await page.waitForTimeout(2500);
      const sub = await page.locator('.main .subtitle').first().innerText().catch(()=>'');
      const rows = await page.locator('tbody tr').count();
      const firstDue = await page.locator('tbody tr').nth(0).innerText().catch(()=>'');
      console.log(`   ${label}: rows=${rows} | ${sub.slice(0,60).replace(/\n/g,' ')}`);
      if (label === 'Old book — due now') console.log('      first row:', firstDue.replace(/\n/g,' | ').slice(0,150));
      if (label === 'Closed leads') {
        const opts = await page.locator('select[aria-label="Closed status"] option').allInnerTexts();
        console.log('      status filter:', JSON.stringify(opts));
        await page.screenshot({path:`/home/user/closed-view-${u}.png`});
      }
    }
    await page.locator('.sidebar .nav-btn:has-text("Old book")').first().click(); await page.waitForTimeout(2500);
    await page.screenshot({path:`/home/user/oldbook-view-${u}.png`});
    console.log('   errors:', errs.slice(0,2));
    await ctx.close();
  }
  await browser.close();
})();
