// ElectroBun postWrap hook — runs after self-extracting bundle is created, before code signing.
// Copies libWindowControls.dylib into the wrapper's Resources so it's signed and notarized.
import { cpSync, existsSync } from "fs";
import { join, dirname } from "path";

const wrapperPath = process.env.ELECTROBUN_WRAPPER_BUNDLE_PATH;
if (!wrapperPath) {
	console.error("  postWrap: ELECTROBUN_WRAPPER_BUNDLE_PATH not set");
	process.exit(1);
}

// Working directory is vibes-desktop/ when ElectroBun runs hooks
const dylib = join(process.cwd(), "native", "macos", "build", "libWindowControls.dylib");
const dest = join(wrapperPath, "Contents", "Resources", "libWindowControls.dylib");

if (existsSync(dylib)) {
	cpSync(dylib, dest);
	// Sign the dylib with Developer ID so notarization passes
	const devId = process.env.ELECTROBUN_DEVELOPER_ID;
	if (devId) {
		const id = devId.includes("Developer ID") ? devId : `Developer ID Application: ${devId}`;
		const result = Bun.spawnSync([
			"codesign", "--force", "--timestamp", "--sign", id,
			"--options", "runtime", dest
		]);
		if (result.exitCode !== 0) {
			console.error("  postWrap: codesign failed:", result.stderr.toString());
			process.exit(1);
		}
		console.log("  postWrap: signed and bundled libWindowControls.dylib");
	} else {
		console.log("  postWrap: bundled libWindowControls.dylib (unsigned — no ELECTROBUN_DEVELOPER_ID)");
	}
} else {
	console.error("  postWrap: libWindowControls.dylib not found at", dylib);
	process.exit(1);
}
