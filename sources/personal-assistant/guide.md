# Personal Assistant (贴心小秘书)

Personal-entry MCP source for a private Supabase-backed notebook. Use it to record, search, update, soft-delete, and append follow-up remarks for personal notes, tasks, reminders, events, ideas, journal entries, grocery items, contacts, and other important life context.

## Scope

This source currently covers **personal entries only**.

Included tables:
- `personal_entries`
- `personal_entry_dates`

Current tools:
- `record_entry`
- `search_entries`
- `update_entry`
- `delete_entry`
- `add_entry_remark`

Not in scope for now:
- expenses
- bagua
- any cross-table lookups outside personal entries

## Guidelines

- Use this source whenever the user wants to save or retrieve an important personal detail from their private notebook.
- Never pretend something was already remembered unless it was actually found by searching this source.
- If the user explicitly says not to save something, do not call the source.
- `raw_input` must always be the same content as the user’s original prompt for the part being saved. Do not translate it, rewrite it, shorten it, or normalize its wording.
- Save content in the same language the user is currently chatting in unless they explicitly ask to translate or normalize it differently.
- Use `processed_text` for a cleaner summary when helpful, while keeping the user’s active chat language by default.
- If `entry_type` is unclear, default to `note`.
- If `status` is unclear, default to `open`.
- If `priority` is unclear, default to `0`.
- Put extra structured context into `metadata`.
- Use array-valued relation keys inside `metadata` when relevant, such as `related_personal_entry_ids`.
- Use `date_entries` only when there is a reliable date or time to store.
- `date_entries` must be an array of objects with both `date_at` and `description`.
- `remarks` can be passed as plain strings or as full objects with `timestamp` and `text`. The server normalizes them.
- `delete_entry` is a soft delete. The main row and active child date rows are marked deleted.
- After create, update, or add-remark operations, the tool returns the full entry with attached `date_entries`.

## Time Handling

- Interpret user-relative time using the current system timezone before calling this source.
- The database stores timestamps in UTC.
- When saving a user-mentioned local date/time, first resolve it in the system timezone, then convert it to UTC ISO before sending it in `date_entries.date_at`.
- For date-range search inputs, pass explicit `from_date` and `to_date` values.
- The source searches date ranges across both:
  - `personal_entries.created_at`
  - `personal_entry_dates.date_at`
- Date-only boundaries such as `2026-03-01` and `2026-03-31` are treated as system-local day boundaries internally and then mapped to UTC for querying.
- When explaining saved times back to the user, map UTC timestamps back into the relevant local timezone if needed.
- If timing is ambiguous, preserve the user’s wording in `raw_input` and clarify your interpretation in `processed_text` or `metadata`.

## Remarks vs Update Rules

- Use `add_entry_remark` for follow-up notes, progress updates, outcomes, and extra context on the same entry.
- If only a short follow-up is being added and the structured data has not changed, use `add_entry_remark` alone.
- If dates, timeline, status, or important structured details changed, first use `add_entry_remark` to preserve the history, then use `update_entry` to refresh the structured fields.
- If the user is correcting the original entry itself, use `update_entry`.

## Entry Types

Allowed `entry_type` values:
- `note`
- `task`
- `reminder`
- `event`
- `idea`
- `journal`
- `grocery`
- `contact`
- `other`

## Status Values

Allowed `status` values:
- `open`
- `completed`
- `archived`
- `cancelled`

## Priority Values

Allowed `priority` values:
- `0` = low
- `1` = medium
- `2` = high

## Tool Reference

### `record_entry`

Create a new personal entry.

**Important input rules:**
- `raw_input` is required.
- `date_entries` must be a full array if provided.
- `remarks` may be strings or `{ "timestamp", "text" }` objects.

**Full sample payload:**
```json
{
  "raw_input": "3月20日晚上跟妈妈吃饭，3月18日先买材料",
  "processed_text": "妈妈生日提醒",
  "entry_type": "reminder",
  "status": "open",
  "priority": 1,
  "tags": ["家人", "生日"],
  "metadata": {
    "person": "妈妈"
  },
  "remarks": [
    {
      "timestamp": "2026-03-16T10:30:00.000Z",
      "text": "先记下来，晚点确认餐厅"
    }
  ],
  "date_entries": [
    {
      "date_at": "2026-03-18T10:00:00.000Z",
      "description": "buy ingredients"
    },
    {
      "date_at": "2026-03-20T11:00:00.000Z",
      "description": "birthday dinner"
    }
  ]
}
```

### `search_entries`

Search existing personal entries.

**Important input rules:**
- Prefer `keyword` for text search.
- `query` is accepted as a legacy alias.
- `from_date` and `to_date` can be date-only strings or ISO datetimes.
- Returned paging is applied after merged date-aware results are assembled.
- Search responses include a `pagination` object with `total`, `limit`, `offset`, `returned`, and `has_more`.

**Full sample payload:**
```json
{
  "keyword": "妈妈 生日",
  "entry_type": "reminder",
  "status": "open",
  "from_date": "2026-03-01",
  "to_date": "2026-03-31",
  "limit": 20,
  "offset": 0
}
```

### `update_entry`

Update an existing personal entry.

**Important input rules:**
- `id` is required.
- If `date_entries` is included, it replaces the active date-entry set for that row.
- If `remarks` is included, the full remarks array is normalized and stored.

**Full sample payload:**
```json
{
  "id": 123,
  "raw_input": "3月21日晚上7:30跟妈妈吃饭，已经订好餐厅",
  "processed_text": "妈妈生日提醒，晚餐改到 3 月21日晚上7:30，已订餐厅",
  "entry_type": "reminder",
  "status": "open",
  "priority": 1,
  "tags": ["家人", "生日"],
  "metadata": {
    "person": "妈妈",
    "booking_status": "booked"
  },
  "remarks": [
    {
      "timestamp": "2026-03-16T10:30:00.000Z",
      "text": "先记下来，晚点确认餐厅"
    },
    {
      "timestamp": "2026-03-17T03:00:00.000Z",
      "text": "已经订好餐厅了"
    }
  ],
  "date_entries": [
    {
      "date_at": "2026-03-21T11:30:00.000Z",
      "description": "birthday dinner"
    }
  ]
}
```

### `delete_entry`

Soft delete an entry.

**Important input rules:**
- `id` is required.

**Full sample payload:**
```json
{
  "id": 123
}
```

### `add_entry_remark`

Append a new follow-up remark to an existing entry.

**Important input rules:**
- `id` is required.
- `text` is required.
- Use this for progress updates and follow-ups when the entry identity stays the same.

**Full sample payload:**
```json
{
  "id": 123,
  "text": "已经订好餐厅了"
}
```

## Common Usage Patterns

### Record a reminder with multiple dates
1. Resolve relative dates in Malaysia time.
2. Call `record_entry` with the original wording in `raw_input`.
3. Put the actionable dates into `date_entries`.

### Search upcoming reminders
1. Use `search_entries`.
2. Pass `entry_type: "reminder"` and `status: "open"`.
3. Include `from_date` and `to_date` for the target window.

### Add a follow-up without changing structure
1. Call `add_entry_remark`.
2. Do not use `update_entry` if only a brief progress note changed.

### Follow-up with changed timeline
1. Call `add_entry_remark` first to preserve the historical note.
2. Then call `update_entry` with refreshed `processed_text`, `status`, `metadata`, and `date_entries`.

## Response Shape

All tools return a JSON object containing:
- `success`
- `current_date_time`
- `data`

Search responses also include:
- `pagination`

For entry-returning operations, `data` includes the personal entry row plus a `date_entries` array.
