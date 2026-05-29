# LifeOS Supabase (生活小管家)

Unified personal and financial notebook backed by Supabase. Combines expense tracking (💸) and personal entries (📝) into a single source.

## Scope

### Financial Domain — Expenses

Included database objects:
- `expenses`
- `active_expenses` (view)
- `soft_delete_expense(...)` (function)

Tools:
- `record_expense` — Create a new expense record
- `search_expenses` — Search active expenses by keyword, date, category, payment method
- `update_expense` — Correct an expense (creates new version, soft-deletes old)
- `delete_expense` — Soft-delete an expense
- `add_expense_remark` — Append a follow-up remark to an expense
- `get_expense_history` — View the correction chain for an expense

### Personal Domain — Entries

Included tables:
- `personal_entries`
- `personal_entry_dates`

Tools:
- `record_personal` — Create a new personal entry
- `search_personal` — Search entries by keyword, type, status, date range
- `update_personal` — Update an existing personal entry
- `delete_personal` — Soft-delete a personal entry
- `add_personal_remark` — Append a follow-up remark to an entry

### System

- `ensure_tables` — Create database tables if they don't exist (run once during setup)

---

## Guidelines (General)

- Use this source whenever the user wants to save, find, correct, or manage expenses or personal details.
- The database is the source of truth — search the source first instead of relying on chat memory.
- Save content in the same language the user is currently chatting in unless they explicitly want translation.
- Keep merchant names and branded payment names exactly as intended (e.g., `ShopeePay`, `SPayLater`, `Grab PayLater`, `Atome`).
- Use the configured default currency (MYR) when `currency` is not provided.
- If the category is unclear, default to `other`.
- If `entry_type` is unclear, default to `note`.
- If `status` is unclear, default to `open`.
- If `priority` is unclear, default to `0`.

## Time Handling

- Interpret user-relative time using the current system timezone before calling tools.
- The database stores timestamps in UTC.
- `transaction_date` (expenses) is treated as a local calendar date.
- If `transaction_date` is omitted, it defaults to the current date in the system timezone.
- When saving user-mentioned local date/times into date_entries or remark timestamps, resolve in system timezone and map to UTC.
- When explaining stored UTC timestamps back to the user, map them back to local timezone.

## Payment Method Expectations (Expenses)

Use stable payment method names, for example:
- `ShopeePay`
- `SPayLater`
- `Grab PayLater`
- `Atome`
- `Touch 'n Go eWallet`
- `Maybank Visa (3344)`
- `CIMB Debit`
- `Cash`

The source auto-detects `is_paylater` when the payment method contains terms like `paylater`, `later`, `atome`, `spaylater`, or `grab paylater`.

## Expense Category Rules

`category` must always be an array. The first category tag must be one of these fixed top-level values:

`food` · `drink` · `transport` · `clothing` · `beauty` · `electronics` · `household` · `entertainment` · `medical` · `education` · `travel` · `gift` · `fees` · `rental` · `loans` · `discount` · `other`

Additional tags should be lowercase English with `-` instead of spaces. Vehicle plate numbers may stay uppercase (e.g., `VKF433`).

## Personal Entry Types

Allowed `entry_type` values:
- `note` · `task` · `reminder` · `event` · `idea` · `journal` · `grocery` · `contact` · `other`

## Status & Priority (Personal)

- Status: `open` · `completed` · `archived` · `cancelled`
- Priority: `0` (low) · `1` (medium) · `2` (high)

## Remarks vs Update Rules (Personal)

- Use `add_personal_remark` for follow-up notes, progress updates, outcomes.
- If only a short follow-up is being added and structured data hasn't changed, use `add_personal_remark` alone.
- If dates, timeline, status, or important structured details changed, first use `add_personal_remark` to preserve history, then use `update_personal`.
- If the user is correcting the original entry itself, use `update_personal`.

---

## Tool Reference — Expenses

### `record_expense`

Create a new expense record.

**Required:** `total_amount`, `payment_method`

```json
{
  "total_amount": 158.95,
  "currency": "MYR",
  "transaction_date": "2026-01-19",
  "merchant_name": "Shopee",
  "merchant_info": {
    "seller": "Nike Official",
    "order_id": "266789012345678",
    "receipt_no": "SHP-8899123",
    "transaction_id": "TXN-55667788",
    "transaction_time": "2026-01-19T06:35:22.000Z"
  },
  "items": [
    {
      "name": "Nike Air Force 1 - Nike Official",
      "qty": 1,
      "unit_price": 299,
      "subtotal": 299,
      "category": ["clothing", "online-order"],
      "remarks": [{ "timestamp": "2026-01-19T06:40:00.000Z", "text": "Bought in petaling-jaya" }]
    }
  ],
  "remarks": [{ "timestamp": "2026-02-22T17:28:00.000Z", "text": "For Miko ♥" }],
  "payment_method": "SPayLater",
  "is_paylater": true
}
```

### `search_expenses`

Search active expense records.

```json
{
  "keyword": "milk tea petaling-jaya",
  "start_date": "2026-03-01",
  "end_date": "2026-03-31",
  "payment_method": "SPayLater",
  "is_paylater": true,
  "category_contains": ["drink", "milk-tea"],
  "limit": 20,
  "offset": 0
}
```

### `update_expense`

Create a corrected replacement record. **Required:** `id`

### `delete_expense`

Soft-delete an expense. **Required:** `id`

### `add_expense_remark`

Append a remark. **Required:** `id`, `text`

### `get_expense_history`

Return the correction chain (oldest → newest). **Required:** `id`

---

## Tool Reference — Personal Entries

### `record_personal`

Create a new personal entry. **Required:** `raw_input`

```json
{
  "raw_input": "3月20日晚上跟妈妈吃饭，3月18日先买材料",
  "processed_text": "妈妈生日提醒",
  "entry_type": "reminder",
  "status": "open",
  "priority": 1,
  "tags": ["家人", "生日"],
  "metadata": { "person": "妈妈" },
  "remarks": [{ "timestamp": "2026-03-16T10:30:00.000Z", "text": "先记下来，晚点确认餐厅" }],
  "date_entries": [
    { "date_at": "2026-03-18T10:00:00.000Z", "description": "buy ingredients" },
    { "date_at": "2026-03-20T11:00:00.000Z", "description": "birthday dinner" }
  ]
}
```

### `search_personal`

Search personal entries.

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

### `update_personal`

Update an existing entry. **Required:** `id`

### `delete_personal`

Soft-delete an entry. **Required:** `id`

### `add_personal_remark`

Append a follow-up remark. **Required:** `id`, `text`

---

## Common Usage Patterns

### Record a quick expense
1. Keep the merchant, amount, payment method, and key notes.
2. Build at least one item if the user described what was purchased.
3. Let the source infer `is_paylater` from the payment method.

### Correct an existing expense
1. Use `update_expense` with the corrected data.
2. Add a follow-up note with `add_expense_remark` if needed.

### Record a reminder with multiple dates
1. Resolve relative dates in Malaysia time.
2. Call `record_personal` with original wording in `raw_input`.
3. Put actionable dates into `date_entries`.

### Search upcoming reminders
1. Use `search_personal` with `entry_type: "reminder"` and `status: "open"`.
2. Include `from_date` and `to_date` for the target window.

### Add a follow-up without changing structure
1. Call `add_personal_remark` or `add_expense_remark`.
2. Do not use `update_*` if only a brief progress note changed.

---

## Response Shape

All tools return a JSON object containing:
- `success`
- `data`
- `error`
- `current_date_time`

Search responses also include:
- `pagination`

For expense operations, the primary payload is inside `data.result`.
For personal entry operations, `data` includes the entry row plus a `date_entries` array.
