// The constellation rail.
//
// Wayfinding as star chart: a thin vertical track on the right edge where
// each movement of the essay is a star. Stars you have passed stay lit and
// connected; the active one glows with the act's color. Desktop only — on
// small screens the hamburger already carries the map.

const STATIONS: { id: string; label: string }[] = [
    { id: 'steelman', label: 'Part One — The Case' },
    { id: 'cracks', label: 'Part Two — The Cracks' },
    { id: 'pluribus', label: 'Case Study — The Joining' },
    { id: 'light-cone', label: 'Interlude — The Light Cone' },
    { id: 'transmission', label: 'Interlude — The Transmission' },
    { id: 'the-forest', label: 'Part Three — The Forest Itself' },
    { id: 'alternatives', label: 'Part Four — Alternative Equilibria' },
    { id: 'assessment', label: 'Part Five — Assessment' },
    { id: 'your-beliefs', label: 'Reflection — Where Do You Stand?' },
    { id: 'real-sky', label: 'Epilogue — The Real Sky' },
];

export function initProgressRail(): void {
    if (window.innerWidth < 1100) return;

    // A div with a navigation role: the global `nav` element styles belong to
    // the top bar alone and must not cascade here.
    const rail = document.createElement('div');
    rail.className = 'progress-rail';
    rail.setAttribute('role', 'navigation');
    rail.setAttribute('aria-label', 'Reading progress');

    const line = document.createElement('div');
    line.className = 'rail-line';
    const fill = document.createElement('div');
    fill.className = 'rail-fill';
    line.appendChild(fill);
    rail.appendChild(line);

    const stars: { el: HTMLAnchorElement; target: HTMLElement }[] = [];
    for (const s of STATIONS) {
        const target = document.getElementById(s.id);
        if (!target) continue;
        const a = document.createElement('a');
        a.className = 'rail-star';
        a.href = `#${s.id}`;
        a.setAttribute('aria-label', s.label);
        a.innerHTML = `<span class="rail-dot" aria-hidden="true"></span><span class="rail-label">${s.label}</span>`;
        a.addEventListener('click', (e) => {
            e.preventDefault();
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            history.replaceState(null, '', `#${s.id}`);
        });
        rail.appendChild(a);
        stars.push({ el: a, target });
    }
    if (stars.length === 0) return;
    document.body.appendChild(rail);

    let pending = false;
    const update = () => {
        pending = false;
        const mid = window.innerHeight * 0.45;
        let lastPassed = -1;
        stars.forEach((s, i) => {
            const passed = s.target.getBoundingClientRect().top < mid;
            s.el.classList.toggle('passed', passed);
            if (passed) lastPassed = i;
        });
        stars.forEach((s, i) => s.el.classList.toggle('active', i === lastPassed));
        const frac = lastPassed < 0 ? 0 : (lastPassed + 1) / stars.length;
        fill.style.height = `${frac * 100}%`;
        rail.classList.toggle('visible', window.scrollY > window.innerHeight * 0.5);
    };
    window.addEventListener('scroll', () => {
        if (!pending) {
            pending = true;
            requestAnimationFrame(update);
        }
    }, { passive: true });
    update();
}
