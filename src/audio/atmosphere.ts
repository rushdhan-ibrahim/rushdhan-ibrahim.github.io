// Scroll-Linked Atmosphere Transitions

import {
  getAudioContext,
  getIsAudioPlaying,
  getAudioLayers,
  getCurrentSection,
  setCurrentSection,
  setScrollProgress
} from './context';

// Scroll velocity tracking
let lastScrollY = 0;
let lastScrollTime = performance.now();
let scrollVelocity = 0;
let isPaused = false;
let pauseTimeout: number | null = null;

/**
 * Get current scroll velocity (pixels per second)
 */
export function getScrollVelocity(): number {
  return scrollVelocity;
}

/**
 * Check if reader appears to be paused
 */
export function isReaderPaused(): boolean {
  return isPaused;
}

/**
 * Update audio based on scroll position and velocity
 */
export function updateScrollAudio(): void {
  const audioCtx = getAudioContext();
  const audioLayers = getAudioLayers();
  if (!audioCtx || !getIsAudioPlaying()) return;

  const now = performance.now();
  const scrollY = window.scrollY;
  const docHeight = document.documentElement.scrollHeight - window.innerHeight;
  const scrollProgress = Math.min(1, scrollY / docHeight);
  setScrollProgress(scrollProgress);

  // Calculate scroll velocity
  const deltaY = Math.abs(scrollY - lastScrollY);
  const deltaTime = (now - lastScrollTime) / 1000; // seconds

  if (deltaTime > 0) {
    const instantVelocity = deltaY / deltaTime;
    // Smooth the velocity
    scrollVelocity = scrollVelocity * 0.8 + instantVelocity * 0.2;
  }

  lastScrollY = scrollY;
  lastScrollTime = now;

  // Detect pause (no scrolling for 3+ seconds)
  if (pauseTimeout) {
    clearTimeout(pauseTimeout);
  }

  // Resume audio if coming back from pause
  if (isPaused) {
    resumeAudioFromPause();
  }

  isPaused = false;
  pauseTimeout = window.setTimeout(() => {
    isPaused = true;
    // Fade audio during pause
    fadeAudioForPause();
  }, 3000);

  // Apply velocity-based audio adjustments
  applyVelocityEffects(scrollVelocity);

  // Detect current section
  const sections = ['steelman', 'cracks', 'pluribus', 'the-forest', 'alternatives', 'assessment'];
  let newSection = 'intro';

  sections.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.5) {
        newSection = id;
      }
    }
  });

  if (newSection !== getCurrentSection()) {
    setCurrentSection(newSection);
    transitionAtmosphere(newSection);
  }

  // Continuous adjustments based on scroll (kept subtle)
  if (audioLayers.noise && audioLayers.noise.filter) {
    // Very subtle increase with scroll - barely noticeable
    const noiseVol = 0.004 + scrollProgress * 0.004;  // Max 0.008
    audioLayers.noise.gain.gain.linearRampToValueAtTime(noiseVol, audioCtx.currentTime + 0.5);
  }
}

/**
 * Transition the atmosphere based on current section
 */
export function transitionAtmosphere(section: string): void {
  const audioCtx = getAudioContext();
  const audioLayers = getAudioLayers();
  if (!audioCtx || !audioLayers.drone) return;

  const now = audioCtx.currentTime;
  const transitionTime = 3;

  switch (section) {
    case 'intro':
      // Open, wonder - pure tones
      audioLayers.drone.oscillators.forEach((d) => {
        d.osc.frequency.exponentialRampToValueAtTime(d.baseFreq, now + transitionTime);
      });
      if (audioLayers.pad) {
        audioLayers.pad.gain.gain.linearRampToValueAtTime(0.08, now + transitionTime);
      }
      break;

    case 'steelman':
      // Tension building - lower, darker
      audioLayers.drone.oscillators.forEach((d) => {
        d.osc.frequency.exponentialRampToValueAtTime(d.baseFreq * 0.85, now + transitionTime);
      });
      if (audioLayers.pad) {
        audioLayers.pad.gain.gain.linearRampToValueAtTime(0.05, now + transitionTime);
      }
      break;

    case 'cracks':
      // Slight relief - brighter harmonics
      audioLayers.drone.oscillators.forEach((d) => {
        d.osc.frequency.exponentialRampToValueAtTime(d.baseFreq * 1.05, now + transitionTime);
      });
      if (audioLayers.pad) {
        audioLayers.pad.gain.gain.linearRampToValueAtTime(0.1, now + transitionTime);
      }
      break;

    case 'pluribus':
      // Alien - shifted, unsettling
      audioLayers.drone.oscillators.forEach((d, i) => {
        const alienFreq = d.baseFreq * (i % 2 === 0 ? 1.12 : 0.94);
        d.osc.frequency.exponentialRampToValueAtTime(alienFreq, now + transitionTime);
      });
      if (audioLayers.pad) {
        audioLayers.pad.gain.gain.linearRampToValueAtTime(0.06, now + transitionTime);
      }
      break;

    case 'the-forest':
      // Predatory stillness - the drone sinks low and the pad thins to a thread
      audioLayers.drone.oscillators.forEach((d) => {
        d.osc.frequency.exponentialRampToValueAtTime(d.baseFreq * 0.78, now + transitionTime + 2);
      });
      if (audioLayers.pad) {
        audioLayers.pad.gain.gain.linearRampToValueAtTime(0.03, now + transitionTime + 2);
      }
      break;

    case 'alternatives':
      // Contemplation - return to natural but subdued
      audioLayers.drone.oscillators.forEach((d) => {
        d.osc.frequency.exponentialRampToValueAtTime(d.baseFreq * 0.95, now + transitionTime);
      });
      if (audioLayers.pad) {
        audioLayers.pad.gain.gain.linearRampToValueAtTime(0.07, now + transitionTime);
      }
      break;

    case 'assessment':
      // Resolution - open but wiser
      audioLayers.drone.oscillators.forEach((d) => {
        d.osc.frequency.exponentialRampToValueAtTime(d.baseFreq, now + transitionTime);
      });
      if (audioLayers.pad) {
        audioLayers.pad.gain.gain.linearRampToValueAtTime(0.09, now + transitionTime);
      }
      break;
  }
}

/**
 * Apply audio effects based on scroll velocity
 * Kept very subtle - the sound should never be disruptive
 */
function applyVelocityEffects(velocity: number): void {
  const audioCtx = getAudioContext();
  const audioLayers = getAudioLayers();
  if (!audioCtx || !audioLayers.noise) return;

  const now = audioCtx.currentTime;

  // Normalize velocity (0-1 range, capped at 2000px/s as "fast")
  const normalizedVelocity = Math.min(1, velocity / 2000);

  // Fast scrolling: very subtle filter change (stays warm)
  if (audioLayers.noise.filter) {
    const baseFilterFreq = 300;
    const velocityBoost = normalizedVelocity * 150;  // Max 450Hz - still warm
    audioLayers.noise.filter.frequency.linearRampToValueAtTime(
      baseFilterFreq + velocityBoost,
      now + 0.5
    );
  }

  // Fast scrolling: minimal volume increase
  if (audioLayers.noise.gain) {
    const baseVol = 0.005;
    const velocityBoost = normalizedVelocity * 0.003;  // Max 0.008
    audioLayers.noise.gain.gain.linearRampToValueAtTime(
      baseVol + velocityBoost,
      now + 0.5
    );
  }

  // Fast scrolling: pad voices become slightly brighter (this is fine)
  if (audioLayers.pad && audioLayers.pad.voices) {
    audioLayers.pad.voices.forEach(voice => {
      if (voice.filter) {
        const baseFreq = 500;
        const velocityBoost = normalizedVelocity * 200;
        voice.filter.frequency.linearRampToValueAtTime(
          baseFreq + velocityBoost,
          now + 0.5
        );
      }
    });
  }
}

/**
 * Fade audio when reader pauses
 */
function fadeAudioForPause(): void {
  const audioCtx = getAudioContext();
  const audioLayers = getAudioLayers();
  if (!audioCtx || !getIsAudioPlaying()) return;

  const now = audioCtx.currentTime;
  const fadeTime = 8; // Slow fade over 8 seconds

  // Reduce drone volume slightly
  if (audioLayers.drone) {
    audioLayers.drone.gain.gain.linearRampToValueAtTime(0.06, now + fadeTime);
  }

  // Reduce pad volume
  if (audioLayers.pad) {
    audioLayers.pad.gain.gain.linearRampToValueAtTime(0.03, now + fadeTime);
  }

  // Noise becomes nearly silent
  if (audioLayers.noise) {
    audioLayers.noise.gain.gain.linearRampToValueAtTime(0.002, now + fadeTime);
  }
}

/**
 * Resume audio after pause (call when scrolling resumes)
 */
export function resumeAudioFromPause(): void {
  const audioCtx = getAudioContext();
  const audioLayers = getAudioLayers();
  if (!audioCtx || !getIsAudioPlaying()) return;

  const now = audioCtx.currentTime;
  const fadeTime = 2; // Quick fade back up

  // Restore drone volume
  if (audioLayers.drone) {
    audioLayers.drone.gain.gain.linearRampToValueAtTime(0.12, now + fadeTime);
  }

  // Restore pad volume
  if (audioLayers.pad) {
    audioLayers.pad.gain.gain.linearRampToValueAtTime(0.08, now + fadeTime);
  }

  // Restore noise (to subtle level)
  if (audioLayers.noise) {
    audioLayers.noise.gain.gain.linearRampToValueAtTime(0.006, now + fadeTime);
  }
}
