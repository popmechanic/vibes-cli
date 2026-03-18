// vibes-desktop/src/bun/update-check.ts
// Auto-updater: check for updates, skip tracking, download + apply.

import { Updater } from "electrobun/bun";
import type { UpdateStatusEntry } from "electrobun/bun";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { BrowserWindow } from "electrobun/bun";
import { waitForSetupAction } from "./setup-ipc.ts";
import { jsStr } from "./claude-auth.ts";

const VIBES_DIR = join(homedir(), ".vibes");
const SKIP_FILE = join(VIBES_DIR, "skipped-update.json");

/** Read the skipped update hash, or null if none. */
function getSkippedHash(): string | null {
	try {
		if (!existsSync(SKIP_FILE)) return null;
		const data = JSON.parse(readFileSync(SKIP_FILE, "utf-8"));
		return data.hash || null;
	} catch {
		return null;
	}
}

/** Write the skipped hash to disk. */
function setSkippedHash(hash: string): void {
	mkdirSync(VIBES_DIR, { recursive: true });
	writeFileSync(SKIP_FILE, JSON.stringify({ hash }));
}

export interface UpdateCheckResult {
	/** Whether an update was applied (app will relaunch) */
	applied: boolean;
	/** Whether the user skipped */
	skipped: boolean;
}

/**
 * Check for updates, prompt the user, and optionally download + apply.
 *
 * Called on every launch after auth but before starting the editor server.
 * Non-blocking: a 5-second timeout ensures the app always proceeds.
 *
 * @param mainWindow - The BrowserWindow showing the setup/update UI
 * @param currentVersion - The current app version string
 * @param log - Logger function
 * @returns UpdateCheckResult
 */
export async function checkAndPromptForUpdate(
	mainWindow: BrowserWindow,
	currentVersion: string,
	log: (...args: any[]) => void,
): Promise<UpdateCheckResult> {
	log("[update] Checking for updates...");

	// Check with 5-second timeout
	let updateInfo;
	try {
		updateInfo = await Promise.race([
			Updater.checkForUpdate(),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error("timeout")), 5000)
			),
		]) as Awaited<ReturnType<typeof Updater.checkForUpdate>>;
	} catch (err: any) {
		log(`[update] Check failed or timed out: ${err.message}`);
		return { applied: false, skipped: false };
	}

	if (updateInfo.error) {
		log(`[update] Check returned error: ${updateInfo.error}`);
		return { applied: false, skipped: false };
	}

	if (!updateInfo.updateAvailable) {
		log("[update] No update available");
		return { applied: false, skipped: false };
	}

	const newVersion = updateInfo.version || "new version";
	log(`[update] Update available: ${newVersion} (hash: ${updateInfo.hash})`);

	// Check skip tracking
	const skippedHash = getSkippedHash();
	if (skippedHash && skippedHash === updateInfo.hash) {
		log(`[update] Update hash ${updateInfo.hash} was previously skipped`);
		return { applied: false, skipped: true };
	}

	// Show update prompt UI
	mainWindow.webview.loadHTML((await import("./setup-html.ts")).SETUP_HTML);
	await new Promise(r => setTimeout(r, 300));
	mainWindow.webview.executeJavascript(
		`showUpdateScreen(${jsStr(currentVersion)}, ${jsStr(newVersion)})`
	);

	// Wait for user choice
	const action = await waitForSetupAction(["update-now", "update-skip"]);

	if (action === "update-skip") {
		log(`[update] User skipped update (hash: ${updateInfo.hash})`);
		setSkippedHash(updateInfo.hash);
		return { applied: false, skipped: true };
	}

	// User chose Update Now — download and apply
	log("[update] User chose to update, starting download...");
	mainWindow.webview.executeJavascript(`showUpdateProgress("Downloading update...")`);

	// Wire up progress callback
	Updater.onStatusChange((entry: UpdateStatusEntry) => {
		log(`[update] Status: ${entry.status} — ${entry.message}`);
		const progress = entry.details?.progress;
		if (progress != null) {
			mainWindow.webview.executeJavascript(`updateUpdateProgress(${progress})`);
		}
		// Update status text for key phases
		if (entry.status === "applying-patch") {
			mainWindow.webview.executeJavascript(`showUpdateProgress("Applying patch...")`);
		} else if (entry.status === "decompressing") {
			mainWindow.webview.executeJavascript(`showUpdateProgress("Decompressing...")`);
		} else if (entry.status === "replacing-app") {
			mainWindow.webview.executeJavascript(`showUpdateProgress("Installing...")`);
		}
	});

	try {
		await Updater.downloadUpdate();
		log("[update] Download complete, applying...");
		mainWindow.webview.executeJavascript(`showUpdateProgress("Applying update...")`);
		mainWindow.webview.executeJavascript(`updateUpdateProgress(100)`);
		await Updater.applyUpdate();
		// applyUpdate() calls quit() and relaunches — if we reach here, it didn't work
		log("[update] applyUpdate() returned without restarting — treating as failure");
		return { applied: false, skipped: false };
	} catch (err: any) {
		log(`[update] Download/apply failed: ${err.message}`);
		Updater.onStatusChange(null);
		mainWindow.webview.executeJavascript(
			`showUpdateError(${jsStr("Download failed — " + err.message)})`
		);
		// Wait for user to click "Continue without updating"
		await waitForSetupAction(["update-skip"]);
		return { applied: false, skipped: false };
	}
}
