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

1. In Clerk Dashboard, go to **Configure** → **Email, phone, username**
2. Enable **Passkey** as an authentication method
3. This enables passwordless login via biometrics

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

## 5. Enable Clerk Billing (Required for `--billing-mode required`)

If your app uses `--billing-mode required`, you must configure Clerk Billing:

### 5.1 Navigate to Billing
1. In Clerk Dashboard, go to **Billing**
2. Click **Get Started** if this is your first time

### 5.2 Create Subscription Plans
1. Go to **Billing** → **Plans**
2. Create plans with names that match what your app checks:
   - `pro` - Premium tier
   - `basic` - Entry tier
   - `monthly` - Monthly subscription
   - `yearly` - Annual subscription
   - `starter` - Starter tier
   - `free` - Free tier with limited features

   **Important:** Plan names are case-sensitive and must match exactly.

### 5.3 Configure Plan Details
For each plan:
1. Set the price (e.g., $9/month, $89/year)
2. Add features that will display in the PricingTable
3. Configure trial period if desired (e.g., 14 days free)

### 5.4 Connect Stripe
1. Go to **Billing** → **Stripe**
2. Click **Connect Stripe Account**
3. Complete the Stripe onboarding flow
4. For testing, use Stripe test mode

---

## 6. Understanding Billing Modes

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

## 7. Testing Billing

### Test Mode
1. Use Clerk test keys (`pk_test_xxx`)
2. Enable Stripe test mode in Clerk Dashboard
3. Use Stripe test cards: `4242 4242 4242 4242`

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

---

## Clerk Setup Checklist

- [ ] Create Clerk application and get publishable key
- [ ] Enable Passkey authentication
- [ ] Add your domain to authorized domains
- [ ] Get admin user ID
- [ ] (If using `--billing-mode required`) Enable Clerk Billing
- [ ] (If using `--billing-mode required`) Create subscription plans
- [ ] (If using `--billing-mode required`) Connect Stripe account

---

## How User Data Works

The sell template uses **client-side only** data management:

- **Subdomain ownership**: Stored in `user.unsafeMetadata.subdomain`
- **Plan/subscription**: Stored in `user.unsafeMetadata.plan` OR checked via Clerk Billing
- **Registration timestamp**: Stored in `user.unsafeMetadata.registeredAt`

No webhooks or backend processing required. All data flows through Clerk's client-side APIs.

---

## Troubleshooting

### Clerk not loading
1. Add your domain to Clerk's authorized domains
2. Check publishable key is correct (use pk_test_... for dev, pk_live_... for production)
3. Verify the domain matches exactly (including subdomains)

### Billing not working
1. Verify plan names in Clerk match what your app checks
2. Ensure Clerk Billing is enabled in your account
3. Check that `has({ plan: 'yourplan' })` matches the plan name exactly

### "Access Denied" on admin dashboard
1. Verify your user ID is in the `--admin-ids` array
2. Re-run assembly with the correct admin IDs
3. Redeploy the updated index.html
