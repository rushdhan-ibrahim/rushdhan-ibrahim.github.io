// Soundscape Layer Creation and Animation

import {
  getAudioContext,
  getMasterGain,
  getIsAudioPlaying,
  setMasterGain,
  setAudioLayer,
  DroneLayer,
  PadLayer,
  NoiseLayer,
  SignalsLayer,
  EyesLayer
} from './context';

/**
 * Build the complete soundscape with all audio layers
 */
export function buildSoundscape(): void {
  const audioCtx = getAudioContext();
  if (!audioCtx) return;

  // Master output, split into a dry path and a generated-impulse reverb send.
  // Every voice in the project routes through masterGain, so the whole
  // soundscape — drones, pings, the forest game, UI ticks — shares one room.
  const masterGain = audioCtx.createGain();
  masterGain.gain.value = 0;

  const dry = audioCtx.createGain();
  dry.gain.value = 0.82;
  masterGain.connect(dry);
  dry.connect(audioCtx.destination);

  const convolver = audioCtx.createConvolver();
  convolver.buffer = buildImpulse(audioCtx, 2.6, 2.4);
  const wet = audioCtx.createGain();
  wet.gain.value = 0.3;
  masterGain.connect(convolver);
  convolver.connect(wet);
  wet.connect(audioCtx.destination);

  setMasterGain(masterGain);

  // Create audio layers
  createDroneLayer();
  createPadLayer();
  createNoiseLayer();
  createSignalLayer();
  createEyesTones();
}

/**
 * Generate a stereo impulse response: exponentially decaying noise.
 * A large, cold, slightly metallic room — the inside of the night.
 */
function buildImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const impulse = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

/**
 * Get a date-seeded random value (same value for entire day)
 */
function getDateSeed(): number {
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    const char = dateStr.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash) / 2147483647;
}

/**
 * Seeded random function for consistent daily variation
 */
function seededRandom(seed: number, index: number): number {
  const x = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * LAYER 1: Deep Space Drone
 * Each day has subtly different characteristics based on date seed
 */
export function createDroneLayer(): void {
  const audioCtx = getAudioContext();
  const masterGain = getMasterGain();
  if (!audioCtx || !masterGain) return;

  const dateSeed = getDateSeed();

  const droneGain = audioCtx.createGain();
  droneGain.gain.value = 0.12;
  droneGain.connect(masterGain);

  const droneLayer: DroneLayer = { gain: droneGain, oscillators: [] };

  // Base frequencies vary slightly each day
  const baseFreqs = [32, 48, 64, 96].map((freq, i) => {
    const variation = 1 + (seededRandom(dateSeed, i) - 0.5) * 0.1;
    return freq * variation;
  });

  baseFreqs.forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const oscGain = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();

    osc.type = i < 2 ? 'sine' : 'triangle';
    osc.frequency.value = freq;

    filter.type = 'lowpass';
    filter.frequency.value = 120;
    filter.Q.value = 1;

    oscGain.gain.value = 0.25 - (i * 0.05);

    osc.connect(filter);
    filter.connect(oscGain);
    oscGain.connect(droneGain);

    osc.start();
    droneLayer.oscillators.push({ osc, gain: oscGain, filter, baseFreq: freq });

    // Slow drift
    driftFrequency(osc, freq, 6, 8000 + i * 1500);
  });

  setAudioLayer('drone', droneLayer);
}

/**
 * LAYER 2: Evolving Pad (Choir of the Void)
 */
export function createPadLayer(): void {
  const audioCtx = getAudioContext();
  const masterGain = getMasterGain();
  if (!audioCtx || !masterGain) return;

  const padGain = audioCtx.createGain();
  padGain.gain.value = 0.08;
  padGain.connect(masterGain);

  const padLayer: PadLayer = { gain: padGain, voices: [] };

  // E minor chord tones
  const notes = [82.41, 123.47, 164.81, 195.99, 246.94];

  notes.forEach((freq, i) => {
    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const voiceGain = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();
    const panner = audioCtx.createStereoPanner();

    osc1.type = 'sine';
    osc1.frequency.value = freq;
    osc2.type = 'triangle';
    osc2.frequency.value = freq * 1.003; // Subtle beating

    filter.type = 'lowpass';
    filter.frequency.value = 500;
    filter.Q.value = 2;

    voiceGain.gain.value = 0.001;
    panner.pan.value = (i % 2 === 0) ? -0.4 : 0.4;

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(voiceGain);
    voiceGain.connect(panner);
    panner.connect(padGain);

    osc1.start();
    osc2.start();

    padLayer.voices.push({ osc1, osc2, gain: voiceGain, filter, baseFreq: freq });

    // Swell animation
    swellVoice(voiceGain, i);
  });

  setAudioLayer('pad', padLayer);
}

/**
 * Animate voice volume swell
 */
export function swellVoice(gainNode: GainNode, index: number): void {
  const audioCtx = getAudioContext();
  if (!getIsAudioPlaying()) {
    setTimeout(() => swellVoice(gainNode, index), 1000);
    return;
  }

  if (!audioCtx) return;

  const now = audioCtx.currentTime;
  const duration = 10 + Math.random() * 10;
  const peakGain = 0.06 + Math.random() * 0.04;

  gainNode.gain.setValueAtTime(0.001, now);
  gainNode.gain.exponentialRampToValueAtTime(peakGain, now + duration * 0.4);
  gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

  setTimeout(() => swellVoice(gainNode, index), duration * 1000 + index * 2000);
}

/**
 * LAYER 3: Cosmic Static (subtle breath of the void)
 * Kept very quiet and low-frequency to avoid being disruptive
 */
export function createNoiseLayer(): void {
  const audioCtx = getAudioContext();
  const masterGain = getMasterGain();
  if (!audioCtx || !masterGain) return;

  const noiseGain = audioCtx.createGain();
  noiseGain.gain.value = 0.006;  // Much quieter base level
  noiseGain.connect(masterGain);

  const bufferSize = audioCtx.sampleRate * 4;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;

  // Lower frequency filter for warmer, less harsh static
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';  // Changed to lowpass for softer sound
  filter.frequency.value = 400;  // Much lower - warm rumble instead of hiss
  filter.Q.value = 0.5;  // Less resonant

  noise.connect(filter);
  filter.connect(noiseGain);
  noise.start();

  const noiseLayer: NoiseLayer = { source: noise, gain: noiseGain, filter };
  setAudioLayer('noise', noiseLayer);

  // Sweep the filter (within lower range)
  sweepNoiseFilter(filter);
}

/**
 * Sweep the noise filter frequency (kept in warm, low range)
 */
export function sweepNoiseFilter(filter: BiquadFilterNode): void {
  const audioCtx = getAudioContext();
  if (!getIsAudioPlaying()) {
    setTimeout(() => sweepNoiseFilter(filter), 2000);
    return;
  }

  if (!audioCtx) return;

  // Keep filter in warm low-frequency range (200-500Hz)
  const newFreq = 200 + Math.random() * 300;
  filter.frequency.exponentialRampToValueAtTime(newFreq, audioCtx.currentTime + 15);
  setTimeout(() => sweepNoiseFilter(filter), 15000);
}

/**
 * LAYER 4: Distant Signals
 */
export function createSignalLayer(): void {
  const signalsLayer: SignalsLayer = { active: true };
  setAudioLayer('signals', signalsLayer);
  scheduleSignal();
}

/**
 * Schedule the next signal blip
 */
export function scheduleSignal(): void {
  if (!getIsAudioPlaying()) {
    setTimeout(scheduleSignal, 3000);
    return;
  }

  playSignalBlip();
  setTimeout(scheduleSignal, 5000 + Math.random() * 15000);
}

/**
 * Play a single signal blip
 */
export function playSignalBlip(): void {
  const audioCtx = getAudioContext();
  const masterGain = getMasterGain();
  if (!audioCtx || !masterGain) return;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();
  const panner = audioCtx.createStereoPanner();

  const freq = 600 + Math.random() * 2400;
  osc.type = 'sine';
  osc.frequency.value = freq;

  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = 15;

  gain.gain.value = 0;
  panner.pan.value = Math.random() * 2 - 1;

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(panner);
  panner.connect(masterGain);

  const now = audioCtx.currentTime;
  const dur = 0.08 + Math.random() * 0.25;

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.025, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

  osc.frequency.exponentialRampToValueAtTime(freq * (0.96 + Math.random() * 0.08), now + dur);

  osc.start(now);
  osc.stop(now + dur + 0.1);
}

/**
 * LAYER 5: Forest Eyes Tones
 */
export function createEyesTones(): void {
  const audioCtx = getAudioContext();
  const masterGain = getMasterGain();
  if (!audioCtx || !masterGain) return;

  const eyesGain = audioCtx.createGain();
  eyesGain.gain.value = 0;
  eyesGain.connect(masterGain);

  const eyesLayer: EyesLayer = {
    gain: eyesGain,
    tones: [],
    activeCount: 0
  };

  // Create 10 subtle tones for the eyes (pentatonic for less dissonance)
  const eyeFreqs = [220, 261.63, 293.66, 349.23, 392, 440, 523.25, 587.33, 698.46, 783.99];

  eyeFreqs.forEach((freq) => {
    const osc = audioCtx.createOscillator();
    const toneGain = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();

    osc.type = 'sine';
    osc.frequency.value = freq;

    filter.type = 'lowpass';
    filter.frequency.value = freq * 2;
    filter.Q.value = 5;

    toneGain.gain.value = 0;

    osc.connect(filter);
    filter.connect(toneGain);
    toneGain.connect(eyesGain);

    osc.start();
    eyesLayer.tones.push({ osc, gain: toneGain, freq, active: false });
  });

  setAudioLayer('eyes', eyesLayer);
}

/**
 * Drift oscillator frequency over time
 */
export function driftFrequency(
  osc: OscillatorNode,
  baseFreq: number,
  range: number,
  interval: number
): void {
  const audioCtx = getAudioContext();
  if (!getIsAudioPlaying()) {
    setTimeout(() => driftFrequency(osc, baseFreq, range, interval), 2000);
    return;
  }

  if (!audioCtx) return;

  const drift = baseFreq + (Math.random() - 0.5) * range;
  osc.frequency.exponentialRampToValueAtTime(drift, audioCtx.currentTime + interval / 1000);
  setTimeout(() => driftFrequency(osc, baseFreq, range, interval), interval);
}
