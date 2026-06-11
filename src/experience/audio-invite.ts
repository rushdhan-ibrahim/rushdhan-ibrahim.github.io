// The soundscape invitation.
//
// The essay has a voice most readers never discover. Once — and only once —
// as the reader crosses into Part One, a quiet card near the toggle says so.
// Dismiss it and it never returns; enable sound and it thanks you by leaving.

import { saveData, loadData } from '../utils/persistence';
import { getIsAudioPlaying } from '../audio/context';

const KEY = 'audio-invite-dismissed';

export function initAudioInvite(): void {
    if (loadData<boolean>(KEY)) return;
    const steelman = document.getElementById('steelman');
    const toggle = document.getElementById('audio-toggle');
    if (!steelman || !toggle) return;

    let shown = false;

    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting || shown) continue;
            shown = true;
            observer.disconnect();
            if (getIsAudioPlaying()) return;
            // One voice at a time: if the return greeting is on stage, wait.
            const delay = document.querySelector('.return-greeting.visible') ? 9000 : 0;
            window.setTimeout(() => {
                if (!getIsAudioPlaying()) show(toggle);
            }, delay);
        }
    }, { threshold: 0.2 });
    observer.observe(steelman);
}

function show(toggle: HTMLElement): void {
    const card = document.createElement('div');
    card.className = 'audio-invite';
    card.setAttribute('role', 'note');
    card.innerHTML = `
        <p>This inquiry has a soundscape — synthesized live, tuned to where you are in the argument.</p>
        <div class="audio-invite-actions">
            <button class="audio-invite-yes">enable sound</button>
            <button class="audio-invite-no" aria-label="Dismiss">not now</button>
        </div>`;
    document.body.appendChild(card);
    requestAnimationFrame(() => card.classList.add('visible'));
    toggle.classList.add('inviting');

    const dismiss = (remember: boolean) => {
        card.classList.remove('visible');
        toggle.classList.remove('inviting');
        if (remember) saveData(KEY, true);
        window.setTimeout(() => card.remove(), 700);
    };

    card.querySelector<HTMLButtonElement>('.audio-invite-yes')!.addEventListener('click', () => {
        (toggle as HTMLButtonElement).click();
        dismiss(true);
    });
    card.querySelector<HTMLButtonElement>('.audio-invite-no')!.addEventListener('click', () => dismiss(true));

    // It also simply leaves if ignored long enough; reappears next visit.
    window.setTimeout(() => {
        if (card.isConnected && card.classList.contains('visible')) dismiss(false);
    }, 16000);
}
