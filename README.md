# LifeOS Craft Agent

Personal Assistant + Financial Assistant sources for Craft Agent.

## Quick Setup

Copy this entire folder into your Craft Agent workspace sources:

```bash
cp -r sources/personal-assistant ~/.craft-agent/workspaces/my-workspace/sources/
cp -r sources/financial-assistant ~/.craft-agent/workspaces/my-workspace/sources/
```

### Configure Credentials

Craft Agent will ask you to provide these values when adding the sources:

| Source                | Field to Replace          | Description                  |
|-----------------------|---------------------------|------------------------------|
| Personal Assistant    | `SUPABASE_URL`            | Your Supabase project URL    |
| Personal Assistant    | `SUPABASE_KEY`            | Your Supabase anon key       |
| Financial Assistant   | `SUPABASE_URL`            | Your Supabase project URL    |
| Financial Assistant   | `SUPABASE_KEY`            | Your Supabase anon key       |
| Financial Assistant   | `DEFAULT_CURRENCY`        | e.g. `MYR`, `USD`, `SGD`     |

### Add Sources via CLI

```bash
# Personal Assistant
craft-agent source create \
  --name "Personal Assistant" \
  --provider "supabase" \
  --type mcp \
  --transport stdio \
  --command "node" \
  --args "~/.craft-agent/workspaces/my-workspace/sources/personal-assistant/server.mjs" \
  --json '{"mcp":{"env":{"SUPABASE_URL":"YOUR_SUPABASE_URL","SUPABASE_KEY":"YOUR_SUPABASE_KEY"}}}'

# Financial Assistant
craft-agent source create \
  --name "Financial Assistant" \
  --provider "supabase" \
  --type mcp \
  --transport stdio \
  --command "node" \
  --args "~/.craft-agent/workspaces/my-workspace/sources/financial-assistant/server.mjs" \
  --json '{"mcp":{"env":{"SUPABASE_URL":"YOUR_SUPABASE_URL","SUPABASE_KEY":"YOUR_SUPABASE_KEY","DEFAULT_CURRENCY":"MYR"}}}'
```

After adding, test them:

```bash
craft-agent source test personal-assistant
craft-agent source test financial-assistant
```

## Folder Structure

```
sources/
├── personal-assistant/
│   ├── config.json          # Change SUPABASE_URL and SUPABASE_KEY here
│   ├── guide.md
│   ├── permissions.json
│   └── server.mjs
└── financial-assistant/
    ├── config.json          # Change SUPABASE_URL, SUPABASE_KEY and DEFAULT_CURRENCY here
    ├── guide.md
    ├── permissions.json
    └── server.mjs
```

## License

MIT