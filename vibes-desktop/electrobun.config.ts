import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "VibesOS",
		identifier: "com.vibes.os",
		version: "0.1.80",
	},
	build: {
		mac: { bundleCEF: false, codesign: true, notarize: true },
		linux: { bundleCEF: false },
		win: { bundleCEF: false },
	},
	scripts: {
		postBuild: "scripts/post-build.ts",
		postWrap: "scripts/post-wrap.ts",
	},
} satisfies ElectrobunConfig;
