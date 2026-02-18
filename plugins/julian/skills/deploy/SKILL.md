---
name: deploy
description: Deploy Julian to an exe.xyz VM (new instance or update existing)
user-invocable: true
allowed-tools:
  - Bash(ssh:*)
  - Bash(scp:*)
  - Bash(curl:*)
  - Bash(git:*)
  - Bash(gh:*)
  - Bash(mkdir:*)
  - Read
  - Write
  - Glob
---

# Deploy Julian

Deploy Julian to an exe.xyz VM. Two paths: **provision** a new VM or **update** an existing one. The instance registry at `deploy/instances.json` tracks which VMs have been provisioned.

## Target VM

Determine the target VM name:

1. If `$ARGUMENTS` is provided, use it as the VM name (e.g., `/julian:deploy screen-test`)
2. If no arguments, derive from current git branch: `julian-<branch>` (e.g., branch `screen` → `julian-screen`)
3. Strip any characters not valid in hostnames (keep alphanumeric and hyphens)

**PRODUCTION SAFETY**: If the resolved VM name is exactly `julian` (the production instance), STOP and warn the user before proceeding. Only proceed after explicit confirmation.

## Routing: Provision or Update?

Read `deploy/instances.json`. If the target VM name exists in the registry, run the **Update** path. Otherwise, run the **Provision** path.

If `deploy/instances.json` doesn't exist, create it as `{}`.

---

## Path A: Provision (New VM)

Full first-time setup. Run all steps in order.

### Pre-flight

1. Get current git branch: `git rev-parse --abbrev-ref HEAD`
2. Pull Julian's changes locally: `git pull` (stop on merge conflicts)
3. Check for uncommitted changes: `git status --porcelain` (warn but don't block)
4. Push to GitHub: `git push`
5. Print target: VM name and URL (`https://<vmname>.exe.xyz/`)

#### Clerk Pre-flight

Read the local `.env` file and check for `VITE_CLERK_PUBLISHABLE_KEY`:

- **If present** (matches `pk_(test|live)_*`): Extract the value for later. Proceed.
- **If missing or invalid**: STOP and guide the user:
  - Option A: Run `/vibes:connect` to set up Clerk + Connect end-to-end
  - Option B: Manually add `VITE_CLERK_PUBLISHABLE_KEY=pk_test_...` to `.env`
  - Remind them to create the `with-email` JWT template in Clerk Dashboard:
    1. Go to Clerk Dashboard → Configure → JWT Templates
    2. Create a new template named **`with-email`**
    3. Set custom claims JSON (the `|| ''` fallbacks are required — Fireproof Studio rejects null names):
       ```json
       {
         "params": {
           "email": "{{user.primary_email_address}}",
           "email_verified": "{{user.email_verified}}",
           "external_id": "{{user.external_id}}",
           "first": "{{user.first_name || ''}}",
           "last": "{{user.last_name || ''}}",
           "name": "{{user.full_name || ''}}",
           "image_url": "{{user.image_url}}",
           "public_meta": "{{user.public_metadata}}"
         },
         "role": "authenticated",
         "userId": "{{user.id}}"
       }
       ```

### Step P1: Create VM

**IMPORTANT**: All SSH commands targeting the VM must include `-o StrictHostKeyChecking=accept-new`.

```bash
ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 <vmname>.exe.xyz echo ok
```

If unreachable, create it:

```bash
ssh exe.dev new --name=<vmname>
ssh exe.dev share set-public <vmname>
```

Wait for boot (up to 90 seconds):

```bash
for i in $(seq 1 9); do
  ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 <vmname>.exe.xyz echo ok && break
  echo "Attempt $i failed, retrying in 10s..."
  sleep 10
done
```

### Step P2: Install system dependencies

```bash
ssh -o StrictHostKeyChecking=accept-new <vmname>.exe.xyz "curl -fsSL https://bun.sh/install | bash && sudo apt-get update -qq && sudo apt-get install -y npm inotify-tools"
```

### Step P3: Set up directory structure

```bash
ssh -o StrictHostKeyChecking=accept-new <vmname>.exe.xyz "sudo mkdir -p /opt/julian && sudo chown exedev:exedev /opt/julian && mkdir -p /home/exedev/mailbox"
```

### Step P4: Generate deploy key and clone repo

Generate an SSH key for push access:

```bash
ssh -o StrictHostKeyChecking=accept-new <vmname>.exe.xyz "ssh-keygen -t ed25519 -f ~/.ssh/julian-deploy -N '' -C '<vmname>-deploy'"
```

Configure SSH to use it for GitHub:

```bash
ssh -o StrictHostKeyChecking=accept-new <vmname>.exe.xyz "mkdir -p ~/.ssh && cat >> ~/.ssh/config << 'SSHEOF'
Host github.com
  IdentityFile ~/.ssh/julian-deploy
  StrictHostKeyChecking accept-new
SSHEOF"
```

Add the deploy key to GitHub with write access:

```bash
DEPLOY_KEY=$(ssh -o StrictHostKeyChecking=accept-new <vmname>.exe.xyz "cat ~/.ssh/julian-deploy.pub")
gh repo deploy-key add - --repo popmechanic/Julian --title "<vmname>-deploy" --allow-write <<< "$DEPLOY_KEY"
```

If the key title already exists, skip — it's fine.

Clone the repo and configure git identity:

```bash
ssh -o StrictHostKeyChecking=accept-new <vmname>.exe.xyz "git clone git@github.com:popmechanic/Julian.git /opt/julian"
ssh -o StrictHostKeyChecking=accept-new <vmname>.exe.xyz "cd /opt/julian && git config user.name 'Julian' && git config user.email 'julian@exe.xyz'"
```

### Step P5: Install dependencies

```bash
ssh -o StrictHostKeyChecking=accept-new <vmname>.exe.xyz "cd /opt/julian && /home/exedev/.bun/bin/bun install"
```

### Step P6: Create .env

Use the `VITE_CLERK_PUBLISHABLE_KEY` from pre-flight (do NOT hardcode):

```bash
ssh -o StrictHostKeyChecking=accept-new <vmname>.exe.xyz "cat > /opt/julian/.env << 'ENVEOF'
VITE_CLERK_PUBLISHABLE_KEY=<value from local .env>
ALLOWED_ORIGIN=https://<vmname>.exe.xyz
ENVEOF"
```

### Step P6b: Configure Claude Code settings

Enable Agent Teams (disabled by default) so Julian can spawn and manage agent teammates:

```bash
ssh -o StrictHostKeyChecking=accept-new <vmname>.exe.xyz "mkdir -p /home/exedev/.claude && cat > /home/exedev/.claude/settings.json << 'SETTINGSEOF'
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
SETTINGSEOF"
```

### Step P7: Install and start systemd services

```bash
scp deploy/julian.service <vmname>.exe.xyz:/tmp/
scp deploy/julian-screen.service <vmname>.exe.xyz:/tmp/
ssh -o StrictHostKeyChecking=accept-new <vmname>.exe.xyz "sudo cp /tmp/julian.service /etc/systemd/system/ && \
  sudo cp /tmp/julian-screen.service /etc/systemd/system/ && \
  sudo systemctl daemon-reload && \
  sudo systemctl enable --now julian julian-screen"
```

### Step P8: Register instance

Add the VM to `deploy/instances.json`:

```json
{
  "<vmname>": {
    "url": "https://<vmname>.exe.xyz",
    "provisioned": "<ISO 8601 timestamp>",
    "branch": "<git branch used for first deploy>"
  }
}
```

Read the existing file, merge the new entry, write it back. **Commit and push** the updated registry so other machines know about it:

```bash
git add deploy/instances.json
git commit -m "Register <vmname> instance"
git push
```

### Step P9: Verify

```bash
ssh -o StrictHostKeyChecking=accept-new <vmname>.exe.xyz "systemctl is-active julian julian-screen"
curl -sf https://<vmname>.exe.xyz/ | head -5
curl -sf https://<vmname>.exe.xyz/api/health
```

Report: URL, service status, and remind user that Anthropic credentials need one-time setup on new instances.

---

## Path B: Update (Existing VM)

Fast path — just sync code and restart. This is the common case.

### Pre-flight

1. Pull Julian's changes locally: `git pull` (stop on merge conflicts)
2. Check for uncommitted changes: `git status --porcelain` (warn but don't block)
3. Push to GitHub: `git push`
4. Print target: VM name and URL

### Change analysis

Before deploying, assess the scope of changes. Get the server's current commit and diff it against what you're about to deploy:

```bash
SERVER_HEAD=$(ssh -o StrictHostKeyChecking=accept-new <vmname>.exe.xyz "cd /opt/julian && git rev-parse HEAD")
git diff --stat $SERVER_HEAD HEAD
git diff --name-only $SERVER_HEAD HEAD
```

Classify the deploy based on what changed:

**Content only** (soul/, memory/, catalog.xml, docs/):
- Safe. Tell the user: "Content-only update — safe to deploy directly."
- Proceed without prompting.

**Small code change** (1-3 files changed in server/ or frontend, under ~100 lines total):
- Low risk. Tell the user: "Small code update — deploying to <vmname>."
- Proceed without prompting.

**Large code change** (4+ files changed, or 200+ lines, or structural changes to server.ts):
- Higher risk. Tell the user the scope, e.g.: "This is a larger change — 8 files, ~350 lines, including server.ts changes."
- If the target is **production** (`julian`), suggest: "Want to deploy to a fresh test VM first? I can provision one with `/julian:deploy test`."
- If the target is already a non-production VM, proceed — that's what test VMs are for.

**Dependency change** (package.json modified):
- Note it: "package.json changed — will run bun install."
- If combined with large code changes on production, reinforce the test VM suggestion.

**No changes** (server is already on the same commit):
- Tell the user: "Server is already up to date (commit <hash>). Nothing to deploy."
- Skip the deploy entirely.

### Step U1: Pull latest code

```bash
ssh -o StrictHostKeyChecking=accept-new <vmname>.exe.xyz "cd /opt/julian && git pull"
```

If git pull fails because Julian has uncommitted changes:

```bash
ssh -o StrictHostKeyChecking=accept-new <vmname>.exe.xyz "cd /opt/julian && git stash && git pull && git stash pop"
```

If there are merge conflicts after stash pop, report them to the user.

### Step U2: Install dependencies (if needed)

Check if `package.json` changed in the pull:

```bash
ssh -o StrictHostKeyChecking=accept-new <vmname>.exe.xyz "cd /opt/julian && git diff HEAD~1 --name-only 2>/dev/null | grep -q package.json && echo changed || echo unchanged"
```

If changed (or if in doubt), run:

```bash
ssh -o StrictHostKeyChecking=accept-new <vmname>.exe.xyz "cd /opt/julian && /home/exedev/.bun/bin/bun install"
```

### Step U3: Restart services

```bash
ssh -o StrictHostKeyChecking=accept-new <vmname>.exe.xyz "sudo systemctl restart julian julian-screen"
```

### Step U4: Verify

```bash
curl -sf https://<vmname>.exe.xyz/api/health
```

Confirm the `version` field in the health response matches the current git hash. Report the URL and version.

---

## Error Recovery

- **DNS not resolving after 90 seconds**: Run `ssh exe.dev list` to verify VM exists. If it does, wait longer or check exe.dev status.
- **Service won't start**: Usually missing Bun. Check `ssh <vmname>.exe.xyz "/home/exedev/.bun/bin/bun --version"`.
- **Connection refused on port 8000**: Check logs: `ssh <vmname>.exe.xyz "journalctl -u julian -n 20 --no-pager"`. Common causes: missing Bun, missing `jose` dependency.
- **git pull/push auth error**: Deploy key issue. Check `ssh <vmname>.exe.xyz "ssh -T git@github.com"`. Re-run Step P4 if needed.
- **git pull merge conflict**: Julian has uncommitted changes. Stash first (see Step U1).
- **Instance in registry but VM gone**: Remove the entry from `deploy/instances.json` and re-run — it will take the Provision path.
- **401 on `/tokens/with-email`**: Missing Clerk JWT template. Create `with-email` in Clerk Dashboard → Configure → JWT Templates with the claims JSON from the Clerk Pre-flight section.
- **VM creation fails**: Check exe.dev status, retry once.
