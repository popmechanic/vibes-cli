# Settings Panel Design — Account + Deployments

**Problem**: Settings button shows sign-in screen even when authenticated. No useful content for authenticated users.

**Solution**: When authenticated, settings opens a slide-in panel (same pattern as Apps panel) showing account info and deployed apps.

## Panel Contents

- **Account card**: Avatar, name, email, sign-out link
- **Deployed apps list**: Screenshot thumbnail, app name, workers.dev URL, re-deploy button

## Data Sources

- User info from `auth_complete` WebSocket message (already available)
- App list from `checkExistingApps()` (already fetched)
- Deploy via existing `save_app` WebSocket message

## Behavior

- **Not authenticated**: `openSettings()` shows sign-in screen (unchanged)
- **Authenticated**: `openSettings()` toggles the account panel
- Sign out: `POST /editor/auth/logout` clears `~/.vibes/auth.json`, reloads page
