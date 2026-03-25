// Shared rsync exclude list for plugin bundling.
// Used by both post-build.ts and post-wrap.ts to keep them in sync.
export const BUNDLE_EXCLUDES = [
	"--exclude=.git", "--exclude=.git-backup", "--exclude=node_modules",
	"--exclude=vibes-desktop", "--exclude=deploy-api", "--exclude=.claude",
	"--exclude=scripts/__tests__", "--exclude=scripts/coverage",
	"--exclude=docs/plans", "--exclude=alchemy",
	"--exclude=skills/cloudflare/worker", "--exclude=superpowers",
	"--exclude=.netlify-deploy", "--exclude=.env", "--exclude=.env.*",
	"--exclude=.connect", "--exclude=.wrangler", "--exclude=.DS_Store",
	"--exclude=.vibes-tmp", "--exclude=.worktrees",
	"--exclude=*.bak.*", "--exclude=*.bak.html", "--exclude=*.bak.jsx",
	"--exclude=ai-worker", "--exclude=designs", "--exclude=dist",
	"--exclude=examples", "--exclude=test-vibes",
	"--exclude=.superpowers", "--exclude=wrangler.jsonc",
	"--exclude=dispatch-worker",
	"--exclude=autoresearch-vibes", "--exclude=eval",
	"--exclude=plugins",
];
