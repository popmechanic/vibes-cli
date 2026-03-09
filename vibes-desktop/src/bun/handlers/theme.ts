import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { spawnClaude, type SpawnOpts } from "../claude-manager.ts";
import type { PluginPaths } from "../plugin-discovery.ts";
import type { ThemeEntry } from "../../shared/rpc-types.ts";

export interface ThemeContext {
	pluginPaths: PluginPaths;
	themes: ThemeEntry[];
	appsDir: string;
	currentApp: string | null;
}

// Shared utilities loaded from plugin during init
let _parseThemeColors:
	| ((themeDir: string, themeId: string) => any)
	| null = null;
let _extractPass2ThemeContext:
	| ((content: string, maxBytes?: number) => string)
	| null = null;
let _hasThemeMarkers: ((code: string) => boolean) | null = null;
let _replaceThemeSection:
	| ((code: string, section: string, content: string) => string)
	| null = null;
let _extractNonThemeSections: ((code: string) => string) | null = null;
let _moveVisualCSSToSurfaces: ((code: string) => string) | null = null;
let _createBackup: ((path: string) => void) | null = null;
let _restoreFromBackup:
	| ((path: string) => { success: boolean })
	| null = null;

export function setThemeModules(mods: {
	parseThemeColors: typeof _parseThemeColors;
	extractPass2ThemeContext: typeof _extractPass2ThemeContext;
	hasThemeMarkers: typeof _hasThemeMarkers;
	replaceThemeSection: typeof _replaceThemeSection;
	extractNonThemeSections: typeof _extractNonThemeSections;
	moveVisualCSSToSurfaces: typeof _moveVisualCSSToSurfaces;
	createBackup: typeof _createBackup;
	restoreFromBackup: typeof _restoreFromBackup;
}) {
	_parseThemeColors = mods.parseThemeColors;
	_extractPass2ThemeContext = mods.extractPass2ThemeContext;
	_hasThemeMarkers = mods.hasThemeMarkers;
	_replaceThemeSection = mods.replaceThemeSection;
	_extractNonThemeSections = mods.extractNonThemeSections;
	_moveVisualCSSToSurfaces = mods.moveVisualCSSToSurfaces;
	_createBackup = mods.createBackup;
	_restoreFromBackup = mods.restoreFromBackup;
}

/**
 * Replace __VIBES_THEMES__ array and useVibesTheme default in app code.
 */
function updateThemeMeta(
	code: string,
	themeId: string,
	themeName: string,
): string {
	let result = code.replace(
		/window\.__VIBES_THEMES__\s*=\s*\[[\s\S]*?\]/,
		() =>
			`window.__VIBES_THEMES__ = [{ id: "${themeId}", name: "${themeName}" }]`,
	);
	result = result.replace(
		/localStorage\.getItem\("vibes-theme"\)\s*\|\|\s*"[^"]*"/,
		() => `localStorage.getItem("vibes-theme") || "${themeId}"`,
	);
	return result;
}

export function handleSwitchTheme(
	ctx: ThemeContext,
	rpc: any,
	themeId: string,
): string {
	const taskId = crypto.randomUUID();

	if (!ctx.currentApp) {
		rpc.send.error({ taskId, message: "No app loaded" });
		return taskId;
	}

	if (!_parseThemeColors || !_hasThemeMarkers || !_replaceThemeSection) {
		rpc.send.error({ taskId, message: "Theme modules not loaded" });
		return taskId;
	}

	const appDir = join(ctx.appsDir, ctx.currentApp);
	const appJsxPath = join(appDir, "app.jsx");

	if (!existsSync(appJsxPath)) {
		rpc.send.error({ taskId, message: "No app.jsx found" });
		return taskId;
	}

	const appCode = readFileSync(appJsxPath, "utf-8");
	const theme = ctx.themes.find((t) => t.id === themeId);
	const themeName = theme?.name || themeId;

	// Load full theme content (for Pass 2 creative context)
	let themeContent = "";
	for (const ext of [".txt", ".md"]) {
		const themePath = join(ctx.pluginPaths.themeDir, `${themeId}${ext}`);
		if (existsSync(themePath)) {
			themeContent = readFileSync(themePath, "utf-8");
			break;
		}
	}

	// Parse colors with buildCompTokenMapping
	const colors = _parseThemeColors(ctx.pluginPaths.themeDir, themeId);

	rpc.send.themeSelected({ themeId });

	if (_hasThemeMarkers(appCode)) {
		handleMultiPassTheme(
			taskId,
			ctx,
			rpc,
			themeId,
			themeName,
			themeContent,
			appCode,
			appJsxPath,
			appDir,
			colors,
		);
	} else {
		handleLegacyTheme(
			taskId,
			ctx,
			rpc,
			themeId,
			themeName,
			themeContent,
			appDir,
			colors,
		);
	}

	return taskId;
}

/**
 * Multi-pass theme switch:
 * Pass 1: Instant mechanical replacement of @theme:tokens and @theme:typography.
 * Pass 2: Claude creative restyle of @theme:surfaces, @theme:motion, @theme:decoration.
 */
function handleMultiPassTheme(
	taskId: string,
	ctx: ThemeContext,
	rpc: any,
	themeId: string,
	themeName: string,
	themeContent: string,
	appCode: string,
	appJsxPath: string,
	appDir: string,
	colors: any,
) {
	// === Pass 1: Mechanical token + typography replacement (instant) ===
	let updatedCode = appCode;

	if (colors?.rootBlock) {
		updatedCode = _replaceThemeSection!(
			updatedCode,
			"tokens",
			colors.rootBlock,
		);
		console.log(
			`[ThemeSwitch] Pass 1: replaced tokens (${colors.rootBlock.split("\n").length} lines)`,
		);
	}

	if (colors?.fontImports?.length > 0) {
		updatedCode = _replaceThemeSection!(
			updatedCode,
			"typography",
			colors.fontImports.join("\n"),
		);
		console.log(
			`[ThemeSwitch] Pass 1: replaced typography (${colors.fontImports.length} fonts)`,
		);
	}

	updatedCode = updateThemeMeta(updatedCode, themeId, themeName);

	// Move orphaned visual CSS into @theme:surfaces before Pass 2
	if (_moveVisualCSSToSurfaces) {
		updatedCode = _moveVisualCSSToSurfaces(updatedCode);
	}

	_createBackup?.(appJsxPath);
	writeFileSync(appJsxPath, updatedCode, "utf-8");

	// Notify preview to refresh after Pass 1
	rpc.send.appUpdated({ path: "app.jsx" });
	console.log(
		"[ThemeSwitch] Pass 1 complete — tokens + typography applied",
	);

	// === Pass 2: Claude creative restyle ===
	const pass1Code = readFileSync(appJsxPath, "utf-8");

	const pass2Context =
		_extractPass2ThemeContext?.(themeContent, 12000) ||
		themeContent.slice(0, 4000);

	const prompt = `Restyle ONLY the marked theme sections in app.jsx for the "${themeName}" theme.

=== CURRENT app.jsx ===

\`\`\`jsx
${pass1Code}
\`\`\`

=== WHAT TO EDIT ===

You MUST only edit content between these marker pairs in app.jsx:
- \`/* @theme:surfaces */\` ... \`/* @theme:surfaces:end */\` — CSS classes for shadows, borders, backgrounds, glass effects
- \`/* @theme:motion */\` ... \`/* @theme:motion:end */\` — @keyframes and animation definitions
- \`{/* @theme:decoration */}\` ... \`{/* @theme:decoration:end */}\` — SVG elements and atmospheric backgrounds

=== THEME PERSONALITY ===

${pass2Context}

=== RULES ===

- Replace the content BETWEEN each marker pair. Keep the markers themselves.
- Match the theme's personality: shadows, glass effects, gradients, animations, SVG decorations.
- Do NOT modify anything outside the markers — no layout, no logic, no tokens, no typography.
- No import statements, no TypeScript, keep export default App.
- Never use CSS unicode escapes (\\2192, \\2022, \\00BB). Use actual Unicode characters instead.`;

	const opts: SpawnOpts = {
		maxTurns: 5,
		tools: "Read,Edit",
		cwd: appDir,
	};

	spawnClaude(taskId, prompt, opts, rpc);
}

/**
 * Legacy theme switch: full-file Claude restyle (no markers).
 */
function handleLegacyTheme(
	taskId: string,
	ctx: ThemeContext,
	rpc: any,
	themeId: string,
	themeName: string,
	themeContent: string,
	appDir: string,
	colors: any,
) {
	let rootCss = colors?.rootBlock || "";
	if (!rootCss) {
		const rootMatch = themeContent.match(/:root\s*\{[\s\S]*?\}/);
		if (rootMatch) rootCss = rootMatch[0];
	}

	const appJsxPath = join(appDir, "app.jsx");
	const appCode = readFileSync(appJsxPath, "utf-8");

	const pass2Context =
		_extractPass2ThemeContext?.(themeContent, 14000) ||
		themeContent.slice(0, 4000);

	const prompt = `Restyle app.jsx to the "${themeName}" (${themeId}) theme.

=== CURRENT app.jsx ===

\`\`\`jsx
${appCode}
\`\`\`

=== MANDATORY CSS CHANGES ===

Replace the ENTIRE :root block in the <style> tag with this EXACT CSS:

\`\`\`css
${rootCss || `/* Build :root with oklch colors matching "${themeName}" */`}
\`\`\`

Replace __VIBES_THEMES__ with: [{ id: "${themeId}", name: "${themeName}" }]
Replace useVibesTheme default with: "${themeId}"

=== THEME PERSONALITY ===

${pass2Context}

=== RULES ===

CHANGE (visual only):
- :root CSS variables -> use the EXACT block above
- Backgrounds, shadows, borders, fonts -> match theme's design principles
- Animations, SVG elements -> match theme's mood
- __VIBES_THEMES__ and useVibesTheme default -> "${themeId}"

KEEP UNCHANGED:
- All components, hooks, functions, state, data models, layout structure
- All Fireproof database calls, document types, query filters
- No import statements, no TypeScript, keep export default App
- Never use CSS unicode escapes (\\2192, \\2022, \\00BB). Use actual Unicode characters instead.`;

	const opts: SpawnOpts = {
		maxTurns: 8,
		tools: "Read,Edit",
		cwd: appDir,
	};

	spawnClaude(taskId, prompt, opts, rpc);
}
