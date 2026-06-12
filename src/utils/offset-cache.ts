// Cached document offsets for scroll-time consumers.
//
// Reading getBoundingClientRect() inside scroll handlers forces layout in the
// hottest loop the page has. Instead: consumers cache absolute offsets once,
// and a single shared observer tells everyone when the document has actually
// reflowed (resize, fonts, collapsibles opening, lazy content arriving).

type ReflowListener = () => void;

const listeners = new Set<ReflowListener>();
let started = false;
let pending = false;

function notify(): void {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
        pending = false;
        listeners.forEach(fn => fn());
    });
}

function start(): void {
    if (started) return;
    started = true;
    window.addEventListener('resize', notify);
    window.addEventListener('load', notify);
    if ('ResizeObserver' in window) {
        const ro = new ResizeObserver(notify);
        ro.observe(document.body);
    }
    // Fonts shift metrics late; settle once more after everything lands.
    window.setTimeout(notify, 1500);
    window.setTimeout(notify, 4000);
}

/** Register a callback for "the document's geometry changed". Fires ~once per reflow, rAF-aligned. */
export function onDocumentReflow(fn: ReflowListener): void {
    start();
    listeners.add(fn);
    fn();
}

/** Absolute top of an element, measured now. Call from inside a reflow callback. */
export function absoluteTop(el: Element): number {
    return el.getBoundingClientRect().top + window.scrollY;
}
