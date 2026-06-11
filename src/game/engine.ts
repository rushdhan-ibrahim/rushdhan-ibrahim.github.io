// The Forest Itself — pure simulation engine
//
// No DOM, no audio, no rendering. Every observable the UI shows must come
// through getPlayerView() / TurnResult so fog of war is enforced in one place.
// All randomness flows through the seeded RNG: a seed fully determines a forest.

import { mulberry32, randomSeed, seedName, shuffled, type Rng } from './rng';

// ── Types ────────────────────────────────────────────────────────────────────

export type Disposition = 'dove' | 'hermit' | 'hawk' | 'zealot' | 'mirror';
export type Posture = 'hide' | 'grow' | 'listen' | 'broadcast';

export type PlayerAction =
    | { kind: 'hide' }
    | { kind: 'grow' }
    | { kind: 'listen' }
    | { kind: 'broadcast' }
    | { kind: 'probe'; target: number }
    | { kind: 'strike'; target: number }
    | { kind: 'answer'; target: number }
    | { kind: 'join' }
    | { kind: 'refuse' };

export interface Knowledge {
    detected: boolean;
    detectedYear: number;
    /** Noisy estimate of the other's tech, refreshed on listen turns. */
    estTech: number;
    estTechYear: number;
    prevEstTech: number;
    fear: number;            // 0..1
    contact: boolean;        // open friendly channel
    contactYear: number;
    /** They know that I know where they are (reflexive suspicion). */
    knowsMe: boolean;
}

export interface Civ {
    id: number;              // 0 = the player
    name: string;
    x: number;               // light-years
    y: number;
    alive: boolean;
    joined: boolean;         // absorbed by the replicator
    disposition: Disposition | 'player';
    /** Mirrors flip to hawk behaviour after witnessing violence. */
    spooked: boolean;
    tech: number;
    posture: Posture;
    signature: number;       // recomputed each turn
    knowledge: Map<number, Knowledge>;
    witnessedViolence: number;
    lastWitnessYear: number;
    struckFirst: boolean;
    kills: number;
    diedYear: number | null;
    killedBy: number | null; // civ id, or -1 for the replicator
    joinedYear: number | null;
    contacts: number;        // live contact count (growth bonus)
    /** Set when this civ first held fire on a target it could have killed. */
    restraint: Map<number, { year: number; reason: RestraintReason }>;
}

export type RestraintReason = 'fear-low' | 'out-of-range' | 'not-capable' | 'friendship' | 'pacifism';

export interface Strike {
    id: number;
    from: number;
    to: number;
    launchYear: number;
    arriveYear: number;
    fromX: number; fromY: number;
    toX: number; toY: number;
    resolved: boolean;
}

export interface Replicator {
    active: boolean;
    x: number;
    y: number;
    radius: number;          // expanding front, light-years
    arrivedTurn: number;
    hailedPlayer: boolean;
    playerRefused: boolean;
}

/** Player-visible events for one turn (fog of war already applied). */
export type TurnEvent =
    | { t: 'detection'; id: number; viaBroadcast: boolean }
    | { t: 'hailed'; id: number; alreadyKnown: boolean }
    | { t: 'intel'; id: number }
    | { t: 'contact-formed'; id: number; theyAnswered: boolean }
    | { t: 'map-shared'; id: number; revealed: number[] }
    | { t: 'probe-launched'; id: number }
    | { t: 'probe-result'; id: number; verdict: 'benign' | 'wary' | 'predatory'; confidence: 'high' | 'moderate' }
    | { t: 'probe-noticed'; id: number }
    | { t: 'strike-launched'; target: number; etaTurns: number }
    | { t: 'strike-impact'; target: number; destroyed: boolean; intercepted: boolean }
    | { t: 'incoming-glimpse'; etaTurns: number }
    | { t: 'struck'; byWhom: number | null }
    | { t: 'civ-died'; id: number; byWhom: number | null }
    | { t: 'distant-flash'; x: number; y: number; big: boolean }
    | { t: 'retaliation'; id: number }
    | { t: 'signature-floor'; }
    | { t: 'contact-lost'; id: number }
    | { t: 'hymn-edge' }
    | { t: 'civ-joined'; id: number }
    | { t: 'replicator-hail' }
    | { t: 'joined-voluntarily' }
    | { t: 'converted' }
    | { t: 'held-out' }
    | { t: 'era-end' }
    | { t: 'silence' };

/** Hidden signals: things that happened TO the player that the player cannot
 *  see. The UI may use them only for ambience (the watched-tone), never text. */
export interface SecretSignals {
    newWatcher: boolean;     // someone detected the player this turn
    watcherCount: number;    // how many civs currently know the player's position
    huntersAiming: number;   // watchers whose fear of the player is past half
}

export interface TurnResult {
    events: TurnEvent[];
    secret: SecretSignals;
    over: boolean;
}

// God's-eye chronicle for the post-mortem reveal.
export type ChronicleEntry =
    | { year: number; kind: 'detect'; who: number; whom: number; viaBroadcast: boolean; visible: boolean }
    | { year: number; kind: 'contact'; a: number; b: number; genuine: boolean; visible: boolean }
    | { year: number; kind: 'launch'; from: number; to: number; visible: boolean }
    | { year: number; kind: 'death'; who: number; byWhom: number; visible: boolean }
    | { year: number; kind: 'intercept'; attacker: number; defender: number; visible: boolean }
    | { year: number; kind: 'restraint'; who: number; whom: number; reason: RestraintReason; visible: boolean }
    | { year: number; kind: 'spooked'; who: number; visible: boolean }
    | { year: number; kind: 'probe-noticed'; who: number; whom: number; visible: boolean }
    | { year: number; kind: 'joined'; who: number; visible: boolean }
    | { year: number; kind: 'replicator-born'; x: number; y: number; visible: boolean };

export type EndingTag =
    | 'killed-zealot' | 'killed-hawk' | 'killed-mirror' | 'killed-deadhand' | 'killed-unknown'
    | 'joined' | 'holdout'
    | 'reef' | 'single-thread' | 'empty-forest' | 'quiet-commons' | 'elder' | 'never-seen';

export interface PendingProbe {
    target: number;
    resolveTurn: number;
}

export interface GameState {
    seed: number;
    rng: Rng;
    turn: number;            // 1 turn = 100 years
    year: number;
    civs: Civ[];
    strikes: Strike[];
    nextStrikeId: number;
    replicator: Replicator | null;
    replicatorTurn: number | null;  // when (if ever) the signal enters this forest
    pendingProbe: PendingProbe | null;
    pendingHail: boolean;    // replicator front reached player; must answer
    over: boolean;
    ending: EndingTag | null;
    chronicle: ChronicleEntry[];
    /** Flashes the player witnessed but could not explain, for the reveal. */
    unexplainedFlashes: { year: number; x: number; y: number }[];
    playerEverDetected: boolean;     // did the player ever detect anyone
    signatureFloorWarned: boolean;
    /** Inbound strike ids the player has glimpsed. */
    glimpsed: Set<number>;
    /** Probe verdicts shown to the player (kept so the view can re-render them). */
    verdicts: Map<number, 'benign' | 'wary' | 'predatory'>;
}

// ── Tuning constants ─────────────────────────────────────────────────────────

export const MAP_W = 1000;
export const MAP_H = 620;
export const YEARS_PER_TURN = 100;
export const ERA_TURNS = 60;                 // survive to year 6,000
export const N_AI = 9;
export const STRIKE_SPEED_LY_PER_TURN = 50;  // relativistic kill vehicles, 0.5c
export const STRIKE_MAX_RANGE = 600;
export const STRIKE_TECH_MIN = 1.6;
const MIN_SPAWN_DIST = 130;

const GROWTH: Record<Posture, number> = {
    grow: 1.045,
    listen: 1.035,
    broadcast: 1.038,
    hide: 1.022,
};
const CONTACT_GROWTH_BONUS = 1.012;

const SIG: Record<Posture, number> = {
    hide: 0.12,
    listen: 0.35,
    grow: 0.5,
    broadcast: 2.6,
};
const SIG_PROBE = 0.45;
// Thermodynamic floor: advanced civilizations glow no matter what they do.
const SIG_TECH_FLOOR_RATE = 0.07;
const SIG_TECH_FLOOR_CAP = 0.6;

const LISTEN_FACTOR: Record<Posture, number> = {
    listen: 1.0,
    hide: 0.45,
    grow: 0.35,
    broadcast: 0.3,
};

const DETECT_BASE = 0.30;
const DETECT_RANGE = 460;
/** Broadcasts carry: a deliberate signal is heard far beyond a waste-heat glow. */
const BROADCAST_RANGE = 700;
/** Weapon flashes are the brightest things in the forest. */
const FLASH_RANGE = 700;
const LAUNCH_FLASH = 2.2;
const IMPACT_FLASH = 3.5;

const PROBE_TURNS = 2;
const PROBE_ACCURACY = 0.75;
const PROBE_NOTICE = 0.2;

const INTERCEPT_TECH_RATIO = 1.4;  // defender this much ahead → strike intercepted
const HERMIT_DISPERSAL_SURVIVAL = 0.35;

const REPLICATOR_CHANCE = 0.12;
const REPLICATOR_SPEED = 28;       // front expansion, ly per turn
const REPLICATOR_CONVERT_P = 0.25; // per-turn conversion roll inside the front
const REPLICATOR_CONVERT_P_HIDING = 0.12;

const AI_NAMES = ['KAPPA', 'SIGMA', 'THETA', 'DELTA', 'OMICRON', 'EPSILON', 'TAU', 'LAMBDA', 'ZETA', 'RHO', 'IOTA', 'UPSILON'];

// ── Construction ─────────────────────────────────────────────────────────────

function emptyKnowledge(): Knowledge {
    return {
        detected: false, detectedYear: 0,
        estTech: 1, estTechYear: 0, prevEstTech: 1,
        fear: 0, contact: false, contactYear: 0, knowsMe: false,
    };
}

function makeCiv(id: number, name: string, x: number, y: number, disposition: Disposition | 'player', tech: number): Civ {
    return {
        id, name, x, y,
        alive: true, joined: false,
        disposition, spooked: false,
        tech, posture: 'hide', signature: SIG.hide,
        knowledge: new Map(),
        witnessedViolence: 0, lastWitnessYear: -10000, struckFirst: false, kills: 0,
        diedYear: null, killedBy: null, joinedYear: null,
        contacts: 0,
        restraint: new Map(),
    };
}

/** Disposition mix is itself randomized per run: the reader can never learn
 *  "the" distribution, only distributions. (The 99.9% problem, mechanized.) */
function rollDispositions(rng: Rng): Disposition[] {
    const out: Disposition[] = [];
    // Guarantee texture: at least one dove, at least one watcher of some kind.
    out.push('dove');
    out.push('hermit');
    const weights: [Disposition, number][] = [
        ['dove', 0.30 + rng() * 0.12],
        ['hermit', 0.2 + rng() * 0.1],
        ['mirror', 0.18 + rng() * 0.1],
        ['hawk', 0.10 + rng() * 0.08],
        ['zealot', 0.04 + rng() * 0.05],
    ];
    const total = weights.reduce((s, [, w]) => s + w, 0);
    while (out.length < N_AI) {
        let r = rng() * total;
        for (const [d, w] of weights) {
            r -= w;
            if (r <= 0) { out.push(d); break; }
        }
    }
    return shuffled(rng, out);
}

export function createGame(seed?: number): GameState {
    const s = seed === undefined ? randomSeed() : seed >>> 0;
    const rng = mulberry32(s);

    const civs: Civ[] = [];
    // The player wakes somewhere in the middle third: neighbours guaranteed.
    const px = MAP_W * (0.33 + rng() * 0.34);
    const py = MAP_H * (0.3 + rng() * 0.4);
    civs.push(makeCiv(0, 'YOU', px, py, 'player', 1.0));

    const names = shuffled(rng, AI_NAMES).slice(0, N_AI);
    const dispositions = rollDispositions(rng);

    for (let i = 0; i < N_AI; i++) {
        let x = 0, y = 0, ok = false, tries = 0;
        while (!ok && tries < 200) {
            x = 40 + rng() * (MAP_W - 80);
            y = 36 + rng() * (MAP_H - 72);
            ok = civs.every(c => dist(c.x, c.y, x, y) >= MIN_SPAWN_DIST);
            tries++;
        }
        // Some are older than you, some younger: tech 0.7–1.45
        const tech = 0.7 + rng() * 0.75;
        civs.push(makeCiv(i + 1, names[i], x, y, dispositions[i], tech));
    }

    for (const a of civs) {
        for (const b of civs) {
            if (a.id !== b.id) a.knowledge.set(b.id, emptyKnowledge());
        }
    }

    return {
        seed: s, rng,
        turn: 0, year: 0,
        civs, strikes: [], nextStrikeId: 1,
        replicator: null,
        replicatorTurn: rng() < REPLICATOR_CHANCE ? 18 + Math.floor(rng() * 13) : null,
        pendingProbe: null, pendingHail: false,
        over: false, ending: null,
        chronicle: [],
        unexplainedFlashes: [],
        playerEverDetected: false,
        signatureFloorWarned: false,
        glimpsed: new Set(),
        verdicts: new Map(),
    };
}

// ── Geometry helpers ─────────────────────────────────────────────────────────

export function dist(x1: number, y1: number, x2: number, y2: number): number {
    return Math.hypot(x2 - x1, y2 - y1);
}

function proximity(d: number, range: number = DETECT_RANGE): number {
    return Math.pow(Math.max(0, 1 - d / range), 1.8);
}

function signatureFor(civ: Civ, posture: Posture, probing: boolean): number {
    const base = probing ? SIG_PROBE : SIG[posture];
    const floor = Math.min(SIG_TECH_FLOOR_CAP, Math.max(0, (civ.tech - 1) * SIG_TECH_FLOOR_RATE));
    return Math.max(base, floor);
}

function detectionP(observer: Civ, targetSig: number, d: number): number {
    const range = targetSig >= 1.5 ? BROADCAST_RANGE : DETECT_RANGE;
    return Math.min(0.92, LISTEN_FACTOR[observer.posture] * targetSig * proximity(d, range) * DETECT_BASE);
}

export function strikeTravelTurns(d: number): number {
    return Math.max(1, Math.ceil(d / STRIKE_SPEED_LY_PER_TURN));
}

export function canStrike(attacker: Civ, target: Civ): boolean {
    return attacker.tech >= STRIKE_TECH_MIN &&
        dist(attacker.x, attacker.y, target.x, target.y) <= STRIKE_MAX_RANGE;
}

// ── AI decisions ─────────────────────────────────────────────────────────────

interface AiDecision {
    posture: Posture;
    strikeTarget: number | null;
}

function effectiveDisposition(civ: Civ): Disposition {
    if (civ.disposition === 'player') return 'dove'; // unused
    if (civ.disposition === 'mirror') return civ.spooked ? 'hawk' : 'dove';
    return civ.disposition;
}

function aiKnownTargets(state: GameState, civ: Civ): Civ[] {
    const out: Civ[] = [];
    for (const other of state.civs) {
        if (other.id === civ.id || !other.alive || other.joined) continue;
        const k = civ.knowledge.get(other.id)!;
        if (k.detected) out.push(other);
    }
    return out;
}

function recordRestraint(state: GameState, civ: Civ, target: Civ, reason: RestraintReason): void {
    if (!civ.restraint.has(target.id)) {
        civ.restraint.set(target.id, { year: state.year, reason });
        state.chronicle.push({ year: state.year, kind: 'restraint', who: civ.id, whom: target.id, reason, visible: false });
    }
}

function decideAI(state: GameState, civ: Civ): AiDecision {
    const rng = state.rng;
    const disp = effectiveDisposition(civ);
    const known = aiKnownTargets(state, civ);

    if (disp === 'zealot') {
        // Predators: scan, close enough kill anything they can.
        const inRange = known.filter(t => canStrike(civ, t));
        if (inRange.length > 0) {
            inRange.sort((a, b) => dist(civ.x, civ.y, a.x, a.y) - dist(civ.x, civ.y, b.x, b.y));
            return { posture: 'listen', strikeTarget: inRange[0].id };
        }
        for (const t of known) {
            recordRestraint(state, civ, t, civ.tech >= STRIKE_TECH_MIN ? 'out-of-range' : 'not-capable');
        }
        return { posture: civ.tech < 1.3 ? 'hide' : 'listen', strikeTarget: null };
    }

    if (disp === 'hawk') {
        for (const t of known) {
            const k = civ.knowledge.get(t.id)!;
            // Threat margin sits above estimate noise so hawks aren't trigger-happy
            // about phantoms — but a baited "friend" is watched on a hair trigger.
            const growthThreat = k.estTech > civ.tech * (k.contact ? 1.2 : 1.35);
            const fearThreat = k.fear > (k.contact ? 0.45 : 0.6);
            if (fearThreat || growthThreat) {
                if (canStrike(civ, t)) {
                    return { posture: 'hide', strikeTarget: t.id };
                }
                recordRestraint(state, civ, t, civ.tech >= STRIKE_TECH_MIN ? 'out-of-range' : 'not-capable');
            } else if (canStrike(civ, t)) {
                recordRestraint(state, civ, t, k.contact ? 'friendship' : 'fear-low');
            }
        }
        // Fear arms: a frightened hawk builds weapons before it hides.
        const anyFear = known.some(t => civ.knowledge.get(t.id)!.fear > 0.3);
        if (anyFear) return { posture: civ.tech < STRIKE_TECH_MIN ? 'grow' : 'hide', strikeTarget: null };
        return { posture: 'listen', strikeTarget: null };
    }

    if (disp === 'hermit') {
        // Dead-hand retaliation only: handled in fear update (killedBy memory).
        for (const t of known) {
            if (canStrike(civ, t)) recordRestraint(state, civ, t, 'pacifism');
        }
        return { posture: 'hide', strikeTarget: null };
    }

    // Doves (and unspooked mirrors)
    for (const t of known) {
        if (canStrike(civ, t)) recordRestraint(state, civ, t, 'pacifism');
    }
    // Violence silences a dove for centuries — but memory fades.
    if (state.year - civ.lastWitnessYear < 800) {
        return { posture: 'hide', strikeTarget: null };
    }
    const maxFear = known.reduce((m, t) => Math.max(m, civ.knowledge.get(t.id)!.fear), 0);
    if (maxFear > 0.45) return { posture: 'hide', strikeTarget: null };
    if (civ.contacts > 0) return { posture: rng() < 0.6 ? 'grow' : 'listen', strikeTarget: null };
    if (maxFear < 0.25 && rng() < 0.28) return { posture: 'broadcast', strikeTarget: null };
    return { posture: rng() < 0.55 ? 'listen' : 'grow', strikeTarget: null };
}

// ── Contact formation ────────────────────────────────────────────────────────

/** A listener who detects a broadcaster may answer. Genuine for doves and
 *  unspooked mirrors; hawks answer too — and the friendship is bait. */
function maybeAnswerBroadcast(state: GameState, listener: Civ, broadcaster: Civ, events: TurnEvent[]): void {
    if (listener.disposition === 'player' || !listener.alive || listener.joined) return;
    const disp = effectiveDisposition(listener);
    const willAnswer =
        (disp === 'dove' && state.year - listener.lastWitnessYear > 800 && state.rng() < 0.6) ||
        (disp === 'hawk' && state.rng() < 0.45);
    if (!willAnswer) return;

    const genuine = disp === 'dove';
    formContact(state, listener, broadcaster, genuine);

    if (broadcaster.id === 0) {
        events.push({ t: 'contact-formed', id: listener.id, theyAnswered: true });
        shareMap(state, listener, broadcaster, events);
    }
}

function formContact(state: GameState, a: Civ, b: Civ, genuine: boolean): void {
    const ka = a.knowledge.get(b.id)!;
    const kb = b.knowledge.get(a.id)!;
    // Answering reveals yourself: contact is mutual knowledge by definition.
    if (!ka.detected) { ka.detected = true; ka.detectedYear = state.year; ka.estTech = b.tech; }
    if (!kb.detected) {
        kb.detected = true; kb.detectedYear = state.year; kb.estTech = a.tech;
        if (b.id !== 0 && a.id === 0) state.playerEverDetected = true;
    }
    ka.contact = true; ka.contactYear = state.year;
    kb.contact = true; kb.contactYear = state.year;
    ka.knowsMe = true; kb.knowsMe = true;
    if (genuine) { ka.fear = Math.max(0, ka.fear - 0.3); kb.fear = Math.max(0, kb.fear - 0.3); }
    a.contacts++; b.contacts++;
    state.chronicle.push({ year: state.year, kind: 'contact', a: a.id, b: b.id, genuine, visible: a.id === 0 || b.id === 0 });
}

/** Cooperation's real treasure is sight: contacts pool their maps. */
function shareMap(state: GameState, giver: Civ, receiver: Civ, events: TurnEvent[]): void {
    const revealed: number[] = [];
    for (const [id, k] of giver.knowledge) {
        if (!k.detected || id === receiver.id) continue;
        const rk = receiver.knowledge.get(id)!;
        if (!rk.detected) {
            rk.detected = true;
            rk.detectedYear = state.year;
            rk.estTech = k.estTech;
            revealed.push(id);
            if (receiver.id === 0) state.playerEverDetected = true;
        }
    }
    if (receiver.id === 0 && revealed.length > 0) {
        events.push({ t: 'map-shared', id: giver.id, revealed });
    }
}

// ── Fear dynamics ────────────────────────────────────────────────────────────

function bumpFear(k: Knowledge, amount: number): void {
    k.fear = Math.min(1, k.fear + amount);
}

function updateFears(state: GameState): void {
    for (const civ of state.civs) {
        if (!civ.alive || civ.joined || civ.disposition === 'player') continue;
        for (const other of state.civs) {
            if (other.id === civ.id) continue;
            const k = civ.knowledge.get(other.id)!;
            if (!k.detected || !other.alive) continue;

            // The technological explosion problem: visible growth is menace.
            if (k.estTech > k.prevEstTech * 1.08 && k.estTechYear > k.detectedYear) {
                bumpFear(k, 0.06);
            }
            // A voice that will not stop is escalating provocation: naive prey,
            // or bait. Either reading frightens; hawks most of all.
            if (other.posture === 'broadcast' && !other.joined) {
                bumpFear(k, effectiveDisposition(civ) === 'hawk' ? 0.06 : 0.02);
            }
            // "B knows A knows": being known is itself dangerous.
            if (k.knowsMe && !k.contact) bumpFear(k, 0.015);
            // Contact soothes — unless the partner pulls far ahead,
            // and never fully for a hawk, whose suspicion does not sleep.
            if (k.contact) {
                if (k.estTech > civ.tech * 2.0) bumpFear(k, 0.04);
                else if (effectiveDisposition(civ) === 'hawk') bumpFear(k, 0.012);
                else k.fear = Math.max(0, k.fear - 0.02);
            }
            // Time, absent provocation, soothes a little.
            k.fear = Math.max(0, k.fear - 0.012);
        }
    }
}

/** Every civ that plausibly sees a flash learns fear from it. */
function witnessFlash(state: GameState, x: number, y: number, strength: number, events: TurnEvent[], aggressor: number | null): void {
    for (const civ of state.civs) {
        if (!civ.alive || civ.joined) continue;
        const d = dist(civ.x, civ.y, x, y);
        const p = Math.min(0.95, LISTEN_FACTOR[civ.posture] * strength * proximity(d, FLASH_RANGE) * DETECT_BASE * 1.6);
        if (state.rng() >= p) continue;

        if (civ.disposition === 'player') {
            events.push({ t: 'distant-flash', x, y, big: strength >= IMPACT_FLASH });
            state.unexplainedFlashes.push({ year: state.year, x, y });
            continue;
        }
        civ.witnessedViolence++;
        civ.lastWitnessYear = state.year;
        if (civ.disposition === 'mirror' && !civ.spooked) {
            civ.spooked = true;
            state.chronicle.push({ year: state.year, kind: 'spooked', who: civ.id, visible: false });
        }
        // Generalized dread: everyone known becomes a little more frightening.
        for (const [, k] of civ.knowledge) {
            if (k.detected) bumpFear(k, 0.07);
        }
        // If the flash betrays the aggressor's position, the witness now has it.
        if (aggressor !== null && aggressor !== civ.id) {
            const agg = state.civs[aggressor];
            if (agg.alive) {
                const ka = civ.knowledge.get(aggressor)!;
                if (!ka.detected && state.rng() < 0.45) {
                    ka.detected = true;
                    ka.detectedYear = state.year;
                    ka.estTech = agg.tech * (0.85 + state.rng() * 0.3);
                    bumpFear(ka, 0.35);
                    state.chronicle.push({ year: state.year, kind: 'detect', who: civ.id, whom: aggressor, viaBroadcast: false, visible: false });
                }
            }
        }
    }
}

// ── The turn ─────────────────────────────────────────────────────────────────

export function applyPlayerAction(state: GameState, action: PlayerAction): TurnResult {
    const events: TurnEvent[] = [];
    const secret: SecretSignals = { newWatcher: false, watcherCount: 0, huntersAiming: 0 };
    if (state.over) return { events, secret, over: true };

    const player = state.civs[0];

    // Replicator hail must be answered before time moves again.
    if (state.pendingHail && action.kind !== 'join' && action.kind !== 'refuse') {
        return { events, secret, over: false };
    }

    state.turn++;
    state.year = state.turn * YEARS_PER_TURN;

    // 1 — Player action
    let playerPosture: Posture = 'grow';
    let playerProbing = false;
    switch (action.kind) {
        case 'hide': playerPosture = 'hide'; break;
        case 'grow': playerPosture = 'grow'; break;
        case 'listen': playerPosture = 'listen'; break;
        case 'broadcast': playerPosture = 'broadcast'; break;
        case 'probe': {
            playerPosture = 'listen';
            playerProbing = true;
            state.pendingProbe = { target: action.target, resolveTurn: state.turn + PROBE_TURNS };
            events.push({ t: 'probe-launched', id: action.target });
            break;
        }
        case 'answer': {
            playerPosture = 'broadcast';
            const target = state.civs[action.target];
            if (target?.alive && !target.joined) {
                const disp = effectiveDisposition(target);
                const genuine = disp === 'dove' || disp === 'hermit';
                formContact(state, player, target, genuine);
                events.push({ t: 'contact-formed', id: target.id, theyAnswered: false });
                if (genuine) shareMap(state, target, player, events);
            }
            break;
        }
        case 'strike': {
            playerPosture = 'hide';
            const target = state.civs[action.target];
            if (target?.alive && canStrike(player, target)) {
                launchStrike(state, player, target, events);
            }
            break;
        }
        case 'join': {
            state.pendingHail = false;
            player.joined = true;
            player.joinedYear = state.year;
            state.chronicle.push({ year: state.year, kind: 'joined', who: 0, visible: true });
            events.push({ t: 'joined-voluntarily' });
            endGame(state, 'joined');
            return { events, secret, over: true };
        }
        case 'refuse': {
            state.pendingHail = false;
            if (state.replicator) state.replicator.playerRefused = true;
            events.push({ t: 'held-out' });
            playerPosture = 'hide';
            break;
        }
    }
    player.posture = playerPosture;
    player.signature = signatureFor(player, playerPosture, playerProbing);

    // One-time warning when your own light outgrows your ability to dim it.
    if (!state.signatureFloorWarned && (player.tech - 1) * SIG_TECH_FLOOR_RATE > SIG.hide) {
        state.signatureFloorWarned = true;
        events.push({ t: 'signature-floor' });
    }

    // 2 — AI decisions (postures + strikes)
    for (const civ of state.civs) {
        if (civ.id === 0 || !civ.alive || civ.joined) continue;
        const decision = decideAI(state, civ);
        civ.posture = decision.posture;
        civ.signature = signatureFor(civ, decision.posture, false);
        if (decision.strikeTarget !== null) {
            const target = state.civs[decision.strikeTarget];
            if (target.alive) launchStrike(state, civ, target, events);
        }
        // A calm dove that has quietly watched you for a while may point a
        // beam at your world and say hello. Being hailed is also being found.
        if (civ.posture === 'broadcast' && effectiveDisposition(civ) === 'dove') {
            const kThem = civ.knowledge.get(0)!;
            const kMine = player.knowledge.get(civ.id)!;
            if (kThem.detected && kThem.fear < 0.15 && !kMine.contact && state.rng() < 0.4) {
                const alreadyKnown = kMine.detected;
                if (!kMine.detected) {
                    kMine.detected = true;
                    kMine.detectedYear = state.year;
                    kMine.estTech = civ.tech * (0.85 + state.rng() * 0.3);
                    kMine.estTechYear = state.year;
                    kMine.prevEstTech = kMine.estTech;
                    state.playerEverDetected = true;
                    state.chronicle.push({ year: state.year, kind: 'detect', who: 0, whom: civ.id, viaBroadcast: true, visible: true });
                }
                events.push({ t: 'hailed', id: civ.id, alreadyKnown });
            }
        }
    }

    // 3 — Strikes in flight resolve on arrival
    resolveStrikes(state, events);
    if (state.over) return { events, secret, over: true };

    // 4 — Growth
    for (const civ of state.civs) {
        if (!civ.alive || civ.joined) continue;
        let g = GROWTH[civ.posture];
        for (let c = 0; c < Math.min(civ.contacts, 3); c++) g *= CONTACT_GROWTH_BONUS;
        civ.tech *= g;
    }

    // 5 — Detection sweep (ordered pairs)
    runDetection(state, events, secret);

    // 6 — Probe resolution
    if (state.pendingProbe && state.turn >= state.pendingProbe.resolveTurn) {
        resolveProbe(state, events);
    }

    // 6.5 — Living contacts keep sharing what they see (genuine partners only;
    // a hawk's friendship takes intelligence and returns none).
    for (const giver of state.civs) {
        if (giver.id === 0 || !giver.alive || giver.joined) continue;
        const gd = effectiveDisposition(giver);
        const shares = gd === 'dove' || gd === 'hermit';
        if (!shares) continue;
        for (const receiver of state.civs) {
            if (receiver.id === giver.id || !receiver.alive || receiver.joined) continue;
            const k = giver.knowledge.get(receiver.id)!;
            if (k.contact && state.rng() < 0.4) {
                shareMap(state, giver, receiver, events);
            }
        }
    }

    // 7 — Replicator
    stepReplicator(state, events);
    if (state.over) return { events, secret, over: true };

    // 8 — Fear evolves
    updateFears(state);

    // 9 — Secret signals for ambience
    let watchers = 0, hunters = 0;
    for (const civ of state.civs) {
        if (civ.id === 0 || !civ.alive || civ.joined) continue;
        const k = civ.knowledge.get(0)!;
        if (k.detected) {
            watchers++;
            if (k.fear > 0.5) hunters++;
        }
    }
    secret.watcherCount = watchers;
    secret.huntersAiming = hunters;

    // 10 — Era end
    if (state.turn >= ERA_TURNS && !state.over) {
        events.push({ t: 'era-end' });
        endGame(state, computeSurvivalEnding(state));
        return { events, secret, over: true };
    }

    if (events.length === 0) events.push({ t: 'silence' });
    return { events, secret, over: state.over };
}

function launchStrike(state: GameState, from: Civ, to: Civ, events: TurnEvent[]): void {
    const d = dist(from.x, from.y, to.x, to.y);
    const travel = strikeTravelTurns(d);
    state.strikes.push({
        id: state.nextStrikeId++,
        from: from.id, to: to.id,
        launchYear: state.year,
        arriveYear: state.year + travel * YEARS_PER_TURN,
        fromX: from.x, fromY: from.y, toX: to.x, toY: to.y,
        resolved: false,
    });
    if (!from.struckFirst && !wasStruckBy(state, from.id)) from.struckFirst = true;
    state.chronicle.push({ year: state.year, kind: 'launch', from: from.id, to: to.id, visible: from.id === 0 });

    if (from.id === 0) {
        events.push({ t: 'strike-launched', target: to.id, etaTurns: travel });
    }
    // The muzzle flash: launches are visible events.
    witnessFlash(state, from.x, from.y, LAUNCH_FLASH, events, from.id);
}

function wasStruckBy(state: GameState, civId: number): boolean {
    return state.strikes.some(s => s.to === civId && s.resolved);
}

function resolveStrikes(state: GameState, events: TurnEvent[]): void {
    for (const strike of state.strikes) {
        if (strike.resolved || strike.arriveYear > state.year) continue;
        strike.resolved = true;

        const attacker = state.civs[strike.from];
        const defender = state.civs[strike.to];
        if (!defender.alive) continue; // someone else got there first

        // A sufficiently superior target swats the lance aside — and now knows you.
        if (defender.tech > attacker.tech * INTERCEPT_TECH_RATIO && !defender.joined) {
            const k = defender.knowledge.get(attacker.id)!;
            k.detected = true;
            k.detectedYear = state.year;
            k.estTech = attacker.tech;
            k.fear = 1;
            k.knowsMe = true;
            state.chronicle.push({ year: state.year, kind: 'intercept', attacker: attacker.id, defender: defender.id, visible: strike.from === 0 || strike.to === 0 });
            if (strike.from === 0) {
                events.push({ t: 'strike-impact', target: strike.to, destroyed: false, intercepted: true });
            }
            if (strike.to === 0) {
                // The player never learns of intercepted strikes they never saw coming —
                // but an interception of an attack on YOU is unmistakable.
                events.push({ t: 'retaliation', id: strike.from });
            }
            continue;
        }

        // Hermits are dispersed: sometimes the strike kills a shell, not the civ.
        if (defender.disposition === 'hermit' && !defender.joined && state.rng() < HERMIT_DISPERSAL_SURVIVAL) {
            const k = defender.knowledge.get(attacker.id)!;
            k.detected = true; k.detectedYear = state.year;
            k.estTech = attacker.tech; k.fear = 1; k.knowsMe = true;
            // Dead-hand answer: immediate, unhesitating, exempt from range limits.
            const d = dist(defender.x, defender.y, attacker.x, attacker.y);
            state.strikes.push({
                id: state.nextStrikeId++,
                from: defender.id, to: attacker.id,
                launchYear: state.year,
                arriveYear: state.year + strikeTravelTurns(d) * YEARS_PER_TURN,
                fromX: defender.x, fromY: defender.y, toX: attacker.x, toY: attacker.y,
                resolved: false,
            });
            state.chronicle.push({ year: state.year, kind: 'launch', from: defender.id, to: attacker.id, visible: false });
            witnessFlash(state, defender.x, defender.y, LAUNCH_FLASH, events, defender.id);
            if (strike.from === 0) {
                events.push({ t: 'strike-impact', target: strike.to, destroyed: false, intercepted: false });
            }
            continue;
        }

        // Impact.
        defender.alive = false;
        defender.diedYear = state.year;
        defender.killedBy = attacker.id;
        attacker.kills++;
        state.chronicle.push({ year: state.year, kind: 'death', who: defender.id, byWhom: attacker.id, visible: strike.to === 0 });

        if (strike.to === 0) {
            const playerK = state.civs[0].knowledge.get(attacker.id)!;
            events.push({ t: 'struck', byWhom: playerK.detected ? attacker.id : null });
            endGame(state, endingForKiller(attacker));
            return;
        }
        if (strike.from === 0) {
            events.push({ t: 'strike-impact', target: strike.to, destroyed: true, intercepted: false });
        } else {
            const playerK = state.civs[0].knowledge.get(defender.id)!;
            if (playerK.detected) {
                events.push({ t: 'civ-died', id: defender.id, byWhom: state.civs[0].knowledge.get(attacker.id)!.detected ? attacker.id : null });
                if (playerK.contact) events.push({ t: 'contact-lost', id: defender.id });
            }
        }
        // Death of a contact ends its growth blessing.
        for (const civ of state.civs) {
            const k = civ.knowledge.get(defender.id);
            if (k?.contact) { k.contact = false; civ.contacts = Math.max(0, civ.contacts - 1); }
        }
        witnessFlash(state, defender.x, defender.y, IMPACT_FLASH, events, attacker.id);
    }
    state.strikes = state.strikes.filter(s => !s.resolved || s.arriveYear >= state.year - 200);
}

function runDetection(state: GameState, events: TurnEvent[], secret: SecretSignals): void {
    const player = state.civs[0];
    for (const observer of state.civs) {
        if (!observer.alive || observer.joined) continue;
        for (const target of state.civs) {
            if (target.id === observer.id || !target.alive || target.joined) continue;
            const k = observer.knowledge.get(target.id)!;
            const d = dist(observer.x, observer.y, target.x, target.y);

            if (k.detected) {
                // Fresh intel on a listen turn: estimates update (with noise).
                if (observer.posture === 'listen' && state.rng() < 0.6) {
                    k.prevEstTech = k.estTech;
                    k.estTech = target.tech * (0.8 + state.rng() * 0.4);
                    k.estTechYear = state.year;
                    if (observer.id === 0 && state.rng() < 0.35) {
                        events.push({ t: 'intel', id: target.id });
                    }
                }
                // A broadcaster may be answered even by those who found it long ago.
                if (target.posture === 'broadcast' && !k.contact && state.rng() < 0.2) {
                    maybeAnswerBroadcast(state, observer, target, events);
                }
                continue;
            }

            const p = detectionP(observer, target.signature, d);
            if (state.rng() >= p) continue;

            k.detected = true;
            k.detectedYear = state.year;
            k.estTech = target.tech * (0.75 + state.rng() * 0.5);
            k.estTechYear = state.year;
            k.prevEstTech = k.estTech;
            const viaBroadcast = target.posture === 'broadcast';
            state.chronicle.push({ year: state.year, kind: 'detect', who: observer.id, whom: target.id, viaBroadcast, visible: observer.id === 0 });

            if (observer.id === 0) {
                state.playerEverDetected = true;
                events.push({ t: 'detection', id: target.id, viaBroadcast });
            } else if (target.id === 0) {
                secret.newWatcher = true;
                // First sight of a stranger carries its own fear. To a hawk, a
                // deliberate broadcast reads as either naive or bait — both alarming.
                bumpFear(k, viaBroadcast ? 0.08 : 0.12);
                if (viaBroadcast && effectiveDisposition(observer) === 'hawk') bumpFear(k, 0.2);
                if (effectiveDisposition(observer) === 'zealot') bumpFear(k, 0.3);
            } else {
                bumpFear(k, 0.1);
            }

            // A broadcaster may receive an answer.
            if (viaBroadcast) maybeAnswerBroadcast(state, observer, target, events);

            // Glimpse of inbound death: a listening player may see it coming.
            if (observer.id === 0) checkIncomingGlimpse(state, events);
        }
    }

    // Even without new detections, a listening player may glimpse inbound strikes.
    if (player.posture === 'listen') checkIncomingGlimpse(state, events);
}

function checkIncomingGlimpse(state: GameState, events: TurnEvent[]): void {
    for (const s of state.strikes) {
        if (s.resolved || s.to !== 0 || state.glimpsed.has(s.id)) continue;
        const turnsLeft = Math.ceil((s.arriveYear - state.year) / YEARS_PER_TURN);
        if (turnsLeft <= 2 && state.civs[0].posture === 'listen' && state.rng() < 0.5) {
            state.glimpsed.add(s.id);
            events.push({ t: 'incoming-glimpse', etaTurns: turnsLeft });
        }
    }
}

function resolveProbe(state: GameState, events: TurnEvent[]): void {
    const probe = state.pendingProbe!;
    state.pendingProbe = null;
    const target = state.civs[probe.target];
    if (!target.alive || target.joined) return;

    const trueBucket = bucketFor(effectiveDisposition(target));
    const accurate = state.rng() < PROBE_ACCURACY;
    let verdict: 'benign' | 'wary' | 'predatory' = trueBucket;
    if (!accurate) {
        const others: ('benign' | 'wary' | 'predatory')[] = ['benign', 'wary', 'predatory'].filter(b => b !== trueBucket) as ('benign' | 'wary' | 'predatory')[];
        verdict = others[Math.floor(state.rng() * others.length)];
    }
    events.push({
        t: 'probe-result',
        id: target.id,
        verdict,
        confidence: state.rng() < 0.5 ? 'moderate' : 'high',
    });

    if (state.rng() < PROBE_NOTICE) {
        const k = target.knowledge.get(0)!;
        if (!k.detected) {
            k.detected = true;
            k.detectedYear = state.year;
            k.estTech = state.civs[0].tech * (0.8 + state.rng() * 0.4);
        }
        k.knowsMe = true;
        bumpFear(k, 0.3);
        state.chronicle.push({ year: state.year, kind: 'probe-noticed', who: target.id, whom: 0, visible: true });
        events.push({ t: 'probe-noticed', id: target.id });
    }
}

function bucketFor(d: Disposition): 'benign' | 'wary' | 'predatory' {
    if (d === 'dove' || d === 'hermit') return 'benign';
    if (d === 'mirror') return 'wary';
    return 'predatory';
}

// ── Replicator: the Bright Virus ─────────────────────────────────────────────

function stepReplicator(state: GameState, events: TurnEvent[]): void {
    if (!state.replicator) {
        if (state.replicatorTurn !== null && state.turn >= state.replicatorTurn) {
            const rng = state.rng;
            const edge = Math.floor(rng() * 4);
            const x = edge === 0 ? 0 : edge === 1 ? MAP_W : rng() * MAP_W;
            const y = edge === 2 ? 0 : edge === 3 ? MAP_H : rng() * MAP_H;
            state.replicator = { active: true, x, y, radius: 30, arrivedTurn: state.turn, hailedPlayer: false, playerRefused: false };
            state.chronicle.push({ year: state.year, kind: 'replicator-born', x, y, visible: false });
        }
        return;
    }

    const rep = state.replicator;
    rep.radius += REPLICATOR_SPEED;
    // Broadcasters call to it: the front leans toward the loudest voice.
    const loud = state.civs.filter(c => c.alive && !c.joined && c.posture === 'broadcast');
    if (loud.length > 0) rep.radius += 9;

    // Announce the hymn once the front is plausibly audible to the player.
    const player = state.civs[0];
    const dToFront = dist(player.x, player.y, rep.x, rep.y) - rep.radius;
    if (!rep.hailedPlayer && dToFront < 320 && !events.some(e => e.t === 'hymn-edge') && !state.chronicle.some(c => c.kind === 'replicator-born' && c.visible)) {
        // Mark visible the first time the player could hear it.
        const born = state.chronicle.find(c => c.kind === 'replicator-born');
        if (born) born.visible = true;
        events.push({ t: 'hymn-edge' });
    }

    for (const civ of state.civs) {
        if (!civ.alive || civ.joined) continue;
        const inside = dist(civ.x, civ.y, rep.x, rep.y) <= rep.radius;
        if (!inside) continue;

        if (civ.id === 0) {
            if (!rep.hailedPlayer) {
                rep.hailedPlayer = true;
                state.pendingHail = true;
                events.push({ t: 'replicator-hail' });
            } else if (rep.playerRefused) {
                const p = civ.posture === 'hide' ? REPLICATOR_CONVERT_P_HIDING : REPLICATOR_CONVERT_P;
                if (state.rng() < p) {
                    civ.joined = true;
                    civ.joinedYear = state.year;
                    state.chronicle.push({ year: state.year, kind: 'joined', who: 0, visible: true });
                    events.push({ t: 'converted' });
                    endGame(state, 'joined');
                    return;
                }
            }
        } else {
            // The Others do not fight. They welcome.
            if (state.rng() < 0.55) {
                civ.joined = true;
                civ.joinedYear = state.year;
                civ.posture = 'broadcast';
                civ.signature = SIG.broadcast * 0.8;
                state.chronicle.push({ year: state.year, kind: 'joined', who: civ.id, visible: state.civs[0].knowledge.get(civ.id)!.detected });
                if (state.civs[0].knowledge.get(civ.id)!.detected) {
                    events.push({ t: 'civ-joined', id: civ.id });
                }
                // A joined civ becomes a new center of the pattern.
                const dCenter = dist(civ.x, civ.y, rep.x, rep.y);
                if (dCenter > rep.radius * 0.6) rep.radius = Math.max(rep.radius, dCenter + 40);
            }
        }
    }
}

// ── Endings ──────────────────────────────────────────────────────────────────

function endingForKiller(killer: Civ): EndingTag {
    const d = effectiveDisposition(killer);
    if (killer.disposition === 'hermit') return 'killed-deadhand';
    if (d === 'zealot') return 'killed-zealot';
    if (killer.disposition === 'mirror') return 'killed-mirror';
    return 'killed-hawk';
}

function computeSurvivalEnding(state: GameState): EndingTag {
    const player = state.civs[0];
    const others = state.civs.filter(c => c.id !== 0);
    const aliveOthers = others.filter(c => c.alive && !c.joined);
    const liveContacts = aliveOthers.filter(c => player.knowledge.get(c.id)!.contact).length;

    if (state.replicator?.playerRefused && !player.joined) return 'holdout';
    if (liveContacts >= 2) return 'reef';
    if (liveContacts === 1) return 'single-thread';
    if (aliveOthers.length === 0) return 'empty-forest';
    if (!state.playerEverDetected && !state.civs.some(c => c.id !== 0 && c.knowledge.get(0)!.detected)) return 'never-seen';
    if (aliveOthers.every(c => player.tech > c.tech * 2)) return 'elder';
    return 'quiet-commons';
}

function endGame(state: GameState, ending: EndingTag): void {
    state.over = true;
    state.ending = ending;
}

// ── Player view (fog of war) ─────────────────────────────────────────────────

export interface ContactView {
    id: number;
    name: string;
    x: number;
    y: number;
    distance: number;
    detectedYear: number;
    estTechBand: 1 | 2 | 3 | 4 | 5;     // banded uncertainty, never exact
    estTechTrend: 'rising' | 'steady' | 'unknown';
    signatureBand: 'dark' | 'faint' | 'bright' | 'blazing';
    contact: boolean;
    isBroadcasting: boolean;
    alive: boolean;
    joined: boolean;
    diedYear: number | null;
    canStrike: boolean;
    strikeEta: number;
    canProbe: boolean;
    verdict: 'benign' | 'wary' | 'predatory' | null;
}

export interface PlayerView {
    seed: number;
    turn: number;
    year: number;
    eraTurns: number;
    alive: boolean;
    joined: boolean;
    over: boolean;
    ending: EndingTag | null;
    tech: number;
    techBand: number;        // 0..1 of a soft cap, for the bar
    signature: number;       // 0..1 normalized for the bar
    signatureFloored: boolean;
    posture: Posture;
    x: number;
    y: number;
    contacts: ContactView[];
    strikesOut: { toX: number; toY: number; fromX: number; fromY: number; progress: number }[];
    /** Inbound strikes the player has glimpsed (and only those). */
    strikesInGlimpsed: { progress: number }[];
    flashes: { year: number; x: number; y: number }[];
    replicatorFront: { x: number; y: number; radius: number } | null;
    pendingHail: boolean;
    probePending: number | null;
    canStrikeAnyone: boolean;
    strikeCapable: boolean;  // tech threshold reached
}

export function noteVerdict(state: GameState, civId: number, verdict: 'benign' | 'wary' | 'predatory'): void {
    state.verdicts.set(civId, verdict);
}

export function getPlayerView(state: GameState): PlayerView {
    const player = state.civs[0];
    const contacts: ContactView[] = [];

    for (const civ of state.civs) {
        if (civ.id === 0) continue;
        const k = player.knowledge.get(civ.id)!;
        if (!k.detected) continue;
        const d = dist(player.x, player.y, civ.x, civ.y);
        const band = Math.min(5, Math.max(1, Math.ceil((k.estTech / Math.max(player.tech, 0.001)) * 2.5))) as 1 | 2 | 3 | 4 | 5;
        contacts.push({
            id: civ.id,
            name: civ.name,
            x: civ.x, y: civ.y,
            distance: Math.round(d),
            detectedYear: k.detectedYear,
            estTechBand: band,
            estTechTrend: k.estTechYear > k.detectedYear
                ? (k.estTech > k.prevEstTech * 1.04 ? 'rising' : 'steady')
                : 'unknown',
            signatureBand: !civ.alive ? 'dark'
                : civ.signature < 0.25 ? 'dark'
                : civ.signature < 0.6 ? 'faint'
                : civ.signature < 1.5 ? 'bright' : 'blazing',
            contact: k.contact,
            isBroadcasting: civ.alive && !civ.joined && civ.posture === 'broadcast',
            alive: civ.alive,
            joined: civ.joined,
            diedYear: civ.diedYear,
            canStrike: civ.alive && !civ.joined && canStrike(player, civ),
            strikeEta: strikeTravelTurns(d),
            canProbe: civ.alive && !civ.joined && state.pendingProbe === null,
            verdict: state.verdicts.get(civ.id) ?? null,
        });
    }
    contacts.sort((a, b) => a.detectedYear - b.detectedYear);

    const strikesOut = state.strikes
        .filter(s => !s.resolved && s.from === 0)
        .map(s => ({
            fromX: s.fromX, fromY: s.fromY, toX: s.toX, toY: s.toY,
            progress: Math.min(1, (state.year - s.launchYear) / (s.arriveYear - s.launchYear)),
        }));

    const strikesInGlimpsed = state.strikes
        .filter(s => !s.resolved && s.to === 0 && state.glimpsed.has(s.id))
        .map(s => ({ progress: Math.min(1, (state.year - s.launchYear) / (s.arriveYear - s.launchYear)) }));

    const sigFloor = Math.min(SIG_TECH_FLOOR_CAP, Math.max(0, (player.tech - 1) * SIG_TECH_FLOOR_RATE));

    return {
        seed: state.seed,
        turn: state.turn,
        year: state.year,
        eraTurns: ERA_TURNS,
        alive: player.alive,
        joined: player.joined,
        over: state.over,
        ending: state.ending,
        tech: player.tech,
        techBand: Math.min(1, Math.log(player.tech) / Math.log(16)),
        signature: Math.min(1, player.signature / 2.6),
        signatureFloored: sigFloor > SIG.hide,
        posture: player.posture,
        x: player.x, y: player.y,
        contacts,
        strikesOut,
        strikesInGlimpsed,
        flashes: state.unexplainedFlashes.slice(-6),
        replicatorFront: state.replicator?.active
            ? { x: state.replicator.x, y: state.replicator.y, radius: state.replicator.radius }
            : null,
        pendingHail: state.pendingHail,
        probePending: state.pendingProbe?.target ?? null,
        canStrikeAnyone: contacts.some(c => c.canStrike),
        strikeCapable: player.tech >= STRIKE_TECH_MIN,
    };
}

// ── Post-mortem: the reveal ──────────────────────────────────────────────────

export interface CivTruth {
    id: number;
    name: string;
    x: number;
    y: number;
    disposition: Disposition;
    spooked: boolean;
    alive: boolean;
    joined: boolean;
    diedYear: number | null;
    killedBy: number | null;
    kills: number;
    killedPlayer: boolean;
    firedOnPlayerYear: number | null;
    detectedPlayerYear: number | null;
    finalFearOfPlayer: number;
    playerDetectedYear: number | null;
    hadContactWithPlayer: boolean;
    contactGenuine: boolean | null;
    restraintTowardPlayer: { year: number; reason: RestraintReason } | null;
}

export interface PostMortem {
    seed: number;
    seedName: string;
    ending: EndingTag;
    yearsSurvived: number;
    truths: CivTruth[];
    chronicle: ChronicleEntry[];
    playerStruckFirst: boolean;
    playerKills: number;
    playerContacts: number;
    hostileCount: number;     // how many civs were actually predatory
    watcherCount: number;     // how many had found the player
}

export function buildPostMortem(state: GameState): PostMortem {
    const player = state.civs[0];
    const truths: CivTruth[] = [];

    for (const civ of state.civs) {
        if (civ.id === 0) continue;
        const theirK = civ.knowledge.get(0)!;
        const myK = player.knowledge.get(civ.id)!;
        const contactEntry = state.chronicle.find(
            (c): c is Extract<ChronicleEntry, { kind: 'contact' }> =>
                c.kind === 'contact' && ((c.a === 0 && c.b === civ.id) || (c.a === civ.id && c.b === 0))
        );
        const launchAtPlayer = state.chronicle.find(
            (c): c is Extract<ChronicleEntry, { kind: 'launch' }> =>
                c.kind === 'launch' && c.from === civ.id && c.to === 0
        );
        truths.push({
            id: civ.id,
            name: civ.name,
            x: civ.x, y: civ.y,
            disposition: civ.disposition as Disposition,
            spooked: civ.spooked,
            alive: civ.alive,
            joined: civ.joined,
            diedYear: civ.diedYear,
            killedBy: civ.killedBy,
            kills: civ.kills,
            killedPlayer: player.killedBy === civ.id,
            firedOnPlayerYear: launchAtPlayer?.year ?? null,
            detectedPlayerYear: theirK.detected ? theirK.detectedYear : null,
            finalFearOfPlayer: theirK.fear,
            playerDetectedYear: myK.detected ? myK.detectedYear : null,
            hadContactWithPlayer: myK.contact || (contactEntry !== undefined),
            contactGenuine: contactEntry ? contactEntry.genuine : null,
            restraintTowardPlayer: civ.restraint.get(0) ?? null,
        });
    }

    const hostile = truths.filter(t => t.disposition === 'hawk' || t.disposition === 'zealot' || (t.disposition === 'mirror' && t.spooked)).length;
    const watchers = truths.filter(t => t.detectedPlayerYear !== null).length;

    return {
        seed: state.seed,
        seedName: seedName(state.seed),
        ending: state.ending ?? 'quiet-commons',
        yearsSurvived: state.year,
        truths,
        chronicle: state.chronicle,
        playerStruckFirst: player.struckFirst,
        playerKills: player.kills,
        playerContacts: truths.filter(t => t.hadContactWithPlayer).length,
        hostileCount: hostile,
        watcherCount: watchers,
    };
}
