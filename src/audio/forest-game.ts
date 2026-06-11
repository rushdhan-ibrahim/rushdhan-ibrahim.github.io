// Audio for The Forest Itself.
//
// The forest's most important sound is the one the reader cannot place: a
// near-silent beating dyad that enters when something out there has found
// them. They are never told. They only feel watched.

import { getAudioContext, getMasterGain, getIsAudioPlaying } from './context';

function ready(): { ctx: AudioContext; master: GainNode } | null {
    const ctx = getAudioContext();
    const master = getMasterGain();
    if (!ctx || !master || !getIsAudioPlaying()) return null;
    return { ctx, master };
}

/** Cold, distant chime: you have found something artificial in the dark. */
export function fgDetection(pan: number = 0): void {
    const a = ready();
    if (!a) return;
    const { ctx, master } = a;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const sub = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const panner = ctx.createStereoPanner();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1180, now);
    osc.frequency.exponentialRampToValueAtTime(640, now + 1.4);
    sub.type = 'sine';
    sub.frequency.value = 118;

    filter.type = 'bandpass';
    filter.frequency.value = 900;
    filter.Q.value = 6;

    panner.pan.value = Math.max(-0.9, Math.min(0.9, pan));

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.07, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);

    osc.connect(filter);
    sub.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(master);

    osc.start(now); sub.start(now);
    osc.stop(now + 2); sub.stop(now + 2);
}

/** A narrow beam touches your world: warmer, deliberate, two notes. */
export function fgHailed(): void {
    const a = ready();
    if (!a) return;
    const { ctx, master } = a;
    const now = ctx.currentTime;

    [392, 523.25].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        const t = now + i * 0.35;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.05, t + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
        osc.connect(gain);
        gain.connect(master);
        osc.start(t);
        osc.stop(t + 1.8);
    });
}

/** Contact established: a soft add9 bloom — warmth with one uneasy note. */
export function fgContact(): void {
    const a = ready();
    if (!a) return;
    const { ctx, master } = a;
    const now = ctx.currentTime;
    const base = 261.63; // C4
    [1, 1.25, 1.5, 2.25].forEach((ratio, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = base * ratio;
        const t = now + i * 0.09;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.035, t + 0.3);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 3);
        osc.connect(gain);
        gain.connect(master);
        osc.start(t);
        osc.stop(t + 3.2);
    });
}

/** Your own voice, hurled outward: a swell that leaves you feeling exposed. */
export function fgBroadcast(): void {
    const a = ready();
    if (!a) return;
    const { ctx, master } = a;
    const now = ctx.currentTime;

    const bufferSize = ctx.sampleRate * 1.6;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.sin((i / bufferSize) * Math.PI);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const nFilter = ctx.createBiquadFilter();
    nFilter.type = 'bandpass';
    nFilter.frequency.setValueAtTime(300, now);
    nFilter.frequency.exponentialRampToValueAtTime(2400, now + 1.4);
    nFilter.Q.value = 2;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.0001, now);
    nGain.gain.exponentialRampToValueAtTime(0.05, now + 0.7);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 1.6);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 1.2);
    const oGain = ctx.createGain();
    oGain.gain.setValueAtTime(0.0001, now);
    oGain.gain.exponentialRampToValueAtTime(0.035, now + 0.5);
    oGain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);

    noise.connect(nFilter); nFilter.connect(nGain); nGain.connect(master);
    osc.connect(oGain); oGain.connect(master);
    noise.start(now);
    osc.start(now); osc.stop(now + 1.7);
}

/** Sonar-like double blip: a probe slipping into the dark. */
export function fgProbe(): void {
    const a = ready();
    if (!a) return;
    const { ctx, master } = a;
    const now = ctx.currentTime;
    [0, 0.22].forEach(offset => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 1480;
        const t = now + offset;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.045, t + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        osc.connect(gain);
        gain.connect(master);
        osc.start(t);
        osc.stop(t + 0.6);
    });
}

/** You have fired. Low thunk, then a thin rising whine that does not resolve. */
export function fgStrikeLaunch(): void {
    const a = ready();
    if (!a) return;
    const { ctx, master } = a;
    const now = ctx.currentTime;

    const thunk = ctx.createOscillator();
    const tGain = ctx.createGain();
    thunk.type = 'sine';
    thunk.frequency.setValueAtTime(120, now);
    thunk.frequency.exponentialRampToValueAtTime(38, now + 0.5);
    tGain.gain.setValueAtTime(0.12, now);
    tGain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    thunk.connect(tGain); tGain.connect(master);
    thunk.start(now); thunk.stop(now + 1);

    const whine = ctx.createOscillator();
    const wGain = ctx.createGain();
    whine.type = 'sine';
    whine.frequency.setValueAtTime(880, now + 0.2);
    whine.frequency.exponentialRampToValueAtTime(1760, now + 3.2);
    wGain.gain.setValueAtTime(0, now + 0.2);
    wGain.gain.linearRampToValueAtTime(0.018, now + 0.7);
    wGain.gain.exponentialRampToValueAtTime(0.001, now + 3.4);
    whine.connect(wGain); wGain.connect(master);
    whine.start(now + 0.2); whine.stop(now + 3.5);
}

/** A flash in the deep field — somewhere, something ended. */
export function fgDistantImpact(big: boolean, pan: number = 0): void {
    const a = ready();
    if (!a) return;
    const { ctx, master } = a;
    const now = ctx.currentTime;

    const bufferSize = ctx.sampleRate * 1.2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = big ? 420 : 240;
    const gain = ctx.createGain();
    gain.gain.value = big ? 0.09 : 0.05;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.9, Math.min(0.9, pan));

    const sub = ctx.createOscillator();
    const sGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(big ? 60 : 48, now);
    sub.frequency.exponentialRampToValueAtTime(24, now + 1.6);
    sGain.gain.setValueAtTime(big ? 0.08 : 0.04, now);
    sGain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);

    noise.connect(filter); filter.connect(gain); gain.connect(panner); panner.connect(master);
    sub.connect(sGain); sGain.connect(panner);
    noise.start(now);
    sub.start(now); sub.stop(now + 2);
}

/** The replicator's hymn: a detuned, joyful, wrong chord. */
export function fgHymn(): void {
    const a = ready();
    if (!a) return;
    const { ctx, master } = a;
    const now = ctx.currentTime;
    const base = 329.63; // E4
    [[1, 0], [1.26, 7], [1.5, -9], [2.02, 4]].forEach(([ratio, cents], i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = base * ratio;
        osc.detune.value = cents;
        const t = now + i * 0.4;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.03, t + 1.2);
        gain.gain.setValueAtTime(0.03, t + 2.8);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 5);
        osc.connect(gain);
        gain.connect(master);
        osc.start(t);
        osc.stop(t + 5.2);
    });
}

/** The end of you. */
export function fgDeath(): void {
    const a = ready();
    if (!a) return;
    const { ctx, master } = a;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(55, now);
    osc.frequency.exponentialRampToValueAtTime(18, now + 4);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.16, now + 0.2);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 4.5);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, now);
    filter.frequency.exponentialRampToValueAtTime(60, now + 4);
    osc.connect(filter); filter.connect(gain); gain.connect(master);
    osc.start(now); osc.stop(now + 4.6);

    // A thin, high remainder that hangs after the rumble: what the sky keeps.
    const shimmer = ctx.createOscillator();
    const sGain = ctx.createGain();
    shimmer.type = 'sine';
    shimmer.frequency.value = 2640;
    sGain.gain.setValueAtTime(0, now + 1);
    sGain.gain.linearRampToValueAtTime(0.012, now + 2);
    sGain.gain.exponentialRampToValueAtTime(0.001, now + 7);
    shimmer.connect(sGain); sGain.connect(master);
    shimmer.start(now + 1); shimmer.stop(now + 7.2);
}

/** Quiet resolution: you reached the end of the era. */
export function fgSurvived(): void {
    const a = ready();
    if (!a) return;
    const { ctx, master } = a;
    const now = ctx.currentTime;
    const base = 196; // G3
    [1, 1.5, 2, 3].forEach((ratio, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = base * ratio;
        const t = now + i * 0.25;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.028, t + 0.6);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 5);
        osc.connect(gain);
        gain.connect(master);
        osc.start(t);
        osc.stop(t + 5.2);
    });
}

// ── The watched-tone ─────────────────────────────────────────────────────────
// A beating pair of sines, barely audible. Present only while something out
// there knows where you are. Never announced, never explained in the UI.

interface WatchedTone {
    oscA: OscillatorNode;
    oscB: OscillatorNode;
    gain: GainNode;
}

let watched: WatchedTone | null = null;

export function fgUpdateWatched(watcherCount: number, huntersAiming: number): void {
    const a = ready();
    if (!a) {
        // Audio off: tear down if present.
        if (watched) { stopWatched(); }
        return;
    }
    const { ctx, master } = a;
    const now = ctx.currentTime;

    if (watcherCount <= 0) {
        if (watched) {
            watched.gain.gain.cancelScheduledValues(now);
            watched.gain.gain.setValueAtTime(watched.gain.gain.value, now);
            watched.gain.gain.linearRampToValueAtTime(0.0001, now + 4);
        }
        return;
    }

    if (!watched) {
        const oscA = ctx.createOscillator();
        const oscB = ctx.createOscillator();
        const gain = ctx.createGain();
        oscA.type = 'sine';
        oscB.type = 'sine';
        oscA.frequency.value = 66;
        oscB.frequency.value = 66.7;
        gain.gain.value = 0.0001;
        oscA.connect(gain);
        oscB.connect(gain);
        gain.connect(master);
        oscA.start(now);
        oscB.start(now);
        watched = { oscA, oscB, gain };
    }

    // Louder with more watchers; the beat quickens when hunters are afraid.
    const vol = Math.min(0.035, 0.008 + watcherCount * 0.005 + huntersAiming * 0.008);
    const beat = 0.7 + huntersAiming * 0.9;
    watched.gain.gain.cancelScheduledValues(now);
    watched.gain.gain.setValueAtTime(watched.gain.gain.value, now);
    watched.gain.gain.linearRampToValueAtTime(vol, now + 6);
    watched.oscB.frequency.linearRampToValueAtTime(66 + beat, now + 3);
}

export function stopWatched(): void {
    if (!watched) return;
    try {
        const ctx = getAudioContext();
        const now = ctx ? ctx.currentTime : 0;
        watched.gain.gain.cancelScheduledValues(now);
        watched.gain.gain.setValueAtTime(watched.gain.gain.value, now);
        watched.gain.gain.linearRampToValueAtTime(0.0001, now + 1);
        watched.oscA.stop(now + 1.2);
        watched.oscB.stop(now + 1.2);
    } catch {
        // Oscillators may already be stopped
    }
    watched = null;
}
