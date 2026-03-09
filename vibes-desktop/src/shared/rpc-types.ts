export type VibesDesktopRPC = {
	bun: {
		requests: {
			// Setup
			checkClaude: {
				params: {};
				response: { installed: boolean; version?: string; path?: string };
			};
			checkAuth: {
				params: {};
				response: { authenticated: boolean; account?: string };
			};
			triggerLogin: {
				params: {};
				response: { success: boolean; error?: string };
			};
			checkPocketId: {
				params: {};
				response: { authenticated: boolean };
			};
			triggerPocketIdLogin: {
				params: {};
				response: { success: boolean };
			};

			// Generate
			generate: {
				params: {
					prompt: string;
					themeId?: string;
					model?: string;
					designRef?: {
						type: "image" | "html";
						content: string;
						intent?: string;
					};
					animationId?: string;
				};
				response: { taskId: string };
			};

			// Chat
			chat: {
				params: {
					message: string;
					model?: string;
					designRef?: {
						type: "image" | "html";
						content: string;
						intent?: string;
					};
					animationId?: string;
					effects?: string[];
					skillId?: string;
				};
				response: { taskId: string };
			};

			// Abort
			abort: {
				params: { taskId: string };
				response: { success: boolean };
			};

			// Theme
			switchTheme: {
				params: { themeId: string };
				response: { taskId: string };
			};
			getThemes: {
				params: {};
				response: { themes: ThemeEntry[] };
			};
			getAnimations: {
				params: {};
				response: { animations: AnimationEntry[] };
			};

			// App Management
			saveApp: {
				params: { name: string };
				response: { success: boolean };
			};
			loadApp: {
				params: { name: string };
				response: { success: boolean };
			};
			listApps: {
				params: {};
				response: { apps: AppEntry[] };
			};
			deleteApp: {
				params: { name: string };
				response: { success: boolean };
			};
			saveScreenshot: {
				params: { name: string; dataUrl: string };
				response: { success: boolean };
			};

			// Deploy
			deploy: {
				params: { name: string };
				response: { taskId: string };
			};

			// Config
			getSkills: {
				params: {};
				response: { skills: SkillEntry[] };
			};
			getConfig: {
				params: {};
				response: EditorConfig;
			};
		};
		messages: {};
	};
	webview: {
		requests: {};
		messages: {
			token: { taskId: string; text: string };
			toolUse: { taskId: string; tool: string; input: string };
			toolResult: {
				taskId: string;
				tool: string;
				output: string;
				isError: boolean;
			};
			status: {
				taskId: string;
				state:
					| "spawning"
					| "running"
					| "thinking"
					| "tool_use"
					| "idle";
				detail?: string;
				elapsedMs: number;
				lastActivityMs: number;
				progress?: number;
				stage?: string;
			};
			done: {
				taskId: string;
				text: string;
				cost: number;
				duration: number;
				hasEdited?: boolean;
			};
			error: { taskId: string; message: string };
			appUpdated: { path: string };
			themeSelected: { themeId: string };
			authRequired: { service: "anthropic" | "pocketid" };
			authComplete: { service: "anthropic" | "pocketid" };
			deployProgress: { stage: string; url?: string; error?: string };
		};
	};
};

export type ThemeEntry = {
	id: string;
	name: string;
	mood: string;
	bestFor: string;
	colors: {
		bg: string;
		text: string;
		accent: string;
		muted: string;
		border: string;
	};
};

export type AnimationEntry = {
	id: string;
	name: string;
	description: string;
};

export type AppEntry = {
	name: string;
	slug: string;
	thumbnailUrl?: string;
	createdAt: string;
	updatedAt: string;
};

export type SkillEntry = {
	id: string;
	name: string;
	description: string;
	pluginName: string;
};

export type EditorConfig = {
	pluginPath: string;
	appsDir: string;
	currentApp: string | null;
};
