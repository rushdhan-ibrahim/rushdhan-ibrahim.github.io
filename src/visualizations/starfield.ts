// Starfield — single-canvas renderer.
//
// One canvas, one rAF, ~230 sprites: what used to be hundreds of DOM nodes
// with `transition: all` now draws in well under a millisecond a frame.
// The cosmic events drive it through field effects (gravity, dimming,
// shockwaves) instead of touching elements; hover memory, audio pings,
// shooting stars, and scroll parallax all live in the same loop.

import { rememberStar, isStarRemembered } from '../utils/persistence';
import { playStarTouchSound } from '../audio/effects';
import { prefersReducedMotion } from '../utils/visibility';

export const starChars: string[] = ['·', '∙', '*', '✦', '✧', '°', '+'];

export const starConfigs: { layer: string; count: number; opacityRange: [number, number]; speed: number }[] = [
    { layer: 'star-layer-1', count: 50, opacityRange: [0.15, 0.3], speed: 0.01 },
    { layer: 'star-layer-2', count: 80, opacityRange: [0.2, 0.5], speed: 0.03 },
    { layer: 'star-layer-3', count: 100, opacityRange: [0.4, 0.8], speed: 0.06 }
];

export const starColors: string[] = ['#f0eeeb', '#b8d4ff', '#ffb8a8', '#ffe8d0', '#d0e8ff'];

// ── Nebulae (CSS layers; the blur lives in the gradients, not in filters) ────

interface NebulaConfig {
    type: 'purple' | 'blue' | 'dust' | 'teal';
    x: number;
    y: number;
    width: number;
    height: number;
    delay: number;
}

const nebulaConfigs: NebulaConfig[] = [
    { type: 'purple', x: 60, y: 10, width: 80, height: 60, delay: 0 },
    { type: 'blue', x: 5, y: 50, width: 60, height: 50, delay: 0.5 },
    { type: 'dust', x: 30, y: 30, width: 50, height: 40, delay: 1 },
    { type: 'teal', x: 10, y: 5, width: 40, height: 35, delay: 1.5 },
    { type: 'purple', x: 70, y: 60, width: 45, height: 40, delay: 2 },
];

export function initNebulae(): void {
    let nebulaLayer = document.getElementById('nebula-layer');
    if (!nebulaLayer) {
        nebulaLayer = document.createElement('div');
        nebulaLayer.id = 'nebula-layer';
        nebulaLayer.className = 'nebula-layer';
        document.body.insertBefore(nebulaLayer, document.body.firstChild);
    }

    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    const configs = isMobile ? nebulaConfigs.slice(0, 3) : nebulaConfigs;

    configs.forEach((config) => {
        const nebula = document.createElement('div');
        nebula.className = `nebula nebula--${config.type}`;
        const sizeVariation = 0.85 + Math.random() * 0.3;
        nebula.style.left = `${config.x}%`;
        nebula.style.top = `${config.y}%`;
        nebula.style.width = `${config.width * sizeVariation}vw`;
        nebula.style.height = `${config.height * sizeVariation}vh`;
        nebula.style.animationDelay = `${config.delay}s`;
        nebulaLayer.appendChild(nebula);
    });
}

// ── Star state ───────────────────────────────────────────────────────────────

interface Star {
    x: number;            // % of viewport
    y: number;
    layerIndex: number;
    starIndex: number;
    baseOpacity: number;
    sprite: number;       // atlas cell
    twinklePhase: number;
    twinkleSpeed: number;
    remembered: boolean;
    hoverBoost: number;   // eased 0..1
    gravOX: number;       // current gravity displacement, %
    gravOY: number;
    consumed: boolean;
}

interface ShootingStar {
    x: number;            // px
    y: number;
    dx: number;
    dy: number;
    start: number;
    duration: number;
    length: number;
    angle: number;
}

interface GravityField {
    x: number;
    y: number;
    intensity: number;
    onConsume: ((pan: number) => void) | null;
}

interface DimField {
    x: number;
    y: number;
    radius: number;
    intensity: number;
}

interface ShockField {
    x: number;
    y: number;
    radius: number;
    thickness: number;
    setAt: number;
}

const GRAVITY_RADIUS = 25;
const STRONG_GRAVITY_RADIUS = 8;
const HORIZON_RADIUS = 3;

let stars: Star[] = [];
let shooting: ShootingStar[] = [];
let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let atlas: HTMLCanvasElement | null = null;
let cell = 0;
let spriteCount = 0;
let rafId: number | null = null;
let reduced = false;
let pointerX = -1000;
let pointerY = -1000;
let gravity: GravityField | null = null;
let gravityRelease = 0;     // timestamp when gravity was cleared (for ease-back)
let dim: DimField | null = null;
let shock: ShockField | null = null;

// ── Field-effect API (used by cosmic events) ─────────────────────────────────

/** Pull stars toward a point (viewport %). Pass null to release — stars ease home. */
export function setStarfieldGravity(field: { x: number; y: number; intensity: number; onConsume?: (pan: number) => void } | null): void {
    if (field === null) {
        if (gravity) gravityRelease = performance.now();
        gravity = null;
        return;
    }
    gravity = { x: field.x, y: field.y, intensity: field.intensity, onConsume: field.onConsume ?? null };
    requestDraw();
}

/** Dim stars near a point (light being drawn in). Intensity 0 clears. */
export function setStarfieldDim(x: number, y: number, radius: number, intensity: number): void {
    dim = intensity > 0 ? { x, y, radius, intensity } : null;
    requestDraw();
}

/** Brighten stars in an expanding ring. Call per frame; stales out on its own. */
export function setStarfieldShockwave(x: number, y: number, radius: number, thickness: number): void {
    shock = { x, y, radius, thickness, setAt: performance.now() };
    requestDraw();
}

// ── Sprite atlas ─────────────────────────────────────────────────────────────

function buildAtlas(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cell = Math.ceil(18 * dpr);
    spriteCount = starChars.length * starColors.length;
    atlas = document.createElement('canvas');
    atlas.width = cell * spriteCount;
    atlas.height = cell * 2; // row 0: normal · row 1: bright (halo)
    const a = atlas.getContext('2d')!;
    a.textAlign = 'center';
    a.textBaseline = 'middle';

    let i = 0;
    for (const ch of starChars) {
        for (const color of starColors) {
            const cx = i * cell + cell / 2;
            // normal
            a.font = `${11 * dpr}px "JetBrains Mono", monospace`;
            a.fillStyle = color;
            a.shadowBlur = 0;
            a.fillText(ch, cx, cell / 2);
            // bright (halo)
            a.shadowColor = color;
            a.shadowBlur = 6 * dpr;
            a.fillText(ch, cx, cell + cell / 2);
            a.fillText(ch, cx, cell + cell / 2);
            a.shadowBlur = 0;
            i++;
        }
    }
}

// ── Shooting stars ───────────────────────────────────────────────────────────

export function createShootingStar(): void {
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const angle = (25 + Math.random() * 20) * Math.PI / 180;
    const length = 80 + Math.random() * 60;
    shooting.push({
        x: Math.random() * 0.6 * w,
        y: Math.random() * 0.4 * h,
        dx: Math.cos(angle),
        dy: Math.sin(angle),
        start: performance.now(),
        duration: 600 + Math.random() * 400,
        length,
        angle,
    });
    requestDraw();
}

// ── Render ───────────────────────────────────────────────────────────────────

function fit(): void {
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function draw(now: number): void {
    if (!ctx || !canvas || !atlas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    const scrollY = window.scrollY;
    const px = (pointerX / w) * 100;
    const py = (pointerY / h) * 100;
    const gravActive = gravity !== null;
    const releaseT = gravityRelease > 0 ? Math.min(1, (now - gravityRelease) / 1600) : 1;
    const shockAlive = shock !== null && now - shock.setAt < 120;
    const cellCss = cell / Math.min(2, window.devicePixelRatio || 1);
    const half = cellCss / 2;

    for (const s of stars) {
        // Parallax: each depth layer drifts at its own rate.
        const layerSpeed = starConfigs[s.layerIndex].speed;
        let sx = s.x;
        let sy = s.y - ((scrollY * layerSpeed) / h) * 100 % 140;
        if (sy < -20) sy += 140;

        // Twinkle
        let opacity = s.baseOpacity;
        if (!reduced) {
            opacity *= 0.85 + 0.15 * Math.sin(now / 1000 * s.twinkleSpeed + s.twinklePhase);
        }

        // Hover: a soft lantern around the pointer.
        const hdx = Math.abs(sx - px);
        const hdy = Math.abs(sy - py);
        let boost = 0;
        if (hdx < 40 && hdy < 40) {
            const d = Math.hypot(hdx, hdy);
            if (d < 40) {
                boost = 1 - d / 40;
                if (boost > 0.5 && !s.remembered) {
                    s.remembered = true;
                    s.baseOpacity = Math.min(1, s.baseOpacity + 0.15);
                    rememberStar(s.layerIndex, s.starIndex);
                    playStarTouchSound(sx / 100, boost);
                }
            }
        }
        s.hoverBoost += (boost - s.hoverBoost) * 0.25;
        opacity = Math.min(1, opacity + s.hoverBoost * 0.6);

        // Gravity field (black hole): displacement, stretch, dimming, consumption.
        let stretch = 0;
        let stretchAngle = 0;
        if (gravActive && gravity) {
            const gdx = gravity.x - sx;
            const gdy = gravity.y - sy;
            const gd = Math.hypot(gdx, gdy);
            if (gd < GRAVITY_RADIUS && gd > 0.1) {
                const pull = Math.pow(1 - gd / GRAVITY_RADIUS, 2) * gravity.intensity;
                s.gravOX = (gdx / gd) * pull * 8;
                s.gravOY = (gdy / gd) * pull * 8;
                if (gd < STRONG_GRAVITY_RADIUS) {
                    stretch = (1 - gd / STRONG_GRAVITY_RADIUS) * 2 * gravity.intensity;
                    stretchAngle = Math.atan2(gdy, gdx);
                    opacity *= (gd / STRONG_GRAVITY_RADIUS);
                }
                if (gd < HORIZON_RADIUS) {
                    if (!s.consumed) {
                        s.consumed = true;
                        gravity.onConsume?.((gravity.x - 50) / 50);
                    }
                    opacity = 0;
                }
            } else {
                s.gravOX *= 0.9;
                s.gravOY *= 0.9;
            }
        } else if (s.gravOX !== 0 || s.gravOY !== 0) {
            // Released: ease home.
            const k = 1 - releaseT;
            s.gravOX *= k;
            s.gravOY *= k;
            if (releaseT >= 1) { s.gravOX = 0; s.gravOY = 0; s.consumed = false; }
        }
        if (!gravActive && releaseT >= 1) s.consumed = false;

        sx += s.gravOX;
        sy += s.gravOY;

        // Dim field (pre-ignition light being drawn inward).
        if (dim) {
            const dd = Math.hypot(dim.x - sx, dim.y - sy);
            if (dd <= dim.radius) {
                opacity *= 1 - (1 - dd / dim.radius) * dim.intensity * 0.4;
            }
        }

        // Shockwave ring. (Remembered stars keep their elevated base opacity,
        // as before — the halo sprite is reserved for live attention.)
        let bright = s.hoverBoost > 0.3;
        if (shockAlive && shock) {
            const sd = Math.hypot(shock.x - sx, shock.y - sy);
            if (sd > shock.radius - shock.thickness && sd < shock.radius + shock.thickness) {
                opacity = Math.min(1, opacity + 0.5);
                bright = true;
            }
        }

        if (opacity <= 0.01) continue;

        const cx = (sx / 100) * w;
        const cy = (sy / 100) * h;
        ctx.globalAlpha = opacity;
        const srcX = s.sprite * cell;
        const srcY = bright ? cell : 0;
        if (stretch > 0.05) {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(stretchAngle);
            ctx.scale(1 + stretch, 1);
            ctx.drawImage(atlas, srcX, srcY, cell, cell, -half, -half, cellCss, cellCss);
            ctx.restore();
        } else {
            ctx.drawImage(atlas, srcX, srcY, cell, cell, cx - half, cy - half, cellCss, cellCss);
        }
    }
    ctx.globalAlpha = 1;

    // Shooting stars: a bright head and a fading vector of light.
    if (shooting.length > 0) {
        const alive: ShootingStar[] = [];
        for (const sh of shooting) {
            const p = (now - sh.start) / sh.duration;
            if (p >= 1) continue;
            alive.push(sh);
            const dist = (sh.length + 50) * p;
            const hx = sh.x + sh.dx * dist;
            const hy = sh.y + sh.dy * dist;
            const fade = p < 0.2 ? p * 5 : p > 0.8 ? (1 - p) * 5 : 1;
            const tail = sh.length * (1 - p * 0.5);

            const grad = ctx.createLinearGradient(hx - sh.dx * tail, hy - sh.dy * tail, hx, hy);
            grad.addColorStop(0, 'rgba(170, 204, 255, 0)');
            grad.addColorStop(0.6, `rgba(170, 204, 255, ${0.35 * fade})`);
            grad.addColorStop(1, `rgba(232, 230, 227, ${0.8 * fade})`);
            ctx.strokeStyle = grad;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(hx - sh.dx * tail, hy - sh.dy * tail);
            ctx.lineTo(hx, hy);
            ctx.stroke();

            ctx.globalAlpha = fade;
            ctx.fillStyle = '#f0eeeb';
            ctx.beginPath();
            ctx.arc(hx, hy, 1.6, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        }
        shooting = alive;
    }
}

function loop(now: number): void {
    rafId = null;
    if (document.hidden) return;
    draw(now);
    if (!reduced) {
        rafId = requestAnimationFrame(loop);
    } else if (shooting.length > 0 || gravity || dim || (shock && now - shock.setAt < 120)) {
        // Reduced motion still honors discrete events, one frame at a time.
        rafId = requestAnimationFrame(loop);
    }
}

function requestDraw(): void {
    if (rafId === null && !document.hidden) {
        rafId = requestAnimationFrame(loop);
    }
}

// ── Init ─────────────────────────────────────────────────────────────────────

export function initStarfield(): void {
    const container = document.getElementById('starfield');
    if (!container) return;

    reduced = prefersReducedMotion();
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    const starMultiplier = isMobile ? 0.5 : 1;

    canvas = document.createElement('canvas');
    canvas.id = 'starfield-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    container.appendChild(canvas);
    ctx = canvas.getContext('2d');
    if (!ctx) return;

    buildAtlas();
    fit();

    stars = [];
    starConfigs.forEach((config, layerIndex) => {
        const count = Math.floor(config.count * starMultiplier);
        for (let i = 0; i < count; i++) {
            const remembered = isStarRemembered(layerIndex, i);
            let baseOpacity = config.opacityRange[0] + Math.random() * (config.opacityRange[1] - config.opacityRange[0]);
            if (remembered) baseOpacity = Math.min(1, baseOpacity + 0.25);
            stars.push({
                x: Math.random() * 100,
                y: Math.random() * 120 - 10,
                layerIndex,
                starIndex: i,
                baseOpacity,
                sprite: Math.floor(Math.random() * spriteCount),
                twinklePhase: Math.random() * Math.PI * 2,
                twinkleSpeed: 0.3 + Math.random() * 0.9,
                remembered,
                hoverBoost: 0,
                gravOX: 0,
                gravOY: 0,
                consumed: false,
            });
        }
    });

    document.addEventListener('pointermove', (e) => {
        pointerX = e.clientX;
        pointerY = e.clientY;
        if (reduced) requestDraw();
    }, { passive: true });

    window.addEventListener('resize', () => {
        fit();
        requestDraw();
    });

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) requestDraw();
    });

    // Shooting stars, as before — less frequent on mobile.
    const shootingStarInterval = isMobile ? 8000 : 4000;
    setInterval(() => {
        if (Math.random() > 0.7) createShootingStar();
    }, shootingStarInterval);
    setTimeout(createShootingStar, 2000);

    if (reduced) {
        requestDraw();
    } else {
        rafId = requestAnimationFrame(loop);
    }
}
