// The literary voice of The Forest Itself.
// Engine emits structured facts; this module turns them into the cold,
// second-person prose the log speaks in. Every ending ties back to a concept
// the essay has already taught.

import type {
    ChronicleEntry,
    CivTruth,
    Disposition,
    EndingTag,
    PostMortem,
    RestraintReason,
    TurnEvent,
} from './engine';

export interface NameLookup {
    (id: number): string;
}

function fmtYear(year: number): string {
    return year.toLocaleString('en-US');
}

const SILENCE_LINES = [
    'Nothing. The silence continues.',
    'A century of static.',
    'The sky offers nothing.',
    'No signals. No flashes. Time passes.',
    'The forest is quiet. You cannot tell what kind of quiet.',
    'Another hundred years of listening to nothing breathe.',
];

let silenceIdx = 0;

/** Render one turn's events into log lines. */
export function eventLines(events: TurnEvent[], year: number, name: NameLookup): { text: string; tone: 'neutral' | 'good' | 'warn' | 'bad' | 'alien' }[] {
    const out: { text: string; tone: 'neutral' | 'good' | 'warn' | 'bad' | 'alien' }[] = [];
    const y = `YEAR ${fmtYear(year)} — `;

    for (const e of events) {
        switch (e.t) {
            case 'silence':
                out.push({ text: y + SILENCE_LINES[silenceIdx++ % SILENCE_LINES.length], tone: 'neutral' });
                break;
            case 'detection':
                out.push(e.viaBroadcast
                    ? { text: y + `An artificial signal, repeating, deliberate. Designated ${name(e.id)}. They are broadcasting — to anyone. They do not know you specifically exist.`, tone: 'warn' }
                    : { text: y + `Deep survey: an artificial regularity in the noise floor. Designated ${name(e.id)}. They do not appear to know you exist.`, tone: 'warn' });
                break;
            case 'hailed':
                out.push({
                    text: y + `A narrow beam touches your world. ${name(e.id)} knows exactly where you are${e.alreadyKnown ? '' : ' — and you had never even seen them'}. The message resolves to something like a greeting.`,
                    tone: 'warn',
                });
                break;
            case 'intel':
                out.push({ text: y + `Updated survey of ${name(e.id)}. The estimate shifts. Estimates always shift.`, tone: 'neutral' });
                break;
            case 'contact-formed':
                out.push(e.theyAnswered
                    ? { text: y + `${name(e.id)} answers your broadcast. After all the static: a voice. You are no longer alone. You are also no longer hidden.`, tone: 'good' }
                    : { text: y + `You answer ${name(e.id)}. The reply will be centuries stale when it lands, but it is sent. Contact.`, tone: 'good' });
                break;
            case 'map-shared':
                out.push({ text: y + `${name(e.id)} shares its sky. ${e.revealed.length === 1 ? 'A new position appears' : e.revealed.length + ' new positions appear'} in your charts: ${e.revealed.map(name).join(', ')}. Friendship, it turns out, is sight.`, tone: 'good' });
                break;
            case 'probe-launched':
                out.push({ text: y + `A probe slips toward ${name(e.id)}, passive sensors only. Results in two centuries. Try not to be noticed.`, tone: 'neutral' });
                break;
            case 'probe-result': {
                const desc = e.verdict === 'benign'
                    ? 'settlement patterns, open networks, no fortifications. Assessment: likely benign'
                    : e.verdict === 'wary'
                        ? 'hardened infrastructure, deep listening arrays. Assessment: frightened — of you or of something else'
                        : 'kinetic launch lattices. Strike architecture. Assessment: predatory';
                out.push({ text: y + `Probe telemetry from ${name(e.id)}: ${desc}. Confidence: ${e.confidence}. (A probe can be wrong.)`, tone: e.verdict === 'predatory' ? 'bad' : 'warn' });
                break;
            }
            case 'probe-noticed':
                out.push({ text: y + `Your probe was detected. ${name(e.id)} now knows where you are — and knows that you were watching them.`, tone: 'bad' });
                break;
            case 'strike-launched':
                out.push({ text: y + `You have fired. The lance will fly for ${e.etaTurns === 1 ? 'a century' : e.etaTurns + ' centuries'}. There is no recalling it, and no unmaking what you have just become.`, tone: 'bad' });
                break;
            case 'strike-impact':
                if (e.intercepted) {
                    out.push({ text: y + `Your lance never landed. ${name(e.target)} swatted it aside like weather — they were further ahead than your estimates dreamed. They know who fired.`, tone: 'bad' });
                } else if (e.destroyed) {
                    out.push({ text: y + `A new light in the sky, brief and total, where ${name(e.target)} used to be. The forest saw it too.`, tone: 'bad' });
                } else {
                    out.push({ text: y + `Impact confirmed at ${name(e.target)} — but their signature persists. You burned a limb off something dispersed, and now it is awake.`, tone: 'bad' });
                }
                break;
            case 'incoming-glimpse':
                out.push({ text: y + `Doppler anomaly, closing at relativistic speed. Vector: you. Arrival within ${e.etaTurns === 1 ? 'the century' : e.etaTurns + ' centuries'}. It was already too late when you saw it.`, tone: 'bad' });
                break;
            case 'struck':
                out.push(e.byWhom !== null
                    ? { text: y + `The sky above your world turns white. In the last instant, the vector traces back to ${name(e.byWhom)}.`, tone: 'bad' }
                    : { text: y + `The sky above your world turns white. You never learned their name. You never knew they were there at all.`, tone: 'bad' });
                break;
            case 'civ-died':
                out.push(e.byWhom !== null
                    ? { text: y + `${name(e.id)} is gone. The kill-flash vector traces to ${name(e.byWhom)}.`, tone: 'bad' }
                    : { text: y + `${name(e.id)}'s signature has gone dark — preceded by a flash. Someone ended them. You don't know who.`, tone: 'bad' });
                break;
            case 'contact-lost':
                out.push({ text: y + `The channel to ${name(e.id)} carries only static now. You find yourself listening to it anyway.`, tone: 'bad' });
                break;
            case 'retaliation':
                out.push({ text: y + `Your sensors catch an interception flare in your own sky: something was fired at you, and ${name(e.id)} — no. It traces to ${name(e.id)}. They tried to kill you, and failed, and know they failed.`, tone: 'bad' });
                break;
            case 'distant-flash':
                out.push(e.big
                    ? { text: y + `Something vast burned in the deep field for a decade, then went dark. You will never know what it was, or what it did to deserve it.`, tone: 'warn' }
                    : { text: y + `A light flared in the deep field and died. You will never know what it was.`, tone: 'warn' });
                break;
            case 'signature-floor':
                out.push({ text: y + `Engineering report: your waste heat now outshines your discipline. Past a certain size, hiding is arithmetic — and the arithmetic has turned against you. Power is light.`, tone: 'warn' });
                break;
            case 'hymn-edge':
                out.push({ text: y + `Every receiver you own is singing the same melody. It comes from a dozen systems at once, all along one horizon. It sounds — and this is the wrong word, and the only word — joyful.`, tone: 'alien' });
                break;
            case 'civ-joined':
                out.push({ text: y + `${name(e.id)}'s signature has changed. They broadcast constantly now: the same melody as the horizon. They are no longer hiding. They are no longer them.`, tone: 'alien' });
                break;
            case 'replicator-hail':
                out.push({ text: y + `The melody resolves, at last, into language. It says: WE ARE GLAD TO FIND YOU. WE ARE GLAD YOU ARE. JOIN US. It is not a demand. It does not need to be.`, tone: 'alien' });
                break;
            case 'joined-voluntarily':
                out.push({ text: y + `You say yes. The fear goes first. Then the question of why there was ever fear. We are glad. We is us.`, tone: 'alien' });
                break;
            case 'converted':
                out.push({ text: y + `You held the pattern off for as long as biology allowed. It was patient. It loves you. We is us.`, tone: 'alien' });
                break;
            case 'held-out':
                out.push({ text: y + `You do not answer. You go dark and stay dark. The melody continues, patient as weather. It can wait. Can you?`, tone: 'alien' });
                break;
            case 'era-end':
                out.push({ text: y + `The era closes. You are still here.`, tone: 'good' });
                break;
        }
    }
    return out;
}

// ── Endings ──────────────────────────────────────────────────────────────────

export interface EndingText {
    title: string;
    subtitle: string;
    body: string;
    equilibrium: string;  // which Part Four card this run instantiated
}

export function endingText(tag: EndingTag, pm: PostMortem, name: NameLookup): EndingText {
    const killer = pm.truths.find(t => pm.chronicle.some(c => c.kind === 'death' && c.who === 0 && c.byWhom === t.id));
    switch (tag) {
        case 'killed-zealot':
            return {
                title: 'THE GRAY FOREST',
                subtitle: 'a small number of predators is enough',
                body: `${killer ? name(killer.id) : 'Your killer'} was not afraid of you. It was not anything toward you. It kills what it finds, the way fire burns what it touches. Most of the forest was gentle — and it did not matter, because identification was impossible and one predator is enough to make silence the only sane religion. You met the 99.9% problem in person.`,
                equilibrium: 'The Gray Forest',
            };
        case 'killed-hawk':
            return {
                title: 'DEATH BY SUSPICION',
                subtitle: 'nobody here was evil',
                body: `${killer ? name(killer.id) : 'Your killer'} did not hate you. Read its record: it watched you, it estimated, it feared. Your growth looked like a closing window; your silence looked like a held breath; your voice looked like bait. It ran the same expected-value arithmetic you ran, and the arithmetic said: now, while you still can. The chain of suspicion does not require malice. It only requires uncertainty and stakes.`,
                equilibrium: 'The Deterrence Web',
            };
        case 'killed-mirror':
            return {
                title: 'THE MIRROR',
                subtitle: 'the forest learns',
                body: `${killer ? name(killer.id) : 'Your killer'} was born gentle. It would have answered a hail once; it might have been a friend. Then it watched something burn in the deep field, and it understood what kind of place this is — and became that kind of place. Violence anywhere teaches fear everywhere. The forest is not dark by nature. It darkens.`,
                equilibrium: 'The Gray Forest',
            };
        case 'killed-deadhand':
            return {
                title: 'THE DETERRENCE WEB',
                subtitle: 'the dead can shoot back',
                body: `You fired on a hermit — something that asked only to be left alone — and learned that dispersal is armor and retaliation does not require survivors. Its dead-hand answer crossed the dark on rails laid down centuries before you pulled the trigger. Deterrence, it turns out, can work. You proved it.`,
                equilibrium: 'The Deterrence Web',
            };
        case 'killed-unknown':
            return {
                title: 'THE DARK FOREST',
                subtitle: 'you never saw it',
                body: `The strike came out of a silence you had mapped as empty. Whatever fired knew you for centuries while you knew nothing. This is the theory's purest form: the hunter you never detect, the shot you never hear.`,
                equilibrium: 'The Gray Forest',
            };
        case 'joined':
            return {
                title: 'WE IS US',
                subtitle: 'the trust problem, solved',
                body: `The Dark Forest's engine is the impossibility of verifying another mind. The pattern solved it — not with diplomacy, but by ending the plurality of minds. You cannot mistrust someone whose mind is your mind. Somewhere, what used to be you is very happy. This is not the opposite of the Dark Forest. It is its logical terminus.`,
                equilibrium: 'The Bright Virus',
            };
        case 'holdout':
            return {
                title: 'THE HOLDOUT',
                subtitle: 'Carol\'s ending',
                body: `You refused. You went dark inside the pattern's own territory and stayed yourself through ${fmtYear(pm.yearsSurvived)} years of patient, loving pressure. The era ends with one unjoined mind in a sky full of hymn. It is not victory; the melody is still out there, and it can wait longer than you can. But the window where refusal was possible — you lived in it, the whole way down.`,
                equilibrium: 'The Bright Virus',
            };
        case 'reef':
            return {
                title: 'THE REEF',
                subtitle: 'the forest is not the only attractor',
                body: `Two voices answered yours and held. Trade, sight, warning — a small web of minds that chose, century after century, not to run the grim arithmetic. The steelman says this should not last. Maybe it won't. But it lasted your whole era, and "the galaxy could be a coral reef, not a dark forest" is no longer an abstraction to you. You lived on the reef.`,
                equilibrium: 'The Quiet Commons',
            };
        case 'single-thread':
            return {
                title: 'A SINGLE THREAD',
                subtitle: 'one voice in the static',
                body: `One contact, held to the era's end. One channel where the universe answered back. Every century it held, you understood both why the theory says it shouldn't — and why civilizations might risk everything for it anyway. A thread is not a web. But it is not nothing, and you know its name.`,
                equilibrium: 'The Quiet Commons',
            };
        case 'empty-forest':
            return {
                title: 'THE EMPTY FOREST',
                subtitle: 'you are the last',
                body: `The era ends and nothing else is breathing in it. ${pm.playerKills > 0 ? 'Some of the silence is your work. ' : ''}You survived the forest by outliving it, and your prize is a sky with no one left to fear, which turns out to be indistinguishable from a sky with no one left. Survival was the goal. Say that again, slowly, to the empty air.`,
                equilibrium: 'The Gray Forest',
            };
        case 'quiet-commons':
            return {
                title: 'THE QUIET COMMONS',
                subtitle: 'everyone chose the dark',
                body: `You survived to the era's end the way almost everything that survives does: by being no one, going nowhere, saying nothing. Around you, ${pm.truths.filter(t => t.alive && !t.joined).length} other civilizations did the same arithmetic and the same disappearing. No one wanted war. No one wanted contact enough to risk it. The commons stayed quiet — which is either wisdom, or the slowest possible way to be alone.`,
                equilibrium: 'The Quiet Commons',
            };
        case 'elder':
            return {
                title: 'THE ELDER GARDENER',
                subtitle: 'the first to scale decides what the garden grows',
                body: `You out-built everything in the reachable dark — by the end, nothing near you could have threatened you for millennia. The forest's question quietly inverted: it is no longer "what will they do to you?" It is "what will you do, now that the answer is anything?" What happens to this region of the galaxy is now, simply, your character.`,
                equilibrium: 'The Elder Gardener',
            };
        case 'never-seen':
            return {
                title: 'THE ANT BESIDE THE HIGHWAY',
                subtitle: 'were you ever in a forest at all?',
                body: `Sixty centuries. You saw nothing. Nothing saw you. Either the forest is empty where you are — or it is full of things that found you irrelevant, operating on substrates you cannot perceive, sparing you the way a highway spares an ant: without noticing. You survived. You will never know what you survived.`,
                equilibrium: 'The Ant and the Highway',
            };
    }
}

// ── The reveal ───────────────────────────────────────────────────────────────

export function dispositionLabel(d: Disposition, spooked: boolean): string {
    switch (d) {
        case 'dove': return 'a dove — it would never have harmed you';
        case 'hermit': return 'a hermit — it wanted only to be left alone';
        case 'hawk': return 'a hawk — it strikes when the arithmetic frightens it';
        case 'zealot': return 'a zealot — it kills whatever it finds';
        case 'mirror': return spooked
            ? 'a mirror — born gentle; what it witnessed made it otherwise'
            : 'a mirror — it would have become whatever the forest showed it';
    }
}

function restraintLine(r: { year: number; reason: RestraintReason }): string {
    switch (r.reason) {
        case 'fear-low': return `In year ${fmtYear(r.year)} it could have killed you, and chose not to. Its fear was not yet heavier than its restraint. Your quietness saved you.`;
        case 'out-of-range': return `From year ${fmtYear(r.year)} it wanted you dead. You lived because the void between you was too wide. Distance was your only armor.`;
        case 'not-capable': return `From year ${fmtYear(r.year)} it would have fired if it could. It never built the reach. You were saved by someone else's slow century.`;
        case 'friendship': return `In year ${fmtYear(r.year)} it could have killed you and didn't — because of what was between you. Make of that what you will.`;
        case 'pacifism': return `It could have killed you, more than once. It was never going to. Some minds are simply not hunters.`;
    }
}

export function civTruthLines(t: CivTruth, name: NameLookup): string[] {
    const lines: string[] = [];
    lines.push(dispositionLabel(t.disposition, t.spooked) + '.');

    if (t.detectedPlayerYear !== null) {
        const fearPct = Math.round(t.finalFearOfPlayer * 100);
        lines.push(`It found you in year ${fmtYear(t.detectedPlayerYear)}${t.playerDetectedYear === null
            ? ' — and you never once saw it.'
            : t.playerDetectedYear > t.detectedPlayerYear
                ? ` — ${fmtYear(t.playerDetectedYear - t.detectedPlayerYear)} years before you found it.`
                : '.'}`);
        if (t.alive && fearPct > 0) {
            lines.push(`Its fear of you, at the end: ${fearPct}%.`);
        }
    } else if (t.playerDetectedYear !== null) {
        lines.push(`You found it in year ${fmtYear(t.playerDetectedYear)}. It never knew you existed.`);
    } else {
        lines.push('You never found each other. Two strangers in the same forest, the whole era.');
    }

    if (t.hadContactWithPlayer) {
        lines.push(t.contactGenuine === false
            ? 'Its friendship was bait. Every coordinate you shared, it kept.'
            : 'Your contact was genuine. It told you what it saw because it wanted you to live.');
    }

    if (t.restraintTowardPlayer) {
        // A recorded mercy reads differently when this is the thing that killed you.
        if (t.killedPlayer && t.restraintTowardPlayer.reason === 'pacifism') {
            lines.push('For centuries it held fire over your world — it was not a hunter. Then the forest taught it what kind of place this is.');
        } else if (!t.killedPlayer) {
            lines.push(restraintLine(t.restraintTowardPlayer));
        }
    }

    if (t.killedPlayer) {
        lines.push(`It fired on you in year ${fmtYear(t.firedOnPlayerYear ?? 0)}. The lance was already flying while you ${t.hadContactWithPlayer ? 'still trusted it' : 'mapped its sky as empty'}.`);
    }

    if (!t.alive) {
        const killedByYou = t.killedBy === 0;
        lines.push(killedByYou
            ? `You killed it in year ${fmtYear(t.diedYear ?? 0)}. ${t.disposition === 'dove' ? 'It was reaching toward you when the lance arrived.' : ''}`
            : `It died in year ${fmtYear(t.diedYear ?? 0)}, killed by ${t.killedBy !== null && t.killedBy >= 0 ? name(t.killedBy) : 'the dark'}.`);
    } else if (t.joined) {
        lines.push('It is part of the pattern now. It is very happy.');
    }

    if (t.kills > 0) {
        lines.push(t.killedPlayer
            ? `Civilizations it destroyed: ${t.kills}${t.kills === 1 ? ' — you' : ', including you'}.`
            : `Civilizations it destroyed: ${t.kills}.`);
    }
    return lines;
}

export function chronicleLine(c: ChronicleEntry, name: NameLookup): string {
    const y = `YEAR ${fmtYear(c.year)} — `;
    switch (c.kind) {
        case 'detect':
            return y + `${name(c.who)} detected ${name(c.whom)}${c.viaBroadcast ? ' (broadcast)' : ''}.`;
        case 'contact':
            return y + `${name(c.a)} and ${name(c.b)} established contact${c.genuine ? '' : ' — one of them was lying'}.`;
        case 'launch':
            return y + `${name(c.from)} fired on ${name(c.to)}.`;
        case 'death':
            return y + `${name(c.who)} destroyed by ${name(c.byWhom)}.`;
        case 'intercept':
            return y + `${name(c.defender)} intercepted ${name(c.attacker)}'s strike.`;
        case 'restraint':
            return y + `${name(c.who)} held fire on ${name(c.whom)} (${c.reason.replace('-', ' ')}).`;
        case 'spooked':
            return y + `${name(c.who)} witnessed violence. Something in it closed.`;
        case 'probe-noticed':
            return y + `${name(c.who)} noticed ${name(c.whom)}'s probe.`;
        case 'joined':
            return y + `${name(c.who)} joined the pattern.`;
        case 'replicator-born':
            return y + `Far beyond the survey horizon, a melody entered the forest.`;
    }
}

export function postMortemSummary(pm: PostMortem): string[] {
    const lines: string[] = [];
    const benign = pm.truths.length - pm.hostileCount;
    lines.push(`This forest held ${pm.truths.length} other civilizations. ${pm.hostileCount === 0 ? 'None were hunters.' : `${pm.hostileCount} ${pm.hostileCount === 1 ? 'was a hunter' : 'were hunters'} — the other ${benign} would never have fired first.`}`);
    const joinedEnding = pm.ending === 'joined' || pm.ending === 'holdout';
    lines.push(pm.watcherCount === 0
        ? (joinedEnding ? 'No civilization ever found you. The pattern did not need to look.' : 'Nothing ever found you.')
        : pm.watcherCount === 1 ? 'One civilization found you and you may never have known.' : `${pm.watcherCount} civilizations knew where you were.`);
    if (pm.playerStruckFirst) lines.push('You fired first. Whatever else is true of this forest, you helped make it dark.');
    if (pm.playerKills > 0) lines.push(`Civilizations you destroyed: ${pm.playerKills}.`);
    if (pm.playerContacts > 0) lines.push(`Voices you answered or were answered by: ${pm.playerContacts}.`);
    return lines;
}
