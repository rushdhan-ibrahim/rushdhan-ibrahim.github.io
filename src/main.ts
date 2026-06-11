// Import styles
import './styles/index.css';

// Import visualizations
import {
    initStarfield,
    initNebulae,
    initCosmicEvents,
    initConstellations,
    initHeroForest,
    initGlassForest,
    initThermo,
    initSignal,
    initChain,
    initSuspicionChain,
    initPayoffMatrix,
    initLightCone,
    initJoining,
    initCarolChoice,
    initWindow,
    initMirror,
    initRealSky,
    resetRealSky
} from './visualizations';

// Import audio
import { initAmbientAudio } from './audio';

// Import components
import { initTransmission, resetTransmission } from './components/transmission';
import { initCredenceInput, resetCredences } from './components/credence-input';
import { initReturnGreeting, forceShowGreeting } from './components/return-greeting';

// Import The Forest Itself (Part Three: the playable dark forest)
import { initForestGame, resetForestGame } from './game/ui';

// Import the experience layer (act engine, atmosphere, wayfinding, entrances)
import { initActs } from './experience/acts';
import { initAtmosphere } from './experience/atmosphere-gl';
import { initProgressRail } from './experience/progress-rail';
import { initReveal } from './experience/reveal';
import { initPointer } from './experience/pointer';
import { initAudioInvite } from './experience/audio-invite';
import { initHeroEntrance } from './experience/hero';

// Import session tracking
import { initSessionTracking, resetReadingData } from './utils/session';

// Import utilities
import { initSmoothScroll, initCollapsibles, initCredenceAnimation, initMobileNav } from './utils';

// Register service worker for offline support
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .catch(() => {
                // Service worker registration failed - continue without it
            });
    });
}

// Debounced orientation change handler for mobile
let orientationTimeout: ReturnType<typeof setTimeout> | null = null;
function handleOrientationChange(): void {
    if (orientationTimeout) {
        clearTimeout(orientationTimeout);
    }
    // Debounce to avoid multiple rapid calls during rotation
    orientationTimeout = setTimeout(() => {
        // Reinitialize visualizations that depend on container dimensions
        resetJoining();
        resetSuspicionChain();
        resetChain();
        resetGlassForest();
    }, 300);
}

// Initialize everything when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Experience layer first: the act engine writes the palette every other
    // surface reads, and the atmosphere sits beneath everything.
    initActs();
    initAtmosphere();
    initHeroEntrance();

    // Visualizations
    initNebulae();  // Initialize nebulae first (behind stars)
    initStarfield();
    initCosmicEvents();  // Rare astronomical phenomena
    initConstellations();  // Star patterns with distance info
    initHeroForest();
    initGlassForest();
    initThermo();
    initSignal();
    initChain();
    initSuspicionChain();
    initPayoffMatrix();
    initLightCone();
    initJoining();
    initCarolChoice();
    initWindow();
    initMirror();

    // Utilities
    initMobileNav();  // Mobile hamburger menu
    initCollapsibles();
    initCredenceAnimation();
    initSmoothScroll();

    // Audio
    initAmbientAudio();

    // Components
    initTransmission();
    initCredenceInput();
    initReturnGreeting();  // Welcome back returning readers
    initForestGame();      // Part Three: The Forest Itself

    // Phase 8: The Return
    initRealSky();
    initSessionTracking();  // Track reading progress

    // Experience layer: wayfinding, choreography, pointer life, the invitation
    initProgressRail();
    initReveal();
    initPointer();
    initAudioInvite();

    // Handle orientation changes on mobile
    window.addEventListener('orientationchange', handleOrientationChange);
    // Also listen for resize as a fallback (some devices don't fire orientationchange)
    let lastWidth = window.innerWidth;
    window.addEventListener('resize', () => {
        // Only trigger if width changed significantly (orientation change)
        if (Math.abs(window.innerWidth - lastWidth) > 100) {
            lastWidth = window.innerWidth;
            handleOrientationChange();
        }
    });
});

// Import interactive functions
import {
    resetGlassForest,
    setAllTrust,
    setGameMode,
    sendChainPulse,
    resetChain,
    resetSuspicionChain,
    resetPayoffMatrix,
    resetLightCone,
    startJoining,
    resetJoining,
    resetCarolChoice
} from './visualizations';

// Expose interactive functions globally for onclick handlers
declare global {
    interface Window {
        resetGlassForest: typeof resetGlassForest;
        setAllTrust: typeof setAllTrust;
        setGameMode: typeof setGameMode;
        sendChainPulse: typeof sendChainPulse;
        resetChain: typeof resetChain;
        resetSuspicionChain: typeof resetSuspicionChain;
        resetPayoffMatrix: typeof resetPayoffMatrix;
        resetLightCone: typeof resetLightCone;
        startJoining: typeof startJoining;
        resetJoining: typeof resetJoining;
        resetCarolChoice: typeof resetCarolChoice;
        resetTransmission: typeof resetTransmission;
        resetCredences: typeof resetCredences;
        resetRealSky: typeof resetRealSky;
        forceShowGreeting: typeof forceShowGreeting;
        resetReadingData: typeof resetReadingData;
        resetForestGame: typeof resetForestGame;
    }
}

window.resetGlassForest = resetGlassForest;
window.setAllTrust = setAllTrust;
window.setGameMode = setGameMode;
window.sendChainPulse = sendChainPulse;
window.resetChain = resetChain;
window.resetSuspicionChain = resetSuspicionChain;
window.resetPayoffMatrix = resetPayoffMatrix;
window.resetLightCone = resetLightCone;
window.startJoining = startJoining;
window.resetJoining = resetJoining;
window.resetCarolChoice = resetCarolChoice;
window.resetTransmission = resetTransmission;
window.resetCredences = resetCredences;
window.resetRealSky = resetRealSky;
window.forceShowGreeting = forceShowGreeting;
window.resetReadingData = resetReadingData;
window.resetForestGame = resetForestGame;
