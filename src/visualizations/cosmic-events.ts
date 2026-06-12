// Cosmic Events - rare astronomical phenomena that create moments of wonder
// Enhanced supernova with 5 phases, and Interstellar-style black hole formation

import {
    createWebGLSupernova,
    prewarmWebGLSupernova,
    WebGLSupernovaRenderer
} from './webgl-supernova';

import { getMasterGain } from '../audio/context';
import { haptics } from '../haptics';
import { setStarfieldGravity, setStarfieldDim, setStarfieldShockwave } from './starfield';

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

interface CosmicEvent {
    type: 'pulsar' | 'supernova' | 'gamma-ray-burst';
    weight: number;
}

type SupernovaState =
    | 'idle'
    | 'progenitor_instability'
    | 'core_collapse'
    | 'shockwave_expansion'
    | 'peak_emission'
    | 'remnant_formation'
    | 'black_hole_formation'
    | 'black_hole_active'
    | 'black_hole_fadeout'
    | 'cleanup';

interface SupernovaElements {
    container: HTMLElement;
    core: HTMLElement;
    innerGlow: HTMLElement;
    shockwave: HTMLElement;
    shockwaveSecondary: HTMLElement;
    shockwaveTertiary: HTMLElement;
    nebulaClouds: HTMLElement[];
    lensFlares: HTMLElement[];
    particles: HTMLElement[];
    ejecta: HTMLElement[];
    flash: HTMLElement | null;
}

interface BlackHoleElements {
    container: HTMLElement;
    eventHorizon: HTMLElement;
    photonRing: HTMLElement;
    accretionDisk: HTMLElement;
    lensedRingTop: HTMLElement;
    lensedRingBottom: HTMLElement;
}

interface BlackHoleAudio {
    rumbleOsc: OscillatorNode;
    rumbleGain: GainNode;
    rumbleFilter: BiquadFilterNode;
    masterGain: GainNode;
}

interface StarGravityState {
    el: HTMLElement;
    originalX: number;
    originalY: number;
    originalOpacity: number;
    originalTransform: string;
}

interface ActiveCosmicEvent {
    state: SupernovaState;
    supernovaElements: SupernovaElements | null;
    blackHoleElements: BlackHoleElements | null;
    blackHoleAudio: BlackHoleAudio | null;
    gravityAnimationId: number | null;
    affectedStars: StarGravityState[];
    affectedTextElements: HTMLElement[];
    warpScrollHandler?: (() => void) | null;
    startTime: number;
    x: number;  // percentage
    y: number;  // percentage
    willBecomeBlackHole: boolean;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const cosmicEvents: CosmicEvent[] = [
    { type: 'pulsar', weight: 25 },
    { type: 'supernova', weight: 60 },
    { type: 'gamma-ray-burst', weight: 15 }
];

// Black hole formation probability (35% for dramatic effect)
const BLACK_HOLE_PROBABILITY = 0.35;

// Gravity effect parameters now live in the starfield canvas (field effects).

// Text warp parameters
const TEXT_WARP_RADIUS = 300;     // pixels

// Timing (milliseconds)
const SUPERNOVA_PHASES = {
    progenitor: { start: 0, duration: 2000 },
    collapse: { start: 2000, duration: 1000 },
    shockwave: { start: 3000, duration: 3000 },
    peak: { start: 6000, duration: 2000 },
    remnant: { start: 8000, duration: 7000 }
};

const BLACK_HOLE_PHASES = {
    formation: { start: 9000, duration: 8000 },   // 9-17s
    active: { start: 17000, duration: 25000 },    // 17-42s
    fadeout: { start: 42000, duration: 8000 }     // 42-50s
};

// ============================================================================
// STATE
// ============================================================================

let pulsarInterval: ReturnType<typeof setInterval> | null = null;
let eventContainer: HTMLElement | null = null;
let activeEvent: ActiveCosmicEvent | null = null;

// WebGL supernova state
let webglRenderer: WebGLSupernovaRenderer | null = null;

// Audio context (lazy initialized)
let cosmicAudioContext: AudioContext | null = null;
let cosmicGainNode: GainNode | null = null;

// Continuous audio nodes for WebGL phases
let progenitorOscillator: OscillatorNode | null = null;
let progenitorGain: GainNode | null = null;

const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;

// ============================================================================
// AUDIO UTILITIES
// ============================================================================

function getAudioContext(): AudioContext | null {
    if (!cosmicAudioContext) {
        try {
            cosmicAudioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
            cosmicGainNode = cosmicAudioContext.createGain();
            cosmicGainNode.gain.value = 0.15;
            cosmicGainNode.connect(cosmicAudioContext.destination);
        } catch {
            return null;
        }
    }
    return cosmicAudioContext;
}

function playPulsarPing(): void {
    const ctx = getAudioContext();
    if (!ctx || !cosmicGainNode) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);

    osc.connect(gain);
    gain.connect(cosmicGainNode);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
}

function playProgenitorSound(): void {
    const ctx = getAudioContext();
    if (!ctx || !cosmicGainNode) return;

    // Quiet rumbling tension
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(30, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(50, ctx.currentTime + 2);

    filter.type = 'lowpass';
    filter.frequency.value = 100;

    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 1);
    gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 2);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(cosmicGainNode);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 2);
}

function playCoreCollapseSound(): void {
    const ctx = getAudioContext();
    if (!ctx || !cosmicGainNode) return;

    // Sharp impact sound
    const osc = ctx.createOscillator();
    const noise = ctx.createOscillator();
    const gain = ctx.createGain();
    const noiseGain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.3);

    noise.type = 'sawtooth';
    noise.frequency.setValueAtTime(100, ctx.currentTime);

    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.5);

    noiseGain.gain.setValueAtTime(0.2, ctx.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

    osc.connect(gain);
    noise.connect(noiseGain);
    noiseGain.connect(gain);
    gain.connect(cosmicGainNode);

    osc.start(ctx.currentTime);
    noise.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 1);
    noise.stop(ctx.currentTime + 0.5);
}

function playExpansionSound(): void {
    const ctx = getAudioContext();
    if (!ctx || !cosmicGainNode) return;

    // Rising rumble
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(40, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(80, ctx.currentTime + 3);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(200, ctx.currentTime);
    filter.frequency.linearRampToValueAtTime(600, ctx.currentTime + 3);

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 2);
    gain.gain.linearRampToValueAtTime(0.4, ctx.currentTime + 3);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(cosmicGainNode);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 3);
}

function playRemnantSound(): void {
    const ctx = getAudioContext();
    if (!ctx || !cosmicGainNode) return;

    // Fading, cooling sound
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(60, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(30, ctx.currentTime + 5);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400, ctx.currentTime);
    filter.frequency.linearRampToValueAtTime(80, ctx.currentTime + 5);

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 5);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(cosmicGainNode);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 5);
}

function startBlackHoleAudio(): BlackHoleAudio | null {
    const ctx = getAudioContext();
    if (!ctx || !cosmicGainNode) return null;

    // Deep, ominous rumble
    const rumbleOsc = ctx.createOscillator();
    const rumbleGain = ctx.createGain();
    const rumbleFilter = ctx.createBiquadFilter();
    const masterGain = ctx.createGain();

    rumbleOsc.type = 'sawtooth';
    rumbleOsc.frequency.setValueAtTime(25, ctx.currentTime);

    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 60;
    rumbleFilter.Q.value = 3;

    rumbleGain.gain.setValueAtTime(0, ctx.currentTime);
    rumbleGain.gain.linearRampToValueAtTime(0.4, ctx.currentTime + 3);

    masterGain.gain.value = 1;

    rumbleOsc.connect(rumbleFilter);
    rumbleFilter.connect(rumbleGain);
    rumbleGain.connect(masterGain);
    masterGain.connect(cosmicGainNode);

    rumbleOsc.start(ctx.currentTime);

    return {
        rumbleOsc,
        rumbleGain,
        rumbleFilter,
        masterGain
    };
}

function fadeBlackHoleAudio(audio: BlackHoleAudio, duration: number): void {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    audio.masterGain.gain.linearRampToValueAtTime(0, now + duration / 1000);

    setTimeout(() => {
        try {
            audio.rumbleOsc.stop();
        } catch {
            // Already stopped
        }
    }, duration + 100);
}

function playStarConsumptionSound(panPosition: number): void {
    const ctx = getAudioContext();
    if (!ctx || !cosmicGainNode) return;

    // Descending ping as star falls in
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    const filter = ctx.createBiquadFilter();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1500, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 1.2);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3000, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 1.2);

    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);

    panner.pan.value = Math.max(-1, Math.min(1, panPosition));

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(cosmicGainNode);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 1.5);
}

function playGammaRayBurst(): void {
    const ctx = getAudioContext();
    if (!ctx || !cosmicGainNode) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(2000, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.5);

    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);

    osc.connect(gain);
    gain.connect(cosmicGainNode);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
}

// ============================================================================
// WEBGL SUPERNOVA AUDIO
// ============================================================================

function startWebGLProgenitorAudio(): void {
    const ctx = getAudioContext();
    if (!ctx || !cosmicGainNode) return;

    // Stop any existing progenitor audio
    stopWebGLProgenitorAudio();

    // Create continuous building rumble for the 10-second progenitor phase
    progenitorOscillator = ctx.createOscillator();
    progenitorGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    progenitorOscillator.type = 'sine';
    progenitorOscillator.frequency.setValueAtTime(25, ctx.currentTime);
    // Slowly rise in pitch as instability builds
    progenitorOscillator.frequency.linearRampToValueAtTime(60, ctx.currentTime + 10);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(80, ctx.currentTime);
    filter.frequency.linearRampToValueAtTime(200, ctx.currentTime + 10);

    progenitorGain.gain.setValueAtTime(0, ctx.currentTime);
    // Gradual build over 10 seconds
    progenitorGain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 2);
    progenitorGain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 8);
    progenitorGain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 9.5);

    progenitorOscillator.connect(filter);
    filter.connect(progenitorGain);
    progenitorGain.connect(cosmicGainNode);

    progenitorOscillator.start(ctx.currentTime);
}

function stopWebGLProgenitorAudio(): void {
    if (progenitorOscillator) {
        try {
            progenitorOscillator.stop();
        } catch {
            // Already stopped
        }
        progenitorOscillator = null;
    }
    progenitorGain = null;
}

function playWebGLExplosionAudio(): void {
    const ctx = getAudioContext();
    if (!ctx || !cosmicGainNode) return;

    // Fade out progenitor
    if (progenitorGain) {
        progenitorGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
        setTimeout(() => stopWebGLProgenitorAudio(), 400);
    }

    // Sharp detonation impact
    const impactOsc = ctx.createOscillator();
    const impactGain = ctx.createGain();
    const impactFilter = ctx.createBiquadFilter();

    impactOsc.type = 'sawtooth';
    impactOsc.frequency.setValueAtTime(300, ctx.currentTime);
    impactOsc.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.5);

    impactFilter.type = 'lowpass';
    impactFilter.frequency.setValueAtTime(2000, ctx.currentTime);
    impactFilter.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.5);

    impactGain.gain.setValueAtTime(0.6, ctx.currentTime);
    impactGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1);

    impactOsc.connect(impactFilter);
    impactFilter.connect(impactGain);
    impactGain.connect(cosmicGainNode);

    impactOsc.start(ctx.currentTime);
    impactOsc.stop(ctx.currentTime + 1.5);

    // Rising expansion rumble
    const expansionOsc = ctx.createOscillator();
    const expansionGain = ctx.createGain();
    const expansionFilter = ctx.createBiquadFilter();

    expansionOsc.type = 'sawtooth';
    expansionOsc.frequency.setValueAtTime(35, ctx.currentTime);
    expansionOsc.frequency.linearRampToValueAtTime(80, ctx.currentTime + 6);

    expansionFilter.type = 'lowpass';
    expansionFilter.frequency.setValueAtTime(150, ctx.currentTime);
    expansionFilter.frequency.linearRampToValueAtTime(400, ctx.currentTime + 4);
    expansionFilter.frequency.linearRampToValueAtTime(200, ctx.currentTime + 6);

    expansionGain.gain.setValueAtTime(0.2, ctx.currentTime + 0.1);
    expansionGain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 2);
    expansionGain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 5);
    expansionGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 6);

    expansionOsc.connect(expansionFilter);
    expansionFilter.connect(expansionGain);
    expansionGain.connect(cosmicGainNode);

    expansionOsc.start(ctx.currentTime);
    expansionOsc.stop(ctx.currentTime + 7);
}

function playWebGLRemnantAudio(): void {
    const ctx = getAudioContext();
    if (!ctx || !cosmicGainNode) return;

    // Ethereal cooling sound
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(80, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(50, ctx.currentTime + 4);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(300, ctx.currentTime);
    filter.frequency.linearRampToValueAtTime(100, ctx.currentTime + 4);

    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 2);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 4);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(cosmicGainNode);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 5);
}

function playWebGLNeutronStarAudio(): void {
    const ctx = getAudioContext();
    if (!ctx || !cosmicGainNode) return;

    // Ethereal, warm pulsing sound - like a cosmic heartbeat
    // Uses layered sine waves with gentle modulation for a pleasant choir-like effect

    const baseFreq = 165; // E3 - warm, not shrill
    const now = ctx.currentTime;

    // Master gain for all neutron star sounds
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0, now);
    masterGain.gain.linearRampToValueAtTime(0.12, now + 2);
    masterGain.gain.linearRampToValueAtTime(0.08, now + 6);
    masterGain.gain.linearRampToValueAtTime(0, now + 10);
    masterGain.connect(cosmicGainNode);

    // Warm lowpass filter
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, now);
    filter.frequency.linearRampToValueAtTime(400, now + 8);
    filter.Q.value = 1;
    filter.connect(masterGain);

    // Layer 1: Base tone (fundamental)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(baseFreq, now);
    gain1.gain.value = 0.4;
    osc1.connect(gain1);
    gain1.connect(filter);

    // Layer 2: Perfect fifth above (musical harmony)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(baseFreq * 1.5, now); // Perfect 5th
    gain2.gain.value = 0.25;
    osc2.connect(gain2);
    gain2.connect(filter);

    // Layer 3: Octave above (adds brightness without shrillness)
    const osc3 = ctx.createOscillator();
    const gain3 = ctx.createGain();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(baseFreq * 2, now); // Octave
    gain3.gain.value = 0.15;
    osc3.connect(gain3);
    gain3.connect(filter);

    // Gentle tremolo LFO (slower, subtler than before)
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(2.5, now); // Slower pulse - like breathing
    lfoGain.gain.value = 0.15; // Subtle modulation
    lfo.connect(lfoGain);
    lfoGain.connect(masterGain.gain);

    // Gentle pitch drift for organic feel
    osc1.frequency.linearRampToValueAtTime(baseFreq * 0.98, now + 5);
    osc1.frequency.linearRampToValueAtTime(baseFreq * 1.01, now + 10);

    // Start all oscillators
    osc1.start(now);
    osc2.start(now);
    osc3.start(now);
    lfo.start(now);

    // Stop after 11 seconds
    osc1.stop(now + 11);
    osc2.stop(now + 11);
    osc3.stop(now + 11);
    lfo.stop(now + 11);
}

function playNebulaFilamentAudio(): void {
    const ctx = getAudioContext();
    if (!ctx || !cosmicGainNode) return;

    // Ethereal, wispy sounds representing the delicate filament structures
    // Multiple soft, detuned oscillators creating a shimmering texture
    const now = ctx.currentTime;

    // Master gain - very subtle
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0, now);
    masterGain.gain.linearRampToValueAtTime(0.06, now + 3);
    masterGain.gain.setValueAtTime(0.06, now + 5);
    masterGain.gain.linearRampToValueAtTime(0, now + 12);
    masterGain.connect(cosmicGainNode);

    // Soft highpass to keep it airy
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.setValueAtTime(200, now);
    highpass.Q.value = 0.5;
    highpass.connect(masterGain);

    // Gentle lowpass to prevent harshness
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(2000, now);
    lowpass.frequency.linearRampToValueAtTime(800, now + 10);
    lowpass.Q.value = 1;
    lowpass.connect(highpass);

    // Create multiple detuned oscillators for shimmer effect
    const frequencies = [330, 440, 550, 660]; // Harmonic series based on E4
    const detunes = [-8, 5, -3, 7]; // Slight detuning for organic shimmer

    frequencies.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);
        osc.detune.setValueAtTime(detunes[i], now);

        // Each oscillator fades in and out at slightly different times
        const fadeOffset = i * 0.8;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.15 - i * 0.03, now + 2 + fadeOffset);
        gain.gain.linearRampToValueAtTime(0.1 - i * 0.02, now + 8);
        gain.gain.linearRampToValueAtTime(0, now + 11 + fadeOffset);

        // Slow random-ish pitch drift for organic movement
        const driftAmount = 10 + i * 5;
        osc.frequency.linearRampToValueAtTime(freq + driftAmount, now + 4);
        osc.frequency.linearRampToValueAtTime(freq - driftAmount * 0.5, now + 8);
        osc.frequency.linearRampToValueAtTime(freq, now + 12);

        osc.connect(gain);
        gain.connect(lowpass);

        osc.start(now + fadeOffset * 0.3);
        osc.stop(now + 13);
    });

    // Add a subtle noise layer for texture (like cosmic dust)
    const noiseLength = 2;
    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * noiseLength, ctx.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) {
        noiseData[i] = (Math.random() * 2 - 1) * 0.3;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(600, now);
    noiseFilter.frequency.linearRampToValueAtTime(400, now + 10);
    noiseFilter.Q.value = 2;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0, now);
    noiseGain.gain.linearRampToValueAtTime(0.03, now + 3);
    noiseGain.gain.linearRampToValueAtTime(0.02, now + 8);
    noiseGain.gain.linearRampToValueAtTime(0, now + 12);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(masterGain);

    noise.start(now);
    noise.stop(now + 13);
}

function playWebGLBlackHoleAudio(): void {
    const ctx = getAudioContext();
    if (!ctx || !cosmicGainNode) return;

    // ═══════════════════════════════════════════════════════════════════
    // THE SUBLIME VOID - A layered soundscape of cosmic terror and beauty
    // ═══════════════════════════════════════════════════════════════════

    const now = ctx.currentTime;

    // ═══ THE CONSUMPTION ═══
    // Black hole sucks all ambient sound into silence
    const ambientMaster = getMasterGain();
    if (ambientMaster) {
        // Store current value and duck to near-silence
        const currentVol = ambientMaster.gain.value;
        ambientMaster.gain.cancelScheduledValues(now);
        ambientMaster.gain.setValueAtTime(currentVol, now);
        // Slowly get sucked into the void
        ambientMaster.gain.exponentialRampToValueAtTime(0.02, now + 5);
        // Hold in near-silence during peak black hole
        ambientMaster.gain.setValueAtTime(0.02, now + 8);
        // Gradually return as black hole fades
        ambientMaster.gain.linearRampToValueAtTime(currentVol, now + 14);
    }

    // Master gain for the black hole's own sounds
    const bhMasterGain = ctx.createGain();
    bhMasterGain.gain.setValueAtTime(0, now);
    bhMasterGain.gain.linearRampToValueAtTime(0.4, now + 3); // Higher for bass presence
    bhMasterGain.gain.setValueAtTime(0.4, now + 7);
    bhMasterGain.gain.linearRampToValueAtTime(0, now + 11);
    bhMasterGain.connect(cosmicGainNode);

    // ═══ LAYER 0: THE UNFATHOMABLE DEPTH ═══
    // Sub-bass with audible harmonics so it comes through on all speakers
    const depthOsc = ctx.createOscillator();
    const depthOsc2 = ctx.createOscillator(); // 1 octave up - audible bass
    const depthOsc3 = ctx.createOscillator(); // 2 octaves up - presence
    const depthGain = ctx.createGain();

    depthOsc.type = 'sine';
    depthOsc.frequency.setValueAtTime(25, now);
    depthOsc.frequency.exponentialRampToValueAtTime(16, now + 10);

    depthOsc2.type = 'sine';
    depthOsc2.frequency.setValueAtTime(50, now); // Octave up - audible on most speakers
    depthOsc2.frequency.exponentialRampToValueAtTime(32, now + 10);

    depthOsc3.type = 'triangle'; // Softer timbre for upper harmonic
    depthOsc3.frequency.setValueAtTime(100, now); // 2 octaves up
    depthOsc3.frequency.exponentialRampToValueAtTime(64, now + 10);

    depthGain.gain.setValueAtTime(0, now);
    depthGain.gain.linearRampToValueAtTime(0.7, now + 2);
    depthGain.gain.setValueAtTime(0.7, now + 8);
    depthGain.gain.linearRampToValueAtTime(0, now + 11);

    depthOsc.connect(depthGain);
    depthOsc2.connect(depthGain);
    depthOsc3.connect(depthGain);
    depthGain.connect(bhMasterGain);

    // ═══ LAYER 0.5: DISTANT COSMIC RUMBLE ═══
    // Like thunder from across the universe - the sound of spacetime tearing
    const rumbleNoise = ctx.createBufferSource();
    const rumbleBuffer = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const rumbleData = rumbleBuffer.getChannelData(0);
    // Create irregular rumbling texture
    for (let i = 0; i < rumbleData.length; i++) {
        const t = i / ctx.sampleRate;
        // Layered slow oscillations for organic rumble
        const rumble = Math.sin(t * 3) * 0.3 +
                       Math.sin(t * 7.3) * 0.2 +
                       Math.sin(t * 11.7) * 0.15 +
                       (Math.random() * 2 - 1) * 0.35;
        rumbleData[i] = rumble;
    }
    rumbleNoise.buffer = rumbleBuffer;
    rumbleNoise.loop = true;

    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.setValueAtTime(120, now); // Higher cutoff so it's audible
    rumbleFilter.frequency.linearRampToValueAtTime(60, now + 10);
    rumbleFilter.Q.value = 1.5;

    const rumbleGain = ctx.createGain();
    rumbleGain.gain.setValueAtTime(0, now);
    rumbleGain.gain.linearRampToValueAtTime(0.8, now + 3); // Powerful rumble
    rumbleGain.gain.setValueAtTime(0.8, now + 7);
    rumbleGain.gain.linearRampToValueAtTime(0, now + 11);

    rumbleNoise.connect(rumbleFilter);
    rumbleFilter.connect(rumbleGain);
    rumbleGain.connect(bhMasterGain);

    // ═══ LAYER 1: THE ABYSS DRONE ═══
    // Deep gravitational pull - descends into sub-bass infinity
    const abyssDrone = ctx.createOscillator();
    const abyssGain = ctx.createGain();
    const abyssFilter = ctx.createBiquadFilter();

    abyssDrone.type = 'sine';
    abyssDrone.frequency.setValueAtTime(55, now); // A1
    abyssDrone.frequency.exponentialRampToValueAtTime(27.5, now + 10); // Descends an octave

    abyssFilter.type = 'lowpass';
    abyssFilter.frequency.setValueAtTime(200, now);
    abyssFilter.frequency.exponentialRampToValueAtTime(60, now + 10);
    abyssFilter.Q.value = 2;

    abyssGain.gain.value = 0.5;
    abyssDrone.connect(abyssFilter);
    abyssFilter.connect(abyssGain);
    abyssGain.connect(bhMasterGain);

    // ═══ LAYER 2: GRAVITATIONAL WAVES ═══
    // Two slightly detuned oscillators create beating patterns
    const gwave1 = ctx.createOscillator();
    const gwave2 = ctx.createOscillator();
    const gwaveGain = ctx.createGain();

    gwave1.type = 'sine';
    gwave2.type = 'sine';
    gwave1.frequency.setValueAtTime(41, now);
    gwave2.frequency.setValueAtTime(41.5, now); // 0.5Hz beating
    // Waves slow down as time dilates near the horizon
    gwave1.frequency.exponentialRampToValueAtTime(20, now + 10);
    gwave2.frequency.exponentialRampToValueAtTime(20.15, now + 10);

    gwaveGain.gain.value = 0.3;
    gwave1.connect(gwaveGain);
    gwave2.connect(gwaveGain);
    gwaveGain.connect(bhMasterGain);

    // ═══ LAYER 3: TIME DILATION CHOIR ═══
    // Ethereal tones that slowly stretch and descend - being pulled in
    const choirFreqs = [330, 440, 554, 659]; // A minor chord
    const choirEndFreqs = [82, 110, 138, 165]; // Stretched down 2 octaves

    choirFreqs.forEach((startFreq, i) => {
        const voice = ctx.createOscillator();
        const voiceGain = ctx.createGain();
        const voiceFilter = ctx.createBiquadFilter();

        voice.type = 'sine';
        voice.frequency.setValueAtTime(startFreq, now);
        // Each voice descends at slightly different rate - spaghettification
        const stretchFactor = 1 + i * 0.15;
        voice.frequency.exponentialRampToValueAtTime(
            choirEndFreqs[i],
            now + 8 * stretchFactor
        );

        voiceFilter.type = 'lowpass';
        voiceFilter.frequency.setValueAtTime(2000, now);
        voiceFilter.frequency.exponentialRampToValueAtTime(200, now + 9);
        voiceFilter.Q.value = 1;

        voiceGain.gain.setValueAtTime(0, now);
        voiceGain.gain.linearRampToValueAtTime(0.03 - i * 0.005, now + 2); // Quieter choir
        voiceGain.gain.linearRampToValueAtTime(0.015, now + 7);
        voiceGain.gain.exponentialRampToValueAtTime(0.001, now + 10);

        voice.connect(voiceFilter);
        voiceFilter.connect(voiceGain);
        voiceGain.connect(bhMasterGain);

        voice.start(now + i * 0.3);
        voice.stop(now + 12);
    });

    // ═══ LAYER 4: EVENT HORIZON RING ═══
    // A subtle resonant hum at the point of no return
    const horizonOsc = ctx.createOscillator();
    const horizonGain = ctx.createGain();
    const horizonFilter = ctx.createBiquadFilter();

    horizonOsc.type = 'sine';
    horizonOsc.frequency.setValueAtTime(73.4, now); // D2 - ominous
    horizonOsc.frequency.linearRampToValueAtTime(55, now + 10);

    horizonFilter.type = 'bandpass';
    horizonFilter.frequency.setValueAtTime(80, now);
    horizonFilter.Q.value = 15; // Sharp resonance

    horizonGain.gain.setValueAtTime(0, now);
    horizonGain.gain.linearRampToValueAtTime(0.2, now + 4);
    horizonGain.gain.setValueAtTime(0.2, now + 7);
    horizonGain.gain.linearRampToValueAtTime(0, now + 10);

    horizonOsc.connect(horizonFilter);
    horizonFilter.connect(horizonGain);
    horizonGain.connect(bhMasterGain);

    // ═══ LAYER 5: HAWKING RADIATION WHISPERS ═══
    // Faint sparkles at the edge - particles escaping the void
    const hawkingNoise = ctx.createBufferSource();
    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) {
        // Sparse, occasional sparkles
        noiseData[i] = Math.random() < 0.02 ? (Math.random() * 2 - 1) : 0;
    }
    hawkingNoise.buffer = noiseBuffer;
    hawkingNoise.loop = true;

    const hawkingFilter = ctx.createBiquadFilter();
    hawkingFilter.type = 'highpass';
    hawkingFilter.frequency.setValueAtTime(2000, now); // Lower, less harsh
    hawkingFilter.frequency.linearRampToValueAtTime(1000, now + 8);

    const hawkingGain = ctx.createGain();
    hawkingGain.gain.setValueAtTime(0, now);
    hawkingGain.gain.linearRampToValueAtTime(0.04, now + 3); // Much quieter
    hawkingGain.gain.linearRampToValueAtTime(0.02, now + 7);
    hawkingGain.gain.linearRampToValueAtTime(0, now + 10);

    hawkingNoise.connect(hawkingFilter);
    hawkingFilter.connect(hawkingGain);
    hawkingGain.connect(bhMasterGain);

    // ═══ LAYER 6: THE CONSUMING WIND ═══
    // Filtered noise being sucked into the void
    const windNoise = ctx.createBufferSource();
    const windBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const windData = windBuffer.getChannelData(0);
    for (let i = 0; i < windData.length; i++) {
        windData[i] = (Math.random() * 2 - 1) * 0.5;
    }
    windNoise.buffer = windBuffer;
    windNoise.loop = true;

    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.setValueAtTime(400, now); // Start lower, less shrill
    windFilter.frequency.exponentialRampToValueAtTime(60, now + 10); // Sucked down
    windFilter.Q.value = 2;

    const windGain = ctx.createGain();
    windGain.gain.setValueAtTime(0, now);
    windGain.gain.linearRampToValueAtTime(0.06, now + 2); // Quieter
    windGain.gain.linearRampToValueAtTime(0.04, now + 6);
    windGain.gain.exponentialRampToValueAtTime(0.001, now + 10);

    windNoise.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(bhMasterGain);

    // ═══ LAYER 7: THE FINAL BREATH ═══
    // A last gasp of light before the singularity - a distant bell
    const bell1 = ctx.createOscillator();
    const bell2 = ctx.createOscillator();
    const bellGain = ctx.createGain();

    bell1.type = 'sine';
    bell2.type = 'sine';
    bell1.frequency.setValueAtTime(262, now + 6); // C4 - lower octave
    bell2.frequency.setValueAtTime(262 * 2.4, now + 6); // Inharmonic partial

    bell1.frequency.exponentialRampToValueAtTime(65, now + 10);
    bell2.frequency.exponentialRampToValueAtTime(156, now + 10);

    bellGain.gain.setValueAtTime(0, now);
    bellGain.gain.setValueAtTime(0, now + 6);
    bellGain.gain.linearRampToValueAtTime(0.04, now + 6.5); // Much quieter
    bellGain.gain.exponentialRampToValueAtTime(0.001, now + 10);

    bell1.connect(bellGain);
    bell2.connect(bellGain);
    bellGain.connect(bhMasterGain);

    // Start all oscillators
    depthOsc.start(now);
    depthOsc2.start(now);
    depthOsc3.start(now);
    rumbleNoise.start(now);
    abyssDrone.start(now);
    gwave1.start(now);
    gwave2.start(now);
    horizonOsc.start(now);
    hawkingNoise.start(now);
    windNoise.start(now);
    bell1.start(now + 6);
    bell2.start(now + 6);

    // Stop all oscillators
    depthOsc.stop(now + 12);
    depthOsc2.stop(now + 12);
    depthOsc3.stop(now + 12);
    rumbleNoise.stop(now + 12);
    abyssDrone.stop(now + 12);
    gwave1.stop(now + 12);
    gwave2.stop(now + 12);
    horizonOsc.stop(now + 12);
    hawkingNoise.stop(now + 12);
    windNoise.stop(now + 12);
    bell1.stop(now + 12);
    bell2.stop(now + 12);
}

function handleWebGLPhaseChange(phase: string, _time: number): void {
    switch (phase) {
        case 'explosion':
            playWebGLExplosionAudio();
            break;
        case 'remnant':
            playWebGLRemnantAudio();
            // Nebula filaments emerge during remnant phase
            playNebulaFilamentAudio();
            break;
        case 'neutron':
            playWebGLNeutronStarAudio();
            break;
        case 'blackhole':
            playWebGLBlackHoleAudio();
            break;
        case 'fadeout':
            // Audio naturally fades out
            break;
    }
}

// ============================================================================
// DOM UTILITIES
// ============================================================================

function createEventContainer(): HTMLElement {
    if (eventContainer) return eventContainer;

    eventContainer = document.createElement('div');
    eventContainer.id = 'cosmic-events';
    eventContainer.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 5;
        overflow: hidden;
    `;
    document.body.appendChild(eventContainer);
    return eventContainer;
}

// ============================================================================
// PULSAR (unchanged from original)
// ============================================================================

function createPulsar(): void {
    const container = createEventContainer();
    const x = 10 + Math.random() * 80;
    const y = 10 + Math.random() * 60;

    const pulsar = document.createElement('div');
    pulsar.className = 'cosmic-pulsar';
    pulsar.style.cssText = `
        position: absolute;
        left: ${x}%;
        top: ${y}%;
        width: 4px;
        height: 4px;
        background: #fff;
        border-radius: 50%;
        box-shadow: 0 0 10px 3px rgba(180, 200, 255, 0.8),
                    0 0 20px 6px rgba(180, 200, 255, 0.4),
                    0 0 30px 10px rgba(180, 200, 255, 0.2);
        opacity: 0;
    `;
    container.appendChild(pulsar);

    let pulseCount = 0;
    const maxPulses = 15;

    pulsarInterval = setInterval(() => {
        if (pulseCount >= maxPulses) {
            if (pulsarInterval) clearInterval(pulsarInterval);
            pulsar.remove();
            return;
        }

        pulsar.style.opacity = '1';
        pulsar.style.transform = 'scale(1.5)';
        playPulsarPing();

        setTimeout(() => {
            pulsar.style.opacity = '0.2';
            pulsar.style.transform = 'scale(1)';
        }, 80);

        pulseCount++;
    }, pulseCount % 3 === 2 ? 600 : 200);
}

// ============================================================================
// GAMMA RAY BURST (unchanged from original)
// ============================================================================

function createGammaRayBurst(): void {
    const container = createEventContainer();

    const angle = Math.random() * 360;
    const startX = 50 + Math.cos(angle * Math.PI / 180) * 60;
    const startY = 50 + Math.sin(angle * Math.PI / 180) * 60;

    const burst = document.createElement('div');
    burst.className = 'cosmic-grb';
    burst.style.cssText = `
        position: absolute;
        left: ${startX}%;
        top: ${startY}%;
        width: 200vmax;
        height: 3px;
        background: linear-gradient(90deg,
            transparent 0%,
            rgba(150, 200, 255, 0.3) 20%,
            rgba(200, 220, 255, 0.8) 45%,
            #fff 50%,
            rgba(200, 220, 255, 0.8) 55%,
            rgba(150, 200, 255, 0.3) 80%,
            transparent 100%
        );
        transform-origin: center center;
        transform: translate(-50%, -50%) rotate(${angle}deg) scaleX(0);
        opacity: 0;
    `;
    container.appendChild(burst);

    const flash = document.createElement('div');
    flash.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(200, 220, 255, 0.15);
        opacity: 0;
        pointer-events: none;
    `;
    container.appendChild(flash);

    playGammaRayBurst();

    setTimeout(() => {
        burst.style.transition = 'transform 0.15s ease-out, opacity 0.1s ease-out';
        burst.style.transform = `translate(-50%, -50%) rotate(${angle}deg) scaleX(1)`;
        burst.style.opacity = '1';
        flash.style.transition = 'opacity 0.1s ease-out';
        flash.style.opacity = '1';
    }, 50);

    setTimeout(() => {
        burst.style.transition = 'opacity 0.4s ease-in';
        burst.style.opacity = '0';
        flash.style.transition = 'opacity 0.3s ease-in';
        flash.style.opacity = '0';
    }, 200);

    setTimeout(() => {
        burst.remove();
        flash.remove();
    }, 700);
}

// ============================================================================
// ENHANCED SUPERNOVA
// ============================================================================

function generateEjectaAngles(count: number): number[] {
    const baseAngles = Array.from({ length: count }, (_, i) => (360 / count) * i);
    return baseAngles.map(a => a + (Math.random() - 0.5) * 60);
}

function createSupernovaElements(x: number, y: number): SupernovaElements {
    const container = createEventContainer();

    // Main supernova container
    const supernovaContainer = document.createElement('div');
    supernovaContainer.className = 'supernova-container';
    supernovaContainer.style.cssText = `
        position: absolute;
        left: ${x}%;
        top: ${y}%;
        width: 0;
        height: 0;
        will-change: transform, opacity;
    `;
    container.appendChild(supernovaContainer);

    // Inner glow - soft halo around core
    const innerGlow = document.createElement('div');
    innerGlow.className = 'supernova-inner-glow';
    supernovaContainer.appendChild(innerGlow);

    // Core element - off-center gradient for depth
    const core = document.createElement('div');
    core.className = 'supernova-core';
    core.style.cssText = `
        position: absolute;
        left: 0;
        top: 0;
        width: 8px;
        height: 8px;
        background: radial-gradient(circle at 40% 40%,
            var(--supernova-flash) 0%,
            var(--supernova-core-hot) 20%,
            var(--supernova-core-warm) 50%,
            transparent 100%);
        border-radius: 50%;
        transform: translate(-50%, -50%) scale(0.5);
        opacity: 0;
        will-change: transform, opacity, background, box-shadow;
    `;
    supernovaContainer.appendChild(core);

    // Nebula clouds - 4 overlapping irregular blobs
    const nebulaClouds: HTMLElement[] = [];
    const nebulaCount = isMobile ? 3 : 4;
    for (let i = 1; i <= nebulaCount; i++) {
        const nebula = document.createElement('div');
        nebula.className = `supernova-nebula nebula-${i}`;
        supernovaContainer.appendChild(nebula);
        nebulaClouds.push(nebula);
    }

    // Lens flares - 6 elongated light rays
    const lensFlares: HTMLElement[] = [];
    const flareCount = isMobile ? 4 : 6;
    const flareAngles = Array.from({ length: flareCount }, (_, i) => (360 / flareCount) * i + Math.random() * 20);

    flareAngles.forEach(angle => {
        const length = 80 + Math.random() * 120; // Vary lengths
        const flare = document.createElement('div');
        flare.className = 'supernova-flare';
        flare.style.cssText = `
            --flare-length: ${length}px;
            transform: translate(-50%, -100%) rotate(${angle}deg);
            height: 10px;
        `;
        supernovaContainer.appendChild(flare);
        lensFlares.push(flare);
    });

    // Primary shockwave ring
    const shockwave = document.createElement('div');
    shockwave.className = 'supernova-shockwave';
    shockwave.style.cssText = `
        position: absolute;
        left: 0;
        top: 0;
        width: 20px;
        height: 20px;
        background: transparent;
        border: 3px solid var(--supernova-shockwave);
        border-radius: 50%;
        transform: translate(-50%, -50%) scale(0);
        opacity: 0;
        box-shadow:
            inset 0 0 15px rgba(255, 140, 0, 0.6),
            0 0 30px rgba(255, 140, 0, 0.5),
            0 0 60px rgba(255, 100, 0, 0.3);
        will-change: transform, opacity;
    `;
    supernovaContainer.appendChild(shockwave);

    // Secondary shockwave - faster, dimmer
    const shockwaveSecondary = document.createElement('div');
    shockwaveSecondary.className = 'supernova-shockwave-secondary';
    supernovaContainer.appendChild(shockwaveSecondary);

    // Tertiary shockwave - fastest, thinnest
    const shockwaveTertiary = document.createElement('div');
    shockwaveTertiary.className = 'supernova-shockwave-tertiary';
    supernovaContainer.appendChild(shockwaveTertiary);

    // Particles - 15-25 small dots that fly outward
    const particles: HTMLElement[] = [];
    const particleCount = isMobile ? 15 : 25;

    for (let i = 0; i < particleCount; i++) {
        const angle = Math.random() * 360;
        const distance = 80 + Math.random() * 150; // How far they fly
        const duration = 1.5 + Math.random() * 2; // 1.5-3.5s
        const dx = Math.cos(angle * Math.PI / 180) * distance;
        const dy = Math.sin(angle * Math.PI / 180) * distance;

        const particle = document.createElement('div');
        particle.className = 'supernova-particle';
        particle.style.cssText = `
            --particle-dx: ${dx}px;
            --particle-dy: ${dy}px;
            --particle-duration: ${duration}s;
        `;
        supernovaContainer.appendChild(particle);
        particles.push(particle);
    }

    // Ejecta elements - asymmetric debris
    const ejectaCount = isMobile ? 3 : 5;
    const ejectaAngles = generateEjectaAngles(ejectaCount);
    const ejecta: HTMLElement[] = [];

    ejectaAngles.forEach((angle, i) => {
        const length = 60 + Math.random() * 80;
        const el = document.createElement('div');
        el.className = 'supernova-ejecta';
        el.style.cssText = `
            position: absolute;
            left: 0;
            top: 0;
            width: ${length}px;
            height: 3px;
            background: linear-gradient(90deg,
                var(--supernova-ejecta) 0%,
                var(--supernova-core-warm) 40%,
                transparent 100%);
            border-radius: 2px;
            transform-origin: left center;
            transform: rotate(${angle}deg) scaleX(0);
            opacity: 0;
            will-change: transform, opacity;
            ${i % 2 === 0 ? 'filter: brightness(1.2);' : ''}
        `;
        supernovaContainer.appendChild(el);
        ejecta.push(el);
    });

    return {
        container: supernovaContainer,
        core,
        innerGlow,
        shockwave,
        shockwaveSecondary,
        shockwaveTertiary,
        nebulaClouds,
        lensFlares,
        particles,
        ejecta,
        flash: null
    };
}

function animateProgenitorPhase(elements: SupernovaElements): void {
    const { core, innerGlow } = elements;

    playProgenitorSound();

    // Show inner glow with subtle pulse
    innerGlow.style.opacity = '0.3';
    innerGlow.style.transform = 'translate(-50%, -50%) scale(0.5)';

    // Flickering instability - more dramatic
    core.style.transition = 'none';
    core.style.opacity = '0.6';
    core.style.transform = 'translate(-50%, -50%) scale(1)';

    let flickerCount = 0;
    const flickerInterval = setInterval(() => {
        const scale = 0.7 + Math.random() * 0.6;
        const brightness = 0.7 + Math.random() * 0.6;
        const glowScale = 0.4 + Math.random() * 0.3;

        core.style.transform = `translate(-50%, -50%) scale(${scale})`;
        core.style.filter = `brightness(${brightness})`;
        core.style.opacity = String(0.4 + Math.random() * 0.6);

        // Inner glow flickers too
        innerGlow.style.opacity = String(0.2 + Math.random() * 0.3);
        innerGlow.style.transform = `translate(-50%, -50%) scale(${glowScale})`;

        flickerCount++;
        if (flickerCount > 25) {
            clearInterval(flickerInterval);
            core.style.filter = 'brightness(1)';
        }
    }, 80);
}

function animateCoreCollapsePhase(elements: SupernovaElements): void {
    const { core, innerGlow, lensFlares } = elements;

    playCoreCollapseSound();

    // Screen flash - more intense
    const flash = document.createElement('div');
    flash.className = 'supernova-flash';
    flash.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: radial-gradient(circle at 50% 50%,
            rgba(255, 255, 255, 0.9) 0%,
            rgba(255, 248, 220, 0.5) 30%,
            transparent 70%);
        opacity: 0;
        pointer-events: none;
        z-index: 10;
    `;
    document.body.appendChild(flash);
    elements.flash = flash;

    // Flash animation - brighter and longer
    flash.style.transition = 'opacity 0.1s ease-out';
    setTimeout(() => { flash.style.opacity = '1'; }, 10);
    setTimeout(() => {
        flash.style.transition = 'opacity 0.8s ease-in';
        flash.style.opacity = '0';
    }, 300);
    setTimeout(() => { flash.remove(); elements.flash = null; }, 1200);

    // Inner glow expands with flash
    innerGlow.style.transition = 'all 0.5s ease-out';
    innerGlow.style.opacity = '1';
    innerGlow.style.transform = 'translate(-50%, -50%) scale(3)';

    // Lens flares appear dramatically
    lensFlares.forEach((flare, i) => {
        setTimeout(() => {
            flare.classList.add('visible');
        }, i * 50);
    });

    // Core expands rapidly
    core.style.transition = 'all 0.8s cubic-bezier(0.2, 0.8, 0.3, 1)';
    core.style.opacity = '1';
    core.style.transform = 'translate(-50%, -50%) scale(5)';
    core.style.background = `radial-gradient(circle at 45% 45%,
        #fff 0%,
        #fff 30%,
        var(--supernova-core-hot) 60%,
        var(--supernova-core-warm) 80%,
        transparent 100%)`;
    core.style.boxShadow = `
        0 0 40px 20px rgba(255, 255, 255, 0.9),
        0 0 80px 40px rgba(255, 220, 180, 0.7),
        0 0 140px 70px rgba(255, 180, 100, 0.4)
    `;
}

function animateShockwavePhase(elements: SupernovaElements): void {
    const { core, shockwave, shockwaveSecondary, shockwaveTertiary,
            nebulaClouds, particles, ejecta, innerGlow } = elements;

    playExpansionSound();

    // Core continues expanding with color shift
    core.style.transition = 'all 3s ease-out';
    core.style.transform = 'translate(-50%, -50%) scale(10)';
    core.classList.add('color-shifting');
    core.style.boxShadow = `
        0 0 50px 25px rgba(255, 200, 150, 0.8),
        0 0 100px 50px rgba(255, 150, 100, 0.5),
        0 0 160px 80px rgba(255, 100, 50, 0.3)
    `;

    // Inner glow expands and fades
    innerGlow.style.transition = 'all 3s ease-out';
    innerGlow.style.transform = 'translate(-50%, -50%) scale(6)';
    innerGlow.style.opacity = '0.4';

    // Primary shockwave ring expands
    shockwave.style.transition = 'all 3s ease-out';
    shockwave.style.opacity = '0.9';
    shockwave.style.transform = 'translate(-50%, -50%) scale(18)';

    // Secondary shockwave - faster, starts slightly delayed
    setTimeout(() => {
        shockwaveSecondary.classList.add('expanding');
    }, 200);

    // Tertiary shockwave - fastest
    setTimeout(() => {
        shockwaveTertiary.classList.add('expanding');
    }, 400);

    // Nebula clouds animate (they have CSS animations)
    nebulaClouds.forEach((cloud, i) => {
        setTimeout(() => {
            cloud.style.opacity = '1';
        }, i * 200);
    });

    // Particles launch outward with staggered timing
    particles.forEach((particle, i) => {
        setTimeout(() => {
            particle.classList.add('launched');
        }, 100 + i * 30);
    });

    // Ejecta shoot outward with staggered timing
    ejecta.forEach((el, i) => {
        setTimeout(() => {
            el.style.transition = 'all 2.5s ease-out';
            el.style.opacity = '0.9';
            el.style.transform = `rotate(${parseFloat(el.style.transform.match(/rotate\(([^)]+)\)/)?.[1] || '0')}deg) scaleX(1) translateX(60px)`;
        }, i * 80);
    });
}

function animatePeakPhase(elements: SupernovaElements): void {
    const { core, shockwave, ejecta, innerGlow, lensFlares } = elements;

    // Core brightness pulsing - dramatic heartbeat effect
    core.classList.add('pulsing');

    // Peak brightness - core at maximum
    core.style.transition = 'all 1.5s ease-in-out';
    core.style.transform = 'translate(-50%, -50%) scale(14)';
    core.style.boxShadow = `
        0 0 60px 30px rgba(255, 255, 255, 0.6),
        0 0 120px 60px rgba(255, 180, 100, 0.4),
        0 0 180px 90px rgba(255, 100, 50, 0.2)
    `;

    // Inner glow at peak
    innerGlow.style.transition = 'all 2s ease-in-out';
    innerGlow.style.transform = 'translate(-50%, -50%) scale(8)';
    innerGlow.style.opacity = '0.5';

    // Shockwave continues expanding
    shockwave.style.transition = 'all 2s ease-out';
    shockwave.style.transform = 'translate(-50%, -50%) scale(28)';
    shockwave.style.opacity = '0.4';

    // Lens flares begin to fade
    setTimeout(() => {
        lensFlares.forEach(flare => {
            flare.style.transition = 'opacity 2s ease-out';
            flare.style.opacity = '0.3';
        });
    }, 500);

    // Ejecta reach maximum extent
    ejecta.forEach(el => {
        el.style.transition = 'all 2s ease-out';
        el.style.opacity = '0.5';
        el.style.transform = `rotate(${parseFloat(el.style.transform.match(/rotate\(([^)]+)\)/)?.[1] || '0')}deg) scaleX(1) translateX(140px)`;
    });
}

function animateRemnantPhase(elements: SupernovaElements, willBecomeBlackHole: boolean): void {
    const { core, shockwave, ejecta, innerGlow, lensFlares,
            nebulaClouds, shockwaveSecondary, shockwaveTertiary } = elements;

    if (!willBecomeBlackHole) {
        playRemnantSound();
    }

    // Stop pulsing
    core.classList.remove('pulsing');

    // Core collapses and cools
    core.style.transition = 'all 5s ease-in';

    if (willBecomeBlackHole) {
        // Rapid collapse to point - dramatic implosion
        core.style.transform = 'translate(-50%, -50%) scale(1.5)';
        core.style.background = `radial-gradient(circle,
            rgba(100, 80, 60, 0.9) 0%,
            rgba(60, 40, 30, 0.6) 50%,
            transparent 100%)`;
        core.style.boxShadow = '0 0 30px 15px rgba(80, 60, 40, 0.6)';
    } else {
        // Normal remnant fade - expands into nebula
        core.style.opacity = '0.25';
        core.style.transform = 'translate(-50%, -50%) scale(25)';
        core.style.background = `radial-gradient(circle,
            var(--supernova-remnant) 0%,
            rgba(90, 120, 160, 0.3) 50%,
            transparent 100%)`;
        core.style.boxShadow = 'none';
    }

    // Inner glow fades
    innerGlow.style.transition = 'all 4s ease-in';
    innerGlow.style.opacity = '0';

    // Lens flares fade completely
    lensFlares.forEach(flare => {
        flare.style.transition = 'opacity 3s ease-in';
        flare.style.opacity = '0';
    });

    // Shockwaves fade out
    shockwave.style.transition = 'all 4s ease-in';
    shockwave.style.opacity = '0';
    shockwave.style.transform = 'translate(-50%, -50%) scale(45)';

    shockwaveSecondary.style.transition = 'opacity 3s ease-in';
    shockwaveSecondary.style.opacity = '0';

    shockwaveTertiary.style.transition = 'opacity 3s ease-in';
    shockwaveTertiary.style.opacity = '0';

    // Nebula clouds continue their animation (CSS handles fade)
    // Just ensure they're visible
    nebulaClouds.forEach(cloud => {
        cloud.style.opacity = '1';
    });

    // Ejecta fade
    ejecta.forEach(el => {
        el.style.transition = 'all 3s ease-in';
        el.style.opacity = '0';
    });
}

// ============================================================================
// BLACK HOLE
// ============================================================================

function createBlackHoleElements(x: number, y: number): BlackHoleElements {
    const container = createEventContainer();

    const bhContainer = document.createElement('div');
    bhContainer.className = 'blackhole-container';
    bhContainer.style.cssText = `
        position: absolute;
        left: ${x}%;
        top: ${y}%;
        width: 0;
        height: 0;
        will-change: transform, opacity;
    `;
    container.appendChild(bhContainer);

    // Event horizon - pure black center
    const eventHorizon = document.createElement('div');
    eventHorizon.className = 'blackhole-horizon';
    eventHorizon.style.cssText = `
        position: absolute;
        left: 0;
        top: 0;
        width: 80px;
        height: 80px;
        border-radius: 50%;
        background: radial-gradient(circle,
            var(--blackhole-void) 0%,
            var(--blackhole-void) 85%,
            var(--blackhole-horizon-glow) 100%
        );
        transform: translate(-50%, -50%) scale(0);
        opacity: 0;
        box-shadow: inset 0 0 30px 10px rgba(0, 0, 0, 1);
        will-change: transform, opacity;
        z-index: 10;
    `;
    bhContainer.appendChild(eventHorizon);

    // Photon ring - thin bright glow at edge
    const photonRing = document.createElement('div');
    photonRing.className = 'blackhole-photon-ring';
    photonRing.style.cssText = `
        position: absolute;
        left: 0;
        top: 0;
        width: 88px;
        height: 88px;
        border-radius: 50%;
        background: transparent;
        border: 1px solid var(--blackhole-photon-ring);
        transform: translate(-50%, -50%) scale(0);
        opacity: 0;
        box-shadow:
            0 0 8px 2px rgba(255, 180, 100, 0.8),
            0 0 20px 5px rgba(255, 150, 50, 0.4),
            inset 0 0 8px 2px rgba(255, 200, 150, 0.3);
        will-change: transform, opacity;
        z-index: 9;
    `;
    bhContainer.appendChild(photonRing);

    // Accretion disk - horizontal ellipse with Doppler gradient
    const accretionDisk = document.createElement('div');
    accretionDisk.className = 'blackhole-disk';
    accretionDisk.style.cssText = `
        position: absolute;
        left: 0;
        top: 0;
        width: 200px;
        height: 24px;
        border-radius: 50%;
        background: linear-gradient(90deg,
            rgba(255, 100, 50, 0.2) 0%,
            var(--blackhole-disk-cool) 15%,
            var(--blackhole-disk-warm) 35%,
            var(--blackhole-disk-hot) 48%,
            #fff 50%,
            var(--blackhole-disk-hot) 52%,
            var(--blackhole-disk-warm) 70%,
            var(--blackhole-disk-cool) 90%,
            rgba(255, 100, 50, 0.2) 100%
        );
        transform: translate(-50%, -50%) rotateX(75deg) scale(0);
        opacity: 0;
        box-shadow:
            0 0 30px 10px rgba(255, 150, 50, 0.6),
            0 0 60px 20px rgba(255, 100, 50, 0.3);
        will-change: transform, opacity;
        z-index: 5;
    `;
    bhContainer.appendChild(accretionDisk);

    // Gravitationally lensed ring - TOP (light bent over the black hole)
    const lensedRingTop = document.createElement('div');
    lensedRingTop.className = 'blackhole-lensed-top';
    lensedRingTop.style.cssText = `
        position: absolute;
        left: 0;
        top: 0;
        width: 130px;
        height: 65px;
        border-radius: 50%;
        background: transparent;
        border: 3px solid transparent;
        border-bottom-color: var(--blackhole-lensing);
        transform: translate(-50%, -80%) rotateX(55deg) scale(0);
        opacity: 0;
        box-shadow: 0 4px 20px rgba(255, 150, 50, 0.5);
        will-change: transform, opacity;
        z-index: 8;
    `;
    bhContainer.appendChild(lensedRingTop);

    // Gravitationally lensed ring - BOTTOM (light bent under the black hole)
    const lensedRingBottom = document.createElement('div');
    lensedRingBottom.className = 'blackhole-lensed-bottom';
    lensedRingBottom.style.cssText = `
        position: absolute;
        left: 0;
        top: 0;
        width: 130px;
        height: 65px;
        border-radius: 50%;
        background: transparent;
        border: 3px solid transparent;
        border-top-color: rgba(255, 180, 120, 0.6);
        transform: translate(-50%, 30%) rotateX(-55deg) scale(0);
        opacity: 0;
        box-shadow: 0 -4px 20px rgba(255, 150, 50, 0.4);
        will-change: transform, opacity;
        z-index: 8;
    `;
    bhContainer.appendChild(lensedRingBottom);

    return {
        container: bhContainer,
        eventHorizon,
        photonRing,
        accretionDisk,
        lensedRingTop,
        lensedRingBottom
    };
}

function animateBlackHoleFormation(elements: BlackHoleElements): void {
    const { eventHorizon, photonRing, accretionDisk, lensedRingTop, lensedRingBottom } = elements;

    // Event horizon appears first
    setTimeout(() => {
        eventHorizon.style.transition = 'all 2s cubic-bezier(0.4, 0, 0.2, 1)';
        eventHorizon.style.opacity = '1';
        eventHorizon.style.transform = 'translate(-50%, -50%) scale(1)';
    }, 1000);

    // Photon ring materializes
    setTimeout(() => {
        photonRing.style.transition = 'all 1.5s ease-out';
        photonRing.style.opacity = '1';
        photonRing.style.transform = 'translate(-50%, -50%) scale(1)';
    }, 2500);

    // Accretion disk fades in and starts rotating
    setTimeout(() => {
        accretionDisk.style.transition = 'opacity 2s ease-out, transform 0s';
        accretionDisk.style.opacity = '1';
        accretionDisk.style.transform = 'translate(-50%, -50%) rotateX(75deg) scale(1)';

        // Start rotation after a brief pause
        setTimeout(() => {
            accretionDisk.style.transition = 'none';
            accretionDisk.classList.add('rotating');
        }, 100);
    }, 4000);

    // Lensed rings appear (the distinctive Interstellar halo effect)
    setTimeout(() => {
        lensedRingTop.style.transition = 'all 2s ease-out';
        lensedRingTop.style.opacity = '1';
        lensedRingTop.style.transform = 'translate(-50%, -80%) rotateX(55deg) scale(1)';

        lensedRingBottom.style.transition = 'all 2s ease-out';
        lensedRingBottom.style.opacity = '1';
        lensedRingBottom.style.transform = 'translate(-50%, 30%) rotateX(-55deg) scale(1)';
    }, 6000);
}

function animateBlackHoleFadeout(elements: BlackHoleElements): void {
    const { eventHorizon, photonRing, accretionDisk, lensedRingTop, lensedRingBottom, container } = elements;

    // Stop rotation
    accretionDisk.classList.remove('rotating');

    // Fade all elements
    const fadeTransition = 'all 6s ease-in';

    eventHorizon.style.transition = fadeTransition;
    eventHorizon.style.opacity = '0';
    eventHorizon.style.transform = 'translate(-50%, -50%) scale(0.5)';

    photonRing.style.transition = fadeTransition;
    photonRing.style.opacity = '0';

    accretionDisk.style.transition = fadeTransition;
    accretionDisk.style.opacity = '0';

    lensedRingTop.style.transition = fadeTransition;
    lensedRingTop.style.opacity = '0';

    lensedRingBottom.style.transition = fadeTransition;
    lensedRingBottom.style.opacity = '0';

    // Remove container after fade
    setTimeout(() => {
        container.remove();
    }, 7000);
}

// ============================================================================
// GRAVITATIONAL EFFECTS ON STARS
// ============================================================================

function getAffectedStars(_bhX: number, _bhY: number): StarGravityState[] {
    // Star gravity now lives in the starfield canvas as a field effect;
    // there are no per-star elements to collect.
    return [];
}

function applyGravitationalEffects(
    bhX: number,
    bhY: number,
    _affectedStars: StarGravityState[],
    intensity: number = 1
): void {
    setStarfieldGravity({
        x: bhX,
        y: bhY,
        intensity,
        onConsume: (pan) => playStarConsumptionSound(pan),
    });
}

function restoreStars(_affectedStars: StarGravityState[]): void {
    // Release the field; the canvas eases every star home.
    setStarfieldGravity(null);
}

// ============================================================================
// TEXT WARPING (Desktop only)
// ============================================================================

// Element centers are measured once per event (and on scroll), never per
// frame — and the warp itself is transform+filter only, so no layout ever
// happens inside the animation loop.
const textWarpCenters = new Map<HTMLElement, { x: number; y: number }>();

function measureTextCenters(elements: HTMLElement[]): void {
    for (const el of elements) {
        const rect = el.getBoundingClientRect();
        textWarpCenters.set(el, {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
        });
    }
}

function getAffectedTextElements(bhScreenX: number, bhScreenY: number): HTMLElement[] {
    if (isMobile) return []; // Skip on mobile for performance

    const elements: HTMLElement[] = [];
    document.querySelectorAll('p, h2, h3, h4, blockquote, .lead').forEach(el => {
        const rect = el.getBoundingClientRect();
        const elCenterX = rect.left + rect.width / 2;
        const elCenterY = rect.top + rect.height / 2;
        const dist = Math.sqrt(
            Math.pow(bhScreenX - elCenterX, 2) +
            Math.pow(bhScreenY - elCenterY, 2)
        );

        if (dist < TEXT_WARP_RADIUS) {
            const h = el as HTMLElement;
            h.classList.add('warping');
            textWarpCenters.set(h, { x: elCenterX, y: elCenterY });
            elements.push(h);
        }
    });
    return elements;
}

function applyTextWarping(
    bhScreenX: number,
    bhScreenY: number,
    elements: HTMLElement[],
    intensity: number = 1
): void {
    for (const el of elements) {
        const c = textWarpCenters.get(el);
        if (!c) continue;
        const dist = Math.sqrt(
            Math.pow(bhScreenX - c.x, 2) +
            Math.pow(bhScreenY - c.y, 2)
        );

        if (dist < TEXT_WARP_RADIUS) {
            const warpIntensity = (1 - dist / TEXT_WARP_RADIUS) * intensity;
            // Lensing without layout: a breath of scale toward the singularity
            // and a haze of blur — compositor and paint only.
            el.style.transform = `scale(${1 + 0.012 * warpIntensity})`;
            el.style.filter = `blur(${0.3 * warpIntensity}px)`;
        }
    }
}

function restoreTextElements(elements: HTMLElement[]): void {
    elements.forEach(el => {
        el.classList.remove('warping');
        el.style.transform = '';
        el.style.filter = '';
    });
    textWarpCenters.clear();
}

// ============================================================================
// MAIN ANIMATION LOOP
// ============================================================================

function startGravityLoop(event: ActiveCosmicEvent): void {
    const throttleMs = isMobile ? 50 : 32; // 20fps mobile, ~30fps desktop
    let lastUpdate = 0;

    // Get screen position of black hole
    const bhScreenX = (event.x / 100) * window.innerWidth;
    const bhScreenY = (event.y / 100) * window.innerHeight;

    // Get affected text elements
    event.affectedTextElements = getAffectedTextElements(bhScreenX, bhScreenY);

    // Text centers move when the reader scrolls; remeasure then, never per frame.
    let scrollPending = false;
    const onWarpScroll = () => {
        if (scrollPending) return;
        scrollPending = true;
        requestAnimationFrame(() => {
            scrollPending = false;
            measureTextCenters(event.affectedTextElements);
        });
    };
    window.addEventListener('scroll', onWarpScroll, { passive: true });
    event.warpScrollHandler = onWarpScroll;

    function animate(timestamp: number): void {
        if (!activeEvent || activeEvent.state === 'cleanup') return;

        if (timestamp - lastUpdate >= throttleMs) {
            lastUpdate = timestamp;

            // Calculate intensity based on state
            let intensity = 1;
            if (activeEvent.state === 'black_hole_formation') {
                const formationProgress = (Date.now() - activeEvent.startTime - BLACK_HOLE_PHASES.formation.start) / BLACK_HOLE_PHASES.formation.duration;
                intensity = Math.min(1, formationProgress);
            } else if (activeEvent.state === 'black_hole_fadeout') {
                const fadeProgress = (Date.now() - activeEvent.startTime - BLACK_HOLE_PHASES.fadeout.start) / BLACK_HOLE_PHASES.fadeout.duration;
                intensity = Math.max(0, 1 - fadeProgress);
            }

            applyGravitationalEffects(event.x, event.y, event.affectedStars, intensity);
            applyTextWarping(bhScreenX, bhScreenY, event.affectedTextElements, intensity);
        }

        event.gravityAnimationId = requestAnimationFrame(animate);
    }

    event.gravityAnimationId = requestAnimationFrame(animate);
}

function stopGravityLoop(event: ActiveCosmicEvent): void {
    if (event.gravityAnimationId) {
        cancelAnimationFrame(event.gravityAnimationId);
        event.gravityAnimationId = null;
    }
    if (event.warpScrollHandler) {
        window.removeEventListener('scroll', event.warpScrollHandler);
        event.warpScrollHandler = null;
    }

    restoreStars(event.affectedStars);
    restoreTextElements(event.affectedTextElements);
}

// ============================================================================
// STATE MACHINE
// ============================================================================

function updateEventState(): void {
    if (!activeEvent) return;

    const elapsed = Date.now() - activeEvent.startTime;

    switch (activeEvent.state) {
        case 'progenitor_instability':
            if (elapsed >= SUPERNOVA_PHASES.collapse.start) {
                activeEvent.state = 'core_collapse';
                if (activeEvent.supernovaElements) {
                    animateCoreCollapsePhase(activeEvent.supernovaElements);
                }
            }
            break;

        case 'core_collapse':
            if (elapsed >= SUPERNOVA_PHASES.shockwave.start) {
                activeEvent.state = 'shockwave_expansion';
                if (activeEvent.supernovaElements) {
                    animateShockwavePhase(activeEvent.supernovaElements);
                }
            }
            break;

        case 'shockwave_expansion':
            if (elapsed >= SUPERNOVA_PHASES.peak.start) {
                activeEvent.state = 'peak_emission';
                if (activeEvent.supernovaElements) {
                    animatePeakPhase(activeEvent.supernovaElements);
                }
            }
            break;

        case 'peak_emission':
            if (elapsed >= SUPERNOVA_PHASES.remnant.start) {
                activeEvent.state = 'remnant_formation';
                if (activeEvent.supernovaElements) {
                    animateRemnantPhase(activeEvent.supernovaElements, activeEvent.willBecomeBlackHole);
                }
            }
            break;

        case 'remnant_formation':
            if (elapsed >= BLACK_HOLE_PHASES.formation.start) {
                if (activeEvent.willBecomeBlackHole) {
                    activeEvent.state = 'black_hole_formation';

                    // Create black hole elements
                    activeEvent.blackHoleElements = createBlackHoleElements(activeEvent.x, activeEvent.y);
                    animateBlackHoleFormation(activeEvent.blackHoleElements);

                    // Start audio
                    activeEvent.blackHoleAudio = startBlackHoleAudio();

                    // Get affected stars and start gravity loop
                    activeEvent.affectedStars = getAffectedStars(activeEvent.x, activeEvent.y);
                    startGravityLoop(activeEvent);

                    // Clean up supernova elements
                    if (activeEvent.supernovaElements) {
                        const elementsToRemove = activeEvent.supernovaElements;
                        setTimeout(() => {
                            elementsToRemove.container.remove();
                        }, 2000);
                    }
                } else {
                    // Normal supernova cleanup
                    activeEvent.state = 'cleanup';
                    cleanupEvent();
                }
            }
            break;

        case 'black_hole_formation':
            if (elapsed >= BLACK_HOLE_PHASES.active.start) {
                activeEvent.state = 'black_hole_active';
            }
            break;

        case 'black_hole_active':
            if (elapsed >= BLACK_HOLE_PHASES.fadeout.start) {
                activeEvent.state = 'black_hole_fadeout';

                if (activeEvent.blackHoleElements) {
                    animateBlackHoleFadeout(activeEvent.blackHoleElements);
                }
                if (activeEvent.blackHoleAudio) {
                    fadeBlackHoleAudio(activeEvent.blackHoleAudio, 6000);
                }
            }
            break;

        case 'black_hole_fadeout':
            if (elapsed >= BLACK_HOLE_PHASES.fadeout.start + BLACK_HOLE_PHASES.fadeout.duration) {
                activeEvent.state = 'cleanup';
                cleanupEvent();
            }
            break;
    }
}

function cleanupEvent(): void {
    if (!activeEvent) return;

    stopGravityLoop(activeEvent);

    if (activeEvent.supernovaElements) {
        activeEvent.supernovaElements.container.remove();
        if (activeEvent.supernovaElements.flash) {
            activeEvent.supernovaElements.flash.remove();
        }
    }

    if (activeEvent.blackHoleElements) {
        activeEvent.blackHoleElements.container.remove();
    }

    activeEvent = null;
}

// ============================================================================
// ENHANCED SUPERNOVA ENTRY POINT
// ============================================================================

function createEnhancedSupernova(): void {
    // Clean up any existing event
    if (activeEvent) {
        cleanupEvent();
    }

    const x = 15 + Math.random() * 70;
    const y = 15 + Math.random() * 50;
    const willBecomeBlackHole = Math.random() < BLACK_HOLE_PROBABILITY;

    // Create supernova elements
    const supernovaElements = createSupernovaElements(x, y);

    // Initialize active event
    activeEvent = {
        state: 'progenitor_instability',
        supernovaElements,
        blackHoleElements: null,
        blackHoleAudio: null,
        gravityAnimationId: null,
        affectedStars: [],
        affectedTextElements: [],
        startTime: Date.now(),
        x,
        y,
        willBecomeBlackHole
    };

    // Start progenitor animation
    animateProgenitorPhase(supernovaElements);

    // Start state machine
    const stateInterval = setInterval(() => {
        if (!activeEvent || activeEvent.state === 'cleanup') {
            clearInterval(stateInterval);
            return;
        }
        updateEventState();
    }, 100);
}

// Keep original createSupernova as alias for compatibility
function createSupernova(): void {
    createEnhancedSupernova();
}

// ============================================================================
// ARTISTIC SUPERNOVA - New visual approach
// ============================================================================

interface ArtisticSupernovaElements {
    container: HTMLElement;
    progenitor: HTMLElement;
    tensionFlicker: HTMLElement;
    coreV3: HTMLElement;
    collapseRings: HTMLElement[];
    diffractionSpikes: HTMLElement[];
    chromaticRing: HTMLElement;
    // V3 elements
    lightRays: HTMLElement;
    lensFlares: HTMLElement[];
    screenFlash: HTMLElement;
    flashOverlay: HTMLElement;
    shockwaveRings: HTMLElement[];  // 4 colored rings with wobble
    // Legacy elements kept for compatibility
    detonationFlash: HTMLElement;
    organicShockwave: HTMLElement;
    lightEchoes: HTMLElement[];
    // Remnant elements
    neutronStar: HTMLElement;
    pulsarBeams: HTMLElement[];
    nebulaClouds: HTMLElement[];
}

interface ArtisticSupernovaEvent {
    state: 'progenitor' | 'collapse' | 'detonation' | 'shockwave' | 'remnant' | 'echoes' | 'cleanup';
    elements: ArtisticSupernovaElements;
    x: number;
    y: number;
    startTime: number;
    willBecomeBlackHole: boolean;
    shockwaveRadius: number;
    shockwaveAnimationId: number | null;
}

let artisticEvent: ArtisticSupernovaEvent | null = null;

// Timing for artistic supernova phases (ms) - V3 design with 10s progenitor growth
const ARTISTIC_PHASES = {
    progenitor: { start: 0, duration: 10000 },     // V3: 10 second growth/collapse
    collapse: { start: 9200, duration: 800 },      // Start just before progenitor ends
    detonation: { start: 10000, duration: 150 },   // Explosion at 10s
    shockwave: { start: 10000, duration: 9000 },   // V3: Longer shockwave (matches 9s teal ring)
    peak: { start: 13000, duration: 2500 },
    remnant: { start: 16000, duration: 6000 },
    echoes: { start: 16000, duration: 6000 }
};

function createArtisticSupernovaElements(x: number, y: number): ArtisticSupernovaElements {
    const container = createEventContainer();

    // Main container for this supernova
    const supernovaContainer = document.createElement('div');
    supernovaContainer.className = 'supernova-container artistic-supernova';
    supernovaContainer.style.cssText = `
        position: absolute;
        left: ${x}%;
        top: ${y}%;
        width: 0;
        height: 0;
    `;
    container.appendChild(supernovaContainer);

    // Progenitor star with arrhythmic heartbeat
    const progenitor = document.createElement('div');
    progenitor.className = 'supernova-progenitor';
    supernovaContainer.appendChild(progenitor);

    // V3: Tension flicker (builds before explosion)
    const tensionFlicker = document.createElement('div');
    tensionFlicker.className = 'tension-flicker';
    supernovaContainer.appendChild(tensionFlicker);

    // V3: Core explosion element
    const coreV3 = document.createElement('div');
    coreV3.className = 'supernova-core-v3';
    supernovaContainer.appendChild(coreV3);

    // V3: Light rays (conic gradient with subtle segments)
    const lightRays = document.createElement('div');
    lightRays.className = 'light-rays';
    supernovaContainer.appendChild(lightRays);

    // V3: Flash overlay (radial gradient centered on explosion)
    const flashOverlay = document.createElement('div');
    flashOverlay.className = 'flash-overlay';
    supernovaContainer.appendChild(flashOverlay);

    // V3: Lens flares (multiple types scattered around explosion)
    const lensFlares: HTMLElement[] = [];
    const flareConfigs = [
        { type: 'flare-blue', offsetX: 3, offsetY: -3 },
        { type: 'flare-warm', offsetX: 7, offsetY: -7 },
        { type: 'flare-cyan', offsetX: 12, offsetY: -12 },
        { type: 'flare-pink', offsetX: -6, offsetY: 6 },
        { type: 'flare-green', offsetX: -12, offsetY: 12 },
        { type: 'flare-purple', offsetX: 15, offsetY: -15 },
        { type: 'flare-hex', offsetX: 18, offsetY: -18 },
        { type: 'flare-anamorphic', offsetX: -20, offsetY: -1 }
    ];

    flareConfigs.forEach(config => {
        const flare = document.createElement('div');
        flare.className = `lens-flare ${config.type}`;
        flare.style.top = `calc(50% + ${config.offsetY}%)`;
        flare.style.left = `calc(50% + ${config.offsetX}%)`;
        if (config.type !== 'flare-anamorphic') {
            flare.style.transform = 'translate(-50%, -50%)';
        }
        supernovaContainer.appendChild(flare);
        lensFlares.push(flare);
    });

    // V3: Screen flash (full screen white at detonation)
    const screenFlash = document.createElement('div');
    screenFlash.className = 'screen-flash';
    document.body.appendChild(screenFlash);

    // V3: 4 colored shockwave rings with wobble
    const shockwaveRings: HTMLElement[] = [];
    const shockwaveColors = ['shockwave-blue', 'shockwave-orange', 'shockwave-purple', 'shockwave-teal'];
    const shockwaveDurations = [6, 7, 8, 9];  // Different speeds for visual layering

    shockwaveColors.forEach((color, i) => {
        const ring = document.createElement('div');
        ring.className = `shockwave-ring ${color}`;
        ring.style.setProperty('--shockwave-duration', `${shockwaveDurations[i]}s`);
        supernovaContainer.appendChild(ring);
        shockwaveRings.push(ring);
    });

    // Collapse rings (3 inward-rushing rings)
    const collapseRings: HTMLElement[] = [];
    for (let i = 0; i < 3; i++) {
        const ring = document.createElement('div');
        ring.className = 'collapse-ring';
        ring.style.animationDelay = `${i * 150}ms`;
        ring.style.opacity = '0';
        supernovaContainer.appendChild(ring);
        collapseRings.push(ring);
    }

    // Diffraction spikes (6 total: 4 primary at 90°, 2 secondary at 45°)
    const diffractionSpikes: HTMLElement[] = [];
    const spikeAngles = [0, 90, 180, 270];  // Primary spikes
    const secondaryAngles = [45, 135];       // Secondary spikes

    spikeAngles.forEach(angle => {
        const spike = document.createElement('div');
        spike.className = 'diffraction-spike';
        spike.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
        supernovaContainer.appendChild(spike);
        diffractionSpikes.push(spike);
    });

    secondaryAngles.forEach(angle => {
        const spike = document.createElement('div');
        spike.className = 'diffraction-spike secondary';
        spike.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
        supernovaContainer.appendChild(spike);
        diffractionSpikes.push(spike);
    });

    // Chromatic ring
    const chromaticRing = document.createElement('div');
    chromaticRing.className = 'chromatic-ring';
    supernovaContainer.appendChild(chromaticRing);

    // Detonation flash (screen-wide)
    const detonationFlash = document.createElement('div');
    detonationFlash.className = 'detonation-flash';
    detonationFlash.style.setProperty('--flash-x', `${x}%`);
    detonationFlash.style.setProperty('--flash-y', `${y}%`);
    document.body.appendChild(detonationFlash);

    // Organic shockwave
    const organicShockwave = document.createElement('div');
    organicShockwave.className = 'organic-shockwave';
    supernovaContainer.appendChild(organicShockwave);

    // Light echoes (3 staggered rings)
    const lightEchoes: HTMLElement[] = [];
    for (let i = 1; i <= 3; i++) {
        const echo = document.createElement('div');
        echo.className = `light-echo echo-${i}`;
        supernovaContainer.appendChild(echo);
        lightEchoes.push(echo);
    }

    // Neutron star (for non-black-hole remnant)
    const neutronStar = document.createElement('div');
    neutronStar.className = 'neutron-star';
    supernovaContainer.appendChild(neutronStar);

    // Pulsar beams (two opposing jets)
    const pulsarBeams: HTMLElement[] = [];
    const beam1 = document.createElement('div');
    beam1.className = 'pulsar-beam';
    supernovaContainer.appendChild(beam1);
    pulsarBeams.push(beam1);

    const beam2 = document.createElement('div');
    beam2.className = 'pulsar-beam opposite';
    supernovaContainer.appendChild(beam2);
    pulsarBeams.push(beam2);

    // Nebula clouds with scientific colors
    const nebulaClouds: HTMLElement[] = [];
    const nebulaTypes = ['hydrogen', 'oxygen', 'sulfur', 'nitrogen', 'hydrogen', 'oxygen'];

    nebulaTypes.forEach((type, i) => {
        const cloud = document.createElement('div');
        cloud.className = `nebula-cloud ${type}`;

        // Randomize size, position, and animation
        const size = 80 + Math.random() * 120;
        const angle = (i / nebulaTypes.length) * Math.PI * 2 + Math.random() * 0.5;
        const distance = 60 + Math.random() * 100;
        const driftX = Math.cos(angle) * distance;
        const driftY = Math.sin(angle) * distance;
        const rotation = -20 + Math.random() * 40;
        const scale = 1.5 + Math.random() * 1.5;
        const duration = 12 + Math.random() * 8;
        const opacity = 0.4 + Math.random() * 0.3;

        cloud.style.width = `${size}px`;
        cloud.style.height = `${size * (0.8 + Math.random() * 0.4)}px`;
        cloud.style.setProperty('--nebula-drift-x', `${driftX}px`);
        cloud.style.setProperty('--nebula-drift-y', `${driftY}px`);
        cloud.style.setProperty('--nebula-rotate', `${rotation}deg`);
        cloud.style.setProperty('--nebula-scale', String(scale));
        cloud.style.setProperty('--nebula-duration', `${duration}s`);
        cloud.style.setProperty('--nebula-opacity', String(opacity));

        supernovaContainer.appendChild(cloud);
        nebulaClouds.push(cloud);
    });

    return {
        container: supernovaContainer,
        progenitor,
        tensionFlicker,
        coreV3,
        collapseRings,
        diffractionSpikes,
        chromaticRing,
        // V3 elements
        lightRays,
        lensFlares,
        screenFlash,
        flashOverlay,
        shockwaveRings,
        // Legacy elements
        detonationFlash,
        organicShockwave,
        lightEchoes,
        // Remnant elements
        neutronStar,
        pulsarBeams,
        nebulaClouds
    };
}

// Dim nearby stars during pre-ignition (light being drawn in).
// The starfield canvas applies the field; no DOM is touched.
function dimNearbyStars(centerX: number, centerY: number, intensity: number): void {
    setStarfieldDim(centerX, centerY, 15, intensity);
}

// Restore dimmed stars
function restoreDimmedStars(): void {
    setStarfieldDim(0, 0, 0, 0);
}

// Brighten stars as shockwave passes — a ring field on the canvas.
function brightenStarsInShockwave(
    centerX: number,
    centerY: number,
    radius: number,
    thickness: number
): void {
    setStarfieldShockwave(centerX, centerY, radius, thickness);
}

function animateArtisticProgenitor(elements: ArtisticSupernovaElements, x: number, y: number): void {
    const { progenitor, tensionFlicker } = elements;

    // V3: Use growing animation (grows then collapses at the end)
    progenitor.classList.add('growing');

    // V3: Start tension flicker building
    tensionFlicker.classList.add('building');

    // Play progenitor sound
    playProgenitorSound();

    // Dim nearby stars gradually
    let dimIntensity = 0;
    const dimInterval = setInterval(() => {
        dimIntensity = Math.min(1, dimIntensity + 0.1);
        dimNearbyStars(x, y, dimIntensity);
    }, 200);

    // Clear interval when phase ends
    setTimeout(() => {
        clearInterval(dimInterval);
    }, ARTISTIC_PHASES.progenitor.duration);
}

function animateArtisticCollapse(elements: ArtisticSupernovaElements): void {
    const { collapseRings } = elements;

    // V3: The progenitor handles its own collapse via progenitor-grow animation
    // We just trigger the collapse rings for additional visual effect

    // Play collapse sound
    playCoreCollapseSound();

    // Trigger inward-rushing rings
    collapseRings.forEach((ring, i) => {
        setTimeout(() => {
            ring.style.opacity = '1';
            ring.style.animation = 'collapse-inward 0.6s ease-in forwards';
        }, i * 150);
    });
}

function animateArtisticDetonation(elements: ArtisticSupernovaElements): void {
    const {
        coreV3,
        diffractionSpikes,
        chromaticRing,
        lightRays,
        lensFlares,
        screenFlash,
        flashOverlay
    } = elements;

    // V3: Trigger core explosion animation
    coreV3.classList.add('exploding');

    // V3: Trigger screen-wide flash
    screenFlash.classList.add('active');
    setTimeout(() => {
        screenFlash.classList.remove('active');
    }, 2000);

    // V3: Trigger flash overlay
    flashOverlay.classList.add('visible');

    // V3: Trigger light rays
    lightRays.classList.add('visible');

    // V3: Trigger lens flares with slight stagger
    lensFlares.forEach((flare, i) => {
        setTimeout(() => {
            flare.classList.add('visible');
        }, 100 + i * 50);
    });

    // Trigger diffraction spikes (kept from original)
    diffractionSpikes.forEach((spike, i) => {
        setTimeout(() => {
            spike.classList.add('visible');
        }, i * 20);
    });

    // Trigger chromatic ring
    setTimeout(() => {
        chromaticRing.classList.add('visible');
    }, 50);
}

function animateArtisticShockwave(event: ArtisticSupernovaEvent): void {
    const { elements, x, y } = event;
    const { shockwaveRings } = elements;

    // V3: Trigger 4 colored shockwave rings with staggered timing
    const shockwaveDelays = [0, 150, 300, 500];
    shockwaveRings.forEach((ring, i) => {
        setTimeout(() => {
            ring.classList.add('expanding');
        }, shockwaveDelays[i]);
    });

    // Play expansion sound
    playExpansionSound();

    // Start shockwave tracking for star brightening (use first ring timing)
    event.shockwaveRadius = 0;
    const startTime = Date.now();
    const shockwaveDuration = 6000;  // Match first ring duration
    const maxRadius = 60; // % of viewport

    const trackShockwave = () => {
        if (!artisticEvent || artisticEvent.state === 'cleanup') return;

        const elapsed = Date.now() - startTime;
        const progress = Math.min(1, elapsed / shockwaveDuration);

        // Ease-out curve for radius
        const easedProgress = 1 - Math.pow(1 - progress, 2);
        event.shockwaveRadius = easedProgress * maxRadius;

        // Brighten stars in the current shockwave ring
        brightenStarsInShockwave(x, y, event.shockwaveRadius, 5);

        if (progress < 1) {
            event.shockwaveAnimationId = requestAnimationFrame(trackShockwave);
        }
    };

    event.shockwaveAnimationId = requestAnimationFrame(trackShockwave);
}

function animateArtisticRemnant(elements: ArtisticSupernovaElements, willBecomeBlackHole: boolean): void {
    const { progenitor, neutronStar, pulsarBeams, nebulaClouds } = elements;

    if (willBecomeBlackHole) {
        // Rapid collapse to black hole
        progenitor.style.transition = 'all 2s ease-in';
        progenitor.style.transform = 'translate(-50%, -50%) scale(0.5)';
        progenitor.style.background = `radial-gradient(
            circle,
            rgba(80, 60, 40, 0.8) 0%,
            rgba(40, 30, 20, 0.4) 50%,
            transparent 100%
        )`;
        progenitor.style.filter = 'brightness(0.5)';

        // Create "gasp" flash before darkness
        setTimeout(() => {
            const gasp = document.createElement('div');
            gasp.className = 'blackhole-gasp';
            elements.container.appendChild(gasp);
            setTimeout(() => gasp.classList.add('active'), 10);
            setTimeout(() => gasp.remove(), 900);
        }, 1500);
    } else {
        // Normal remnant - progenitor fades as nebula forms
        progenitor.style.transition = 'all 3s ease-in';
        progenitor.style.transform = 'translate(-50%, -50%) scale(8)';
        progenitor.style.opacity = '0';

        // Trigger nebula clouds with staggered timing
        nebulaClouds.forEach((cloud, i) => {
            setTimeout(() => {
                cloud.classList.add('visible');
            }, i * 300);
        });

        // Show neutron star emerging from the collapse
        setTimeout(() => {
            neutronStar.classList.add('visible');

            // Start pulsar beams after neutron star appears
            setTimeout(() => {
                pulsarBeams.forEach(beam => {
                    beam.classList.add('visible');
                });

                // Start spinning after beams extend
                setTimeout(() => {
                    neutronStar.classList.add('pulsing');
                    pulsarBeams.forEach(beam => {
                        beam.classList.remove('visible');
                        beam.classList.add('spinning');
                    });
                }, 2000);
            }, 1500);
        }, 2000);

        // Play remnant sound
        playRemnantSound();
    }

    // Restore stars
    restoreDimmedStars();
}

function triggerLightEchoes(elements: ArtisticSupernovaElements): void {
    const { lightEchoes } = elements;

    // Stagger the light echoes
    lightEchoes.forEach((echo, i) => {
        setTimeout(() => {
            echo.classList.add('visible');
        }, i * 800);
    });
}

function createArtisticSupernova(): void {
    // Clean up any existing event
    if (artisticEvent) {
        cleanupArtisticEvent();
    }

    const x = 15 + Math.random() * 70;
    const y = 15 + Math.random() * 50;
    const willBecomeBlackHole = Math.random() < BLACK_HOLE_PROBABILITY;

    const elements = createArtisticSupernovaElements(x, y);

    const eventStartTime = Date.now();

    artisticEvent = {
        state: 'progenitor',
        elements,
        x,
        y,
        startTime: eventStartTime,
        willBecomeBlackHole,
        shockwaveRadius: 0,
        shockwaveAnimationId: null
    };

    // Helper to check if this event is still active
    const isEventStillActive = () => artisticEvent && artisticEvent.startTime === eventStartTime;

    // Start progenitor phase
    animateArtisticProgenitor(elements, x, y);

    // Schedule phase transitions
    setTimeout(() => {
        if (!isEventStillActive()) return;
        artisticEvent!.state = 'collapse';
        animateArtisticCollapse(elements);
    }, ARTISTIC_PHASES.collapse.start);

    setTimeout(() => {
        if (!isEventStillActive()) return;
        artisticEvent!.state = 'detonation';
        animateArtisticDetonation(elements);
    }, ARTISTIC_PHASES.detonation.start);

    setTimeout(() => {
        if (!isEventStillActive()) return;
        artisticEvent!.state = 'shockwave';
        animateArtisticShockwave(artisticEvent!);
    }, ARTISTIC_PHASES.shockwave.start);

    setTimeout(() => {
        if (!isEventStillActive()) return;
        artisticEvent!.state = 'remnant';
        animateArtisticRemnant(elements, willBecomeBlackHole);
    }, ARTISTIC_PHASES.remnant.start);

    // Trigger light echoes (only if not becoming black hole)
    if (!willBecomeBlackHole) {
        setTimeout(() => {
            if (!isEventStillActive()) return;
            artisticEvent!.state = 'echoes';
            triggerLightEchoes(elements);
        }, ARTISTIC_PHASES.echoes.start);
    }

    // Handle black hole transition or cleanup
    if (willBecomeBlackHole) {
        setTimeout(() => {
            if (!isEventStillActive()) return;

            // Create black hole at same position
            artisticEvent!.state = 'cleanup';
            const bhElements = createBlackHoleElements(x, y);
            animateBlackHoleFormation(bhElements);

            // Transfer to main activeEvent for gravity effects
            if (activeEvent) cleanupEvent();

            activeEvent = {
                state: 'black_hole_formation',
                supernovaElements: null,
                blackHoleElements: bhElements,
                blackHoleAudio: startBlackHoleAudio(),
                gravityAnimationId: null,
                affectedStars: getAffectedStars(x, y),
                affectedTextElements: [],
                startTime: Date.now(),
                x,
                y,
                willBecomeBlackHole: true
            };

            startGravityLoop(activeEvent);

            // Clean up supernova elements
            setTimeout(() => {
                elements.container.remove();
                elements.screenFlash?.remove();
            }, 2000);

            // Schedule black hole fadeout
            setTimeout(() => {
                if (!activeEvent || !activeEvent.blackHoleElements) return;
                activeEvent.state = 'black_hole_fadeout';
                animateBlackHoleFadeout(activeEvent.blackHoleElements);
                if (activeEvent.blackHoleAudio) {
                    fadeBlackHoleAudio(activeEvent.blackHoleAudio, 6000);
                }
            }, 25000);

            setTimeout(() => {
                cleanupEvent();
            }, 33000);

            artisticEvent = null;
        }, ARTISTIC_PHASES.remnant.start + 2000);
    } else {
        // Normal cleanup
        setTimeout(() => {
            if (!isEventStillActive()) return;
            cleanupArtisticEvent();
        }, ARTISTIC_PHASES.echoes.start + 8000);
    }
}

function cleanupArtisticEvent(): void {
    if (!artisticEvent) return;

    // Cancel shockwave animation
    if (artisticEvent.shockwaveAnimationId) {
        cancelAnimationFrame(artisticEvent.shockwaveAnimationId);
    }

    // Restore stars
    restoreDimmedStars();

    // Remove elements
    artisticEvent.elements.container.remove();
    artisticEvent.elements.detonationFlash?.remove();
    artisticEvent.elements.screenFlash?.remove();  // V3 screen flash

    artisticEvent = null;
}

// ============================================================================
// EVENT SELECTION AND INITIALIZATION
// ============================================================================

function selectRandomEvent(): CosmicEvent['type'] {
    const totalWeight = cosmicEvents.reduce((sum, e) => sum + e.weight, 0);
    let random = Math.random() * totalWeight;

    for (const event of cosmicEvents) {
        random -= event.weight;
        if (random <= 0) return event.type;
    }
    return 'pulsar';
}

// Toggle between WebGL, artistic, and enhanced supernova
// Options: 'webgl' | 'artistic' | 'enhanced'
const SUPERNOVA_MODE: 'webgl' | 'artistic' | 'enhanced' = 'webgl';

// Click-to-trigger testing mode
// When true: click anywhere to trigger supernova, alternates between neutron star and black hole
const SUPERNOVA_CLICK_TRIGGER = true;
const TAPS_REQUIRED = 3;  // Number of taps required to trigger cosmic event
const TAP_TIMEOUT = 2000;  // Reset tap count after 2 seconds of inactivity
let clickTriggerNextFate = 0;  // 0 = neutron star, 1 = black hole (alternates)
let clickTriggerRunning = false;
let lastCosmicEventTime = 0;  // Timestamp of last cosmic event completion
const COSMIC_EVENT_COOLDOWN = 72000;  // 1.2 minutes minimum between events
let tapCount = 0;
let tapTimer: number | null = null;
let tapIndicator: HTMLElement | null = null;

// ============================================================================
// WEBGL SUPERNOVA
// ============================================================================

// Optional forceFate parameter: 0 = neutron star, 1 = black hole, undefined = random
function createWebGLSupernovaEvent(forceFate?: number, onCompleteCallback?: () => void): void {
    // Clean up any existing WebGL renderer
    if (webglRenderer) {
        webglRenderer.destroy();
        webglRenderer = null;
    }

    // Clean up any existing DOM-based events
    if (artisticEvent) {
        cleanupArtisticEvent();
    }
    if (activeEvent) {
        cleanupEvent();
    }

    // Determine fate: use forced value or 35% chance of black hole
    const fate = forceFate !== undefined
        ? forceFate
        : (Math.random() < BLACK_HOLE_PROBABILITY ? 1 : 0);

    console.log(`[Supernova] Starting ${fate === 0 ? 'Neutron Star' : 'Black Hole'} event`);

    // Create WebGL renderer
    webglRenderer = createWebGLSupernova({
        fate,
        onPhaseChange: handleWebGLPhaseChange,
        onComplete: () => {
            console.log(`[Supernova] Event complete`);
            if (webglRenderer) {
                webglRenderer.destroy();
                webglRenderer = null;
            }
            stopWebGLProgenitorAudio();
            // Call the optional completion callback
            onCompleteCallback?.();
        }
    });

    if (webglRenderer) {
        // Start the renderer
        webglRenderer.start();

        // Start progenitor audio
        startWebGLProgenitorAudio();
    }
}

function triggerRandomEvent(): void {
    // Respect cooldown period after any cosmic event
    const timeSinceLastEvent = Date.now() - lastCosmicEventTime;
    if (timeSinceLastEvent < COSMIC_EVENT_COOLDOWN) {
        console.log(`[Cosmic] Skipping random event - cooldown (${Math.round((COSMIC_EVENT_COOLDOWN - timeSinceLastEvent) / 1000)}s remaining)`);
        return;
    }

    // Don't trigger if a manual event is running
    if (clickTriggerRunning) {
        return;
    }

    const eventType = selectRandomEvent();

    switch (eventType) {
        case 'pulsar':
            createPulsar();
            break;
        case 'supernova':
            switch (SUPERNOVA_MODE) {
                case 'webgl':
                    createWebGLSupernovaEvent();
                    break;
                case 'artistic':
                    createArtisticSupernova();
                    break;
                case 'enhanced':
                    createEnhancedSupernova();
                    break;
            }
            break;
        case 'gamma-ray-burst':
            createGammaRayBurst();
            break;
    }
}

// ============================================================================
// TAP INDICATOR UI
// Subtle visual feedback for triple-tap cosmic event trigger
// ============================================================================

function createTapIndicator(): void {
    if (tapIndicator) return;

    tapIndicator = document.createElement('div');
    tapIndicator.className = 'cosmic-tap-indicator';
    const hintText = isMobile ? 'tap 3×' : 'click 3×';
    tapIndicator.innerHTML = `
        <span class="tap-dots">
            <span class="tap-dot"></span>
            <span class="tap-dot"></span>
            <span class="tap-dot"></span>
        </span>
        <span class="tap-hint">${hintText}</span>
    `;

    // Inject styles
    const style = document.createElement('style');
    style.textContent = `
        .cosmic-tap-indicator {
            position: fixed;
            bottom: max(20px, env(safe-area-inset-bottom, 20px));
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 14px;
            background: rgba(10, 8, 20, 0.6);
            border: 1px solid rgba(120, 100, 150, 0.2);
            border-radius: 20px;
            z-index: 90;
            opacity: 0.5;
            transition: opacity 0.3s ease, transform 0.3s ease;
            pointer-events: none;
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
        }

        .cosmic-tap-indicator:hover {
            opacity: 0.7;
        }

        .cosmic-tap-indicator.active {
            opacity: 0.85;
            transform: translateX(-50%) scale(1.05);
        }

        .cosmic-tap-indicator.triggered {
            opacity: 1;
            animation: tapFlash 0.5s ease-out;
        }

        @keyframes tapFlash {
            0% {
                transform: translateX(-50%) scale(1.15);
                border-color: rgba(200, 180, 255, 0.6);
                box-shadow: 0 0 20px rgba(180, 160, 220, 0.4);
            }
            100% {
                transform: translateX(-50%) scale(1);
                border-color: rgba(120, 100, 150, 0.2);
                box-shadow: none;
            }
        }

        .tap-dots {
            display: flex;
            gap: 4px;
        }

        .tap-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: rgba(140, 120, 170, 0.3);
            border: 1px solid rgba(140, 120, 170, 0.4);
            transition: all 0.2s ease;
        }

        .tap-dot.lit {
            background: rgba(200, 180, 255, 0.8);
            border-color: rgba(200, 180, 255, 0.9);
            box-shadow: 0 0 6px rgba(180, 160, 220, 0.6);
        }

        .tap-hint {
            font-family: 'JetBrains Mono', 'Spectral', serif;
            font-size: 0.6rem;
            letter-spacing: 0.05em;
            color: rgba(160, 140, 190, 0.6);
            text-transform: lowercase;
        }

        /* Hide on very small screens to avoid clutter */
        @media (max-height: 500px) {
            .cosmic-tap-indicator {
                display: none;
            }
        }
    `;
    document.head.appendChild(style);
    document.body.appendChild(tapIndicator);
}

function updateTapIndicator(): void {
    if (!tapIndicator) return;

    const dots = tapIndicator.querySelectorAll('.tap-dot');
    dots.forEach((dot, i) => {
        if (i < tapCount) {
            dot.classList.add('lit');
        } else {
            dot.classList.remove('lit');
        }
    });

    // Add active class when tapping
    if (tapCount > 0) {
        tapIndicator.classList.add('active');
    } else {
        tapIndicator.classList.remove('active');
    }
}

function showTapActivation(): void {
    if (!tapIndicator) return;

    tapIndicator.classList.add('triggered');
    setTimeout(() => {
        tapIndicator?.classList.remove('triggered');
    }, 500);
}

export function initCosmicEvents(): void {
    // Respect reduced motion preference
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return;
    }

    // Build the supernova machine while nothing is happening: context creation
    // and the big shader compile must never land on the trigger frame.
    window.setTimeout(() => prewarmWebGLSupernova(), 4000);

    // Click-to-trigger mode: triple-tap anywhere to trigger supernova
    if (SUPERNOVA_CLICK_TRIGGER) {
        console.log('[Supernova] Triple-tap mode active');
        console.log('[Supernova] Tap 3x anywhere to trigger cosmic event');

        // Create subtle UI indicator
        createTapIndicator();

        document.addEventListener('click', (e) => {
            // Ignore clicks on interactive elements
            const target = e.target as HTMLElement;
            if (target.closest('button, a, input, .collapsible, nav, .audio-toggle')) {
                return;
            }

            // Don't trigger if one is already running
            if (clickTriggerRunning) {
                return;
            }

            // Increment tap count with haptic feedback
            tapCount++;
            haptics.tap();  // Subtle tap feedback
            updateTapIndicator();

            // Reset timer
            if (tapTimer !== null) {
                window.clearTimeout(tapTimer);
            }
            tapTimer = window.setTimeout(() => {
                tapCount = 0;
                updateTapIndicator();
            }, TAP_TIMEOUT);

            // Check if we've reached the required taps
            if (tapCount >= TAPS_REQUIRED) {
                // Reset tap state
                tapCount = 0;
                if (tapTimer !== null) {
                    window.clearTimeout(tapTimer);
                    tapTimer = null;
                }
                updateTapIndicator();

                // Trigger cosmic event
                clickTriggerRunning = true;
                const fateType = clickTriggerNextFate === 0 ? 'Neutron Star' : 'Black Hole';
                console.log(`[Supernova] Triggering ${fateType}`);

                // Show brief activation flash on indicator
                showTapActivation();
                haptics.confirm();  // Confirmation haptic on trigger

                createWebGLSupernovaEvent(clickTriggerNextFate, () => {
                    clickTriggerRunning = false;
                    lastCosmicEventTime = Date.now();  // Record when event finished
                    // Alternate for next trigger
                    clickTriggerNextFate = clickTriggerNextFate === 0 ? 1 : 0;
                });
            }
        });

        // Continue to also allow random events (less frequently)
    }

    const TESTING_MODE = false;

    // Random events happen infrequently - rare cosmic occurrences
    const baseInterval = TESTING_MODE
        ? 8000  // 8 seconds for testing
        : (isMobile ? 180000 : 120000);  // 2-3 minutes between checks

    const triggerProbability = TESTING_MODE ? 0.9 : 0.15;  // 15% chance when checked
    const initialDelay = TESTING_MODE
        ? 3000 + Math.random() * 2000   // 3-5 seconds for testing
        : 45000 + Math.random() * 30000; // 45-75 seconds before first possible event

    // Initial delay before first event
    setTimeout(() => {
        triggerRandomEvent();

        // Schedule recurring events
        setInterval(() => {
            if (Math.random() < triggerProbability) {
                triggerRandomEvent();
            }
        }, baseInterval + Math.random() * (TESTING_MODE ? 2000 : 20000));
    }, initialDelay);
}

// Export for testing/manual triggering
export {
    createPulsar,
    createSupernova,
    createEnhancedSupernova,
    createArtisticSupernova,
    createWebGLSupernovaEvent,
    createGammaRayBurst
};
