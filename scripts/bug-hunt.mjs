// Bug-hunt harness: drives production (or local) through every interactive
// system, capturing console output at all levels, page errors, and
// screenshots at key moments. Run: node scripts/bug-hunt.mjs [url]

import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'https://myrkvidur.com/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const log = [];
page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error' || t === 'warning') log.push(`[${t}] ${msg.text().slice(0, 200)}`);
});
page.on('pageerror', (err) => log.push('[PAGEERROR] ' + String(err).slice(0, 300)));

const out = {};
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3000);
await page.evaluate(() => document.querySelector('.greeting-dismiss')?.click());

// ── 1. Triple-tap supernova, twice (singleton reuse is the risky path) ──────
const tapAndWait = async (label) => {
    for (let i = 0; i < 3; i++) {
        await page.mouse.click(720, 760);
        await page.waitForTimeout(160);
    }
    const visible = await page.waitForFunction(() => {
        const c = document.getElementById('webgl-supernova-canvas');
        return c && c.style.display !== 'none' && c.style.opacity === '1';
    }, { timeout: 6000 }).then(() => true).catch(() => false);
    out[label] = { triggered: visible };
    if (visible) {
        await page.waitForTimeout(11000); // into remnant/black-hole territory
        await page.screenshot({ path: `/tmp/bh-${label}.png` });
        // wait for completion (~28s timeline + buffer)
        await page.waitForFunction(() => {
            const c = document.getElementById('webgl-supernova-canvas');
            return !c || c.style.opacity === '0' || c.style.display === 'none';
        }, { timeout: 30000 }).catch(() => { out[label].neverCompleted = true; });
        await page.waitForTimeout(1500);
    }
};
await page.waitForTimeout(2500); // let cosmic module idle-load
await tapAndWait('event1');
await tapAndWait('event2');

// ── 2. Glass forest: fire a node in one-shot, then iterated mode ────────────
await page.evaluate(() => document.getElementById('glass-forest-container')?.scrollIntoView({ block: 'center' }));
await page.waitForTimeout(2000);
out.glassNodes = await page.evaluate(() => document.querySelectorAll('.glass-node').length);
await page.evaluate(() => document.querySelector('.glass-node')?.click());
await page.waitForTimeout(3500);
out.glassPhase = await page.evaluate(() => document.getElementById('glass-phase')?.textContent);
await page.evaluate(() => window.resetGlassForest());
await page.waitForTimeout(800);
out.glassAfterReset = await page.evaluate(() => document.getElementById('glass-phase')?.textContent);

// ── 3. The game: wake, take three turns, check log/stance ───────────────────
await page.evaluate(() => document.getElementById('forest-game-container')?.scrollIntoView({ block: 'center' }));
await page.waitForTimeout(2500);
await page.evaluate(() => document.querySelector('.fg-overlay [data-wake]')?.click());
await page.waitForTimeout(400);
for (const act of ['listen', 'grow', 'hide']) {
    await page.evaluate((a) => document.querySelector(`[data-act="${a}"]`)?.click(), act);
    await page.waitForTimeout(500);
}
out.game = await page.evaluate(() => ({
    year: document.querySelector('.fg-year')?.textContent,
    stance: document.querySelector('.fg-stance b')?.textContent,
    logLines: document.querySelectorAll('.fg-line').length,
}));
await page.screenshot({ path: '/tmp/bh-game.png' });

// ── 4. Starfield visual: hover memory + remembered glow state ────────────────
await page.evaluate(() => scrollTo(0, 0));
await page.waitForTimeout(800);
for (let x = 200; x < 1300; x += 90) {
    await page.mouse.move(x, 300 + (x % 240));
    await page.waitForTimeout(40);
}
await page.screenshot({ path: '/tmp/bh-starfield.png' });

// ── 5. Collapsible, rail, transmission, credence quick pokes ─────────────────
await page.evaluate(() => document.querySelector('.collapsible-header')?.click());
await page.waitForTimeout(400);
out.collapsibleOpens = await page.evaluate(() => !!document.querySelector('.collapsible.open'));
out.railStars = await page.evaluate(() => document.querySelectorAll('.rail-star').length);
await page.evaluate(() => document.getElementById('transmission-container')?.scrollIntoView({ block: 'center' }));
await page.waitForTimeout(1800);
out.transmissionReady = await page.evaluate(() => !!document.querySelector('#transmission-container textarea, #transmission-container input, #transmission-container button'));
await page.evaluate(() => document.getElementById('credence-container')?.scrollIntoView({ block: 'center' }));
await page.waitForTimeout(1800);
out.credenceReady = await page.evaluate(() => document.querySelectorAll('#credence-container input[type="range"], #credence-container .credence-slider, #credence-container button').length);
await page.evaluate(() => document.getElementById('real-sky-container')?.scrollIntoView({ block: 'center' }));
await page.waitForTimeout(2200);
out.realSkyChildren = await page.evaluate(() => document.getElementById('real-sky-container')?.children.length);
await page.screenshot({ path: '/tmp/bh-realsky.png' });

out.consoleIssues = log.slice(0, 30);
console.log(JSON.stringify(out, null, 2));
await browser.close();
