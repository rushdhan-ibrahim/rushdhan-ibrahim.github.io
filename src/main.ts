// Entry point.
//
// The critical path initializes only what the reader can see in the first
// viewport: the sky, the forest, the type, the act engine. Everything below
// the fold loads on approach as its own chunk, and the heavy spectacle
// (cosmic events, the WebGL supernova, the playable forest) arrives in idle
// time or when its section nears. First paint owes nothing to page twelve.

import './styles/index.css';

// Eager: the first viewport and the systems every surface listens to.
import { initStarfield, initNebulae } from './visualizations/starfield';
import { initHeroForest } from './visualizations/forest';
import { initAmbientAudio } from './audio';
import { initSmoothScroll, initCollapsibles, initCredenceAnimation, initMobileNav } from './utils';
import { initSessionTracking, resetReadingData } from './utils/session';
import { initActs } from './experience/acts';
import { initAtmosphere } from './experience/atmosphere-gl';
import { initProgressRail } from './experience/progress-rail';
import { initReveal } from './experience/reveal';
import { initPointer } from './experience/pointer';
import { initAudioInvite } from './experience/audio-invite';
import { initHeroEntrance } from './experience/hero';

// Register service worker for offline support
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .catch(() => {
                // Service worker registration failed - continue without it
            });
    });
}

// ── Lazy loading machinery ───────────────────────────────────────────────────

const moduleCache = new Map<string, Promise<unknown>>();

function once<T>(key: string, loader: () => Promise<T>): () => Promise<T> {
    return () => {
        let p = moduleCache.get(key) as Promise<T> | undefined;
        if (!p) {
            p = loader();
            moduleCache.set(key, p);
        }
        return p;
    };
}

/** Initialize a module when its container approaches the viewport. */
function onApproach(id: string, run: () => void, margin = '900px'): void {
    const el = document.getElementById(id);
    if (!el) return;
    if (!('IntersectionObserver' in window)) {
        run();
        return;
    }
    const io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                io.disconnect();
                run();
                return;
            }
        }
    }, { rootMargin: `${margin} 0px` });
    io.observe(el);
}

function idle(run: () => void, timeout = 3000): void {
    if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(run, { timeout });
    } else {
        // Safari has no requestIdleCallback; a timeout keeps the spirit.
        window.setTimeout(run, 1200);
    }
}

// Chunk loaders (each dynamic import becomes its own bundle).
const loadGlass = once('glass', () => import('./visualizations/glass-forest'));
const loadThermo = once('thermo', () => import('./visualizations/thermometer'));
const loadSignal = once('signal', () => import('./visualizations/signal'));
const loadChain = once('chain', () => import('./visualizations/chain'));
const loadSuspicion = once('suspicion', () => import('./visualizations/suspicion-chain'));
const loadPayoff = once('payoff', () => import('./visualizations/payoff-matrix'));
const loadLightCone = once('light-cone', () => import('./visualizations/light-cone'));
const loadJoining = once('joining', () => import('./visualizations/joining'));
const loadCarol = once('carol', () => import('./visualizations/carol-choice'));
const loadWindow = once('window', () => import('./visualizations/window'));
const loadMirror = once('mirror', () => import('./visualizations/mirror'));
const loadConstellations = once('constellations', () => import('./visualizations/constellations'));
const loadCosmic = once('cosmic', () => import('./visualizations/cosmic-events'));
const loadTransmission = once('transmission', () => import('./components/transmission'));
const loadCredence = once('credence', () => import('./components/credence-input'));
const loadGreeting = once('greeting', () => import('./components/return-greeting'));
const loadRealSky = once('real-sky', () => import('./visualizations/real-sky'));
const loadGame = once('game', () => import('./game/ui'));

// Visualizations that must re-layout after an orientation change register here.
const rotationResets: (() => void)[] = [];

// ── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    // Phase one — only what the first paint needs: the conductors and the sky.
    initActs();
    initAtmosphere();
    initHeroEntrance();
    initNebulae();
    initStarfield();
    initHeroForest();
    initMobileNav();

    // Phase two — after the first frame is on screen, the furniture arrives.
    requestAnimationFrame(() => requestAnimationFrame(() => {
        initCollapsibles();
        initCredenceAnimation();
        initSmoothScroll();
        initAmbientAudio();
        initSessionTracking();
        initProgressRail();
        initReveal();
        initPointer();
        initAudioInvite();
        registerLazySections();
    }));
});

function registerLazySections(): void {
    // Below the fold: each instrument wakes as the reader approaches it.
    onApproach('glass-forest-container', () => void loadGlass().then(m => {
        m.initGlassForest();
        rotationResets.push(m.resetGlassForest);
    }));
    onApproach('thermo-container', () => void loadThermo().then(m => m.initThermo()));
    onApproach('signal-container', () => void loadSignal().then(m => m.initSignal()));
    onApproach('chain-container', () => void loadChain().then(m => {
        m.initChain();
        rotationResets.push(m.resetChain);
    }));
    onApproach('suspicion-chain-container', () => void loadSuspicion().then(m => {
        m.initSuspicionChain();
        rotationResets.push(m.resetSuspicionChain);
    }));
    onApproach('payoff-matrix-container', () => void loadPayoff().then(m => m.initPayoffMatrix()));
    onApproach('light-cone-container', () => void loadLightCone().then(m => m.initLightCone()));
    onApproach('joining-container', () => void loadJoining().then(m => {
        m.initJoining();
        rotationResets.push(m.resetJoining);
    }));
    onApproach('carol-choice-container', () => void loadCarol().then(m => m.initCarolChoice()));
    onApproach('window-container', () => void loadWindow().then(m => m.initWindow()));
    onApproach('mirror-container', () => void loadMirror().then(m => m.initMirror()));
    onApproach('transmission-container', () => void loadTransmission().then(m => m.initTransmission()));
    onApproach('credence-container', () => void loadCredence().then(m => m.initCredenceInput()));
    onApproach('real-sky-container', () => void loadRealSky().then(m => m.initRealSky()));
    onApproach('forest-game-container', () => void loadGame().then(m => m.initForestGame()), '1200px');

    // Idle-time guests: spectacle and memory, never blocking arrival or the
    // reader's first interactions. The cosmic machinery is the heaviest
    // module in the project; it can afford to be the last thing awake —
    // except that the first tap anywhere fast-tracks it, so the triple-tap
    // trigger never has a dead period.
    let cosmicStarted = false;
    const ensureCosmic = () => {
        if (cosmicStarted) return;
        cosmicStarted = true;
        void loadCosmic().then(m => m.initCosmicEvents());
    };
    idle(() => void loadGreeting().then(m => m.initReturnGreeting()), 2000);
    idle(() => void loadConstellations().then(m => m.initConstellations()), 9000);
    idle(ensureCosmic, 14000);
    window.addEventListener('pointerdown', ensureCosmic, { once: true, passive: true });

    // Warm the remaining section chunks once the page is long idle: a reader
    // on a cold CDN edge should never wait for an instrument to wake.
    idle(() => {
        [loadGlass, loadThermo, loadSignal, loadChain, loadSuspicion, loadPayoff,
            loadLightCone, loadJoining, loadCarol, loadWindow, loadMirror,
            loadTransmission, loadCredence, loadRealSky, loadGame]
            .forEach(loader => void loader().catch(() => { /* warmed best-effort */ }));
    }, 25000);

    // Handle orientation changes on mobile
    let orientationTimeout: ReturnType<typeof setTimeout> | null = null;
    const handleOrientationChange = (): void => {
        if (orientationTimeout) clearTimeout(orientationTimeout);
        orientationTimeout = setTimeout(() => {
            rotationResets.forEach(reset => reset());
        }, 300);
    };
    window.addEventListener('orientationchange', handleOrientationChange);
    let lastWidth = window.innerWidth;
    window.addEventListener('resize', () => {
        if (Math.abs(window.innerWidth - lastWidth) > 100) {
            lastWidth = window.innerWidth;
            handleOrientationChange();
        }
    });
}

// ── Global handlers for HTML onclick hooks (lazy-aware) ──────────────────────

declare global {
    interface Window {
        resetGlassForest: () => void;
        setAllTrust: (level: number) => void;
        setGameMode: (mode: 'one-shot' | 'iterated') => void;
        sendChainPulse: () => void;
        resetChain: () => void;
        resetSuspicionChain: () => void;
        resetPayoffMatrix: () => void;
        resetLightCone: () => void;
        startJoining: () => void;
        resetJoining: () => void;
        resetCarolChoice: () => void;
        resetTransmission: () => void;
        resetCredences: () => void;
        resetRealSky: () => void;
        forceShowGreeting: () => void;
        resetReadingData: typeof resetReadingData;
        resetForestGame: (seed?: number) => void;
    }
}

window.resetGlassForest = () => void loadGlass().then(m => m.resetGlassForest());
window.setAllTrust = (level) => void loadGlass().then(m => m.setAllTrust(level));
window.setGameMode = (mode) => void loadGlass().then(m => m.setGameMode(mode));
window.sendChainPulse = () => void loadChain().then(m => m.sendChainPulse());
window.resetChain = () => void loadChain().then(m => m.resetChain());
window.resetSuspicionChain = () => void loadSuspicion().then(m => m.resetSuspicionChain());
window.resetPayoffMatrix = () => void loadPayoff().then(m => m.resetPayoffMatrix());
window.resetLightCone = () => void loadLightCone().then(m => m.resetLightCone());
window.startJoining = () => void loadJoining().then(m => m.startJoining());
window.resetJoining = () => void loadJoining().then(m => m.resetJoining());
window.resetCarolChoice = () => void loadCarol().then(m => m.resetCarolChoice());
window.resetTransmission = () => void loadTransmission().then(m => m.resetTransmission());
window.resetCredences = () => void loadCredence().then(m => m.resetCredences());
window.resetRealSky = () => void loadRealSky().then(m => m.resetRealSky());
window.forceShowGreeting = () => void loadGreeting().then(m => m.forceShowGreeting());
window.resetReadingData = resetReadingData;
window.resetForestGame = (seed?: number) => void loadGame().then(m => m.resetForestGame(seed));
