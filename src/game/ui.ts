// The Forest Itself — UI orchestration.
// Owns the DOM inside #forest-game-container, drives the engine one century
// per click, narrates events into the log, and runs the post-mortem reveal.

import {
    createGame,
    applyPlayerAction,
    getPlayerView,
    buildPostMortem,
    noteVerdict,
    ERA_TURNS,
    MAP_W,
    type GameState,
    type PlayerAction,
    type PlayerView,
    type PostMortem,
    type TurnEvent,
} from './engine';
import { seedName } from './rng';
import { eventLines, endingText, civTruthLines, chronicleLine, postMortemSummary } from './narrative';
import { ForestRenderer } from './render';
import { recordRun, getRuns, recordLines } from './stats';
import {
    fgDetection, fgHailed, fgContact, fgBroadcast, fgProbe,
    fgStrikeLaunch, fgDistantImpact, fgHymn, fgDeath, fgSurvived,
    fgUpdateWatched, stopWatched,
} from '../audio/forest-game';
import { haptics } from '../haptics';
import { observeVisibility } from '../utils/visibility';

let game: GameState | null = null;
let renderer: ForestRenderer | null = null;
let container: HTMLElement | null = null;
let selectedId: number | null = null;
let everStarted = false;
let strikeArmed = false;
let resetArmed = false;
let hymnPlayedThisTurn = false;

interface Els {
    stage: HTMLElement;
    canvas: HTMLCanvasElement;
    year: HTMLElement;
    eraFill: HTMLElement;
    techFill: HTMLElement;
    sigFill: HTMLElement;
    sigLabel: HTMLElement;
    actions: HTMLElement;
    hint: HTMLElement;
    context: HTMLElement;
    contacts: HTMLElement;
    log: HTMLElement;
    overlay: HTMLElement;
    hud: HTMLElement;
}
let els: Els | null = null;

const ACTION_HINTS: Record<string, string> = {
    hide: 'Suppress your signature. Slowest growth. Past a certain size, even silence glows.',
    grow: 'Develop. Brighter than hiding — capability is the only door some choices have.',
    listen: 'Deep survey. The best chance to find what is out there, and to see death coming.',
    broadcast: 'Speak into the dark. Heard far beyond your normal glow. Doves answer. Other things take note.',
    probe: 'Passive flyby, two centuries. Roughly three times in four, the verdict is true. It may be noticed.',
    answer: 'Reply to their signal. Contact: shared growth, shared sky — and they will know exactly where you are.',
    strike: 'Irrevocable. The lance flies for centuries, and the launch is a flash the whole forest can read.',
};

function fmt(n: number): string {
    return n.toLocaleString('en-US');
}

function nameOf(id: number): string {
    if (id === 0) return 'YOU';
    return game?.civs[id]?.name ?? `CIV-${id}`;
}

// ── DOM construction ─────────────────────────────────────────────────────────

function buildDOM(root: HTMLElement): Els {
    root.innerHTML = `
        <div class="fg-stage">
            <canvas class="fg-canvas" role="img" aria-label="Map of your region of the galaxy"></canvas>
        </div>
        <div class="fg-hud">
            <div class="fg-statusbar">
                <div class="fg-yearwrap">
                    <span class="fg-year">YEAR 0</span>
                    <div class="fg-era-track"><div class="fg-era-fill"></div></div>
                </div>
                <div class="fg-meters">
                    <div class="fg-meter">
                        <label>capability</label>
                        <div class="fg-track"><div class="fg-fill fg-tech"></div></div>
                    </div>
                    <div class="fg-meter">
                        <label class="fg-sig-label">signature</label>
                        <div class="fg-track"><div class="fg-fill fg-sig"></div></div>
                    </div>
                </div>
            </div>
            <div class="fg-actions" role="group" aria-label="Choose your posture for this century">
                <button class="fg-action" data-act="hide">HIDE</button>
                <button class="fg-action" data-act="grow">GROW</button>
                <button class="fg-action" data-act="listen">LISTEN</button>
                <button class="fg-action" data-act="broadcast">BROADCAST</button>
            </div>
            <div class="fg-hint" aria-live="off">Each choice spends a century.</div>
            <div class="fg-lower">
                <div class="fg-contacts-wrap">
                    <div class="fg-panel-title">KNOWN</div>
                    <div class="fg-contacts"><div class="fg-empty">nothing. yet.</div></div>
                    <div class="fg-context" hidden></div>
                </div>
                <div class="fg-log-wrap">
                    <div class="fg-panel-title">RECORD</div>
                    <ul class="fg-log" aria-live="polite"></ul>
                </div>
            </div>
        </div>
        <div class="fg-overlay" hidden></div>
    `;
    return {
        stage: root.querySelector('.fg-stage')!,
        canvas: root.querySelector('.fg-canvas')!,
        year: root.querySelector('.fg-year')!,
        eraFill: root.querySelector('.fg-era-fill')!,
        techFill: root.querySelector('.fg-tech')!,
        sigFill: root.querySelector('.fg-sig')!,
        sigLabel: root.querySelector('.fg-sig-label')!,
        actions: root.querySelector('.fg-actions')!,
        hint: root.querySelector('.fg-hint')!,
        context: root.querySelector('.fg-context')!,
        contacts: root.querySelector('.fg-contacts')!,
        log: root.querySelector('.fg-log')!,
        overlay: root.querySelector('.fg-overlay')!,
        hud: root.querySelector('.fg-hud')!,
    };
}

// ── Overlays ─────────────────────────────────────────────────────────────────

function showIntro(): void {
    if (!els) return;
    const seed = game ? seedName(game.seed) : '——';
    els.overlay.hidden = false;
    els.overlay.innerHTML = `
        <div class="fg-card">
            <div class="fg-card-label">forest #${seed}</div>
            <h3 class="fg-card-title">You are a young civilization</h3>
            <p>Somewhere in the noise floor around you: others. Some gentle. Some frightened. Some neither. Nothing on your instruments will tell you which is which.</p>
            <p class="fg-card-em">That is the entire problem.</p>
            <p>Each choice spends a century. The era ends at year 6,000 — if you do.</p>
            <button class="fg-btn fg-btn-primary" data-wake>WAKE</button>
        </div>`;
    els.overlay.querySelector<HTMLButtonElement>('[data-wake]')!.addEventListener('click', () => {
        els!.overlay.hidden = true;
        everStarted = true;
        haptics.tap();
        syncAll();
    });
}

function showHailOverlay(): void {
    if (!els) return;
    els.overlay.hidden = false;
    els.overlay.innerHTML = `
        <div class="fg-card fg-card-hail">
            <div class="fg-card-label">the melody resolves into language</div>
            <h3 class="fg-card-title fg-alien">WE ARE GLAD TO FIND YOU.<br>WE ARE GLAD YOU ARE.<br>JOIN US.</h3>
            <p>It is not a demand. It does not need to be. Everyone it has asked has eventually said yes — one way or the other.</p>
            <div class="fg-btn-row">
                <button class="fg-btn fg-btn-alien" data-join>JOIN</button>
                <button class="fg-btn" data-refuse>REFUSE</button>
            </div>
        </div>`;
    els.overlay.querySelector<HTMLButtonElement>('[data-join]')!.addEventListener('click', () => {
        els!.overlay.hidden = true;
        haptics.confirm();
        takeTurn({ kind: 'join' });
    });
    els.overlay.querySelector<HTMLButtonElement>('[data-refuse]')!.addEventListener('click', () => {
        els!.overlay.hidden = true;
        haptics.warn();
        takeTurn({ kind: 'refuse' });
    });
}

function showEndingOverlay(pm: PostMortem): void {
    if (!els) return;
    const ending = endingText(pm.ending, pm, nameOf);
    const summary = postMortemSummary(pm).map(l => `<p class="fg-summary-line">${l}</p>`).join('');
    els.overlay.hidden = false;
    els.overlay.innerHTML = `
        <div class="fg-card fg-card-ending">
            <div class="fg-card-label">year ${fmt(pm.yearsSurvived)} · forest #${pm.seedName}</div>
            <h3 class="fg-card-title">${ending.title}</h3>
            <div class="fg-card-sub">${ending.subtitle}</div>
            <p>${ending.body}</p>
            <div class="fg-summary">${summary}</div>
            <p class="fg-equilibrium">In Part Four's taxonomy, you lived in something like <a href="#alternatives">${ending.equilibrium}</a>.</p>
            <div class="fg-btn-row">
                <button class="fg-btn fg-btn-primary" data-reveal>REVEAL THE FOREST</button>
                <button class="fg-btn" data-again>ENTER A NEW FOREST</button>
            </div>
        </div>`;
    els.overlay.querySelector<HTMLButtonElement>('[data-reveal]')!.addEventListener('click', () => {
        haptics.tap();
        showReveal(pm);
    });
    els.overlay.querySelector<HTMLButtonElement>('[data-again]')!.addEventListener('click', () => {
        haptics.tap();
        newForest();
    });
}

function showReveal(pm: PostMortem): void {
    if (!els || !renderer) return;
    els.overlay.hidden = true;
    renderer.showReveal(pm);

    const truthBlocks = pm.truths.map(t => `
        <div class="fg-truth">
            <div class="fg-truth-name" style="color:${t.joined ? 'var(--joining-glow)' : truthColor(t.disposition)}">${t.name}</div>
            ${civTruthLines(t, nameOf).map(l => `<div class="fg-truth-line">${l}</div>`).join('')}
        </div>`).join('');

    const chronicleItems = pm.chronicle
        .map(c => `<li class="${c.visible ? '' : 'fg-secret'}">${chronicleLine(c, nameOf)}</li>`)
        .join('');

    const record = recordLines(getRuns()).map(l => `<p class="fg-record-line">${l}</p>`).join('');

    els.hud.innerHTML = `
        <div class="fg-reveal">
            <div class="fg-panel-title">WHAT THE FOREST WAS</div>
            <div class="fg-truths">${truthBlocks}</div>
            <details class="fg-chronicle">
                <summary>THE FULL CHRONICLE — everything that actually happened</summary>
                <p class="fg-chronicle-note">Dimmed lines were invisible to you while you lived here.</p>
                <ul>${chronicleItems}</ul>
            </details>
            ${record ? `<div class="fg-record"><div class="fg-panel-title">ACROSS YOUR FORESTS</div>${record}</div>` : ''}
            <div class="fg-btn-row">
                <button class="fg-btn fg-btn-primary" data-again>ENTER A NEW FOREST</button>
            </div>
            <div class="fg-seed-note">forest #${pm.seedName} · the same seed always grows the same forest</div>
        </div>`;
    els.hud.querySelector<HTMLButtonElement>('[data-again]')!.addEventListener('click', () => {
        haptics.tap();
        newForest();
    });
}

function truthColor(d: string): string {
    switch (d) {
        case 'dove': return 'var(--hope-teal)';
        case 'hermit': return 'var(--cold-blue)';
        case 'hawk': return 'var(--warning-amber)';
        case 'zealot': return 'var(--danger-red)';
        default: return 'var(--bright-blue)';
    }
}

// ── Log ──────────────────────────────────────────────────────────────────────

function appendLog(lines: { text: string; tone: string }[]): void {
    if (!els) return;
    for (const line of lines) {
        const li = document.createElement('li');
        li.className = `fg-line fg-tone-${line.tone}`;
        li.textContent = line.text;
        els.log.appendChild(li);
    }
    while (els.log.children.length > 70) {
        els.log.removeChild(els.log.firstChild!);
    }
    els.log.scrollTop = els.log.scrollHeight;
}

// ── Audio & haptics dispatch ─────────────────────────────────────────────────

function panFor(x: number): number {
    if (!game) return 0;
    return ((x - game.civs[0].x) / MAP_W) * 1.6;
}

function playEvent(e: TurnEvent, view: PlayerView): void {
    switch (e.t) {
        case 'detection': {
            const c = view.contacts.find(c => c.id === e.id);
            fgDetection(c ? panFor(c.x) : 0);
            haptics.warn();
            break;
        }
        case 'hailed': fgHailed(); haptics.eyesAlert(); break;
        case 'contact-formed': fgContact(); haptics.confirm(); break;
        case 'probe-launched': fgProbe(); break;
        case 'probe-noticed': fgDetection(0); haptics.warn(); break;
        case 'probe-result': if (e.verdict === 'predatory') haptics.warn(); break;
        case 'strike-launched': fgStrikeLaunch(); haptics.chainStart(); break;
        case 'strike-impact': {
            const c = view.contacts.find(c => c.id === e.target);
            fgDistantImpact(e.destroyed, c ? panFor(c.x) : 0);
            if (c && renderer) renderer.addFlash(c.x, c.y, e.destroyed);
            if (e.destroyed) haptics.heavyImpact();
            break;
        }
        case 'incoming-glimpse': fgDetection(0); haptics.eyesAlert(); break;
        case 'struck': fgDeath(); haptics.heavyImpact(); break;
        case 'civ-died': {
            const c = view.contacts.find(c => c.id === e.id);
            fgDistantImpact(true, c ? panFor(c.x) : 0);
            if (c && renderer) renderer.addFlash(c.x, c.y, true);
            break;
        }
        case 'distant-flash':
            fgDistantImpact(e.big, panFor(e.x));
            if (renderer) renderer.addFlash(e.x, e.y, e.big);
            break;
        case 'signature-floor': haptics.warn(); break;
        case 'hymn-edge':
        case 'civ-joined':
        case 'replicator-hail':
        case 'joined-voluntarily':
        case 'converted':
            if (!hymnPlayedThisTurn) { fgHymn(); hymnPlayedThisTurn = true; }
            break;
        case 'era-end': fgSurvived(); haptics.confirm(); break;
        default: break;
    }
}

// ── Turn flow ────────────────────────────────────────────────────────────────

function takeTurn(action: PlayerAction): void {
    if (!game || game.over) return;
    hymnPlayedThisTurn = false;

    if (action.kind === 'broadcast') fgBroadcast();

    const result = applyPlayerAction(game, action);
    const view = getPlayerView(game);

    // Verdicts persist so the contact list can keep showing them.
    for (const e of result.events) {
        if (e.t === 'probe-result') noteVerdict(game, e.id, e.verdict);
    }

    appendLog(eventLines(result.events, game.year, nameOf));
    for (const e of result.events) playEvent(e, view);
    fgUpdateWatched(result.secret.watcherCount, result.secret.huntersAiming);

    // Selection follows reality: drop selection of the dead.
    if (selectedId !== null) {
        const sel = view.contacts.find(c => c.id === selectedId);
        if (!sel || (!sel.alive && !sel.joined)) selectedId = null;
    }

    syncAll();

    if (view.pendingHail) {
        window.setTimeout(showHailOverlay, 1100);
        return;
    }
    if (result.over) {
        const pm = buildPostMortem(game);
        recordRun(pm);
        stopWatched();
        window.setTimeout(() => showEndingOverlay(pm), 1600);
    }
}

// ── Sync (view → DOM) ────────────────────────────────────────────────────────

function syncAll(): void {
    if (!game || !els || !renderer) return;
    const view = getPlayerView(game);

    els.year.textContent = `YEAR ${fmt(view.year)}`;
    els.eraFill.style.width = `${Math.min(100, (view.turn / ERA_TURNS) * 100)}%`;
    els.techFill.style.width = `${Math.round(view.techBand * 100)}%`;
    els.sigFill.style.width = `${Math.round(view.signature * 100)}%`;
    els.sigLabel.textContent = view.signatureFloored ? 'signature (floored by your own heat)' : 'signature';

    renderer.selected = selectedId;
    renderer.sync(view);

    els.canvas.setAttribute('aria-label',
        `Map of your region of the galaxy. Year ${fmt(view.year)} of 6,000. ` +
        `${view.contacts.length === 0 ? 'No known civilizations.' : view.contacts.length + ' known civilizations.'} ` +
        `Your signature is ${view.signature < 0.15 ? 'dark' : view.signature < 0.4 ? 'faint' : 'bright'}.`);

    renderContacts(view);
    renderContext(view);

    const playing = !view.over && !view.pendingHail && everStarted;
    els.actions.querySelectorAll<HTMLButtonElement>('.fg-action').forEach(b => {
        b.disabled = !playing;
    });
}

function techGlyphs(band: number): string {
    return '▮'.repeat(band) + '▯'.repeat(5 - band);
}

function renderContacts(view: PlayerView): void {
    if (!els) return;
    if (view.contacts.length === 0) {
        els.contacts.innerHTML = '<div class="fg-empty">nothing. yet.</div>';
        return;
    }
    els.contacts.innerHTML = '';
    for (const c of view.contacts) {
        const row = document.createElement('button');
        row.className = 'fg-contact-row';
        row.dataset.id = String(c.id);
        if (c.id === selectedId) row.classList.add('selected');
        if (!c.alive) row.classList.add('dead');
        if (c.joined) row.classList.add('joined');

        const status = !c.alive ? 'DEAD'
            : c.joined ? 'JOINED'
            : c.isBroadcasting ? 'SIGNALING'
            : c.signatureBand.toUpperCase();
        const marks = [
            c.contact ? '<span class="fg-mark fg-mark-contact" title="contact established">◆</span>' : '',
            c.verdict ? `<span class="fg-mark fg-mark-${c.verdict}" title="probe verdict: ${c.verdict}">${c.verdict === 'benign' ? '○' : c.verdict === 'wary' ? '◊' : '▲'}</span>` : '',
        ].join('');

        row.innerHTML = `
            <span class="fg-c-name">${c.name}${marks}</span>
            <span class="fg-c-dist">${fmt(c.distance)} ly</span>
            <span class="fg-c-tech" title="estimated capability relative to yours — estimates lie">${techGlyphs(c.estTechBand)}${c.estTechTrend === 'rising' ? '↑' : ''}</span>
            <span class="fg-c-status">${status}</span>`;
        row.addEventListener('click', () => {
            selectedId = selectedId === c.id ? null : c.id;
            strikeArmed = false;
            haptics.tap();
            syncAll();
        });
        els.contacts.appendChild(row);
    }
}

function renderContext(view: PlayerView): void {
    if (!els) return;
    const c = selectedId !== null ? view.contacts.find(x => x.id === selectedId) : undefined;
    if (!c || view.over || view.pendingHail) {
        els.context.hidden = true;
        els.context.innerHTML = '';
        return;
    }
    els.context.hidden = false;

    const probeDisabled = !c.canProbe || view.probePending !== null;
    const probeLabel = view.probePending === c.id ? 'PROBE IN FLIGHT' : 'PROBE';
    const canAnswer = c.isBroadcasting && !c.contact && c.alive && !c.joined;
    const strikeLabel = strikeArmed
        ? 'CONFIRM — THERE IS NO RECALL'
        : `STRIKE · arrives in ${c.strikeEta === 1 ? '1 century' : c.strikeEta + ' centuries'}`;
    const strikeDisabled = !c.canStrike || !view.strikeCapable;
    const strikeTitle = !view.strikeCapable
        ? 'your capability is not yet sufficient to build a relativistic lance'
        : !c.canStrike ? 'beyond reach: the void protects them' : ACTION_HINTS.strike;

    els.context.innerHTML = `
        <div class="fg-context-name">${c.name} · ${fmt(c.distance)} ly${c.contact ? ' · contact' : ''}${!c.alive ? ' · dead' : c.joined ? ' · part of the pattern' : ''}</div>
        <div class="fg-context-actions">
            <button class="fg-btn fg-ctx" data-ctx="probe" ${probeDisabled || !c.alive || c.joined ? 'disabled' : ''} title="${ACTION_HINTS.probe}">${probeLabel}</button>
            <button class="fg-btn fg-ctx" data-ctx="answer" ${canAnswer ? '' : 'disabled'} title="${ACTION_HINTS.answer}">ANSWER</button>
            <button class="fg-btn fg-ctx fg-ctx-strike ${strikeArmed ? 'armed' : ''}" data-ctx="strike" ${strikeDisabled || !c.alive || c.joined ? 'disabled' : ''} title="${strikeTitle}">${strikeLabel}</button>
        </div>`;

    els.context.querySelector<HTMLButtonElement>('[data-ctx="probe"]')?.addEventListener('click', () => {
        if (selectedId === null) return;
        haptics.tap();
        takeTurn({ kind: 'probe', target: selectedId });
    });
    els.context.querySelector<HTMLButtonElement>('[data-ctx="answer"]')?.addEventListener('click', () => {
        if (selectedId === null) return;
        haptics.tap();
        takeTurn({ kind: 'answer', target: selectedId });
    });
    els.context.querySelector<HTMLButtonElement>('[data-ctx="strike"]')?.addEventListener('click', () => {
        if (selectedId === null) return;
        if (!strikeArmed) {
            strikeArmed = true;
            haptics.warn();
            renderContext(view);
            window.setTimeout(() => {
                if (strikeArmed) { strikeArmed = false; if (game) syncAll(); }
            }, 5000);
            return;
        }
        strikeArmed = false;
        takeTurn({ kind: 'strike', target: selectedId });
    });
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

function logOpening(): void {
    if (!game) return;
    appendLog([{
        text: `YEAR 0 — Your first radio telescope comes online. The sky is full of static and you do not yet know what kind. Forest #${seedName(game.seed)}.`,
        tone: 'neutral',
    }]);
}

function newForest(seed?: number): void {
    if (!els || !renderer) return;
    stopWatched();
    game = createGame(seed);
    selectedId = null;
    strikeArmed = false;
    els.log.innerHTML = '';
    els.overlay.hidden = true;
    renderer.seedStars(game.seed);
    rebuildHud();
    logOpening();
    syncAll();
}

/** Reveal mode replaces the HUD; rebuild it for a fresh run. */
function rebuildHud(): void {
    if (!container) return;
    const existing = els;
    if (!existing) return;
    const hudHasGame = existing.hud.querySelector('.fg-actions');
    if (hudHasGame) return;
    els = buildDOM(container);
    // Re-bind the canvas renderer to the rebuilt DOM.
    renderer?.destroy();
    renderer = new ForestRenderer(els.canvas);
    renderer.onSelect = onMapSelect;
    if (game) renderer.seedStars(game.seed);
    wireActions();
    observeContainer();
}

function onMapSelect(id: number | null): void {
    selectedId = id;
    strikeArmed = false;
    if (id !== null) haptics.tap();
    syncAll();
}

function wireActions(): void {
    if (!els) return;
    els.actions.querySelectorAll<HTMLButtonElement>('.fg-action').forEach(btn => {
        const act = btn.dataset.act as 'hide' | 'grow' | 'listen' | 'broadcast';
        btn.title = ACTION_HINTS[act];
        btn.addEventListener('click', () => {
            haptics.tap();
            strikeArmed = false;
            takeTurn({ kind: act });
        });
        btn.addEventListener('mouseenter', () => { if (els) els.hint.textContent = ACTION_HINTS[act]; });
        btn.addEventListener('focus', () => { if (els) els.hint.textContent = ACTION_HINTS[act]; });
    });
}

let visObserver: IntersectionObserver | null = null;

function observeContainer(): void {
    if (!container || !renderer) return;
    visObserver?.disconnect();
    visObserver = observeVisibility(container, (visible) => {
        renderer?.setVisible(visible);
    }, 0.05);
}

export function initForestGame(): void {
    container = document.getElementById('forest-game-container');
    if (!container) return;

    els = buildDOM(container);
    renderer = new ForestRenderer(els.canvas);
    renderer.onSelect = onMapSelect;
    wireActions();
    observeContainer();

    game = createGame();
    renderer.seedStars(game.seed);
    logOpening();
    syncAll();
    showIntro();
}

/** Optional seed: the same seed always grows the same forest. */
export function resetForestGame(seed?: number): void {
    if (!game || !els) return;
    // Mid-run reset is destructive: ask twice, like every irrevocable thing here.
    if (seed === undefined && !game.over && everStarted && game.turn > 0 && !resetArmed) {
        resetArmed = true;
        appendLog([{ text: 'Abandon this forest? The button asks once more.', tone: 'warn' }]);
        window.setTimeout(() => { resetArmed = false; }, 4000);
        return;
    }
    resetArmed = false;
    newForest(seed);
}
