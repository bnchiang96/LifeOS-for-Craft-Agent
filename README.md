# LifeOS Craft Agent

A complete **Life Operating System** built on Craft Agent. This repository contains skills, source configurations, and setup instructions to turn Craft Agent into a powerful personal OS for productivity, knowledge management, and life tracking.

## What is LifeOS?

LifeOS combines:
- **Skills** — Specialized agents for daily reviews, task triage, journaling, project management, etc.
- **Sources (MCP)** — Connected data sources (Linear, GitHub, Calendar, Notes, Health, Finance, etc.)
- **Automations** — Scheduled briefings, weekly reviews, and proactive life management.

## Quick Setup

### 1. Install Personal Assistant & Financial Assistant (Core LifeOS Sources)

These two sources power the LifeOS system:

- **Personal Assistant** — Private notebook (tasks, notes, journaling)
- **Financial Assistant** — Expense tracking

**During setup, Craft Agent will ask you to provide:**

- `SUPABASE_URL` — Your Supabase project URL
- `SUPABASE_KEY` — Your Supabase anon key

```bash
# Personal Assistant
craft-agent source create \
  --name "Personal Assistant" \
  --provider "supabase" \
  --type mcp \
  --transport stdio \
  --command "node" \
  --args "sources/personal-assistant/server.mjs" \
  --json '{
    "mcp": {
      "env": {
        "SUPABASE_URL": "YOUR_SUPABASE_URL",
        "SUPABASE_KEY": "YOUR_SUPABASE_KEY"
      }
    }
  }'

# Financial Assistant
craft-agent source create \
  --name "Financial Assistant" \
  --provider "supabase" \
  --type mcp \
  --transport stdio \
  --command "node" \
  --args "sources/financial-assistant/server.mjs" \
  --json '{
    "mcp": {
      "env": {
        "SUPABASE_URL": "YOUR_SUPABASE_URL",
        "SUPABASE_KEY": "YOUR_SUPABASE_KEY",
        "DEFAULT_CURRENCY": "MYR"
      }
    }
  }'
```

After adding each source, run:

```bash
craft-agent source test personal-assistant
craft-agent source test financial-assistant
```

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
├── skills/                     # LifeOS skills (coming soon)
├── sources/
│   ├── personal-assistant/     # Personal notebook (masked Supabase credentials)
│   └── financial-assistant/    # Expense tracking (masked Supabase credentials)
├── docs/
└── setup.sh                    # One-command setup (coming soon)
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