// Pointer life.
//
// Two small things, desktop fine-pointers only: cards lean toward the cursor
// like something noticing you back, and a faint aura follows the pointer
// across the interactive instruments. Both are transform/opacity only.

import { prefersReducedMotion } from '../utils/visibility';

const TILT_SELECTOR = '.hybrid-card, .character-card';
const MAX_TILT = 3.2; // degrees — a lean, not a carnival

function finePointer(): boolean {
    return window.matchMedia('(pointer: fine)').matches;
}

function initTilt(): void {
    document.querySelectorAll<HTMLElement>(TILT_SELECTOR).forEach(card => {
        card.classList.add('tiltable');
        card.addEventListener('pointermove', (e) => {
            const r = card.getBoundingClientRect();
            const px = (e.clientX - r.left) / r.width - 0.5;
            const py = (e.clientY - r.top) / r.height - 0.5;
            card.style.transform =
                `perspective(700px) rotateX(${(-py * MAX_TILT).toFixed(2)}deg) rotateY(${(px * MAX_TILT).toFixed(2)}deg) translateY(-2px)`;
            card.style.setProperty('--sheen-x', `${((px + 0.5) * 100).toFixed(1)}%`);
            card.style.setProperty('--sheen-y', `${((py + 0.5) * 100).toFixed(1)}%`);
        });
        card.addEventListener('pointerleave', () => {
            card.style.transform = '';
        });
    });
}

function initAura(): void {
    const aura = document.createElement('div');
    aura.className = 'pointer-aura';
    aura.setAttribute('aria-hidden', 'true');
    document.body.appendChild(aura);

    let visible = false;
    document.addEventListener('pointermove', (e) => {
        const overInstrument = (e.target as HTMLElement | null)?.closest?.('.ascii-interactive, #hero-forest') != null;
        if (overInstrument !== visible) {
            visible = overInstrument;
            aura.classList.toggle('on', visible);
        }
        if (visible) {
            aura.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
        }
    }, { passive: true });
}

export function initPointer(): void {
    if (!finePointer() || prefersReducedMotion()) return;
    initTilt();
    initAura();
}
