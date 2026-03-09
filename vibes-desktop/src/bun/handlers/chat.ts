import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { spawnClaude, type SpawnOpts } from "../claude-manager.ts";
import { getAnimationInstructions } from "../config.ts";
import type { PluginPaths } from "../plugin-discovery.ts";

export interface ChatContext {
	pluginPaths: PluginPaths;
	appsDir: string;
	currentApp: string | null;
}

const EFFECT_INSTRUCTIONS: Record<string, string> = {
	"3d": "Add WebGL or CSS 3D transforms. Use perspective, rotateX/Y/Z, preserve-3d.",
	animated:
		"Add @keyframes animations, CSS transitions, requestAnimationFrame loops, scroll-triggered effects.",
	interactive:
		"Add mouse-follow effects, drag interactions, hover morphs, parallax scrolling.",
	particles:
		"Add Canvas 2D particle system with useRef/useEffect. Particles drift and connect with proximity lines.",
	shader: "Add WebGL fragment shader with u_time, u_resolution, u_mouse uniforms. Use requestAnimationFrame.",
};

export function handleChat(
	ctx: ChatContext,
	rpc: any,
	params: {
		message: string;
		model?: string;
		designRef?: { type: string; content: string; intent?: string };
		animationId?: string;
		effects?: string[];
		skillId?: string;
	},
): string {
	const taskId = crypto.randomUUID();

	if (!ctx.currentApp) {
		rpc.send.error({ taskId, message: "No app loaded" });
		return taskId;
	}

	const appDir = join(ctx.appsDir, ctx.currentApp);
	const promptParts: string[] = [];
	let maxTurns = 8;

	// Animation instructions
	if (params.animationId) {
		const instructions = getAnimationInstructions(
			ctx.pluginPaths.animationDir,
			params.animationId,
		);
		if (instructions) {
			promptParts.push(`ANIMATION MODIFIER:\n${instructions}`);
			maxTurns = 12;
		}
	}

	// Legacy effect chips
	if (params.effects?.length) {
		const effectBlocks = params.effects
			.map((e) => EFFECT_INSTRUCTIONS[e])
			.filter(Boolean);
		if (effectBlocks.length) {
			promptParts.push(
				`EFFECT INSTRUCTIONS:\n${effectBlocks.join("\n\n")}`,
			);
			maxTurns = 12;
		}
	}

	// Design reference
	if (params.designRef) {
		if (params.designRef.type === "html") {
			const content = params.designRef.content.slice(0, 15000);
			promptParts.push(
				`DESIGN REFERENCE:\n${content}\n\nExtract colors, typography, layout from this reference.`,
			);
			maxTurns = 12;
		} else if (params.designRef.type === "image") {
			const intent = params.designRef.intent || "match";
			promptParts.push(
				`A design image has been provided. ${
					intent === "mood"
						? "Analyze mood and colors only."
						: "Match the layout and colors."
				}`,
			);
			maxTurns = 12;
		}
	}

	// Skill context
	if (params.skillId) {
		const skillContent = loadSkillContent(
			ctx.pluginPaths,
			params.skillId,
		);
		if (skillContent) {
			promptParts.push(
				`SKILL CONTEXT (adapt for web editor — no Bash, no Agent, focused on Edit calls):\n${skillContent.slice(0, 30000)}`,
			);
			maxTurns = 16;
		}
	}

	// User message
	promptParts.push(`User says: "${params.message}"`);

	const prompt = promptParts.join("\n\n");

	const opts: SpawnOpts = {
		maxTurns,
		model: params.model,
		tools: "Read,Edit,Write,Glob,Grep",
		cwd: appDir,
	};

	spawnClaude(taskId, prompt, opts, rpc);

	return taskId;
}

function loadSkillContent(
	pluginPaths: PluginPaths,
	skillId: string,
): string | null {
	const parts = skillId.split(":");
	if (parts.length !== 2) return null;

	const [targetPlugin, targetSkill] = parts;
	const home = homedir();
	const installedPath = join(
		home,
		".claude",
		"plugins",
		"installed_plugins.json",
	);
	if (!existsSync(installedPath)) return null;

	try {
		const raw = JSON.parse(readFileSync(installedPath, "utf-8"));
		const plugins = raw.plugins || raw;
		if (typeof plugins !== "object" || Array.isArray(plugins)) return null;

		for (const [key, value] of Object.entries(plugins)) {
			const atIdx = key.indexOf("@");
			const pluginName = atIdx >= 0 ? key.slice(0, atIdx) : key;
			if (pluginName !== targetPlugin) continue;

			const pluginEntry = Array.isArray(value)
				? (value as any[])[0]
				: value;
			const installPath = (pluginEntry as any)?.installPath;
			if (!installPath) continue;

			const skillMdPath = join(
				installPath,
				"skills",
				targetSkill,
				"SKILL.md",
			);
			if (!existsSync(skillMdPath)) continue;

			return readFileSync(skillMdPath, "utf-8");
		}
		return null;
	} catch {
		return null;
	}
}
