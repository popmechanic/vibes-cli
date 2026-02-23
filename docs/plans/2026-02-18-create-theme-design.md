# Create Theme — Design Document

**Date:** 2026-02-18
**Status:** Approved

## Summary

A "Create Theme" button in the preview wrapper's theme modal. User enters a prompt, OpenRouter generates 3 UI mockup images, user picks one, Claude analyzes the image and writes a theme file in the same format as existing themes.

## Flow

```
[Create Theme] button in theme modal
        │
        ▼
User enters prompt (e.g. "cyberpunk neon Tokyo")
        │
        ▼
OpenRouter generates 3 UI mockup images (DALL-E 3)
        │
        ▼
Preview shows 3 images as clickable cards
        │
        ▼
User picks one
        │
        ▼
Claude (via claude -p) analyzes image + reference theme format
        │
        ▼
Writes .txt to skills/vibes/themes/{id}.txt
Updates catalog.txt with new row
        │
        ▼
Server reloads themes, modal refreshes
```

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Image generation | OpenRouter (DALL-E 3) | Already in stack, no new API key needed |
| Vision/extraction | Claude via `claude -p` | Best structured output, already bridged |
| Theme storage | `skills/vibes/themes/` | Same as built-in themes, becomes part of catalog |
| Image prompt strategy | 3 parallel calls with variation hints | Gives meaningfully different options |

## WebSocket Protocol

**Client → Server:**
```json
{ "type": "create_theme", "prompt": "cyberpunk neon Tokyo" }
{ "type": "pick_theme_image", "index": 0, "prompt": "cyberpunk neon Tokyo" }
```

**Server → Client:**
```json
{ "type": "theme_images", "images": ["url1", "url2", "url3"] }
{ "type": "theme_created", "themeId": "cyberpunk-neon-tokyo", "themeName": "Cyberpunk Neon Tokyo" }
{ "type": "error", "message": "..." }
```

## Image Generation

- API: `https://openrouter.ai/api/v1/images/generations`
- Model: `openai/dall-e-3`
- 3 parallel requests with variation hints (cards emphasis, navigation emphasis, data density emphasis)
- API key: `OPENROUTER_API_KEY` from `.env` or `~/.vibes/.env`
- Images returned as temporary URLs

**Prompt template:**
> "UI design mockup for a web application dashboard. Style: {user prompt}. Show a full-page layout with navigation, cards, buttons, and data display. Clean, modern interface design. No text labels, focus on visual design language. {variation hint}"

## Claude Extraction

- Receives: chosen image URL + reference theme file content (e.g. `archive.txt`)
- Prompt instructs Claude to analyze the image's color palette, layout patterns, and visual personality
- Outputs theme file with sections: DESCRIPTION, BEST FOR, NOT FOR, DESIGN PRINCIPLES, COLOR TOKENS (oklch), PERSONALITY, ANIMATIONS, SVG ELEMENTS
- Writes to `skills/vibes/themes/{id}.txt`
- Appends row to `skills/vibes/themes/catalog.txt`

## UI

- "Create Theme" button at top of theme modal (next to search bar)
- Click → input field + "Generate" button
- Generating: 3 placeholder cards with spinners
- Images arrive: 3 clickable image cards
- Pick one → spinner while Claude extracts → success → modal refreshes

## Error Handling

| Scenario | Behavior |
|----------|----------|
| No API key | Error message: "OpenRouter API key required" |
| Image gen fails | Show error in failed card slot, others still clickable |
| All 3 fail | Show retry button |
| Theme ID collision | Append `-2`, `-3`, etc. |
| Claude extraction fails | Show error, offer "Try again" |

## Files Changed

| File | Changes |
|------|---------|
| `scripts/preview-server.js` | `handleCreateTheme`, `handlePickThemeImage`, OpenRouter API call, catalog reload |
| `skills/vibes/templates/preview.html` | Create Theme UI in modal (input, image cards, states) |
