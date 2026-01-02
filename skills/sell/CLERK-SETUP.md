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

## 5. Enable Clerk Billing (Optional)

For subscription gating:

1. In Clerk Dashboard, go to **Billing**
2. Create subscription plans:
   - **monthly** or **pro** - matches `has({ plan: 'monthly' })` or `has({ plan: 'pro' })`
   - **yearly** - matches `has({ plan: 'yearly' })`
   - **free** or **starter** - for free tier access

   Plan names must match what your app checks with `has({ plan: 'planname' })`

---

## Clerk Setup Checklist

- [ ] Create Clerk application and get publishable key
- [ ] Enable Passkey authentication
- [ ] Add your domain to authorized domains
- [ ] Get admin user ID
- [ ] (Optional) Enable Clerk Billing with subscription plans

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
