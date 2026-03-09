// ElectroBun postBuild hook — runs after app bundle is built, before tarball compression.
// Copies libWindowControls.dylib into the app bundle so it's included in the tarball.
import { cpSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const cwd = process.cwd();
const dylib = join(cwd, "native", "macos", "build", "libWindowControls.dylib");
const appBun = join(cwd, "build", "stable-macos-arm64", "VibesOS.app", "Contents", "Resources", "app", "bun");

if (!existsSync(dylib)) {
	console.error("  postBuild: libWindowControls.dylib not found at", dylib);
	process.exit(1);
}

if (!existsSync(appBun)) {
	console.error("  postBuild: app/bun dir not found at", appBun);
	process.exit(1);
}

const dest = join(appBun, "libWindowControls.dylib");
cpSync(dylib, dest);

// Sign with Developer ID (ElectroBun only signs Contents/MacOS/ binaries)
const devId = process.env.ELECTROBUN_DEVELOPER_ID;
if (devId) {
	const id = devId.includes("Developer ID") ? devId : `Developer ID Application: ${devId}`;
	const result = Bun.spawnSync([
		"codesign", "--force", "--timestamp", "--sign", id,
		"--options", "runtime", dest
	]);
	if (result.exitCode !== 0) {
		console.error("  postBuild: codesign failed:", result.stderr.toString());
		process.exit(1);
	}
	console.log("  postBuild: signed and copied libWindowControls.dylib");
} else {
	console.log("  postBuild: copied libWindowControls.dylib (unsigned — no ELECTROBUN_DEVELOPER_ID)");
}
