import {
	existsSync,
	readFileSync,
	writeFileSync,
} from "fs";
import { join } from "path";
import type { PluginPaths } from "../plugin-discovery.ts";
import { cleanEnv } from "../auth.ts";

const DEPLOY_API_URL = "https://vibes-deploy-api.marcus-e.workers.dev";

export interface DeployContext {
	pluginPaths: PluginPaths;
	appsDir: string;
	currentApp: string | null;
}

export async function handleDeploy(
	ctx: DeployContext,
	rpc: any,
	appName: string,
): Promise<string> {
	const taskId = crypto.randomUUID();

	const appDir = join(ctx.appsDir, appName);
	const appJsxPath = join(appDir, "app.jsx");
	const indexHtmlPath = join(appDir, "index.html");

	if (!existsSync(appJsxPath)) {
		rpc.send.error({ taskId, message: "No app.jsx found" });
		return taskId;
	}

	// Check Pocket ID auth — obtain access token via getAccessToken()
	rpc.send.deployProgress({ stage: "authenticating" });
	const { getAccessToken } = await import(
		join(ctx.pluginPaths.root, "scripts", "lib", "cli-auth.js")
	);
	const { OIDC_AUTHORITY, OIDC_CLIENT_ID } = await import(
		join(ctx.pluginPaths.root, "scripts", "lib", "auth-constants.js")
	);

	let token: string;
	try {
		const tokens = await getAccessToken({
			authority: OIDC_AUTHORITY,
			clientId: OIDC_CLIENT_ID,
			silent: true,
		});
		if (!tokens) {
			rpc.send.authRequired({ service: "pocketid" });
			return taskId;
		}
		token = tokens.accessToken;
	} catch {
		rpc.send.authRequired({ service: "pocketid" });
		return taskId;
	}

	rpc.send.deployProgress({ stage: "assembling" });

	try {
		// Step 1: Assemble
		const assembleResult = Bun.spawnSync(
			[
				"bun",
				ctx.pluginPaths.assembleScript,
				appJsxPath,
				indexHtmlPath,
			],
			{ cwd: ctx.pluginPaths.root, timeout: 30000 },
		);

		if (assembleResult.exitCode !== 0) {
			const stderr = assembleResult.stderr.toString();
			rpc.send.error({
				taskId,
				message: `Assembly failed: ${stderr.slice(0, 2000)}`,
			});
			return taskId;
		}

		// Step 2: Patch background color
		try {
			const appCode = readFileSync(appJsxPath, "utf8");
			let html = readFileSync(indexHtmlPath, "utf8");

			const rootMatch = appCode.match(/:root\s*\{([^}]+)\}/);
			let bgColor = "";
			if (rootMatch) {
				const bgMatch =
					rootMatch[1].match(
						/--color-background\s*:\s*([^;]+)/,
					);
				if (bgMatch) bgColor = bgMatch[1].trim();
			}
			if (!bgColor) {
				const bodyBgMatch = appCode.match(
					/body\s*\{[^}]*background\s*:\s*([^;]+)/,
				);
				if (bodyBgMatch) bgColor = bodyBgMatch[1].trim();
			}
			// Sanitize — reject chars that could break CSS/HTML context
			if (bgColor && /[;{}<>"']/.test(bgColor)) bgColor = "";
			const bg = bgColor || "inherit";

			const headPatch = `<style>
      #container { padding: 10px !important; }
      body::before { background-color: ${bg} !important; }
    </style>`;
			html = html.replace("</head>", headPatch + "\n</head>");

			const bodyPatch = `<style>
      div[style*="z-index: 10"][style*="position: fixed"] { background: ${bg} !important; }
    </style>`;
			html = html.replace("</body>", bodyPatch + "\n</body>");

			writeFileSync(indexHtmlPath, html);
		} catch (e: any) {
			console.error("[Deploy] Patch failed:", e.message);
		}

		// Step 3: Connect provisioning
		rpc.send.deployProgress({ stage: "provisioning sync" });

		const { isFirstDeploy: checkFirstDeploy, getApp, setApp } =
			await import(
				join(
					ctx.pluginPaths.root,
					"scripts",
					"lib",
					"registry.js",
				)
			);

		let connectInfo = getApp(appName)?.connect || null;

		if (checkFirstDeploy(appName)) {
			try {
				const { deployConnect } = await import(
					join(
						ctx.pluginPaths.root,
						"scripts",
						"lib",
						"alchemy-deploy.js",
					)
				);

				const partialEntry = getApp(appName);
				let alchemyPassword =
					partialEntry?.connect?.alchemyPassword || null;
				if (!alchemyPassword) {
					const { randomBytes } = await import("crypto");
					alchemyPassword = randomBytes(32).toString("hex");
					setApp(appName, {
						...(partialEntry || { name: appName }),
						name: appName,
						connect: { alchemyPassword },
					});
				}

				// Clean env for child processes (macOS GUI PATH issue)
				const savedEnv = { ...process.env };
				const clean = cleanEnv();
				Object.keys(process.env).forEach(
					(k) => delete process.env[k],
				);
				Object.assign(process.env, clean);

				try {
					connectInfo = await deployConnect({
						appName,
						oidcAuthority: OIDC_AUTHORITY,
						oidcServiceWorkerName: "pocket-id",
						alchemyPassword,
					});
				} finally {
					Object.keys(process.env).forEach(
						(k) => delete process.env[k],
					);
					Object.assign(process.env, savedEnv);
				}

				setApp(appName, {
					name: appName,
					connect: {
						...connectInfo,
						deployedAt: new Date().toISOString(),
					},
				});
				console.log(
					`[Deploy] Connect provisioned for ${appName}: ${connectInfo.apiUrl}`,
				);
			} catch (err: any) {
				rpc.send.error({
					taskId,
					message: `Connect provisioning failed: ${err.message}`,
				});
				return taskId;
			}
		} else {
			console.log(
				`[Deploy] Reusing existing Connect for ${appName}: ${connectInfo?.apiUrl}`,
			);
		}

		// Inject Connect URLs into assembled HTML
		if (connectInfo?.apiUrl && connectInfo?.cloudUrl) {
			let html = readFileSync(indexHtmlPath, "utf8");
			html = html.replace(
				/tokenApiUri:\s*"[^"]*"/,
				`tokenApiUri: "${connectInfo.apiUrl}"`,
			);
			html = html.replace(
				/cloudBackendUrl:\s*"[^"]*"/,
				`cloudBackendUrl: "${connectInfo.cloudUrl}"`,
			);
			writeFileSync(indexHtmlPath, html);
			console.log("[Deploy] Injected Connect URLs into index.html");
		}

		rpc.send.deployProgress({ stage: "deploying" });

		// Step 4: Build files map for Deploy API
		const files: Record<string, string> = {
			"index.html": readFileSync(indexHtmlPath, "utf8"),
		};

		// Include the OIDC bridge bundle
		const bridgePath = join(
			ctx.pluginPaths.bundlesDir,
			"fireproof-oidc-bridge.js",
		);
		if (existsSync(bridgePath)) {
			files["fireproof-oidc-bridge.js"] = readFileSync(
				bridgePath,
				"utf8",
			);
		}

		// Include auth card SVG assets
		const authCardsDir = join(
			ctx.pluginPaths.root,
			"assets/auth-cards",
		);
		if (existsSync(authCardsDir)) {
			for (const name of [
				"card-1.svg",
				"card-2.svg",
				"card-3.svg",
				"card-4.svg",
			]) {
				const p = join(authCardsDir, name);
				if (existsSync(p))
					files[`assets/auth-cards/${name}`] = readFileSync(
						p,
						"utf8",
					);
			}
		}

		// Include favicon assets
		const faviconDir = join(
			ctx.pluginPaths.root,
			"assets/vibes-favicon",
		);
		if (existsSync(faviconDir)) {
			const textAssets = ["favicon.svg", "site.webmanifest"];
			const binaryAssets = [
				"favicon-96x96.png",
				"favicon.ico",
				"apple-touch-icon.png",
				"web-app-manifest-192x192.png",
				"web-app-manifest-512x512.png",
			];
			for (const name of textAssets) {
				const p = join(faviconDir, name);
				if (existsSync(p))
					files[`assets/vibes-favicon/${name}`] = readFileSync(
						p,
						"utf8",
					);
			}
			for (const name of binaryAssets) {
				const p = join(faviconDir, name);
				if (existsSync(p))
					files[`assets/vibes-favicon/${name}`] =
						"base64:" +
						readFileSync(p).toString("base64");
			}
		}

		// Step 5: Deploy via the Deploy API
		const response = await fetch(`${DEPLOY_API_URL}/deploy`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ name: appName, files }),
		});

		if (!response.ok) {
			const errorText = await response.text();
			rpc.send.error({
				taskId,
				message: `Deploy failed (${response.status}): ${errorText.slice(0, 2000)}`,
			});
			return taskId;
		}

		const result: any = await response.json();
		const url = result.url || "";

		rpc.send.deployProgress({ stage: "complete", url });
		rpc.send.done({
			taskId,
			text: `Deployed to ${url}`,
			cost: 0,
			duration: 0,
		});
	} catch (err) {
		rpc.send.error({ taskId, message: String(err) });
	}

	return taskId;
}
