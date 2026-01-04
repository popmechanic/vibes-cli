# Clerk Setup Guide

This document provides step-by-step instructions for configuring Clerk after deployment.

**NO REBUILD REQUIRED**: Clerk setup is done in the Clerk Dashboard only. The app already has Clerk integration built in - you just need to configure your Clerk account. Do NOT regenerate or reassemble the app.

---

## 1. Create Clerk Application

1. Go to [clerk.com](https://clerk.com) and sign in
2. Create a new application
3. Copy the **Publishable Key** (pk_test_... or pk_live_...)

---

## 2. Enable Passkey Authentication

The sell template uses passkey-first authentication for the best user experience.

1. In Clerk Dashboard, go to **Configure** → **Email, phone, username**
2. Enable **Passkey** as an authentication method
3. Enable **Email address** for magic link fallback
4. This enables passwordless login via biometrics with email as backup

### Passkey Scope for Subdomains

Passkeys created on one subdomain (e.g., `alice.yourapp.com`) will work across all subdomains of your domain because WebAuthn uses the root domain as the RP ID (Relying Party ID). A single passkey gives access to all claimed subdomains.

**Reference:** [Clerk Custom Passkey Authentication](https://clerk.com/docs/guides/development/custom-flows/authentication/passkeys)

---

## 3. Add Authorized Domains

1. In Clerk Dashboard, go to **Configure** → **Domains**
2. Add your domain (e.g., `myapp.exe.xyz` or `yourdomain.com`)
3. For wildcard subdomains, add the root domain - Clerk handles subdomains automatically

---

## 4. Get Your Admin User ID

1. Sign up on your app (or use an existing Clerk account)
2. Go to Clerk Dashboard → **Users**
3. Click your user
4. Copy the **User ID** (e.g., `user_2abc123xyz`)

Use this ID in the `--admin-ids` flag when running the assembly script.

---

## 5. Subdomain Registry & Webhooks

The sell template uses a server-side registry to track subdomain ownership. This enables:
- First-claim ownership (first user to claim a subdomain owns it)
- Unlimited subdomains per user (each must be paid for)
- Immediate release when subscription lapses

### 5.1 Configure Webhook Endpoint

The registry server listens for Clerk subscription webhooks to release subdomains when subscriptions change.

1. In Clerk Dashboard, go to **Webhooks**
2. Click **Add Endpoint**
3. Enter your webhook URL: `https://yourapp.exe.xyz/webhook`
4. Select these events:
   - `subscription.updated`
   - `subscription.deleted`
5. Copy the **Signing Secret**

### 5.2 Set Webhook Secret

The webhook secret is set when deploying:

```bash
node deploy-exe.js --name myapp \
  --file index.html \
  --clerk-webhook-secret whsec_xxxxx
```

Or set it in `/etc/registry.env` on the VM:
```
CLERK_WEBHOOK_SECRET=whsec_xxxxx
```

Then restart the registry service:
```bash
sudo systemctl restart registry
```

---

## 6. Enable Clerk Billing (Required for `--billing-mode required`)

If your app uses `--billing-mode required`, you must configure Clerk Billing:

### 6.1 Navigate to Billing
1. In Clerk Dashboard, go to **Billing**
2. Click **Get Started** if this is your first time

### 6.2 Create Subscription Plans with Quantity

For multi-subdomain support, create a plan with **quantity** enabled:

1. Go to **Billing** → **Plans**
2. Create a plan (e.g., `subdomain-access`)
3. Enable **Per-seat pricing** or **Usage-based pricing**
4. Set the price per subdomain (e.g., $5/month per subdomain)

The registry server automatically updates subscription quantity when users claim or lose subdomains.

### 6.3 Alternative: Simple Plans

If you prefer simple subscription tiers:
- `pro` - Premium tier (unlimited subdomains)
- `basic` - Entry tier (limited subdomains)
- `monthly` - Monthly subscription
- `yearly` - Annual subscription
- `starter` - Starter tier
- `free` - Free tier with limited features

**Important:** Plan names are case-sensitive and must match exactly.

### 6.4 Configure Plan Details
For each plan:
1. Set the price (e.g., $9/month, $89/year)
2. Add features that will display in the PricingTable
3. Configure trial period if desired (e.g., 14 days free)

### 6.5 Connect Stripe
1. Go to **Billing** → **Stripe**
2. Click **Connect Stripe Account**
3. Complete the Stripe onboarding flow
4. For testing, use Stripe test mode

---

## 7. Understanding Billing Modes

Your app supports two billing modes set during assembly:

### billing-mode: off (default)
- Everyone gets free access after signing in
- No subscription required
- Good for testing or free apps
- PricingTable not shown on landing page

### billing-mode: required
- Users must subscribe to access tenant app
- PricingTable shown on landing page
- Non-subscribed users see paywall with PricingTable
- Admins always bypass billing gate
- Trial periods configured in Clerk Dashboard

To change billing mode:
```bash
node assemble-sell.js app.jsx index.html \
  --clerk-key pk_live_xxx \
  --billing-mode required \
  ... (other options)
```

---

## 8. Reserved Subdomains

Operators can reserve subdomains at deploy time to prevent users from claiming them:

```bash
node deploy-exe.js --name myapp \
  --file index.html \
  --reserved "admin,billing,api,www,support"
```

Reserved subdomains show as "unavailable" to users.

### Pre-allocated Subdomains

For enterprise customers or special cases, pre-allocate subdomains to specific user IDs:

```bash
node deploy-exe.js --name myapp \
  --file index.html \
  --preallocated "acme:user_enterprise1,bigcorp:user_enterprise2"
```

Pre-allocated subdomains are immediately owned by the specified user.

---

## 9. Testing

### Test Mode
1. Use Clerk test keys (`pk_test_xxx`)
2. Enable Stripe test mode in Clerk Dashboard
3. Use Stripe test cards: `4242 4242 4242 4242`

### Verify Subdomain Claiming
1. Visit an unclaimed subdomain (e.g., `test.yourapp.com`)
2. You should see the passkey signup flow
3. Complete signup - subdomain should be claimed
4. Check the registry: `curl https://yourapp.com/registry.json`

### Verify Billing Flow
1. Visit your landing page
2. Click a plan in the PricingTable
3. Complete checkout with test card
4. Visit your subdomain - should have access

### Verify Paywall
1. Create new user without subscription
2. Visit subdomain
3. Should see paywall with PricingTable
4. Subscribe via paywall
5. Should redirect to app with access

### Verify Webhook
1. Cancel a subscription in Clerk/Stripe
2. Check registry - subdomain should be released
3. Visit the subdomain - should show as available

---

## Clerk Setup Checklist

### Basic Setup
- [ ] Create Clerk application and get publishable key
- [ ] Enable Passkey authentication
- [ ] Enable Email magic link (fallback)
- [ ] Add your domain to authorized domains
- [ ] Get admin user ID

### Subdomain Registry
- [ ] Configure webhook endpoint in Clerk Dashboard
- [ ] Set webhook secret in registry server

### Billing (if using `--billing-mode required`)
- [ ] Enable Clerk Billing
- [ ] Create subscription plans (with quantity for multi-subdomain)
- [ ] Connect Stripe account

---

## How Data Works

### Subdomain Registry (Server-side)

Subdomain ownership is stored in `/var/www/html/registry.json`:

```json
{
  "claims": {
    "alice": { "userId": "user_abc123", "claimedAt": "2025-01-04T..." }
  },
  "reserved": ["admin", "billing", "api"],
  "preallocated": {
    "enterprise": "user_xyz789"
  }
}
```

### User Metadata (Client-side)

Additional user data is stored in Clerk's `unsafeMetadata`:
- **plan**: User's subscription plan name
- **registeredAt**: Registration timestamp

### Subscription Quantity

For multi-subdomain users, the number of claimed subdomains equals their subscription quantity. When quantity decreases (downgrade or cancellation), subdomains are released in LIFO order (newest first).

---

## Troubleshooting

### Clerk not loading
1. Add your domain to Clerk's authorized domains
2. Check publishable key is correct (use pk_test_... for dev, pk_live_... for production)
3. Verify the domain matches exactly (including subdomains)

### Passkey creation fails
1. Ensure HTTPS is configured (passkeys require secure context)
2. Check browser supports WebAuthn (all modern browsers do)
3. Verify Passkey is enabled in Clerk Dashboard

### Subdomain shows "unavailable" but shouldn't be
1. Check `/registry.json` - is it in `reserved` or `claims`?
2. Verify registry server is running: `sudo systemctl status registry`
3. Check nginx proxy config is correct

### Webhook not releasing subdomains
1. Verify webhook URL is correct in Clerk Dashboard
2. Check webhook secret matches `/etc/registry.env`
3. View registry logs: `sudo journalctl -u registry -f`
4. Verify webhook events are selected (subscription.updated, subscription.deleted)

### Billing not working
1. Verify plan names in Clerk match what your app checks
2. Ensure Clerk Billing is enabled in your account
3. Check that `has({ plan: 'yourplan' })` matches the plan name exactly

### "Access Denied" on admin dashboard
1. Verify your user ID is in the `--admin-ids` array
2. Re-run assembly with the correct admin IDs
3. Redeploy the updated index.html

---

## Reference Documentation

- [Clerk Custom Flows Overview](https://clerk.com/docs/guides/development/custom-flows/overview)
- [Clerk Custom Passkey Authentication](https://clerk.com/docs/guides/development/custom-flows/authentication/passkeys)
- [WebAuthn RP ID Best Practices](https://www.corbado.com/blog/webauthn-relying-party-id-rpid-passkeys)
