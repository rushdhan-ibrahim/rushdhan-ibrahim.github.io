// The Act Engine.
//
// The essay is a composition in acts, and this module is its conductor: as the
// reader scrolls, one palette dissolves into the next, and every layer that
// listens — CSS custom properties, the WebGL atmosphere, the soundscape that
// already watches these same anchors — moves together. Nothing snaps. Acts
// arrive the way weather does.

export interface ActPalette {
    /** Anchor element id that begins this act (null = page top). */
    anchor: string | null;
    name: string;
    accent: [number, number, number];   // 0-255
    deep: [number, number, number];     // GL deep-field tint
    mid: [number, number, number];      // GL cloud body
    /** Atmosphere intensity 0..1 — some acts breathe harder than others. */
    intensity: number;
}

export const ACTS: ActPalette[] = [
    { anchor: null,           name: 'prologue',     accent: [138, 164, 198], deep: [9, 10, 18],  mid: [22, 28, 48],  intensity: 0.85 },
    { anchor: 'steelman',     name: 'the-case',     accent: [111, 135, 184], deep: [8, 9, 17],   mid: [18, 22, 40],  intensity: 0.7 },
    { anchor: 'cracks',       name: 'the-cracks',   accent: [106, 158, 158], deep: [7, 12, 13],  mid: [16, 34, 34],  intensity: 0.75 },
    { anchor: 'pluribus',     name: 'the-joining',  accent: [212, 141, 184], deep: [13, 8, 14],  mid: [36, 18, 34],  intensity: 0.85 },
    { anchor: 'light-cone',   name: 'interlude',    accent: [212, 180, 106], deep: [11, 10, 10], mid: [32, 26, 16],  intensity: 0.65 },
    { anchor: 'the-forest',   name: 'the-forest',   accent: [212, 107, 107], deep: [8, 6, 8],    mid: [24, 12, 14],  intensity: 0.5 },
    { anchor: 'alternatives', name: 'taxonomy',     accent: [127, 90, 158],  deep: [9, 8, 15],   mid: [24, 18, 38],  intensity: 0.7 },
    { anchor: 'assessment',   name: 'assessment',   accent: [138, 164, 198], deep: [8, 9, 15],   mid: [20, 24, 40],  intensity: 0.7 },
    { anchor: 'your-beliefs', name: 'reflection',   accent: [158, 184, 212], deep: [8, 10, 14],  mid: [22, 28, 42],  intensity: 0.75 },
    { anchor: 'real-sky',     name: 'epilogue',     accent: [232, 217, 184], deep: [10, 10, 12], mid: [28, 26, 24],  intensity: 0.9 },
];

type Vec3 = [number, number, number];
type Listener = (deep: Vec3, mid: Vec3, accent: Vec3, intensity: number) => void;

const current = {
    accent: [138, 164, 198] as Vec3,
    deep: [9, 10, 18] as Vec3,
    mid: [22, 28, 48] as Vec3,
    intensity: 0.85,
};

let target = ACTS[0];
let listeners: Listener[] = [];
let rafId: number | null = null;
let settleFrames = 0;
let lastActName = '';

export function onActChange(fn: Listener): void {
    listeners.push(fn);
    fn(current.deep, current.mid, current.accent, current.intensity);
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function close3(a: Vec3, b: Vec3): boolean {
    return Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) < 0.5 && Math.abs(a[2] - b[2]) < 0.5;
}

function activeAct(): ActPalette {
    const mid = window.innerHeight * 0.45;
    let act = ACTS[0];
    for (const a of ACTS) {
        if (a.anchor === null) continue;
        const el = document.getElementById(a.anchor);
        if (el && el.getBoundingClientRect().top < mid) act = a;
    }
    return act;
}

function writeVars(): void {
    const root = document.documentElement.style;
    const [r, g, b] = current.accent.map(Math.round);
    root.setProperty('--act-accent', `rgb(${r}, ${g}, ${b})`);
    root.setProperty('--act-accent-rgb', `${r}, ${g}, ${b}`);
    const [dr, dg, db] = current.deep.map(Math.round);
    root.setProperty('--act-deep', `rgb(${dr}, ${dg}, ${db})`);
    const [mr, mg, mb] = current.mid.map(Math.round);
    root.setProperty('--act-mid-rgb', `${mr}, ${mg}, ${mb}`);
}

function tick(): void {
    rafId = null;
    const t = 0.045;
    current.accent = lerp3(current.accent, target.accent, t);
    current.deep = lerp3(current.deep, target.deep, t);
    current.mid = lerp3(current.mid, target.mid, t);
    current.intensity = lerp(current.intensity, target.intensity, t);

    writeVars();
    for (const fn of listeners) fn(current.deep, current.mid, current.accent, current.intensity);

    const settled = close3(current.accent, target.accent) && close3(current.mid, target.mid);
    if (!settled || settleFrames < 30) {
        settleFrames = settled ? settleFrames + 1 : 0;
        rafId = requestAnimationFrame(tick);
    }
}

function wake(): void {
    settleFrames = 0;
    if (rafId === null) rafId = requestAnimationFrame(tick);
}

function onScroll(): void {
    const act = activeAct();
    if (act.name !== lastActName) {
        lastActName = act.name;
        target = act;
        document.body.dataset.act = act.name;
    }
    wake();

    // Nav grows a floor once the hero is gone.
    document.body.classList.toggle('scrolled', window.scrollY > 60);
}

export function initActs(): void {
    writeVars();
    let pending = false;
    window.addEventListener('scroll', () => {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => { pending = false; onScroll(); });
    }, { passive: true });
    onScroll();
}
