# The Dark Forest: A Deep Inquiry

An interactive multimedia essay exploring the Dark Forest Theory from game theory and international relations.

## Overview

This is not an essay with decorations—it is a **philosophical instrument**. Through interactive visualizations, generative audio, and carefully structured arguments, readers experience the weight of cosmic silence and the trap of game-theoretic reasoning.

### Features

- **The Forest Itself**: a fully playable dark forest — you are one civilization among hidden others (doves, hermits, hawks, zealots, mirrors), choosing each century to hide, grow, listen, broadcast, probe, or strike. Seeded and deterministic; every ending maps onto the essay's taxonomy of equilibria, and the post-mortem reveals what the forest really was: who found you, who feared you, who held fire and why
- **Living Starfield**: Parallax ASCII stars, nebulae, constellations, and rare cosmic events (pulsars, WebGL supernovae, gamma-ray bursts)
- **Forest Eyes**: Mouse-tracking eyes that observe you from the void
- **Glass Forest**: Civilization network visualization with one-shot and iterated trust dynamics
- **Light Cone & Real Sky**: How far we've announced ourselves; the actual night sky above you
- **Generative Soundscape**: Web Audio API synthesis that responds to scroll position — including a near-silent "watched" tone whenever something in the forest knows where you are
- **Interactive Elements**: Payoff matrix, chain of suspicion builder, signal propagation, transmission composer, credence collector

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Installation

```bash
npm install
```

### Development

```bash
npm run dev      # Start development server with hot reload
npm run build    # Build for production (outputs to dist/)
npm run preview  # Preview production build locally
```

## Tech Stack

- **Vite** - Build tool and dev server
- **TypeScript** - Type-safe JavaScript
- **Web Audio API** - Generative audio synthesis
- **CSS Custom Properties** - Theming and design tokens

## Project Structure

```
src/
├── main.ts           # Entry point
├── styles/           # CSS modules (variables, base, components, sections)
├── audio/            # Generative audio system
├── game/             # The Forest Itself: engine, AI, renderer, narrative, UI
├── visualizations/   # Interactive visual elements
├── components/       # Transmission, credence collector, return greeting
└── utils/            # Scroll, collapsibles, persistence, session tracking

scripts/
└── balance.ts        # Headless balance harness for the game engine
```

The game engine (`src/game/engine.ts`) is pure and deterministic — no DOM, all
randomness through a seeded RNG. `scripts/balance.ts` runs hundreds of seeded
forests under fixed policies to verify the strategic landscape matches the
essay's claims (hiding is safest; broadcasting is a heavy-tailed gamble;
violence invites the forest's answer).

## Documentation

- `SOUL.md` - Creative vision and philosophical commitments
- `PLAN.md` - Implementation roadmap

## License

All rights reserved.
