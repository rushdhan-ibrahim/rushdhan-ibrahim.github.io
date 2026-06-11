// Canvas renderer for The Forest Itself.
// Plays in two modes: fog-of-war (the lived game) and reveal (the post-mortem,
// when the forest finally shows the reader what it was).

import { MAP_W, MAP_H, type PlayerView, type PostMortem, type Disposition } from './engine';
import { mulberry32 } from './rng';
import { prefersReducedMotion } from '../utils/visibility';

const DISPOSITION_COLORS: Record<Disposition, string> = {
    dove: '#6a9e9e',      // hope-teal
    hermit: '#5a6a7f',    // cold-blue
    hawk: '#e0b285',      // warning-amber
    zealot: '#d46b6b',    // danger-red
    mirror: '#8aa4c6',    // bright-blue
};

const CIV_COLOR = '#8aa4c6';
const CONTACT_COLOR = '#6a9e9e';
const PLAYER_COLOR = '#f0eeeb';
const JOINED_COLOR = '#d48db8';
const DANGER_COLOR = '#d46b6b';

interface FlashAnim {
    x: number;
    y: number;
    born: number;   // performance.now()
    big: boolean;
}

export class ForestRenderer {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private stars: { x: number; y: number; a: number; r: number; tw: number }[] = [];
    private view: PlayerView | null = null;
    private reveal: PostMortem | null = null;
    private flashes: FlashAnim[] = [];
    private ripples: { x: number; y: number; born: number }[] = [];
    private knownIds = new Set<number>();
    private rafId: number | null = null;
    private visible = false;
    private reduced: boolean;
    public selected: number | null = null;
    public onSelect: ((id: number | null) => void) | null = null;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas 2d unavailable');
        this.ctx = ctx;
        this.reduced = prefersReducedMotion();

        canvas.addEventListener('click', (e) => this.handleClick(e));
        const ro = new ResizeObserver(() => {
            this.fit();
            this.drawOnce();
        });
        ro.observe(canvas);
        this.fit();
    }

    seedStars(seed: number): void {
        const rng = mulberry32(seed ^ 0x5f3759df);
        this.stars = [];
        this.ripples = [];
        this.knownIds = new Set();
        for (let i = 0; i < 130; i++) {
            this.stars.push({
                x: rng() * MAP_W,
                y: rng() * MAP_H,
                a: 0.05 + rng() * 0.16,
                r: rng() < 0.85 ? 1 : 1.6,
                tw: rng() * Math.PI * 2,
            });
        }
    }

    sync(view: PlayerView): void {
        // New faces in the dark announce themselves with a ripple.
        for (const c of view.contacts) {
            if (!this.knownIds.has(c.id)) {
                this.knownIds.add(c.id);
                if (view.turn > 0) {
                    this.ripples.push({ x: c.x, y: c.y, born: performance.now() });
                }
            }
        }
        this.view = view;
        this.reveal = null;
        this.drawOnce();
    }

    showReveal(pm: PostMortem): void {
        this.reveal = pm;
        this.drawOnce();
    }

    addFlash(x: number, y: number, big: boolean): void {
        this.flashes.push({ x, y, born: performance.now(), big });
    }

    setVisible(v: boolean): void {
        this.visible = v;
        if (v && !this.reduced) this.startLoop();
        else this.stopLoop();
        if (v) this.drawOnce();
    }

    destroy(): void {
        this.stopLoop();
    }

    // ── geometry ────────────────────────────────────────────────────────────

    private fit(): void {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        if (w === 0 || h === 0) return;
        this.canvas.width = Math.round(w * dpr);
        this.canvas.height = Math.round(h * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    private mapToCanvas(mx: number, my: number): [number, number] {
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        const scale = Math.min(w / MAP_W, h / MAP_H);
        const ox = (w - MAP_W * scale) / 2;
        const oy = (h - MAP_H * scale) / 2;
        return [ox + mx * scale, oy + my * scale];
    }

    private scale(): number {
        return Math.min(this.canvas.clientWidth / MAP_W, this.canvas.clientHeight / MAP_H);
    }

    private handleClick(e: MouseEvent): void {
        if (!this.view || !this.onSelect) return;
        const rect = this.canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        let best: number | null = null;
        let bestD = 26; // px hit radius
        for (const c of this.view.contacts) {
            const [x, y] = this.mapToCanvas(c.x, c.y);
            const d = Math.hypot(cx - x, cy - y);
            if (d < bestD) { bestD = d; best = c.id; }
        }
        this.onSelect(best);
    }

    // ── loop ────────────────────────────────────────────────────────────────

    private startLoop(): void {
        if (this.rafId !== null) return;
        const tick = () => {
            this.rafId = null;
            if (!this.visible) return;
            this.draw(performance.now());
            this.rafId = requestAnimationFrame(tick);
        };
        this.rafId = requestAnimationFrame(tick);
    }

    private stopLoop(): void {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    drawOnce(): void {
        this.draw(performance.now());
    }

    // ── drawing ─────────────────────────────────────────────────────────────

    private draw(t: number): void {
        const ctx = this.ctx;
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        ctx.clearRect(0, 0, w, h);

        this.drawStars(t);
        if (this.reveal) {
            this.drawRevealMode(this.reveal);
            return;
        }
        if (!this.view) return;
        const view = this.view;

        this.drawReplicator(t, view);
        this.drawFlashes(t);
        this.drawRipples(t);
        this.drawStrikes(t, view);
        this.drawContacts(t, view);
        this.drawPlayer(t, view);
        this.drawInbound(t, view);
    }

    /** Expanding ring where something was just found. */
    private drawRipples(t: number): void {
        const ctx = this.ctx;
        this.ripples = this.ripples.filter(r => t - r.born < 1800);
        for (const r of this.ripples) {
            const age = (t - r.born) / 1800;
            const [x, y] = this.mapToCanvas(r.x, r.y);
            ctx.globalAlpha = (1 - age) * 0.6;
            ctx.strokeStyle = CIV_COLOR;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(x, y, 4 + age * 26, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }

    private drawStars(t: number): void {
        const ctx = this.ctx;
        for (const s of this.stars) {
            const [x, y] = this.mapToCanvas(s.x, s.y);
            const tw = this.reduced ? 1 : 0.75 + 0.25 * Math.sin(t / 2400 + s.tw);
            ctx.globalAlpha = s.a * tw;
            ctx.fillStyle = '#cdd6e4';
            ctx.fillRect(x, y, s.r, s.r);
        }
        ctx.globalAlpha = 1;
    }

    private drawReplicator(t: number, view: PlayerView): void {
        const front = view.replicatorFront;
        if (!front) return;
        const ctx = this.ctx;
        const [x, y] = this.mapToCanvas(front.x, front.y);
        const r = front.radius * this.scale();
        const pulse = this.reduced ? 0 : Math.sin(t / 900) * 2;

        const grad = ctx.createRadialGradient(x, y, Math.max(0, r - 60), x, y, r + pulse);
        grad.addColorStop(0, 'rgba(158, 90, 127, 0)');
        grad.addColorStop(0.85, 'rgba(158, 90, 127, 0.10)');
        grad.addColorStop(1, 'rgba(212, 141, 184, 0.32)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r + pulse, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(212, 141, 184, 0.5)';
        ctx.setLineDash([3, 7]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, r + pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    private drawFlashes(t: number): void {
        const ctx = this.ctx;
        const now = t;
        this.flashes = this.flashes.filter(f => now - f.born < 6000);
        for (const f of this.flashes) {
            const age = (now - f.born) / 6000;
            const [x, y] = this.mapToCanvas(f.x, f.y);
            const maxR = f.big ? 26 : 14;
            const r = 3 + age * maxR;
            ctx.globalAlpha = (1 - age) * 0.7;
            ctx.strokeStyle = f.big ? '#e8d9c4' : '#c4b8a8';
            ctx.lineWidth = f.big ? 1.5 : 1;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.stroke();
            if (age < 0.25) {
                ctx.globalAlpha = (0.25 - age) * 3;
                ctx.fillStyle = '#fff8ec';
                ctx.beginPath();
                ctx.arc(x, y, 2.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.globalAlpha = 1;
    }

    private drawStrikes(t: number, view: PlayerView): void {
        const ctx = this.ctx;
        for (const s of view.strikesOut) {
            const [x1, y1] = this.mapToCanvas(s.fromX, s.fromY);
            const [x2, y2] = this.mapToCanvas(s.toX, s.toY);
            ctx.strokeStyle = 'rgba(212, 107, 107, 0.25)';
            ctx.setLineDash([2, 6]);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            ctx.setLineDash([]);

            const flicker = this.reduced ? 1 : 0.7 + 0.3 * Math.sin(t / 90);
            // The lance and its fading wake.
            for (let i = 0; i < 4; i++) {
                const p = Math.max(0, s.progress - i * 0.012);
                const px = x1 + (x2 - x1) * p;
                const py = y1 + (y2 - y1) * p;
                ctx.globalAlpha = flicker * (1 - i * 0.28);
                ctx.fillStyle = DANGER_COLOR;
                ctx.beginPath();
                ctx.arc(px, py, 2.2 - i * 0.4, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
        }
    }

    /** Inbound strikes the player has glimpsed: no source shown — only
     *  something closing in. Arcs tighten around the player's world. */
    private drawInbound(t: number, view: PlayerView): void {
        if (view.strikesInGlimpsed.length === 0) return;
        const ctx = this.ctx;
        const [x, y] = this.mapToCanvas(view.x, view.y);
        for (const s of view.strikesInGlimpsed) {
            const r = 60 - s.progress * 44;
            const spin = this.reduced ? 0 : t / 1300;
            ctx.strokeStyle = 'rgba(212, 107, 107, 0.8)';
            ctx.lineWidth = 1.4;
            for (let i = 0; i < 3; i++) {
                const a0 = spin + (i * Math.PI * 2) / 3;
                ctx.beginPath();
                ctx.arc(x, y, r, a0, a0 + 0.9);
                ctx.stroke();
            }
        }
    }

    private glyphFont(size: number): string {
        return `${size}px 'JetBrains Mono', monospace`;
    }

    private drawContacts(t: number, view: PlayerView): void {
        const ctx = this.ctx;
        for (const c of view.contacts) {
            const [x, y] = this.mapToCanvas(c.x, c.y);

            if (!c.alive) {
                ctx.globalAlpha = 0.45;
                ctx.fillStyle = '#6b6b73';
                ctx.font = this.glyphFont(13);
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('✕', x, y);
                ctx.font = this.glyphFont(8);
                ctx.fillText(c.name, x, y + 14);
                ctx.globalAlpha = 1;
                continue;
            }

            const color = c.joined ? JOINED_COLOR : c.contact ? CONTACT_COLOR : CIV_COLOR;

            // Signature halo: how loudly they exist right now.
            const sigR = c.signatureBand === 'dark' ? 0 : c.signatureBand === 'faint' ? 7 : c.signatureBand === 'bright' ? 12 : 20;
            if (sigR > 0) {
                const pulse = this.reduced ? 1 : (c.signatureBand === 'blazing' || c.joined ? 0.8 + 0.2 * Math.sin(t / 420) : 1);
                const grad = ctx.createRadialGradient(x, y, 1, x, y, sigR * pulse + 4);
                grad.addColorStop(0, color + '55');
                grad.addColorStop(1, color + '00');
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(x, y, sigR * pulse + 4, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.fillStyle = color;
            ctx.font = this.glyphFont(13);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = color;
            ctx.shadowBlur = 9;
            ctx.fillText(c.joined ? '❋' : '◉', x, y);
            ctx.shadowBlur = 0;

            ctx.globalAlpha = 0.85;
            ctx.font = this.glyphFont(8);
            ctx.fillText(c.name, x, y + 14);
            ctx.globalAlpha = 1;

            if (c.verdict) {
                ctx.globalAlpha = 0.7;
                ctx.font = this.glyphFont(8);
                ctx.fillStyle = c.verdict === 'benign' ? CONTACT_COLOR : c.verdict === 'wary' ? '#e0b285' : DANGER_COLOR;
                ctx.fillText(c.verdict === 'benign' ? '○' : c.verdict === 'wary' ? '◊' : '▲', x + 12, y - 9);
                ctx.globalAlpha = 1;
            }

            if (this.selected === c.id) {
                ctx.strokeStyle = 'rgba(240, 238, 235, 0.7)';
                ctx.setLineDash([3, 3]);
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(x, y, 11, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }
    }

    private drawPlayer(t: number, view: PlayerView): void {
        const ctx = this.ctx;
        const [x, y] = this.mapToCanvas(view.x, view.y);

        if (!view.alive) {
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = '#6b6b73';
            ctx.font = this.glyphFont(14);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('✕', x, y);
            ctx.font = this.glyphFont(8);
            ctx.fillText('YOU', x, y + 15);
            ctx.globalAlpha = 1;
            return;
        }
        if (view.joined) {
            ctx.fillStyle = JOINED_COLOR;
            ctx.font = this.glyphFont(14);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('❋', x, y);
            ctx.font = this.glyphFont(8);
            ctx.fillText('US', x, y + 15);
            return;
        }

        // Your own visibility, honestly rendered: the halo others could see.
        const sig = view.signature;
        const sigR = 4 + sig * 30;
        const grad = ctx.createRadialGradient(x, y, 1, x, y, sigR);
        grad.addColorStop(0, 'rgba(240, 238, 235, 0.35)');
        grad.addColorStop(1, 'rgba(240, 238, 235, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, sigR, 0, Math.PI * 2);
        ctx.fill();

        if (view.posture === 'broadcast' && !this.reduced) {
            const phase = (t % 2200) / 2200;
            for (let i = 0; i < 2; i++) {
                const p = (phase + i * 0.5) % 1;
                ctx.globalAlpha = (1 - p) * 0.5;
                ctx.strokeStyle = PLAYER_COLOR;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(x, y, 8 + p * 46, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
        }

        ctx.fillStyle = PLAYER_COLOR;
        ctx.font = this.glyphFont(14);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = PLAYER_COLOR;
        ctx.shadowBlur = 12;
        ctx.fillText('◈', x, y);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 0.85;
        ctx.font = this.glyphFont(8);
        ctx.fillText('YOU', x, y + 15);
        ctx.globalAlpha = 1;
    }

    private drawRevealMode(pm: PostMortem): void {
        const ctx = this.ctx;
        const view = this.view;

        // Kill lines first, beneath everything.
        ctx.strokeStyle = 'rgba(212, 107, 107, 0.3)';
        ctx.lineWidth = 1;
        for (const c of pm.chronicle) {
            if (c.kind !== 'death') continue;
            const killer = c.byWhom === 0 && view ? { x: view.x, y: view.y } : pm.truths.find(t => t.id === c.byWhom);
            const victim = c.who === 0 && view ? { x: view.x, y: view.y } : pm.truths.find(t => t.id === c.who);
            if (!killer || !victim) continue;
            const [x1, y1] = this.mapToCanvas(killer.x, killer.y);
            const [x2, y2] = this.mapToCanvas(victim.x, victim.y);
            ctx.setLineDash([2, 4]);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        for (const t of pm.truths) {
            const [x, y] = this.mapToCanvas(t.x, t.y);
            const color = t.joined ? JOINED_COLOR : DISPOSITION_COLORS[t.disposition];
            ctx.globalAlpha = t.alive || t.joined ? 1 : 0.5;
            ctx.fillStyle = color;
            ctx.font = this.glyphFont(13);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = color;
            ctx.shadowBlur = t.alive || t.joined ? 9 : 0;
            ctx.fillText(t.joined ? '❋' : t.alive ? '◉' : '✕', x, y);
            ctx.shadowBlur = 0;
            ctx.font = this.glyphFont(8);
            ctx.fillText(`${t.name}`, x, y + 14);
            ctx.globalAlpha = 0.75;
            ctx.fillText(t.disposition.toUpperCase() + (t.spooked ? '*' : ''), x, y + 24);
            ctx.globalAlpha = 1;
        }

        if (view) {
            const [x, y] = this.mapToCanvas(view.x, view.y);
            ctx.fillStyle = view.alive ? PLAYER_COLOR : '#6b6b73';
            ctx.font = this.glyphFont(14);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(view.joined ? '❋' : view.alive ? '◈' : '✕', x, y);
            ctx.font = this.glyphFont(8);
            ctx.fillText('YOU', x, y + 15);
        }
    }
}
