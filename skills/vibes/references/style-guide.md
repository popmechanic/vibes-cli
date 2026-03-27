---
name: Style Guide
description: >
  OKLCH color system, design token overrides, gradients, bold graphic patterns,
  glass morphism, color modifications, Tailwind integration for Vibes apps.
inject: system-prompt
---

## UI Style & Theming

### OKLCH Colors (Recommended)

Use OKLCH for predictable, vibrant colors. Unlike RGB/HSL, OKLCH has perceptual lightness - changing L by 10% looks the same across all hues.

```css
oklch(L C H)
/* L = Lightness (0-1): 0 black, 1 white */
/* C = Chroma (0-0.4): 0 gray, higher = more saturated */
/* H = Hue (0-360): color wheel degrees */
```

**Theme-appropriate palettes:**

```jsx
{/* Dark/moody theme */}
className="bg-[oklch(0.15_0.02_250)]"  /* Deep blue-black */

{/* Warm/cozy theme */}
className="bg-[oklch(0.25_0.08_30)]"   /* Warm brown */

{/* Fresh/bright theme */}
className="bg-[oklch(0.95_0.03_150)]"  /* Mint white */

{/* Vibrant accent */}
className="bg-[oklch(0.7_0.2_145)]"    /* Vivid green */
```

### Better Gradients with OKLCH

Use `in oklch` for smooth gradients without muddy middle zones:

```jsx
{/* Smooth gradient - no gray middle */}
className="bg-[linear-gradient(in_oklch,oklch(0.6_0.2_250),oklch(0.6_0.2_150))]"

{/* Sunset gradient */}
className="bg-[linear-gradient(135deg_in_oklch,oklch(0.7_0.25_30),oklch(0.5_0.2_330))]"

{/* Dark glass effect */}
className="bg-[linear-gradient(180deg_in_oklch,oklch(0.2_0.05_270),oklch(0.1_0.02_250))]"
```

### Bold Graphic Style (Optional)

For bold, graphic UI:

- **Borders**: thick 4px, dark `border-[#0f172a]`
- **Shadows**: hard offset `shadow-[6px_6px_0px_#0f172a]`
- **Corners**: square (0px) OR pill (rounded-full) - no in-between

```jsx
<button className="px-6 py-3 bg-[oklch(0.95_0.02_90)] border-4 border-[#0f172a] shadow-[6px_6px_0px_#0f172a] hover:shadow-[4px_4px_0px_#0f172a] font-bold">
  Click Me
</button>
```

### Glass Morphism (Dark themes)

```jsx
<div className="bg-white/5 backdrop-blur-lg border border-white/10 rounded-2xl">
  {/* content */}
</div>
```

### Color Modifications

Lighten/darken using L value:
- **Hover**: increase L by 0.05-0.1
- **Active/pressed**: decrease L by 0.05
- **Disabled**: reduce C to near 0

---
