import { Electroview } from "electrobun/view";
import type { VibesDesktopRPC } from "../shared/rpc-types.ts";

// Module-level callbacks for React to subscribe to
export const callbacks = {
	onToken: null as
		| ((data: VibesDesktopRPC["webview"]["messages"]["token"]) => void)
		| null,
	onToolUse: null as
		| ((data: VibesDesktopRPC["webview"]["messages"]["toolUse"]) => void)
		| null,
	onToolResult: null as
		| ((
				data: VibesDesktopRPC["webview"]["messages"]["toolResult"],
		  ) => void)
		| null,
	onStatus: null as
		| ((data: VibesDesktopRPC["webview"]["messages"]["status"]) => void)
		| null,
	onDone: null as
		| ((data: VibesDesktopRPC["webview"]["messages"]["done"]) => void)
		| null,
	onError: null as
		| ((data: VibesDesktopRPC["webview"]["messages"]["error"]) => void)
		| null,
	onAppUpdated: null as
		| ((
				data: VibesDesktopRPC["webview"]["messages"]["appUpdated"],
		  ) => void)
		| null,
	onThemeSelected: null as
		| ((
				data: VibesDesktopRPC["webview"]["messages"]["themeSelected"],
		  ) => void)
		| null,
	onAuthRequired: null as
		| ((
				data: VibesDesktopRPC["webview"]["messages"]["authRequired"],
		  ) => void)
		| null,
	onAuthComplete: null as
		| ((
				data: VibesDesktopRPC["webview"]["messages"]["authComplete"],
		  ) => void)
		| null,
	onDeployProgress: null as
		| ((
				data: VibesDesktopRPC["webview"]["messages"]["deployProgress"],
		  ) => void)
		| null,
};

const rpc = Electroview.defineRPC<VibesDesktopRPC>({
	handlers: {
		requests: {},
		messages: {
			token: (data) => callbacks.onToken?.(data),
			toolUse: (data) => callbacks.onToolUse?.(data),
			toolResult: (data) => callbacks.onToolResult?.(data),
			status: (data) => callbacks.onStatus?.(data),
			done: (data) => callbacks.onDone?.(data),
			error: (data) => callbacks.onError?.(data),
			appUpdated: (data) => callbacks.onAppUpdated?.(data),
			themeSelected: (data) => callbacks.onThemeSelected?.(data),
			authRequired: (data) => callbacks.onAuthRequired?.(data),
			authComplete: (data) => callbacks.onAuthComplete?.(data),
			deployProgress: (data) => callbacks.onDeployProgress?.(data),
		},
	},
});

export const electrobun = new Electroview({ rpc });
