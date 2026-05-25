# LifeOS Craft Agent

A complete **Life Operating System** built on Craft Agent. This repository contains skills, source configurations, and setup instructions to turn Craft Agent into a powerful personal OS for productivity, knowledge management, and life tracking.

## What is LifeOS?

LifeOS combines:
- **Skills** — Specialized agents for daily reviews, task triage, journaling, project management, etc.
- **Sources (MCP)** — Connected data sources (Linear, GitHub, Calendar, Notes, Health, Finance, etc.)
- **Automations** — Scheduled briefings, weekly reviews, and proactive life management.

## Quick Setup

### 1. Install Recommended Sources

```bash
# Core productivity
craft-agent source create --name "Linear" --provider "linear" --type mcp --url "https://mcp.linear.app" --auth-type oauth

# Development
craft-agent source create --name "GitHub" --provider "github" --type mcp --url "https://api.githubcopilot.com/mcp/" --auth-type bearer

# Calendar & Tasks
craft-agent source create --name "Google Calendar" --provider "google" --type api --base-url "https://www.googleapis.com/calendar/v3/" --auth-type oauth

# Notes / Knowledge
craft-agent source create --name "Craft" --provider "craft" --type api --base-url "https://api.craft.do/" --auth-type oauth
```

Run `craft-agent source test <slug>` after each source.

### 2. Install LifeOS Skills

Copy the skills from this repo into your workspace:

```bash
cp -r skills/* ~/.craft-agent/workspaces/my-workspace/skills/
```

Then validate them:

```bash
craft-agent skill validate daily-review
craft-agent skill validate life-triage
craft-agent skill validate weekly-review
```

### 3. Recommended Skills

| Skill              | Purpose                          | Trigger          |
|--------------------|----------------------------------|------------------|
| `daily-review`     | Morning/evening briefing         | `/daily`         |
| `life-triage`      | Prioritize tasks & energy        | `/triage`        |
| `weekly-review`    | Sunday review + planning         | Scheduled        |
| `project-closer`   | Cleanly close projects           | —                |
| `knowledge-curator`| Capture & link knowledge         | —                |

## Repository Structure

```
.
├── README.md
├── skills/                 # Reusable LifeOS skills
│   ├── daily-review/
│   ├── life-triage/
│   └── weekly-review/
├── sources/                # Example source configs + guide.md templates
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