// Cross-run memory for The Forest Itself.
// The reader's own record across forests becomes the essay's evidence.

import { saveData, loadData } from '../utils/persistence';
import type { EndingTag, PostMortem } from './engine';

const KEY = 'forest-runs';
const MAX_RUNS = 60;

export interface RunRecord {
    seed: string;
    ending: EndingTag;
    years: number;
    struckFirst: boolean;
    kills: number;
    contacts: number;
}

export function recordRun(pm: PostMortem): RunRecord[] {
    const runs = loadData<RunRecord[]>(KEY) ?? [];
    runs.push({
        seed: pm.seedName,
        ending: pm.ending,
        years: pm.yearsSurvived,
        struckFirst: pm.playerStruckFirst,
        kills: pm.playerKills,
        contacts: pm.playerContacts,
    });
    while (runs.length > MAX_RUNS) runs.shift();
    saveData(KEY, runs);
    return runs;
}

export function getRuns(): RunRecord[] {
    return loadData<RunRecord[]>(KEY) ?? [];
}

/** "Across your forests" — the reader's own behavioral record, narrated. */
export function recordLines(runs: RunRecord[]): string[] {
    if (runs.length < 2) return [];
    const n = runs.length;
    const died = runs.filter(r => r.ending.startsWith('killed')).length;
    const joined = runs.filter(r => r.ending === 'joined').length;
    const firedFirst = runs.filter(r => r.struckFirst).length;
    const contacts = runs.reduce((s, r) => s + r.contacts, 0);
    const kills = runs.reduce((s, r) => s + r.kills, 0);
    const reefs = runs.filter(r => r.ending === 'reef' || r.ending === 'single-thread').length;

    const lines: string[] = [];
    lines.push(`You have entered ${n} forests.`);
    if (died > 0) lines.push(`In ${died} of them, something killed you.`);
    if (joined > 0) lines.push(`In ${joined}, you became part of the pattern.`);
    if (firedFirst > 0) {
        lines.push(`You fired first in ${firedFirst} ${firedFirst === 1 ? 'forest' : 'forests'}${kills > 0 ? `, destroying ${kills} ${kills === 1 ? 'civilization' : 'civilizations'}` : ''}. Remember what you concluded about the kind of thing that fires first.`);
    } else {
        lines.push(`You have never fired first. Not once. Hold on to what that cost you — and what it didn't.`);
    }
    if (contacts > 0) lines.push(`Voices answered across all your forests: ${contacts}.`);
    if (reefs > 0) lines.push(`${reefs === 1 ? 'Once, you' : `${reefs} times, you`} found something like friendship and kept it to the end of an era.`);
    return lines;
}
