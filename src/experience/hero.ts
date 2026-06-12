// The first breath.
//
// The title doesn't fade in — it condenses out of the dark, letter by letter,
// the way a signal resolves out of static. Screen readers get the intact
// heading; the spans are scenery.

import { prefersReducedMotion } from '../utils/visibility';

export function initHeroEntrance(): void {
    const h1 = document.querySelector<HTMLElement>('.hero h1');
    if (!h1 || prefersReducedMotion()) return;

    const text = h1.textContent ?? '';
    if (!text.trim()) return;

    h1.setAttribute('aria-label', text);
    h1.innerHTML = '';
    h1.classList.add('materialize');

    // Deterministic arrival order: middle letters first, edges last, with a
    // little interleave so it reads as condensation, not a wipe.
    const chars = Array.from(text);
    const order = chars.map((_, i) => i)
        .sort((a, b) => Math.abs(a - chars.length / 2) - Math.abs(b - chars.length / 2));

    // Letters are grouped into unbreakable word spans with real spaces between
    // them, so narrow screens wrap between words — never through one.
    let wordSpan: HTMLSpanElement | null = null;
    chars.forEach((ch, i) => {
        if (ch === ' ') {
            h1.appendChild(document.createTextNode(' '));
            wordSpan = null;
            return;
        }
        if (!wordSpan) {
            wordSpan = document.createElement('span');
            wordSpan.className = 'hero-word';
            wordSpan.setAttribute('aria-hidden', 'true');
            h1.appendChild(wordSpan);
        }
        const span = document.createElement('span');
        span.className = 'hero-char';
        span.textContent = ch;
        const rank = order.indexOf(i);
        span.style.setProperty('--d', `${0.25 + rank * 0.055 + (rank % 3) * 0.04}s`);
        wordSpan.appendChild(span);
    });
}
