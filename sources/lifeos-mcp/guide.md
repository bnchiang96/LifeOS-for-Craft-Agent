# LifeOS MCP Server

Core data layer for the LifeOS system. Connects tasks, notes, health metrics, finance, and personal knowledge.

## Setup Instructions

**Important:** This source requires your personal LifeOS project credentials.

During installation, Craft Agent will prompt you for:

1. **LIFEOS_PROJECT_URL** — Your Supabase project URL  
   Example: `https://xxxxxxxx.supabase.co`

2. **LIFEOS_ANON_KEY** — Your Supabase anonymous (public) API key

### How to Install

Run the following command and **replace the placeholders** when prompted:

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

After creation, run:

```bash
craft-agent source test lifeos-mcp
```

## Scope

This MCP server provides access to:

- Tasks & Projects
- Notes & Knowledge Base
- Health & Energy Tracking
- Finance Records
- Relationships & Contacts

## Security Note

Never commit real `PROJECT_URL` or `ANON_KEY` to this repository. Always use environment variables or the credential prompt.