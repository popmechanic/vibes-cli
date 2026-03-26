# VibesOS - a GUI for Claude Code that makes unhackable mini-apps

![Vibes](assets/vibes.png)

Instantly make your own small multi-user apps, without a backend. For apps made with Vibes, the front-end _is_ the app.

## What is Vibes?

Vibes is a vibe coding framework made for coding agents. It collapses application code and application state into a single HTML file that runs anywhere.

**Why does this matter?** AI doesn't make apps - it makes *text*. By embedding the database in JavaScript (via [TinyBase](https://tinybase.org)), your coding agent can describe an entire app - including its persistence layer - in one shot. No server setup, no schema imports. Just a working app.

Your data lives locally in the browser, encrypted and portable. It syncs across users automatically. Share your creations with a simple link and friends can jump in immediately.

## Installation

[MacOS users can download the desktop app](https://install.vibesos.com/).

If you want to run it as a plugin, register the marketplace first:

```
/plugin marketplace add popmechanic/VibesOS
```

Then install the plugin:

```
/plugin install vibes@VibesOS
```

Restart Claude Code after installation.

## Plugin Quick Start

After installation, open Claude Code and enter /launch, then choose the Editor option. Claude will then open a web GUI designed to help you produce secure, vibe coded apps. 

![Vibes Editor](assets/GUI.png)

It's still Claude Code under the hood, we just help you with a nice user interface. Use the GUI to turn your ideas into simple deployable multiplayer apps that don't require a server. (So you don't have to be a Linux genius to run a great app.)


## Skills

Skills are **model-invoked** - Claude automatically uses them when your task matches the skill's purpose. Just describe what you want to build.

### `vibes`

Generate a complete, working app from a prompt. Perfect when you have a clear idea and want to see it working quickly.

Creates a single HTML file with inline JavaScript, TinyBase for local-first reactive data, and Tailwind CSS styling. No build step - just open and run.

**Example prompts:**
- "Make a chore chart for my roommates"
- "Build a potluck sign-up for Friendsgiving"
- "Create a trivia game about reality TV"


## Commands

Commands are **user-invoked** — run them explicitly when you want a specific skill.

| Command | What it does |
|---------|-------------|
| `/vibes` | Generate a React web app with TinyBase |
| `/launch` | Build and deploy a SaaS app end-to-end using Agent Teams |

## Why Vibes?

Every vibe-coded project starts in the vibe zone - the AI understands you, progress is fast, each change moves the app forward.

Then something small goes wrong. A fix that mostly works. An edge case layered on top. You correct it, then correct the correction, and suddenly progress slows to a crawl.

You've drifted out of the vibe zone.

![Vibe Zone](assets/vibezone.png)

**Vibes OS keeps things simple enough that you stay in the vibe zone.** Single-file apps. Local-first data. No server complexity. The AI can see and understand everything it needs to help you.

## How Data Works

Vibes apps use [TinyBase](https://tinybase.org), a reactive data store for local-first apps:

- **Offline-first**: Apps work without internet, sync when connected
- **Reactive**: Automatic re-rendering when data changes via React hooks
- **Shareable**: Real-time sync across users via WebSocket relay
- **Portable**: Simple table/row data model, easy to export

The hidden settings menu (gear icon) lets you configure sync for collaboration.

### The Constraint Is the Feature

You cannot run global queries across all tenants. Some ideas won't fit. This is groupware—tools for communities, not platforms that own them. No one can be Zuckerberg over a Vibes app. That's the point.

## Links

- [vibes.diy](https://vibes.diy) - Try the web builder
- [Discord](https://discord.gg/vnpWycj4Ta) - Join the community

## License

MIT
