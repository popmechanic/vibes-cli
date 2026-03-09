import { describe, test, expect } from "bun:test";
import { resolveClaudePath, cleanEnv } from "../auth.ts";

describe("resolveClaudePath", () => {
	test("returns a non-empty string", () => {
		const path = resolveClaudePath();
		expect(path).toBeTruthy();
		expect(typeof path).toBe("string");
	});
});

describe("cleanEnv", () => {
	test("removes nesting guard variables", () => {
		process.env.CLAUDECODE = "1";
		process.env.CLAUDE_CODE_ENTRYPOINT = "test";
		const env = cleanEnv();
		expect(env.CLAUDECODE).toBeUndefined();
		expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
		delete process.env.CLAUDECODE;
		delete process.env.CLAUDE_CODE_ENTRYPOINT;
	});

	test("preserves CLAUDE_CODE_OAUTH_TOKEN", () => {
		process.env.CLAUDE_CODE_OAUTH_TOKEN = "keep-me";
		const env = cleanEnv();
		expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("keep-me");
		delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
	});

	test("removes CMUX variables", () => {
		process.env.CMUX_SURFACE_ID = "test";
		process.env.CMUX_PANEL_ID = "test";
		const env = cleanEnv();
		expect(env.CMUX_SURFACE_ID).toBeUndefined();
		expect(env.CMUX_PANEL_ID).toBeUndefined();
		delete process.env.CMUX_SURFACE_ID;
		delete process.env.CMUX_PANEL_ID;
	});
});
