import { describe, test, expect } from "bun:test";
import {
	discoverVibesPlugin,
	resolvePluginPaths,
} from "../plugin-discovery.ts";

describe("discoverVibesPlugin", () => {
	test("returns null when installed_plugins.json does not exist", async () => {
		const result = await discoverVibesPlugin("/nonexistent/home");
		expect(result).toBeNull();
	});

	test("resolvePluginPaths returns expected paths", () => {
		const paths = resolvePluginPaths("/fake/plugin/root");
		expect(paths.assembleScript).toBe(
			"/fake/plugin/root/scripts/assemble.js",
		);
		expect(paths.themeDir).toBe(
			"/fake/plugin/root/skills/vibes/themes",
		);
		expect(paths.animationDir).toBe(
			"/fake/plugin/root/skills/vibes/animations",
		);
		expect(paths.baseTemplate).toBe(
			"/fake/plugin/root/source-templates/base/template.html",
		);
		expect(paths.bundlesDir).toBe("/fake/plugin/root/bundles");
		expect(paths.stylePrompt).toBe(
			"/fake/plugin/root/skills/vibes/defaults/style-prompt.txt",
		);
	});
});
