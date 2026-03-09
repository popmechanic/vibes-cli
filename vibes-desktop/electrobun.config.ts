import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "Vibes Editor",
		identifier: "com.vibes.desktop-editor",
		version: "0.1.79",
	},
	build: {
		mac: { bundleCEF: false },
		linux: { bundleCEF: false },
		win: { bundleCEF: false },
	},
} satisfies ElectrobunConfig;
