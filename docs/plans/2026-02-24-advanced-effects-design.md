# Advanced Visual Effects Prompt — Design

**Date**: 2026-02-24
**Status**: Approved

## Goal

Create a separate prompt file (`advanced-effects-prompt.txt`) that instructs the LLM to generate apps with rich visual effects using native browser APIs: Canvas 2D, WebGL shaders, interactive SVGs, advanced CSS, and scroll-driven interactions.

## Constraints

- Native browser APIs only — no library additions to the import map
- Separate file from `style-prompt.txt` for easy removal
- Model auto-selects visual complexity tier based on theme mood (no theme file edits)
- All code patterns must work inside React JSX with `useRef`/`useEffect` hooks
- No build step — everything runs in Babel `<script type="text/babel">` context

## File: `skills/vibes/defaults/advanced-effects-prompt.txt`

### Section 1: VISUAL COMPLEXITY TIERS

Model picks tier from theme MOOD:
- **Tier 1 (Restrained)**: editorial, archival, minimal moods → CSS @property, subtle SVG filters, micro-animations
- **Tier 2 (Expressive)**: bold, playful, rounded, modern moods → Canvas 2D particles, interactive SVG morphs, scroll parallax
- **Tier 3 (Spectacular)**: neon, cyberpunk, cosmic, glitch, arcade moods → WebGL shaders, generative Canvas, SVG path-drawing, interactive scenes

### Section 2: CANVAS 2D PATTERNS

- Particle fields (floating dots/lines, mouse-reactive)
- Generative noise/gradient backgrounds
- Pattern: `useRef` + `useEffect` + `requestAnimationFrame` loop
- Performance: `devicePixelRatio`, `cancelAnimationFrame` cleanup, resize observer

### Section 3: WEBGL SHADERS

- Fragment shaders for aurora, plasma, noise, gradient mesh
- Pattern: `useEffect` creates context, compiles shaders, uniform loop
- Vertex shader (pass-through) + fragment shader (the visual)
- Mouse uniform for interactivity

### Section 4: INTERACTIVE SVG

- `<animate begin="mouseover/click">` for SMIL-driven morphs
- `stroke-dasharray` + `stroke-dashoffset` keyframes for path drawing
- SVG filters: `<feTurbulence>` + `<feDisplacementMap>` for liquid effects
- `<feGaussianBlur>` + `<feComposite>` for glow
- Mouse-follow: `onMouseMove` repositions SVG elements
- Tiling SVG `<pattern>` backgrounds with animated transforms

### Section 5: CSS ADVANCED

- `@property` for animatable custom properties (gradient angle, color stops)
- `clip-path` polygon morph keyframes
- `mix-blend-mode` compositing (screen, overlay, difference)
- `backdrop-filter` stacking for glassmorphic depth
- `conic-gradient` + `@property` for spinning color wheels

### Section 6: SCROLL & INTERACTION

- `IntersectionObserver` for staggered reveal-on-scroll
- Parallax layers via transform + scroll offset (useEffect + scroll listener)
- Mouse-follow cursor glow (radial-gradient positioned at mouse)
- Card tilt on hover via CSS perspective + rotateX/Y

## Integration Points

| File | Change |
|------|--------|
| `skills/vibes/defaults/advanced-effects-prompt.txt` | NEW |
| `scripts/preview-server.js` | Load alongside `stylePrompt` in `handleGenerate()` |
| `scripts/lib/paths.js` | Add `advancedEffectsPrompt` constant |
| `skills/vibes/SKILL.md` | Add to "read on demand" table |
| `skills/launch/prompts/builder.md` | Add as step 4b |
| `CLAUDE.md` | Add to file reference tables |
