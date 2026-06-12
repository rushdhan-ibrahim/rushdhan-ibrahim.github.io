import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'http://localhost:5301/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });

for (const [name, vw, vh] of [['desk', 1440, 900], ['mob', 390, 844]]) {
  const page = await browser.newPage({ viewport: { width: vw, height: vh } });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => document.querySelector('.greeting-dismiss')?.click());
  await page.evaluate(() => document.querySelector('.audio-invite-no')?.click());
  const stops = [
    ['hero', () => scrollTo(0, 0)],
    ['axioms', () => { document.getElementById('steelman')?.scrollIntoView(); document.querySelectorAll('.collapsible-header')[0]?.click(); }],
    ['mirror', () => document.querySelector('.mirror-section')?.scrollIntoView({ block: 'center' })],
    ['pluribus', () => document.getElementById('pluribus')?.scrollIntoView()],
    ['characters', () => document.querySelector('.character-grid')?.scrollIntoView({ block: 'center' })],
    ['lightcone', () => document.getElementById('light-cone-container')?.scrollIntoView({ block: 'center' })],
    ['alternatives', () => document.querySelector('.hybrid-grid')?.scrollIntoView({ block: 'center' })],
    ['credence-dash', () => document.querySelector('.credence-dashboard')?.scrollIntoView({ block: 'center' })],
    ['collector', () => document.getElementById('credence-container')?.scrollIntoView({ block: 'center' })],
    ['footer', () => scrollTo(0, 9e9)],
  ];
  for (const [label, fn] of stops) {
    await page.evaluate(fn);
    await page.waitForTimeout(2200);
    await page.screenshot({ path: `/tmp/vt-${name}-${label}.png` });
  }
  await page.close();
}
await browser.close();
console.log('tour complete');
