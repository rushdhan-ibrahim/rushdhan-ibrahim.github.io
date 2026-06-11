// Reveal choreography.
//
// Content surfaces from the dark as the reader reaches it — a slow exhale,
// not a parade. Elements are visible by default; the hidden state is applied
// only by JS, so a failed observer can never strand the essay invisible.
// Reduced motion: nothing moves, everything simply is.

import { prefersReducedMotion } from '../utils/visibility';

const SELECTOR = [
    '.section-header',
    '.prose',
    '.collapsible',
    '.thought-experiment',
    '.ascii-interactive',
    '.hybrid-card',
    '.character-card',
    '.credence-dashboard',
    '.show-quote',
    '.spoiler-warning',
    '.pluribus-intro',
    '.mirror-section blockquote',
    '.closing',
].join(', ');

export function initReveal(): void {
    if (prefersReducedMotion() || !('IntersectionObserver' in window)) return;

    const els = Array.from(document.querySelectorAll<HTMLElement>(SELECTOR));
    const vh = window.innerHeight;

    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add('rv-in');
            observer.unobserve(entry.target);
        }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });

    let stagger = 0;
    let lastTop = -1;
    for (const el of els) {
        const rect = el.getBoundingClientRect();
        // Anything already on screen stays put — no entrance theatrics for
        // content the reader is mid-sentence in.
        if (rect.top < vh * 0.92) continue;
        el.classList.add('rv');
        // Siblings revealed in the same sweep get a small cascade.
        stagger = Math.abs(rect.top - lastTop) < 40 ? Math.min(stagger + 1, 4) : 0;
        lastTop = rect.top;
        el.style.setProperty('--rv-delay', `${stagger * 90}ms`);
        observer.observe(el);
    }

    // Teleports (find-in-page, PageDown floods, hash jumps) should not land
    // the reader in a fog of mid-transition text: a large delta reveals
    // everything near the viewport at once, without ceremony.
    let lastY = window.scrollY;
    window.addEventListener('scroll', () => {
        const y = window.scrollY;
        const delta = Math.abs(y - lastY);
        lastY = y;
        if (delta < window.innerHeight * 1.2) return;
        document.querySelectorAll<HTMLElement>('.rv:not(.rv-in)').forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.top < window.innerHeight * 1.3 && r.bottom > -window.innerHeight * 0.3) {
                el.classList.add('rv-fast', 'rv-in');
            }
        });
    }, { passive: true });
}
