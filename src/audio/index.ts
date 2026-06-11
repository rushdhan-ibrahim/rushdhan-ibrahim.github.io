// Main Audio Module Entry Point

import {
  getAudioContext,
  getMasterGain,
  getIsAudioPlaying,
  setAudioContext,
  setIsAudioPlaying
} from './context';
import { buildSoundscape } from './soundscape';
import { updateScrollAudio } from './atmosphere';
import { enableBloom } from './ui-sounds';

// Re-export everything for external use
export * from './context';
export * from './soundscape';
export * from './effects';
export * from './joining';
export * from './atmosphere';
export * from './whispers';
export * from './cosmic';
export * from './ui-sounds';

/**
 * Fade in the audio smoothly
 */
function fadeInAudio(): void {
  const audioCtx = getAudioContext();
  const masterGain = getMasterGain();
  if (!audioCtx || !masterGain) return;

  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  masterGain.gain.cancelScheduledValues(audioCtx.currentTime);
  masterGain.gain.setValueAtTime(masterGain.gain.value, audioCtx.currentTime);
  masterGain.gain.linearRampToValueAtTime(0.7, audioCtx.currentTime + 3);
}

/**
 * Fade out the audio smoothly
 */
function fadeOutAudio(): void {
  const audioCtx = getAudioContext();
  const masterGain = getMasterGain();
  if (!audioCtx || !masterGain) return;

  masterGain.gain.cancelScheduledValues(audioCtx.currentTime);
  masterGain.gain.setValueAtTime(masterGain.gain.value, audioCtx.currentTime);
  masterGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 2);
}

/**
 * Toggle audio playback state
 * Returns the new playing state
 */
export function toggleAudio(): boolean {
  const audioCtx = getAudioContext();
  const isPlaying = getIsAudioPlaying();

  if (!audioCtx) {
    // Create new audio context on first toggle
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioContextClass();
    setAudioContext(ctx);
    buildSoundscape();
  }

  if (isPlaying) {
    fadeOutAudio();
  } else {
    fadeInAudio();
    // The moment sound is granted deserves a voice of its own.
    enableBloom();
  }

  const newState = !isPlaying;
  setIsAudioPlaying(newState);
  return newState;
}

/**
 * Initialize the ambient audio system
 * Sets up the audio toggle button and scroll listener
 */
export function initAmbientAudio(): void {
  const toggle = document.getElementById('audio-toggle');
  const soundOff = document.getElementById('sound-off');
  const soundOn = document.getElementById('sound-on');

  if (!toggle) return;

  toggle.addEventListener('click', () => {
    const isNowPlaying = toggleAudio();

    if (soundOff && soundOn) {
      if (isNowPlaying) {
        soundOff.style.display = 'none';
        soundOn.style.display = 'block';
        toggle.classList.add('playing');
      } else {
        soundOff.style.display = 'block';
        soundOn.style.display = 'none';
        toggle.classList.remove('playing');
      }
    }
  });

  // Scroll listener for atmosphere evolution
  window.addEventListener('scroll', updateScrollAudio);
}
