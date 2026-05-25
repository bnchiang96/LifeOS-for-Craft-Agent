# LifeOS Craft Agent

Personal Assistant + Financial Assistant sources + LifeOS skill for Craft Agent.

## For Craft Agent

When you open this project, here is what you need to do.

### What's Included

This project contains two MCP sources and one orchestrator skill for Craft Agent:

- **Personal Assistant** — A Supabase-backed source for personal notes, tasks, reminders, and journal entries. Lives at `sources/personal-assistant/`.
- **Financial Assistant** — A Supabase-backed source for personal expense tracking. Lives at `sources/financial-assistant/`.
- **LifeOS** — An orchestrator skill that routes user requests to the right source (personal-assistant for notes/tasks/reminders, financial-assistant for expenses), handles corrections across both systems, and enforces consistent behavior around truthfulness, language, time, and operational rules. Lives at `skills/LifeOS/`.

### Setup

1. Update `args` in each `config.json` to use the absolute path of `server.mjs` (e.g. `~/.craft-agent/workspaces/my-workspace/sources/personal-assistant/server.mjs`).

2. Prompt the user for credentials using `source_credential_prompt`. Update each source's `config.json` `env` section:

| Source               | Env Variable          | Description                  |
|----------------------|-----------------------|------------------------------|
| Personal Assistant   | `SUPABASE_URL`        | Supabase project URL         |
| Personal Assistant   | `SUPABASE_KEY`        | Supabase project anon key    |
| Financial Assistant  | `SUPABASE_URL`        | Supabase project URL         |
| Financial Assistant  | `SUPABASE_KEY`        | Supabase project anon key    |
| Financial Assistant  | `DEFAULT_CURRENCY`    | Default currency (e.g. MYR)  |

3. Run `source_test` on both sources to initialize the MCP servers.

4. Call `ensure_tables` on both sources. Done.

## Folder Structure

```
.
├── 02-table.sql               # All table schemas (reference / manual fallback)
├── sources/
│   ├── personal-assistant/
│   │   ├── config.json          # Update SUPABASE_URL and SUPABASE_KEY
│   │   ├── guide.md
│   │   ├── permissions.json
│   │   └── server.mjs
│   └── financial-assistant/
│       ├── config.json          # Update SUPABASE_URL, SUPABASE_KEY, DEFAULT_CURRENCY
│       ├── guide.md
│       ├── permissions.json
│       └── server.mjs
└── skills/
    └── LifeOS/
        └── SKILL.md             # Main LifeOS orchestrator skill
```

## License

MIT