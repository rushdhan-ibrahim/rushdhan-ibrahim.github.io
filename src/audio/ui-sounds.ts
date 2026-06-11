// The interface's voice — almost nothing, on purpose.
// Soft ticks for touch, and one bloom for the moment sound is granted.

import { getAudioContext, getMasterGain, getIsAudioPlaying } from './context';

function ready(): { ctx: AudioContext; master: GainNode } | null {
    const ctx = getAudioContext();
    const master = getMasterGain();
    if (!ctx || !master || !getIsAudioPlaying()) return null;
    return { ctx, master };
}

/** A breath of a click: collapsibles, postures, small commitments. */
export function uiTick(opening: boolean = true): void {
    const a = ready();
    if (!a) return;
    const { ctx, master } = a;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(opening ? 740 : 520, now);
    osc.frequency.exponentialRampToValueAtTime(opening ? 980 : 420, now + 0.07);

    filter.type = 'bandpass';
    filter.frequency.value = 850;
    filter.Q.value = 4;

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.022, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + 0.2);
}

/** The grant of sound: a slow G-major bloom with one ninth for the unease. */
export function enableBloom(): void {
    const ctx = getAudioContext();
    const master = getMasterGain();
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const base = 98; // G2
    [1, 2, 3, 4.5, 9].forEach((ratio, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = base * ratio;
        const t = now + 0.4 + i * 0.22;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.035 - i * 0.005, t + 0.9);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 5.5);
        osc.connect(gain);
        gain.connect(master);
        osc.start(t);
        osc.stop(t + 5.8);
    });
}
