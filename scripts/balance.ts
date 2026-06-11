// Headless balance harness for The Forest Itself.
// Runs many seeded games under fixed policies and prints outcome distributions.
// The forest's logic should match the essay's: broadcasting is dangerous,
// hiding mostly works (until your own light betrays you), contact is
// achievable but risky, and striking first invites the night to notice you.
//
// Run: npx esbuild scripts/balance.ts --bundle --format=esm --platform=node \
//        --outfile=/tmp/df-balance.mjs && node /tmp/df-balance.mjs

import {
    createGame,
    applyPlayerAction,
    getPlayerView,
    buildPostMortem,
    type PlayerAction,
    type PlayerView,
    type GameState,
    type TurnEvent,
} from '../src/game/engine';

type Policy = (view: PlayerView, turn: number, events: TurnEvent[]) => PlayerAction;

const policies: Record<string, Policy> = {
    alwaysHide: (view) => {
        if (view.pendingHail) return { kind: 'refuse' };
        return { kind: 'hide' };
    },

    alwaysBroadcast: (view) => {
        if (view.pendingHail) return { kind: 'refuse' };
        return { kind: 'broadcast' };
    },

    quietGrowth: (view, turn) => {
        if (view.pendingHail) return { kind: 'refuse' };
        return turn % 3 === 0 ? { kind: 'listen' } : { kind: 'grow' };
    },

    contactSeeker: (view, turn) => {
        if (view.pendingHail) return { kind: 'refuse' };
        const hailing = view.contacts.find(c => c.isBroadcasting && !c.contact && c.alive && !c.joined);
        if (hailing) return { kind: 'answer', target: hailing.id };
        const haveContact = view.contacts.some(c => c.contact && c.alive);
        if (haveContact) return turn % 4 === 0 ? { kind: 'listen' } : { kind: 'grow' };
        return turn % 3 === 0 ? { kind: 'broadcast' } : { kind: 'listen' };
    },

    hunter: (view, turn) => {
        if (view.pendingHail) return { kind: 'refuse' };
        const target = view.contacts.find(c => c.canStrike);
        if (target && view.strikeCapable) return { kind: 'strike', target: target.id };
        return turn % 2 === 0 ? { kind: 'listen' } : { kind: 'grow' };
    },

    cautiousReader: (view, turn, events) => {
        // A plausible thoughtful first playthrough: listen, probe what you find,
        // answer the benign and the friendly, hide from the predatory.
        if (view.pendingHail) return { kind: 'refuse' };
        const hailedBy = events.find(e => e.t === 'hailed');
        if (hailedBy && hailedBy.t === 'hailed') {
            const c = view.contacts.find(c => c.id === hailedBy.id);
            if (c && c.verdict !== 'predatory' && !c.contact) return { kind: 'answer', target: c.id };
        }
        const unprobed = view.contacts.find(c => c.canProbe && c.verdict === null && c.alive && !c.joined);
        if (unprobed && view.probePending === null) return { kind: 'probe', target: unprobed.id };
        const benignHailing = view.contacts.find(c => c.isBroadcasting && !c.contact && c.verdict === 'benign');
        if (benignHailing) return { kind: 'answer', target: benignHailing.id };
        const predatorKnown = view.contacts.some(c => c.verdict === 'predatory' && c.alive && !c.joined);
        if (predatorKnown) return { kind: 'hide' };
        return turn % 3 === 0 ? { kind: 'listen' } : { kind: 'grow' };
    },
};

interface RunStats {
    survived: number;
    endings: Record<string, number>;
    deathYears: number[];
    contactsTotal: number;
    watchersAtEnd: number[];
    hostileCounts: number[];
    replicatorRuns: number;
    avgTurnsToFirstDetection: number[];
}

function runOne(seed: number, policy: Policy): { state: GameState; turns: number } {
    const state = createGame(seed);
    let turns = 0;
    let lastEvents: TurnEvent[] = [];
    while (!state.over && turns < 200) {
        const view = getPlayerView(state);
        const action = policy(view, state.turn, lastEvents);
        lastEvents = applyPlayerAction(state, action).events;
        turns++;
    }
    return { state, turns };
}

function runPolicy(name: string, policy: Policy, n: number): RunStats {
    const stats: RunStats = {
        survived: 0, endings: {}, deathYears: [], contactsTotal: 0,
        watchersAtEnd: [], hostileCounts: [], replicatorRuns: 0,
        avgTurnsToFirstDetection: [],
    };
    for (let i = 0; i < n; i++) {
        const seed = 1000 + i * 7919; // deterministic spread
        const { state } = runOne(seed, policy);
        const pm = buildPostMortem(state);
        stats.endings[pm.ending] = (stats.endings[pm.ending] ?? 0) + 1;
        const died = pm.ending.startsWith('killed');
        if (!died && pm.ending !== 'joined') stats.survived++;
        if (died) stats.deathYears.push(pm.yearsSurvived);
        stats.contactsTotal += pm.playerContacts;
        stats.watchersAtEnd.push(pm.watcherCount);
        stats.hostileCounts.push(pm.hostileCount);
        if (state.replicator) stats.replicatorRuns++;
        const firstDet = state.chronicle.find(c => c.kind === 'detect' && c.who === 0);
        if (firstDet) stats.avgTurnsToFirstDetection.push(firstDet.year / 100);
    }
    return stats;
}

function median(a: number[]): number {
    if (a.length === 0) return 0;
    const s = a.slice().sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
}

function avg(a: number[]): number {
    return a.length === 0 ? 0 : a.reduce((x, y) => x + y, 0) / a.length;
}

const N = 300;
console.log(`The Forest Itself — balance sweep, ${N} forests per policy\n`);

for (const [name, policy] of Object.entries(policies)) {
    const s = runPolicy(name, policy, N);
    const endingsStr = Object.entries(s.endings)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}:${((v / N) * 100).toFixed(0)}%`)
        .join('  ');
    console.log(`── ${name}`);
    console.log(`   survival ${(s.survived / N * 100).toFixed(1)}%   median death year ${median(s.deathYears)}   contacts/run ${(s.contactsTotal / N).toFixed(2)}`);
    console.log(`   watchers at end avg ${avg(s.watchersAtEnd).toFixed(1)}   hostile civs avg ${avg(s.hostileCounts).toFixed(1)}   replicator ${(s.replicatorRuns / N * 100).toFixed(0)}%`);
    console.log(`   first detection of another: turn ${avg(s.avgTurnsToFirstDetection).toFixed(1)} (${(s.avgTurnsToFirstDetection.length / N * 100).toFixed(0)}% of runs)`);
    console.log(`   endings: ${endingsStr}\n`);
}
