# Clerk Setup Guide

This document provides step-by-step instructions for configuring Clerk after Cloudflare deployment.

**IMPORTANT**: Provide these instructions to the user after Cloudflare deployment completes. Do NOT web search - everything needed is here.

**NO REBUILD REQUIRED**: Clerk setup is done in the Clerk Dashboard only. The app already has Clerk integration built in - you just need to configure your Clerk account. Do NOT regenerate or reassemble the app.

---

## 1. Create Clerk Application

1. Go to [clerk.com](https://clerk.com) and sign in
2. Create a new application
3. Copy the **Publishable Key**

---

## 2. Enable Clerk Billing

1. In Clerk Dashboard, go to **Billing**
2. Create subscription plans:
   - **monthly** or **pro** - matches `has({ plan: 'monthly' })` or `has({ plan: 'pro' })`
   - **yearly** - matches `has({ plan: 'yearly' })`

   Plan names must match what your app checks with `has({ plan: 'planname' })`

---

## 3. Get Your Admin User ID

1. Sign up on your app
2. Go to Clerk Dashboard → **Users**
3. Click your user
4. Copy the **User ID** (e.g., `user_2abc123xyz`)

Then paste the User ID here and I'll update the app configuration.

---

## 4. Configure Clerk Webhooks (Required for User Tracking)

Set up webhooks so the admin dashboard can track users:

**NOTE:** The webhook URL uses a **path** on your root domain, NOT a subdomain:
- **CORRECT:** `https://yourdomain.com/webhooks/clerk`
- **WRONG:** `https://webhooks.yourdomain.com/clerk`

1. Go to Clerk Dashboard → **Webhooks** → **Add Endpoint**
2. Enter endpoint URL: `https://yourdomain.com/webhooks/clerk`
3. Subscribe to events:
   - `user.created` (required)
   - `user.deleted` (required)
4. Click **Create**

### Optional: Verify Webhook Signatures (Production)

For production, verify webhook signatures:

1. After creating the endpoint, copy the **Signing Secret** (whsec_...)
2. Add to wrangler.toml:
   ```toml
   [vars]
   CLERK_WEBHOOK_SECRET = "whsec_..."
   ```

### Test the webhook:
```bash
curl -X POST https://yourdomain.com/webhooks/clerk \
  -H "Content-Type: application/json" \
  -d '{"type":"user.created","data":{"id":"test"}}'
# Should return: {"received":true}
```

---

## CRITICAL: Webhook Tracking Limitation

> **WARNING:** The `user.created` webhook **only fires for NEW Clerk account signups** - users who just created their Clerk account for the first time.
>
> It does **NOT** fire when:
> - An existing Clerk user signs into your app for the first time
> - A user creates a new subdomain/tenant
>
> **Impact:** Your admin dashboard user count may not reflect all active users. The template includes a `TenantRegistration` component that calls `/api/tenants/register` when users visit their subdomain to supplement webhook tracking.
>
> **For accurate tracking:** Implement client-side registration on first app visit, not just webhook-based tracking.

---

## Clerk Setup Checklist

- [ ] Create webhook endpoint for `https://yourdomain.com/webhooks/clerk`
- [ ] Subscribe to `user.created` and `user.deleted` events
- [ ] Test webhook with curl
- [ ] Add authorized domains in Clerk settings

---

## Troubleshooting

### Webhook not receiving events
1. Check the endpoint URL is correct (path on root domain, not subdomain)
2. Verify the worker routes are configured in Cloudflare
3. Check Clerk Dashboard → Webhooks → Logs for delivery attempts

### User tracking incomplete
See the "Webhook Tracking Limitation" section above. The webhook only tracks new Clerk signups, not existing users visiting your app.

### Billing not working
1. Verify plan names in Clerk match what your app checks
2. Ensure Clerk Billing is enabled in your account
3. Check that `has({ plan: 'yourplan' })` matches the plan name exactly
