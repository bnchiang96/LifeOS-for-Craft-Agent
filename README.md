# LifeOS Craft Agent

A personal life management setup for [Craft Agent](https://craft.do) — two MCP sources and one orchestrator skill that let you naturally manage notes, reminders, tasks, groceries, contacts, and expenses through conversation.

## What's Included

| Component | Type | Description |
|-----------|------|-------------|
| **Personal Assistant** | MCP Source | Notes, tasks, reminders, events, groceries, contacts, journal entries |
| **Financial Assistant** | MCP Source | Expense tracking, corrections, payment methods, spending history |
| **LifeOS** | Skill | Orchestrator that routes requests to the right source and enforces consistent behavior |

### Personal Assistant Tools

- `record_entry` — Create a new personal entry
- `search_entries` — Search by keyword, type, status, or date range
- `update_entry` — Update an existing entry
- `delete_entry` — Soft-delete an entry
- `add_entry_remark` — Append a follow-up remark

### Financial Assistant Tools

- `record_expense` — Log a new expense with merchant, items, and payment details
- `search_expenses` — Search by keyword, date range, payment method, or category
- `update_expense` — Correct an expense (preserves full change history)
- `delete_expense` — Soft-delete an expense
- `add_expense_remark` — Append a follow-up remark
- `get_expense_history` — View the correction chain for an expense

## Prerequisites

- **Node.js** (v18+)
- **Supabase** project with a database
- **Craft Agent** desktop app

## Setup

### 1. Create the Database Tables

Run the contents of [`02-table.sql`](./02-table.sql) in your Supabase SQL Editor. This creates:

- `personal_entries` + `personal_entry_dates` (for personal assistant)
- `expenses` + `active_expenses` view (for financial assistant)
- Necessary indexes, triggers, and functions

### 2. Configure Each Source

Update each `config.json` with your Supabase credentials and the absolute path to `server.mjs`.

**`sources/personal-assistant/config.json`**

```json
{
  "mcp": {
    "args": ["/absolute/path/to/sources/personal-assistant/server.mjs"],
    "env": {
      "SUPABASE_URL": "https://your-project.supabase.co",
      "SUPABASE_KEY": "your-anon-key"
    }
  }
}
```

**`sources/financial-assistant/config.json`**

```json
{
  "mcp": {
    "args": ["/absolute/path/to/sources/financial-assistant/server.mjs"],
    "env": {
      "SUPABASE_URL": "https://your-project.supabase.co",
      "SUPABASE_KEY": "your-anon-key",
      "DEFAULT_CURRENCY": "MYR"
    }
  }
}
```

### 3. Test the Sources

In Craft Agent, run `source_test` on both sources to verify connectivity.

### 4. Enable the LifeOS Skill

The LifeOS skill (`skills/LifeOS/SKILL.md`) is automatically discovered by Craft Agent. Once the sources are connected, the skill routes your requests:

- **Notes, reminders, tasks, groceries, contacts** → Personal Assistant
- **Expenses, purchases, bills, payments** → Financial Assistant
- **Mixed requests** → Both sources as needed

## Folder Structure

```
LifeOS Craft Agent/
├── 02-table.sql                    # Database schema (run once in Supabase)
├── sources/
│   ├── personal-assistant/
│   │   ├── config.json             # Credentials + path to server.mjs
│   │   ├── guide.md                # Usage guidelines for the source
│   │   ├── permissions.json        # Tool permission rules
│   │   └── server.mjs              # MCP server (Node.js)
│   └── financial-assistant/
│       ├── config.json             # Credentials + path to server.mjs
│       ├── guide.md                # Usage guidelines for the source
│       ├── permissions.json        # Tool permission rules
│       └── server.mjs              # MCP server (Node.js)
└── skills/
    └── LifeOS/
        └── SKILL.md                # Orchestrator skill definition
```

## How It Works

Both MCP servers are Node.js processes that communicate with Supabase via its REST API (PostgREST). They run locally on your machine as stdio subprocesses managed by Craft Agent.

- **Timestamps** are stored in UTC in Supabase. Servers convert local dates to UTC when saving and format back to local time when displaying.
- **Soft deletes** are used everywhere — records are never permanently removed, just marked with `deleted_at`.
- **Expense corrections** create a new record linked to the original via `correction_of`, preserving the full change history.

## License

MIT
