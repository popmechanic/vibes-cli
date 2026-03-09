import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { spawnClaude, type SpawnOpts } from "../claude-manager.ts";
import { autoSelectTheme, slugifyPrompt, resolveAppName } from "../config.ts";
import type { PluginPaths } from "../plugin-discovery.ts";
import type { ThemeEntry } from "../../shared/rpc-types.ts";

export interface GenerateContext {
	pluginPaths: PluginPaths;
	themes: ThemeEntry[];
	themeRootCss: Record<string, string>;
	appsDir: string;
	currentApp: string | null;
	setCurrentApp: (name: string) => void;
}

export function handleGenerate(
	ctx: GenerateContext,
	rpc: any,
	params: {
		prompt: string;
		themeId?: string;
		model?: string;
		designRef?: { type: string; content: string; intent?: string };
		animationId?: string;
	},
): string {
	const taskId = crypto.randomUUID();

	// Create app directory
	const slug = slugifyPrompt(params.prompt);
	const appName = resolveAppName(ctx.appsDir, slug);
	const appDir = join(ctx.appsDir, appName);
	mkdirSync(appDir, { recursive: true });
	ctx.setCurrentApp(appName);

	// Select theme
	const themeId =
		params.themeId || autoSelectTheme(ctx.themes, params.prompt);
	const theme = ctx.themes.find((t) => t.id === themeId);

	// Load style guide
	let styleGuide = "";
	if (existsSync(ctx.pluginPaths.stylePrompt)) {
		styleGuide = readFileSync(ctx.pluginPaths.stylePrompt, "utf-8");
	}

	// Load theme content
	let themeContent = "";
	let themeEssentials = "";
	for (const ext of [".txt", ".md"]) {
		const themePath = join(ctx.pluginPaths.themeDir, `${themeId}${ext}`);
		if (existsSync(themePath)) {
			themeContent = readFileSync(themePath, "utf-8");
			themeEssentials = themeContent.slice(0, 4000);
			break;
		}
	}

	const rootCss = ctx.themeRootCss[themeId] || "";

	// Build prompt
	let prompt: string;
	let tools = "Write";
	let maxTurns = 5;

	if (params.designRef?.type === "html") {
		const refContent = params.designRef.content.slice(0, 30000);
		prompt = buildHtmlRefPrompt(params.prompt, refContent, styleGuide);
		maxTurns = 5;
	} else if (params.designRef?.type === "image") {
		// Save image to temp file so Claude can Read it
		const tmpDir = join(appDir, ".vibes-tmp");
		mkdirSync(tmpDir, { recursive: true });
		const refPath = join(tmpDir, "design-ref.png");
		const base64 =
			params.designRef.content.split(",")[1] ||
			params.designRef.content;
		writeFileSync(refPath, Buffer.from(base64, "base64"));

		prompt = buildImageRefPrompt(
			params.prompt,
			refPath,
			params.designRef.intent || "match",
			styleGuide,
		);
		tools = "Write,Read";
		maxTurns = 8;
	} else {
		prompt = buildStandardPrompt(
			params.prompt,
			styleGuide,
			themeEssentials,
			rootCss,
			theme?.name || themeId,
			themeId,
		);
	}

	const opts: SpawnOpts = {
		maxTurns,
		model: params.model,
		tools,
		cwd: appDir,
	};

	spawnClaude(taskId, prompt, opts, rpc);

	return taskId;
}

function buildStandardPrompt(
	userPrompt: string,
	styleGuide: string,
	themeEssentials: string,
	rootCss: string,
	themeName: string,
	themeId: string,
): string {
	return `You are an expert React app designer. Generate a beautiful, creative app.

USER REQUEST: "${userPrompt}"

=== MANDATORY THEME: "${themeName}" (id: "${themeId}") ===

Your app.jsx MUST start with these EXACT lines (copy-paste, do not modify):

\`\`\`jsx
window.__VIBES_THEMES__ = [{ id: "${themeId}", name: "${themeName}" }];

function useVibesTheme() {
  const [theme, setTheme] = React.useState(() => localStorage.getItem("vibes-theme") || "${themeId}");
  React.useEffect(() => {
    const handler = (e) => { const t = e.detail?.theme; if (t) { setTheme(t); localStorage.setItem("vibes-theme", t); } };
    document.addEventListener("vibes-design-request", handler);
    return () => document.removeEventListener("vibes-design-request", handler);
  }, []);
  return theme;
}
\`\`\`

Your <style> tag MUST include these EXACT CSS custom properties from the "${themeName}" theme:

\`\`\`css
${rootCss || `/* No :root block found — create one with warm oklch colors matching "${themeName}" */`}
\`\`\`

=== THEME PERSONALITY ===

${themeEssentials || "Bold neo-brutalist: strong typography, hard shadows, playful hover effects."}

=== DESIGN GUIDANCE ===

${styleGuide}

=== DESIGN REASONING ===

Think in a <design> block:
- How does "${themeName}" personality shape the visual choices?
- What custom SVG illustrations fit this app?
- What animations and effects match the theme mood? (Canvas particles, animated SVG, scroll reveals, card tilt, cursor glow)

=== WRITE app.jsx ===

Write the complete app to app.jsx. Rules:
- FIRST: the exact __VIBES_THEMES__ + useVibesTheme code shown above
- THEN: <style> tag with theme-sensitive CSS organized into marked sections (see below), plus component styles
- Add rich visual effects: Canvas 2D backgrounds, animated SVG illustrations, CSS @property animations, hover effects
- JSX with React hooks (useState, useEffect, useRef, useCallback, useMemo)
- useFireproofClerk("db-name") for database — returns { database, useLiveQuery, useDocument }
- NO import statements — runs in Babel script block with globals
- NO TypeScript. End with: export default App
- Never use CSS unicode escapes (\\2192, \\2022, \\00BB). Use actual Unicode characters instead.
- Responsive (mobile-first with Tailwind). className="btn" for buttons, "grid-background" on root

=== THEME SECTION MARKERS ===

Organize ALL visual CSS into marked sections. This enables fast theme switching.

In your <style> tag, wrap CSS in comment markers:

\`\`\`css
/* @theme:tokens */
:root { --comp-bg: ...; --comp-text: ...; /* all color variables */ }
/* @theme:tokens:end */

/* @theme:typography */
@import url('...');  /* Google Fonts or other font imports */
/* @theme:typography:end */

/* @theme:surfaces */
.glass-card { backdrop-filter: ...; }
.nav-button { display: flex; gap: 0.5rem; background: var(--comp-accent); border: 2px solid var(--comp-border); }
/* @theme:surfaces:end */

/* @theme:motion */
@keyframes drift { ... } /* all @keyframes and animation definitions */
/* @theme:motion:end */

/* Pure-layout ONLY — no visual properties */
.grid-wrapper { display: grid; gap: 1rem; max-width: 800px; margin: 0 auto; }
\`\`\`

In your JSX, wrap decorative elements:

\`\`\`jsx
{/* @theme:decoration */}
<svg className="atmospheric-bg">...</svg>
<div className="scan-line" />
{/* @theme:decoration:end */}
\`\`\`

Rules:
- EVERY :root block must be inside @theme:tokens markers
- EVERY @import font URL must be inside @theme:typography markers
- EVERY @keyframes must be inside @theme:motion markers
- Decorative SVGs and atmospheric elements go in @theme:decoration
- ANY class with visual properties (color, background, border, box-shadow, font-family, font-size, font-weight, text-shadow, fill, stroke, opacity, gradients) MUST go inside @theme:surfaces
- ONLY pure-layout classes go outside markers: display, grid-template, gap, padding, margin, position, z-index, width, max-width, height, flex-*, align-items, justify-content, overflow, box-sizing

DATABASE: useDocument({text:"",type:"item"}), useLiveQuery("type",{key:"item"}), database.put/del`;
}

function buildHtmlRefPrompt(
	userPrompt: string,
	htmlContent: string,
	styleGuide: string,
): string {
	return `You are an expert React app designer. Generate a beautiful, creative app.

=== DESIGN REFERENCE (HTML) ===

Study this HTML file's design — colors, typography, spacing, layout, surfaces, effects — and use it as your design spec.

\`\`\`html
${htmlContent}
\`\`\`

Extract the visual design from this HTML:
- COLOR PALETTE: map every color to oklch() values for the --comp-* tokens
- TYPOGRAPHY: font families, weights, sizing hierarchy
- SURFACES: border styles, shadows, gradients, glass effects
- LAYOUT PATTERNS: spatial organization, card styles, grid/flex structure
- MOTION/EFFECTS: animations, transitions, hover states
- --color-background MUST match the HTML's background. Never transparent.

USER REQUEST: "${userPrompt}"

Your app.jsx MUST start with these EXACT lines (copy-paste, do not modify):

\`\`\`jsx
window.__VIBES_THEMES__ = [{ id: "custom-ref", name: "Custom Reference" }];

function useVibesTheme() {
  const [theme, setTheme] = React.useState(() => localStorage.getItem("vibes-theme") || "custom-ref");
  React.useEffect(() => {
    const handler = (e) => { const t = e.detail?.theme; if (t) { setTheme(t); localStorage.setItem("vibes-theme", t); } };
    document.addEventListener("vibes-design-request", handler);
    return () => document.removeEventListener("vibes-design-request", handler);
  }, []);
  return theme;
}
\`\`\`

Derive ALL :root CSS tokens from the design reference above — do NOT use any predefined theme.

=== DESIGN GUIDANCE ===

${styleGuide}

=== WRITE app.jsx ===

Write the complete app to app.jsx. Rules:
- FIRST: the exact __VIBES_THEMES__ + useVibesTheme code shown above
- THEN: <style> tag with reference-derived CSS organized into marked sections
- Theme section markers: @theme:tokens, @theme:typography, @theme:surfaces, @theme:motion, @theme:decoration
- NO import statements — runs in Babel script block with globals
- NO TypeScript. End with: export default App
- Never use CSS unicode escapes. Use actual Unicode characters.
- useFireproofClerk("db-name") for database

DATABASE: useDocument({text:"",type:"item"}), useLiveQuery("type",{key:"item"}), database.put/del`;
}

function buildImageRefPrompt(
	userPrompt: string,
	imageRefPath: string,
	intent: string,
	styleGuide: string,
): string {
	const analyzeBlock = `MANDATORY FIRST STEP: Read the image at ${imageRefPath} using the Read tool.

ANALYZE the image like a theme designer — before writing any code, identify:
- MOOD: 3-4 adjectives describing the visual feeling
- COLOR PALETTE: extract every distinct color as oklch() — background, text, accent, borders, muted tones
- DESIGN PRINCIPLES: border styles, shadow depth, spacing rhythm
- TYPOGRAPHY FEEL: weight, style, sizing hierarchy
- SURFACE TREATMENT: glass/frosted effects, gradients, textures, card styles
- MOTION ENERGY: calm/lively/dramatic — what kind of transitions and hover effects fit
- DECORATIVE ELEMENTS: any SVG patterns, background shapes, dividers, icons style
${intent === "match" ? "- LAYOUT STRUCTURE: how is the space divided? sidebar? header? grid? cards? split-pane?" : ""}

${
	intent === "mood"
		? "Apply the MOOD and COLOR PALETTE from this image to the app you generate."
		: "Apply BOTH the visual style AND layout structure from this image to the app you generate."
}
Use the extracted oklch() colors for the --comp-* tokens and :root block.
--color-background MUST match the image's background. Never leave it transparent or unset.
${intent === "match" ? "The goal: the generated app should look like the image was its design spec." : ""}`;

	return `${analyzeBlock}

You are an expert React app designer. Generate a beautiful, creative app.

USER REQUEST: "${userPrompt}"

Your app.jsx MUST start with these EXACT lines (copy-paste, do not modify):

\`\`\`jsx
window.__VIBES_THEMES__ = [{ id: "custom-ref", name: "Custom Reference" }];

function useVibesTheme() {
  const [theme, setTheme] = React.useState(() => localStorage.getItem("vibes-theme") || "custom-ref");
  React.useEffect(() => {
    const handler = (e) => { const t = e.detail?.theme; if (t) { setTheme(t); localStorage.setItem("vibes-theme", t); } };
    document.addEventListener("vibes-design-request", handler);
    return () => document.removeEventListener("vibes-design-request", handler);
  }, []);
  return theme;
}
\`\`\`

Derive ALL :root CSS tokens from the design reference above — do NOT use any predefined theme.

=== DESIGN GUIDANCE ===

${styleGuide}

=== WRITE app.jsx ===

Write the complete app to app.jsx. Rules:
- FIRST: the exact __VIBES_THEMES__ + useVibesTheme code shown above
- THEN: <style> tag with image-derived CSS organized into marked sections
- Theme section markers: @theme:tokens, @theme:typography, @theme:surfaces, @theme:motion, @theme:decoration
- Add rich visual effects: Canvas 2D backgrounds, animated SVG, CSS @property animations
- NO import statements — runs in Babel script block with globals
- NO TypeScript. End with: export default App
- Never use CSS unicode escapes. Use actual Unicode characters.
- useFireproofClerk("db-name") for database

DATABASE: useDocument({text:"",type:"item"}), useLiveQuery("type",{key:"item"}), database.put/del`;
}
