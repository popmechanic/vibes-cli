# Admin Paywall Checklist Card

## Overview
We will add a new informational card to the Sell admin dashboard that makes the paywall test flow obvious without changing any behavior. The card will sit directly above the existing "Quota Tools" section and provide a short, step-by-step checklist for forcing the paywall and confirming checkout behavior. The goal is to remove ambiguity for testers, reduce the guesswork around Grant vs Revoke, and highlight the common edge case where existing claims redirect instead of showing the paywall.

## Goals
- Make it obvious how to force the paywall vs bypass it.
- Provide a clear, repeatable testing sequence in the UI.
- Avoid any backend or API changes.
- Keep styling consistent with existing admin cards.

## Non-Goals
- No new admin actions or endpoints.
- No changes to quotas logic or claim logic.
- No workflow automation or state changes.

## UX and Copy
Placement: A new card directly above "Quota Tools" within the Admin dashboard content.

Card title: "Paywall Test Checklist"
Intro line (muted): "Use this quick checklist to force or bypass the paywall during testing."

Checklist items:
1. Find the target user ID (from Clerk or the claims table below).
2. Click **Revoke** to force the paywall for that user.
3. Have the user visit a **new subdomain** they do not already own.
4. They should see the paywall and complete checkout.
5. Click **Grant** to bypass the paywall for future tests.

Rule-of-thumb line (emphasized):
"Revoke = paywall. Grant = bypass."

Edge case note (muted):
"If a user already owns a subdomain, they may be redirected instead of seeing the paywall."

## Architecture / Implementation Notes
- Update the admin dashboard markup in the Sell template (not the generated `index.html`).
- Reuse the existing admin card styling (white background, 2px border, drop shadow).
- Use existing typography scales and muted color tokens for consistency.

## Data Flow
No data changes. The card is static copy only.

## Error Handling
None required; the card is informational.

## Testing
- Visual verification on admin route: `?subdomain=admin`.
- Confirm layout does not shift or overlap on narrow screens.
- Ensure existing Quota Tools functionality is unchanged.

