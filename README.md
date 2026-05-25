# LifeOS Craft Agent

A complete **Life Operating System** built on Craft Agent. This repository contains skills, source configurations, and setup instructions to turn Craft Agent into a powerful personal OS for productivity, knowledge management, and life tracking.

## What is LifeOS?

LifeOS combines:
- **Skills** — Specialized agents for daily reviews, task triage, journaling, project management, etc.
- **Sources (MCP)** — Connected data sources (Linear, GitHub, Calendar, Notes, Health, Finance, etc.)
- **Automations** — Scheduled briefings, weekly reviews, and proactive life management.

## Quick Setup

### 1. Install the LifeOS MCP Server (Core Data Layer)

This is the most important step. The LifeOS MCP server connects all your personal data.

**During setup, Craft Agent will ask you to provide:**

- `LIFEOS_PROJECT_URL` — Your project URL
- `LIFEOS_ANON_KEY` — Your anonymous API key

Run this command:

```bash
craft-agent source create \
  --name "LifeOS MCP" \
  --provider "lifeos" \
  --type mcp \
  --transport stdio \
  --command "npx" \
  --args "-y,@lifeos/mcp-server" \
  --json '{
    "mcp": {
      "env": {
        "LIFEOS_PROJECT_URL": "YOUR_PROJECT_URL",
        "LIFEOS_ANON_KEY": "YOUR_ANON_KEY"
      }
    }
  }'
```

Then validate:

```bash
craft-agent source test lifeos-mcp
```

> See `sources/lifeos-mcp/guide.md` for detailed instructions.

### 2. Install Additional Recommended Sources

```bash
# Linear (Tasks)
craft-agent source create --name "Linear" --provider "linear" --type mcp --url "https://mcp.linear.app" --auth-type oauth

# GitHub
craft-agent source create --name "GitHub" --provider "github" --type mcp --url "https://api.githubcopilot.com/mcp/" --auth-type bearer

# Google Calendar
craft-agent source create --name "Google Calendar" --provider "google" --type api --base-url "https://www.googleapis.com/calendar/v3/" --auth-type oauth
```

### 3. Install LifeOS Skills

Skills will be added to this repository soon. You can create your own or copy from the community.

## Repository Structure

```
.
├── README.md
├── skills/                 # Reusable LifeOS skills (coming soon)
├── sources/
│   └── lifeos-mcp/         # LifeOS MCP server template (masked credentials)
├── docs/                   # Additional guides
└── setup.sh                # One-command setup (coming soon)
```

## Publishing Your Own Skills & MCPs

This repo is designed to be forked and extended.

- **Skills** follow the official Claude Code SDK format → fully compatible.
- **MCP servers** are standard MCP — publish as npm packages or hosted endpoints.

See individual skill folders for examples.

## Contributing

Pull requests for new LifeOS skills (especially around health, finance, relationships, and long-term goals) are very welcome.

## License

MIT — Use freely to build your own LifeOS.