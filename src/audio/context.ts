// Audio Context and State Management

export interface DroneOscillator {
  osc: OscillatorNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  baseFreq: number;
}

export interface PadVoice {
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  baseFreq: number;
}

export interface EyesTone {
  osc: OscillatorNode;
  gain: GainNode;
  freq: number;
  active: boolean;
}

export interface DroneLayer {
  gain: GainNode;
  oscillators: DroneOscillator[];
}

export interface PadLayer {
  gain: GainNode;
  voices: PadVoice[];
}

export interface NoiseLayer {
  source: AudioBufferSourceNode;
  gain: GainNode;
  filter: BiquadFilterNode;
}

export interface SignalsLayer {
  active: boolean;
}

export interface EyesLayer {
  gain: GainNode;
  tones: EyesTone[];
  activeCount: number;
}

export interface AudioLayers {
  drone?: DroneLayer;
  pad?: PadLayer;
  noise?: NoiseLayer;
  signals?: SignalsLayer;
  eyes?: EyesLayer;
}

export interface SectionMarker {
  start?: number;
  mood: string;
}

export interface SectionMarkers {
  [key: string]: SectionMarker;
}

// Audio state
let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let isAudioPlaying = false;
let audioLayers: AudioLayers = {};
let currentSection = 'intro';
let scrollProgress = 0;

// Section markers for scroll-linked audio
export const sectionMarkers: SectionMarkers = {
  intro: { start: 0, mood: 'wonder' },
  steelman: { mood: 'tension' },
  cracks: { mood: 'relief' },
  pluribus: { mood: 'alien' },
  'the-forest': { mood: 'stillness' },
  alternatives: { mood: 'contemplation' },
  assessment: { mood: 'resolution' }
};

// Getters
export function getAudioContext(): AudioContext | null {
  return audioCtx;
}

export function getMasterGain(): GainNode | null {
  return masterGain;
}

export function getIsAudioPlaying(): boolean {
  return isAudioPlaying;
}

export function getAudioLayers(): AudioLayers {
  return audioLayers;
}

export function getCurrentSection(): string {
  return currentSection;
}

export function getScrollProgress(): number {
  return scrollProgress;
}

// Setters
export function setAudioContext(ctx: AudioContext): void {
  audioCtx = ctx;
}

export function setMasterGain(gain: GainNode): void {
  masterGain = gain;
}

export function setIsAudioPlaying(playing: boolean): void {
  isAudioPlaying = playing;
}

export function setAudioLayers(layers: AudioLayers): void {
  audioLayers = layers;
}

export function setCurrentSection(section: string): void {
  currentSection = section;
}

export function setScrollProgress(progress: number): void {
  scrollProgress = progress;
}

// Utility to update a specific layer
export function setAudioLayer<K extends keyof AudioLayers>(
  key: K,
  value: AudioLayers[K]
): void {
  audioLayers[key] = value;
}
