import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "VibesOS",
		identifier: "com.vibes.os",
		version: "0.1.97",
	},
	build: {
		mac: { bundleCEF: false, codesign: true, notarize: true },
		linux: { bundleCEF: false },
		win: { bundleCEF: false },
	},
	release: {
		baseUrl: "https://install.vibesos.com/updates",
	},
	scripts: {
		postBuild: "scripts/post-build.ts",
		postWrap: "scripts/post-wrap.ts",
	},
} satisfies ElectrobunConfig;
