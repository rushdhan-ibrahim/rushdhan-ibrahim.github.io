// Seeded RNG (mulberry32) — every run of The Forest is reproducible from its seed

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function randomSeed(): number {
    return (Math.random() * 0xFFFFFFFF) >>> 0;
}

/** Format a seed as the short "forest designation" shown to the reader. */
export function seedName(seed: number): string {
    return seed.toString(16).toUpperCase().padStart(8, '0').slice(-6);
}

export function pick<T>(rng: Rng, arr: T[]): T {
    return arr[Math.floor(rng() * arr.length)];
}

export function shuffled<T>(rng: Rng, arr: T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
