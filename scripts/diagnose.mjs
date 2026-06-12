import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'https://myrkvidur.com/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const events = [];
page.on('request', r => { if (r.url().includes('assets/') && r.url().endsWith('.js')) events.push('req: ' + r.url().split('/').pop()); });
page.on('pageerror', e => events.push('PAGEERROR: ' + String(e).slice(0,200)));
page.on('console', m => { if (m.type() === 'error') events.push('[err] ' + m.text().slice(0,150)); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3500);
await page.evaluate(() => {
  document.querySelector('.greeting-dismiss')?.click();
  // tag elements so replacement is detectable
  document.getElementById('glass-forest-container').__tag = 'original';
  document.getElementById('forest-game-container').__tag = 'original';
});
// trigger supernova (event 1 = neutron)
for (let i = 0; i < 3; i++) { await page.mouse.click(720, 760); await page.waitForTimeout(170); }
const trig = await page.waitForFunction(() => {
  const c = document.getElementById('webgl-supernova-canvas');
  return c && c.style.opacity === '1';
}, { timeout: 8000 }).then(() => true).catch(() => false);
events.push('supernova triggered: ' + trig);
await page.waitForTimeout(30000); // ride out full event
const mid = await page.evaluate(() => ({
  glassTag: document.getElementById('glass-forest-container').__tag ?? 'REPLACED',
  gameTag: document.getElementById('forest-game-container').__tag ?? 'REPLACED',
}));
await page.evaluate(() => document.getElementById('glass-forest-container')?.scrollIntoView({ block: 'center' }));
await page.waitForTimeout(3000);
const glass = await page.evaluate(() => ({
  nodes: document.querySelectorAll('.glass-node').length,
  tag: document.getElementById('glass-forest-container').__tag ?? 'REPLACED',
}));
await page.evaluate(() => document.getElementById('forest-game-container')?.scrollIntoView({ block: 'center' }));
await page.waitForTimeout(3000);
const game = await page.evaluate(() => ({
  stage: !!document.querySelector('.fg-stage'),
  tag: document.getElementById('forest-game-container').__tag ?? 'REPLACED',
}));
console.log(JSON.stringify({ mid, glass, game, events }, null, 2));
await browser.close();
