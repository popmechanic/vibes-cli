import { dlopen, FFIType } from "bun:ffi";
import { join, dirname } from "path";
import { existsSync } from "fs";

function findDylib(): string {
	// Walk up from this file to find native/macos/build/
	let dir = dirname(import.meta.dir);
	for (let i = 0; i < 10; i++) {
		const candidate = join(dir, "native", "macos", "build", "libWindowControls.dylib");
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error("libWindowControls.dylib not found — run native/macos/build-window-controls.sh");
}

const lib = dlopen(findDylib(), {
	hideZoomButton: {
		args: [],
		returns: FFIType.void,
	},
});

export const { hideZoomButton } = lib.symbols;
