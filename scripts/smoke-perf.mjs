// Headless performance + functionality smoke test.
// Drives system Chrome: measures rAF FPS during scroll and during a
// triple-tap-triggered WebGL supernova, and checks for console errors.
// Run: node scripts/smoke-perf.mjs [url]

import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:5300/';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text().slice(0, 160));
});
page.on('pageerror', (err) => errors.push('PAGEERROR: ' + String(err).slice(0, 160)));

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2500);
await page.evaluate(() => document.querySelector('.greeting-dismiss')?.click());

// FPS sampler: counts rAF frames and the worst frame gap.
const sampleFps = (ms) => page.evaluate((duration) => new Promise((resolve) => {
    let frames = 0;
    let worst = 0;
    let last = performance.now();
    const t0 = last;
    const tick = (now) => {
        frames++;
        worst = Math.max(worst, now - last);
        last = now;
        if (now - t0 < duration) requestAnimationFrame(tick);
        else resolve({ fps: Math.round(frames / (duration / 1000)), worstGapMs: Math.round(worst) });
    };
    requestAnimationFrame(tick);
}), ms);

// 1 — idle FPS at top
const idleTop = await sampleFps(2000);

// 2 — FPS while continuously scrolling through the whole essay
const scrollPromise = page.evaluate(() => new Promise((resolve) => {
    const total = document.documentElement.scrollHeight - innerHeight;
    const t0 = performance.now();
    const dur = 6000;
    const step = (now) => {
        const p = Math.min(1, (now - t0) / dur);
        scrollTo(0, p * total);
        if (p < 1) requestAnimationFrame(step);
        else resolve(null);
    };
    requestAnimationFrame(step);
}));
const scrolling = await sampleFps(5500);
await scrollPromise;

// 3 — back to top; wait for cosmic module (idle-loaded), then triple-tap
await page.evaluate(() => scrollTo(0, 0));
await page.waitForTimeout(2500);
const tapIndicator = await page.waitForSelector('.tap-indicator, [class*="tap"]', { timeout: 20000 }).catch(() => null);
for (let i = 0; i < 3; i++) {
    await page.mouse.click(720, 700);
    await page.waitForTimeout(180);
}
const canvasVisible = await page.waitForFunction(() => {
    const c = document.getElementById('webgl-supernova-canvas');
    return c && c.style.display !== 'none' && c.style.opacity === '1';
}, { timeout: 8000 }).then(() => true).catch(() => false);

// 4 — FPS during the supernova (the previously stuttering moment)
const duringEvent = canvasVisible ? await sampleFps(4000) : null;

// 5 — black hole gravity phase fps (later in timeline)
await page.waitForTimeout(9000);
const lateEvent = canvasVisible ? await sampleFps(3000) : null;

console.log(JSON.stringify({
    idleTop,
    scrolling,
    cosmicLoaded: !!tapIndicator,
    supernovaTriggered: canvasVisible,
    duringEvent,
    lateEvent,
    consoleErrors: errors.slice(0, 6),
}, null, 2));

await browser.close();
