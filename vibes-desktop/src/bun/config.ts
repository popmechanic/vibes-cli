import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { PluginPaths } from "./plugin-discovery.ts";
import type {
	ThemeEntry,
	AnimationEntry,
	SkillEntry,
} from "../shared/rpc-types.ts";

export interface AppConfig {
	themes: ThemeEntry[];
	animations: AnimationEntry[];
	skills: SkillEntry[];
	themeRootCss: Record<string, string>;
	appsDir: string;
}

export function loadConfig(pluginPaths: PluginPaths): AppConfig {
	const themes = loadThemeCatalog(pluginPaths.themeDir);
	const animations = loadAnimationCatalog(pluginPaths.animationDir);
	const skills = discoverPluginSkills();
	const themeRootCss = loadThemeRootCss(pluginPaths.themeDir, themes);
	const appsDir = join(homedir(), ".vibes", "apps");

	return { themes, animations, skills, themeRootCss, appsDir };
}

// --- Theme Catalog ---

function loadThemeCatalog(themeDir: string): ThemeEntry[] {
	const catalogPath = join(themeDir, "catalog.txt");
	if (!existsSync(catalogPath)) return [];

	const content = readFileSync(catalogPath, "utf-8");
	const themes: ThemeEntry[] = [];

	for (const line of content.split("\n")) {
		if (!line.trim() || line.startsWith("#")) continue;
		// Format: id | name | mood | bestFor
		const parts = line.split("|").map((s) => s.trim());
		if (parts.length < 4) continue;

		const [id, name, mood, bestFor] = parts;
		const colors = parseThemeColors(themeDir, id);

		themes.push({ id, name, mood, bestFor, colors });
	}

	return themes;
}

function parseThemeColors(
	themeDir: string,
	themeId: string,
): ThemeEntry["colors"] {
	const defaults = {
		bg: "#1a1a2e",
		text: "#e0e0e0",
		accent: "#e94560",
		muted: "#666",
		border: "#333",
	};

	for (const ext of [".txt", ".md"]) {
		const filePath = join(themeDir, `${themeId}${ext}`);
		if (!existsSync(filePath)) continue;

		const content = readFileSync(filePath, "utf-8");
		const colors = { ...defaults };

		const bgMatch = content.match(/--bg[:\s]+([#\w]+)/);
		const textMatch = content.match(/--text[:\s]+([#\w]+)/);
		const accentMatch = content.match(/--accent[:\s]+([#\w]+)/);
		const mutedMatch = content.match(/--muted[:\s]+([#\w]+)/);
		const borderMatch = content.match(/--border[:\s]+([#\w]+)/);

		if (bgMatch) colors.bg = bgMatch[1];
		if (textMatch) colors.text = textMatch[1];
		if (accentMatch) colors.accent = accentMatch[1];
		if (mutedMatch) colors.muted = mutedMatch[1];
		if (borderMatch) colors.border = borderMatch[1];

		return colors;
	}

	return defaults;
}

// Plugin's parseThemeColors — set during init via setConfigModules()
let _pluginParseThemeColors:
	| ((themeDir: string, themeId: string) => any)
	| null = null;

export function setConfigModules(mods: {
	parseThemeColors: typeof _pluginParseThemeColors;
}) {
	_pluginParseThemeColors = mods.parseThemeColors;
}

/**
 * Load rootBlock CSS for each theme, including the --comp-* token bridge.
 */
function loadThemeRootCss(
	themeDir: string,
	themes: ThemeEntry[],
): Record<string, string> {
	const result: Record<string, string> = {};

	for (const theme of themes) {
		if (_pluginParseThemeColors) {
			const colors = _pluginParseThemeColors(themeDir, theme.id);
			if (colors?.rootBlock) {
				result[theme.id] = colors.rootBlock;
			}
		} else {
			// Fallback if plugin modules not yet loaded
			for (const ext of [".txt", ".md"]) {
				const filePath = join(themeDir, `${theme.id}${ext}`);
				if (!existsSync(filePath)) continue;
				const content = readFileSync(filePath, "utf-8");
				const rootMatch = content.match(/:root\s*\{[^}]+\}/s);
				if (rootMatch) result[theme.id] = rootMatch[0];
				break;
			}
		}
	}

	return result;
}

// --- Animation Catalog ---

function loadAnimationCatalog(animDir: string): AnimationEntry[] {
	const catalogPath = join(animDir, "catalog.txt");
	if (!existsSync(catalogPath)) return [];

	const content = readFileSync(catalogPath, "utf-8");
	const animations: AnimationEntry[] = [];

	for (const line of content.split("\n")) {
		if (!line.trim() || line.startsWith("#")) continue;
		const parts = line.split("|").map((s) => s.trim());
		if (parts.length < 3) continue;

		const [id, name, description] = parts;
		animations.push({ id, name, description });
	}

	return animations;
}

export function getAnimationInstructions(
	animDir: string,
	animationId: string,
): string | null {
	const filePath = join(animDir, `${animationId}.txt`);
	if (!existsSync(filePath)) return null;
	return readFileSync(filePath, "utf-8");
}

// --- Skill Discovery ---

function discoverPluginSkills(): SkillEntry[] {
	const home = homedir();
	const installedPath = join(
		home,
		".claude",
		"plugins",
		"installed_plugins.json",
	);
	if (!existsSync(installedPath)) return [];

	try {
		const raw = JSON.parse(readFileSync(installedPath, "utf-8"));
		const plugins = raw.plugins || raw;
		if (typeof plugins !== "object" || Array.isArray(plugins)) return [];

		const skills: SkillEntry[] = [];

		for (const [pluginKey, pluginData] of Object.entries(plugins)) {
			if (pluginKey.startsWith("vibes@")) continue;

			const atIdx = pluginKey.indexOf("@");
			const pluginName =
				atIdx >= 0 ? pluginKey.slice(0, atIdx) : pluginKey;

			const pluginEntry = Array.isArray(pluginData)
				? (pluginData as any[])[0]
				: pluginData;
			const installPath = pluginEntry?.installPath;
			if (!installPath || !existsSync(installPath)) continue;

			const pluginJsonPath = join(
				installPath,
				".claude-plugin",
				"plugin.json",
			);
			let skillsDir = join(installPath, "skills");
			if (existsSync(pluginJsonPath)) {
				try {
					const pj = JSON.parse(
						readFileSync(pluginJsonPath, "utf-8"),
					);
					if (pj.skills) skillsDir = join(installPath, pj.skills);
				} catch {}
			}
			if (!existsSync(skillsDir)) continue;

			for (const skillDir of readdirSync(skillsDir)) {
				const skillMdPath = join(skillsDir, skillDir, "SKILL.md");
				if (!existsSync(skillMdPath)) continue;

				const content = readFileSync(skillMdPath, "utf-8");
				const frontmatter = parseYamlFrontmatter(content);
				if (frontmatter.name) {
					skills.push({
						id: `${pluginName}:${skillDir}`,
						name: frontmatter.name,
						description: frontmatter.description || "",
						pluginName,
					});
				}
			}
		}

		return skills;
	} catch {
		return [];
	}
}

function parseYamlFrontmatter(content: string): Record<string, string> {
	const match = content.match(/^---\n([\s\S]*?)\n---/);
	if (!match) return {};

	const result: Record<string, string> = {};
	for (const line of match[1].split("\n")) {
		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) continue;
		const key = line.slice(0, colonIdx).trim();
		let value = line.slice(colonIdx + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		result[key] = value;
	}
	return result;
}

// --- Theme Auto-Selection ---

export function autoSelectTheme(
	themes: ThemeEntry[],
	userPrompt: string,
): string {
	const prompt = userPrompt.toLowerCase();
	let bestMatch = themes[0]?.id || "midnight";
	let bestScore = 0;

	for (const theme of themes) {
		let score = 0;
		const keywords = (theme.bestFor + " " + theme.mood)
			.toLowerCase()
			.split(/[\s,]+/);
		for (const kw of keywords) {
			if (kw && prompt.includes(kw)) score++;
		}
		if (score > bestScore) {
			bestScore = score;
			bestMatch = theme.id;
		}
	}

	return bestMatch;
}

// --- App Management Utils ---

export function slugifyPrompt(prompt: string): string {
	const filler = new Set([
		"a",
		"an",
		"the",
		"is",
		"it",
		"in",
		"on",
		"to",
		"for",
		"and",
		"or",
		"but",
		"with",
		"that",
		"this",
		"of",
		"my",
		"me",
		"i",
		"we",
		"make",
		"create",
		"build",
		"app",
	]);

	return (
		prompt
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, "")
			.split(/\s+/)
			.filter((w) => w && !filler.has(w))
			.slice(0, 4)
			.join("-")
			.slice(0, 63) || "untitled"
	);
}

export function resolveAppName(appsDir: string, slug: string): string {
	if (!existsSync(join(appsDir, slug))) return slug;

	for (let i = 2; i <= 99; i++) {
		const candidate = `${slug}-${i}`;
		if (!existsSync(join(appsDir, candidate))) return candidate;
	}

	return `${slug}-${Date.now()}`;
}
