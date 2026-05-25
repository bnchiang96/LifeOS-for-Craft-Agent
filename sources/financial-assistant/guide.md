# Financial Assistant (记账小精灵)

Expense-tracking MCP source for a private Supabase-backed notebook. Use it to record expenses, search past spending, update records through a correction chain, soft-delete records, append follow-up remarks, and inspect change history.

## Scope

This source currently covers **expense records only**.

Included database objects:
- `expenses`
- `active_expenses`
- `soft_delete_expense(...)`

Current tools:
- `record_expense`
- `search_expenses`
- `update_expense`
- `delete_expense`
- `add_expense_remark`
- `get_expense_history`

Not in scope for now:
- monthly summary tool
- any non-expense assistant flows

## Guidelines

- Use this source whenever the user wants to save, find, correct, annotate, or remove an expense record.
- The database is the source of truth for amounts, dates, payment methods, categories, remarks, and history.
- If a user asks to check whether a record exists, search the source first instead of relying on chat memory.
- Save content in the same language the user is currently chatting in unless they explicitly want translation or normalization.
- Keep merchant names and branded payment names exactly as intended, such as `ShopeePay`, `SPayLater`, `Grab PayLater`, `Atome`, and bank card names.
- Use the configured default currency when `currency` is not provided.
- `payment_method` should use consistent normalized labels.
- `category` must always be an array.
- The first category tag must be one of these fixed top-level values:
  - `food`
  - `drink`
  - `transport`
  - `clothing`
  - `beauty`
  - `electronics`
  - `household`
  - `entertainment`
  - `medical`
  - `education`
  - `travel`
  - `gift`
  - `fees`
  - `rental`
  - `loans`
  - `discount`
  - `other`
- Additional category tags should be lowercase English and use `-` instead of spaces.
- Vehicle plate numbers are the exception and may stay uppercase, such as `VKF433`.
- If the category is unclear, default to `other`.
- If the user provides fuel details, keep odometer or mileage notes in the main `remarks`.
- For receipts or invoices, extract and confirm the details with the user before storing them.
- For updates and deletes, capture the reason in a remark after the main action if the workflow requires a correction note.

## Time Handling

- Interpret user-relative time using the current system timezone before calling this source.
- The database stores timestamp fields such as `created_at`, `updated_at`, `correction_at`, and remark timestamps in UTC.
- When saving a user-mentioned local date/time into remark timestamps or merchant transaction metadata, resolve it in the system timezone first and map it to UTC if needed.
- `transaction_date` is treated as a local calendar date from the user’s perspective.
- If `transaction_date` is omitted, the source defaults it to the current date in the system timezone.
- When explaining stored UTC timestamps back to the user, map them back into the relevant local timezone if needed.

## Payment Method Expectations

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

## Tool Reference

### `record_expense`

Create a new expense record.

**Important input rules:**
- `total_amount` and `payment_method` are required.
- `currency` defaults from source config if omitted.
- `transaction_date` defaults to the current system-local date if omitted.
- `items` and `remarks` should be complete arrays when provided.
- `merchant_info` can store detailed receipt or payment metadata.

**Full sample payload:**
```json
{
  "total_amount": 158.95,
  "currency": "MYR",
  "transaction_date": "2026-01-19",
  "merchant_name": "Shopee",
  "merchant_info": {
    "seller": "Nike Official",
    "company_name": "Nike Official Store Malaysia",
    "address": "Lot 2-17, PJ Mall, Petaling Jaya, Selangor",
    "reg_no": "202001234567",
    "tel": "03-1234 5678",
    "email": "support@nike-example.com",
    "order_id": "266789012345678",
    "receipt_no": "SHP-8899123",
    "transaction_id": "TXN-55667788",
    "payment_reference": "PAYREF-22334455",
    "approval_code": "APR8899",
    "terminal_id": "TID-0088",
    "transaction_time": "2026-01-19T06:35:22.000Z"
  },
  "items": [
    {
      "name": "Nike Air Force 1 - Nike Official",
      "qty": 1,
      "unit_price": 299,
      "subtotal": 299,
      "category": ["clothing", "online-order"],
      "remarks": [
        {
          "timestamp": "2026-01-19T06:40:00.000Z",
          "text": "Bought in petaling-jaya"
        }
      ]
    }
  ],
  "remarks": [
    {
      "timestamp": "2026-02-22T17:28:00.000Z",
      "text": "For Miko ♥"
    }
  ],
  "payment_method": "SPayLater",
  "is_paylater": true
}
```

### `search_expenses`

Search active expense records.

**Important input rules:**
- `keyword` uses full-text search against the stored search vector.
- `start_date` and `end_date` filter `transaction_date`.
- `category_contains` is applied after the database query and requires matching tags inside `items[].category`.
- `is_paylater` should be passed as a boolean.
- Use `limit` and `offset` for pagination.
- Search responses include a `pagination` object with `total`, `limit`, `offset`, `returned`, and `has_more`.

**Full sample payload:**
```json
{
  "keyword": "milk tea petaling-jaya",
  "start_date": "2026-03-01",
  "end_date": "2026-03-31",
  "payment_method": "SPayLater",
  "is_paylater": true,
  "category_contains": ["drink", "milk-tea", "petaling-jaya"],
  "limit": 20,
  "offset": 0
}
```

### `update_expense`

Create a corrected replacement record for an existing expense.

**Important input rules:**
- `id` is required.
- The source preserves history by inserting a new corrected row and soft-deleting the old one.
- Include the complete updated structure for fields that should change.

**Full sample payload:**
```json
{
  "id": 123,
  "total_amount": 136.5,
  "currency": "MYR",
  "transaction_date": "2026-03-12",
  "merchant_name": "Shopee",
  "merchant_info": {
    "seller": "Nike Official",
    "order_id": "998812341234",
    "receipt_no": "SHP-7788123",
    "transaction_id": "TXN-11223344",
    "payment_reference": "PAYREF-99887766",
    "approval_code": "APR5566",
    "terminal_id": "TID-0091",
    "transaction_time": "2026-03-12T13:14:00.000Z"
  },
  "items": [
    {
      "name": "Running Shoes - Nike Official",
      "qty": 1,
      "unit_price": 149,
      "subtotal": 149,
      "category": ["clothing", "shopee", "nike"],
      "remarks": [
        {
          "timestamp": "2026-03-12T13:20:00.000Z",
          "text": "Use for jogging"
        }
      ]
    },
    {
      "name": "Voucher Discount",
      "qty": 1,
      "unit_price": -12.5,
      "subtotal": -12.5,
      "category": ["discount", "voucher"],
      "remarks": []
    }
  ],
  "remarks": [
    {
      "timestamp": "2026-03-12T13:20:00.000Z",
      "text": "Corrected total after seller refund"
    }
  ],
  "payment_method": "SPayLater",
  "is_paylater": true
}
```

### `delete_expense`

Soft-delete an expense record.

**Important input rules:**
- `id` is required.

**Full sample payload:**
```json
{
  "id": 123
}
```

### `add_expense_remark`

Append a new remark to an existing expense record.

**Important input rules:**
- `id` is required.
- `text` is required.

**Full sample payload:**
```json
{
  "id": 123,
  "text": "朋友欠我 RM45，还没还，今天先记下来"
}
```

### `get_expense_history`

Return the correction chain for an expense record.

**Important input rules:**
- `id` is required.
- The result is ordered from oldest to newest version.

**Full sample payload:**
```json
{
  "id": 123
}
```

## Common Usage Patterns

### Record a quick expense
1. Keep the merchant, amount, payment method, and key notes.
2. Build at least one item if the user described what was purchased.
3. Let the source infer `is_paylater` from the payment method when relevant.

### Correct an existing record
1. Use `update_expense` with the corrected data.
2. Then add a follow-up note with `add_expense_remark` if you need to store the correction reason.

### Delete a mistaken record
1. Use `delete_expense`.
2. If the workflow needs an audit note, capture the reason before or alongside the deletion flow in user-facing handling.

### Search by tags and payment style
1. Use `search_expenses`.
2. Combine `keyword`, date filters, `payment_method`, `is_paylater`, and `category_contains` when known.

## Response Shape

All tools return a JSON object containing:
- `success`
- `data`
- `error`
- `current_date_time`

Search responses also include:
- `pagination`

For successful reads and writes, the primary payload is inside `data.result`.
