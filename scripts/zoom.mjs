import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:5301/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await page.evaluate(() => document.querySelector('.greeting-dismiss')?.click());
await page.evaluate(() => document.getElementById('your-beliefs')?.scrollIntoView());
await page.waitForTimeout(2500);
const text = await page.evaluate(() => {
  const sec = document.getElementById('your-beliefs')?.nextElementSibling;
  return sec?.textContent?.slice(0, 400);
});
console.log(JSON.stringify(text));
await page.screenshot({ path: '/tmp/vt-beliefs-zoom.png', clip: { x: 300, y: 0, width: 850, height: 500 } });
await browser.close();
