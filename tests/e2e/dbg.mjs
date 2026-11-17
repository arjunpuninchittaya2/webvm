import { chromium } from 'playwright-core';
const b = await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const p = await b.newPage();
const srv = process.argv[2];
await p.goto(srv+'/');
await p.getByRole('button',{name:/profile|boot/i}).first().click();
const panel=p.locator('aside').first();
for (const [n,re] of [['distro',/profile|distro|os/i],['uid',/^uid$/i],['gid',/^gid$/i],['env',/env/i],['cmd',/command|cmd/i]]) {
  const l=panel.getByLabel(re);
  console.log(n, await l.count(), await l.first().evaluate(e=>e.tagName+':'+(e.id||e.getAttribute('aria-label')||'')));
}
await b.close();
