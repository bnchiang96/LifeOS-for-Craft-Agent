# LifeOS Craft Agent

A personal life management setup for [Craft Agent](https://craft.do) — a unified MCP source and orchestrator skill that let you naturally manage notes, reminders, tasks, groceries, contacts, and expenses through conversation.

## What's Included

| Component | Type | Description |
|-----------|------|-------------|
| **LifeOS Supabase** | MCP Source | Unified source for both personal entries and expense tracking |
| **LifeOS** | Skill | Orchestrator that routes requests to the right tools and enforces consistent behavior |

### Expense Tools

- `record_expense` — Log a new expense with merchant, items, and payment details
- `search_expenses` — Search by keyword, date range, payment method, or category
- `update_expense` — Correct an expense (preserves full change history)
- `delete_expense` — Soft-delete an expense
- `add_expense_remark` — Append a follow-up remark
- `get_expense_history` — View the correction chain for an expense

### Personal Tools

- `record_personal` — Create a new personal entry (notes, tasks, reminders, events, etc.)
- `search_personal` — Search by keyword, type, status, or date range
- `update_personal` — Update an existing entry
- `delete_personal` — Soft-delete an entry
- `add_personal_remark` — Append a follow-up remark

### System

- `ensure_tables` — Create database tables if they don't exist (run once during setup)

## Prerequisites

- **Node.js** (v18+)
- **Supabase** project with a database
- **Craft Agent** desktop app

## Setup

1. Go to your Supabase dashboard → Project Settings → API. Copy the **Project URL** and **anon key**.
2. Open this project in Craft Agent and provide the URL and key when prompted.
3. Craft Agent will update `config.json`:
   - Set `args` to the absolute path of `server.mjs` on your machine
   - Set `SUPABASE_URL` and `SUPABASE_KEY` to your project values
4. Craft Agent will run `ensure_tables` to check if the database tables exist. If they do, setup is done. If not, it creates them automatically.

## Folder Structure

```
LifeOS Craft Agent/
├── 02-table.sql                    # Database schema (run once in Supabase)
├── sources/
│   └── lifeos-supabase/
│       ├── config.json             # URL, key + path to server.mjs
│       ├── guide.md                # Usage guidelines for the source
│       ├── permissions.json        # Tool permission rules
│       └── server.mjs              # MCP server (Node.js)
└── skills/
    └── LifeOS/
        └── SKILL.md                # Orchestrator skill definition
```

## How It Works

The MCP server is a Node.js process that communicates with Supabase via its REST API (PostgREST). It runs locally on your machine as a stdio subprocess managed by Craft Agent.

- **Timestamps** are stored in UTC in Supabase. The server converts local dates to UTC when saving and formats back to local time when displaying.
- **Soft deletes** are used everywhere — records are never permanently removed, just marked with `deleted_at`.
- **Expense corrections** create a new record linked to the original via `correction_of`, preserving the full change history.
- **Personal entries** can have multiple attached dates (e.g., "buy ingredients on Mar 18" + "birthday dinner on Mar 20").

## License

MIT
