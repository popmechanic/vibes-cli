import { existsSync, readFileSync } from "fs";
import { join, extname } from "path";
import type { PluginPaths } from "./plugin-discovery.ts";

const MIME_TYPES: Record<string, string> = {
	".html": "text/html",
	".js": "application/javascript",
	".css": "text/css",
	".json": "application/json",
	".png": "image/png",
	".jpg": "image/jpeg",
	".svg": "image/svg+xml",
	".txt": "text/plain",
};

export interface PreviewServerContext {
	pluginPaths: PluginPaths;
	getAssembledHtml: () => string | null;
	port: number;
}

export function startPreviewServer(
	ctx: PreviewServerContext,
): ReturnType<typeof Bun.serve> {
	const server = Bun.serve({
		port: ctx.port,
		hostname: "127.0.0.1",
		fetch(req) {
			const url = new URL(req.url);
			const path = url.pathname;

			// CORS headers for iframe
			const corsHeaders = {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "GET, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type",
			};

			if (req.method === "OPTIONS") {
				return new Response(null, {
					status: 204,
					headers: corsHeaders,
				});
			}

			// Preview frame
			if (path === "/app-frame" || path === "/app-frame/") {
				const html = ctx.getAssembledHtml();
				if (!html) {
					return new Response(
						"<html><body><p>No app loaded.</p></body></html>",
						{
							headers: {
								...corsHeaders,
								"Content-Type": "text/html",
							},
						},
					);
				}
				return new Response(html, {
					headers: {
						...corsHeaders,
						"Content-Type": "text/html",
					},
				});
			}

			// Theme files
			if (path.startsWith("/themes/")) {
				const filePath = join(
					ctx.pluginPaths.themeDir,
					path.replace("/themes/", ""),
				);
				return serveFile(filePath, corsHeaders);
			}

			// Animation files
			if (path.startsWith("/animations/")) {
				const filePath = join(
					ctx.pluginPaths.animationDir,
					path.replace("/animations/", ""),
				);
				return serveFile(filePath, corsHeaders);
			}

			// Bundle files (fireproof-oidc-bridge.js etc.)
			if (path.startsWith("/bundles/")) {
				const filePath = join(
					ctx.pluginPaths.bundlesDir,
					path.replace("/bundles/", ""),
				);
				return serveFile(filePath, corsHeaders);
			}

			return new Response("Not Found", {
				status: 404,
				headers: corsHeaders,
			});
		},
	});

	console.log(
		`[preview-server] Listening on http://127.0.0.1:${ctx.port}`,
	);
	return server;
}

function serveFile(
	filePath: string,
	headers: Record<string, string>,
): Response {
	if (!existsSync(filePath)) {
		return new Response("Not Found", { status: 404, headers });
	}

	const ext = extname(filePath);
	const contentType = MIME_TYPES[ext] || "application/octet-stream";

	try {
		const content = readFileSync(filePath);
		return new Response(content, {
			headers: { ...headers, "Content-Type": contentType },
		});
	} catch {
		return new Response("Read Error", { status: 500, headers });
	}
}
