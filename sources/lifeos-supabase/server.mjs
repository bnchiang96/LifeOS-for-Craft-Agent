#!/usr/bin/env node

// ─── LifeOS Supabase — Unified MCP Server ───────────────────────────────────
// Merges financial-assistant (expenses) + personal-assistant (personal entries)
// into a single MCP source backed by one Supabase project.
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
const DEFAULT_CURRENCY = process.env.DEFAULT_CURRENCY || "MYR";

if (!SUPABASE_URL) {
  process.stderr.write("ERROR: SUPABASE_URL environment variable is not set\n");
  process.exit(1);
}
if (!SUPABASE_KEY) {
  process.stderr.write("ERROR: SUPABASE_KEY or SUPABASE_ANON_KEY environment variable is not set\n");
  process.exit(1);
}

const REST_BASE = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1`;
const RPC_BASE = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc`;
const SQL_BASE = `${SUPABASE_URL.replace(/\/$/, "")}/sql`;

// ─── Shared Helpers ──────────────────────────────────────────────────────────

function nowIso() {
  return new Date().toISOString();
}

function formatLocalDate(date = new Date()) {
  return date.toLocaleDateString("en-CA");
}

function sanitizeLimit(value, fallback = 20) {
  const num = Number(value ?? fallback);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.min(100, Math.floor(num));
}

function sanitizeOffset(value) {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.floor(num);
}

function buildPagination(total, limit, offset) {
  return {
    total, limit, offset,
    returned: Math.max(0, Math.min(limit, total - offset)),
    has_more: offset + limit < total,
  };
}

function buildResponse(success, data = null, error = null) {
  return { success, data, error, current_date_time: nowIso() };
}

// ─── Supabase HTTP Client ────────────────────────────────────────────────────

async function request(method, path, { query, body, object = false, prefer, base } = {}) {
  const requestBase = base || REST_BASE;
  const url = new URL(`${requestBase}${path}`);
  if (query) {
    for (const [key, values] of Object.entries(query)) {
      if (values == null) continue;
      if (Array.isArray(values)) {
        for (const value of values) url.searchParams.append(key, value);
      } else {
        url.searchParams.set(key, values);
      }
    }
  }

  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Accept: object ? "application/vnd.pgrst.object+json" : "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;

  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }

  if (!res.ok) {
    const message =
      typeof data === "object" && data && data.message ? data.message
      : typeof data === "string" && data ? data
      : `Supabase request failed (${res.status})`;
    const error = new Error(message);
    error.status = res.status;
    error.details = data;
    throw error;
  }

  return data;
}

async function dbRequest(method, path, options) {
  return request(method, path, options);
}

async function rpcRequest(name, body) {
  return request("POST", `/${name}`, { base: RPC_BASE, body, prefer: "return=minimal" });
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPENSE TOOLS (Financial Assistant)
// ═══════════════════════════════════════════════════════════════════════════════

const EXPENSE_RESPONSE_COLUMNS =
  "id,total_amount,currency,transaction_date,merchant_name,merchant_info,items,remarks,payment_method,is_paylater,deleted_at,correction_of,correction_at,created_at,updated_at";

function itemHasCategoryTag(item, tag) {
  return Boolean(item && Array.isArray(item.category) && item.category.includes(tag));
}

function normalizeExpensePayload(payload = {}, { isUpdate = false } = {}) {
  const next = { ...payload };
  if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, "currency"))
    next.currency = String(payload.currency || DEFAULT_CURRENCY).trim() || DEFAULT_CURRENCY;
  if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, "transaction_date"))
    next.transaction_date = String(payload.transaction_date || formatLocalDate()).trim() || formatLocalDate();
  if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, "merchant_info"))
    next.merchant_info = payload.merchant_info && typeof payload.merchant_info === "object" && !Array.isArray(payload.merchant_info) ? payload.merchant_info : {};
  if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, "items"))
    next.items = Array.isArray(payload.items) ? payload.items : [];
  if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, "remarks"))
    next.remarks = Array.isArray(payload.remarks) ? payload.remarks : [];

  const paymentMethodProvided = Object.prototype.hasOwnProperty.call(payload, "payment_method") || !isUpdate;
  if (paymentMethodProvided) next.payment_method = String(payload.payment_method || "").trim();

  if (Object.prototype.hasOwnProperty.call(payload, "is_paylater") || paymentMethodProvided) {
    const method = String(next.payment_method || payload.payment_method || "").toLowerCase();
    next.is_paylater = Boolean(payload.is_paylater) ||
      method.includes("paylater") || method.includes("later") ||
      method.includes("atome") || method.includes("spaylater") || method.includes("grab paylater");
  }
  return next;
}

async function recordExpense(args) {
  const payload = normalizeExpensePayload(args);
  if (!(Number(payload.total_amount) >= 0) || !payload.payment_method)
    return buildResponse(false, null, "Missing required fields: total_amount and payment_method");

  const data = await dbRequest("POST", "/expenses", {
    body: {
      total_amount: payload.total_amount, currency: payload.currency,
      transaction_date: payload.transaction_date, merchant_name: payload.merchant_name,
      merchant_info: payload.merchant_info, items: payload.items, remarks: payload.remarks,
      payment_method: payload.payment_method, is_paylater: payload.is_paylater,
    },
    query: { select: EXPENSE_RESPONSE_COLUMNS },
    prefer: "return=representation", object: true,
  });
  return buildResponse(true, { id: data.id, result: data });
}

async function searchExpenses(args) {
  const keyword = String(args.keyword || "").trim();
  const startDate = String(args.start_date || "").trim();
  const endDate = String(args.end_date || "").trim();
  const paymentMethod = String(args.payment_method || "").trim();
  const limit = sanitizeLimit(args.limit, 20);
  const offset = sanitizeOffset(args.offset);

  const query = { select: EXPENSE_RESPONSE_COLUMNS, order: "transaction_date.desc" };
  if (keyword) query.search_vector = `fts(english).${keyword}`;
  if (startDate) query.transaction_date = `gte.${startDate}`;
  if (endDate) query.transaction_date = query.transaction_date ? [query.transaction_date, `lte.${endDate}`] : `lte.${endDate}`;
  if (paymentMethod) query.payment_method = `eq.${paymentMethod}`;
  if (typeof args.is_paylater === "boolean") query.is_paylater = `eq.${args.is_paylater}`;

  const data = await dbRequest("GET", "/active_expenses", { query });

  let filteredResults = data || [];
  if (Array.isArray(args.category_contains) && args.category_contains.length > 0) {
    filteredResults = filteredResults.filter((row) =>
      args.category_contains.every((tag) => Array.isArray(row.items) && row.items.some((item) => itemHasCategoryTag(item, tag)))
    );
  }

  const total = filteredResults.length;
  const pagedResults = filteredResults.slice(offset, offset + limit);
  return buildResponse(true, {
    result: pagedResults, count: total,
    pagination: { ...buildPagination(total, limit, offset), returned: pagedResults.length },
  });
}

async function updateExpense(args) {
  const id = Number(args.id);
  if (!id) return buildResponse(false, null, "Missing id");

  const old = await dbRequest("GET", "/expenses", {
    object: true, query: { select: EXPENSE_RESPONSE_COLUMNS, id: `eq.${id}` },
  }).catch(() => null);
  if (!old) return buildResponse(false, null, "Record not found");

  const updates = normalizeExpensePayload(args, { isUpdate: true });
  delete updates.id;

  const newRecord = { ...old, ...updates, correction_of: id, correction_at: nowIso() };
  delete newRecord.id;
  delete newRecord.created_at;
  delete newRecord.updated_at;
  delete newRecord.deleted_at;

  const inserted = await dbRequest("POST", "/expenses", {
    body: newRecord, query: { select: "id" }, prefer: "return=representation", object: true,
  });
  await dbRequest("PATCH", "/expenses", {
    body: { deleted_at: nowIso() }, query: { id: `eq.${id}` }, prefer: "return=minimal",
  });
  return buildResponse(true, { result: { new_id: inserted.id, old_id: id } });
}

async function deleteExpense(args) {
  const id = Number(args.id);
  if (!id) return buildResponse(false, null, "Missing id");
  await rpcRequest("soft_delete_expense", { p_id: id });
  return buildResponse(true, { result: { id } });
}

async function addExpenseRemark(args) {
  const id = Number(args.id);
  const text = String(args.text || "").trim();
  if (!id || !text) return buildResponse(false, null, "Missing id or text");

  const current = await dbRequest("GET", "/expenses", {
    object: true, query: { select: "remarks", id: `eq.${id}` },
  }).catch(() => null);
  if (!current) return buildResponse(false, null, "Record not found");

  const newRemarks = [...(Array.isArray(current.remarks) ? current.remarks : []), { timestamp: nowIso(), text }];
  await dbRequest("PATCH", "/expenses", {
    body: { remarks: newRemarks }, query: { id: `eq.${id}` }, prefer: "return=minimal",
  });
  return buildResponse(true, { result: { id } });
}

async function getExpenseHistory(args) {
  const id = Number(args.id);
  if (!id) return buildResponse(false, null, "Missing id");

  const history = [];
  let currentId = id;
  while (currentId) {
    const data = await dbRequest("GET", "/expenses", {
      object: true,
      query: {
        select: "id,total_amount,currency,transaction_date,merchant_name,payment_method,remarks,items,correction_of,correction_at,created_at",
        id: `eq.${currentId}`,
      },
    }).catch(() => null);
    if (!data) break;
    history.push({
      id: data.id, total_amount: data.total_amount, payment_method: data.payment_method,
      date: data.transaction_date, merchant: data.merchant_name,
      remarks_count: Array.isArray(data.remarks) ? data.remarks.length : 0,
      correction_of: data.correction_of, corrected_at: data.correction_at, created_at: data.created_at,
    });
    currentId = data.correction_of;
  }
  return buildResponse(true, { result: history.reverse() });
}

// ═══════════════════════════════════════════════════════════════════════════════
// PERSONAL TOOLS (Personal Assistant)
// ═══════════════════════════════════════════════════════════════════════════════

const ENTRY_TYPES = ["note", "task", "reminder", "event", "idea", "journal", "grocery", "contact", "other"];
const STATUSES = ["open", "completed", "archived", "cancelled"];
const PERSONAL_ENTRY_RESPONSE_COLUMNS =
  "id,created_at,updated_at,raw_input,processed_text,entry_type,status,priority,tags,remarks,metadata,deleted_at";

function normalizeDateEntries(input) {
  if (input == null) return [];
  if (!Array.isArray(input)) throw new Error("date_entries must be an array");
  return input.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`date_entries[${index}] must be an object`);
    const rawDateAt = String(item.date_at || "").trim();
    const description = String(item.description || "").trim();
    if (!rawDateAt) throw new Error(`date_entries[${index}].date_at is required`);
    if (!description) throw new Error(`date_entries[${index}].description is required`);
    const parsed = new Date(rawDateAt);
    if (Number.isNaN(parsed.getTime())) throw new Error(`date_entries[${index}].date_at is not a valid date`);
    return { date_at: parsed.toISOString(), description };
  });
}

function normalizeRemarks(input) {
  if (input == null) return [];
  if (!Array.isArray(input)) throw new Error("remarks must be an array");
  return input.map((item, index) => {
    if (typeof item === "string") {
      const text = item.trim();
      if (!text) throw new Error(`remarks[${index}] cannot be empty`);
      return { timestamp: nowIso(), text };
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`remarks[${index}] must be a string or object`);
    const text = String(item.text || "").trim();
    const rawTimestamp = String(item.timestamp || "").trim();
    if (!text) throw new Error(`remarks[${index}].text is required`);
    let timestamp = rawTimestamp;
    if (timestamp) {
      const parsed = new Date(timestamp);
      if (Number.isNaN(parsed.getTime())) throw new Error(`remarks[${index}].timestamp is not a valid date`);
      timestamp = parsed.toISOString();
    } else {
      timestamp = nowIso();
    }
    return { timestamp, text };
  });
}

function dateBoundaryToUtc(dateOnly, boundary) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly);
  if (!match) throw new Error(`Invalid date boundary: ${dateOnly}`);
  const [_, year, month, day] = match;
  const time = boundary === "start" ? "00:00:00" : "23:59:59.999";
  const date = new Date(`${year}-${month}-${day}T${time}`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date boundary: ${dateOnly}`);
  return date.toISOString();
}

function normalizeDateBoundary(input, boundary) {
  const value = String(input || "").trim();
  if (!value) return "";
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const normalized = isDateOnly ? dateBoundaryToUtc(value, boundary) : value;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid date boundary: ${value}`);
  return parsed.toISOString();
}

function escapeLike(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

async function fetchDateMatchedEntryIds(fromDate, toDate) {
  const ids = new Set();
  if (!fromDate && !toDate) return ids;
  const query = { select: "personal_entry_id", deleted_at: "is.null" };
  const dateAtFilters = [];
  if (fromDate) dateAtFilters.push(`gte.${normalizeDateBoundary(fromDate, "start")}`);
  if (toDate) dateAtFilters.push(`lte.${normalizeDateBoundary(toDate, "end")}`);
  if (dateAtFilters.length === 1) query.date_at = dateAtFilters[0];
  else if (dateAtFilters.length > 1) query.date_at = dateAtFilters;
  const rows = await dbRequest("GET", "/personal_entry_dates", { query });
  for (const row of rows || []) ids.add(Number(row.personal_entry_id));
  return ids;
}

async function fetchCreatedMatchedEntryIds(fromDate, toDate) {
  const ids = new Set();
  if (!fromDate && !toDate) return ids;
  const query = { select: "id", deleted_at: "is.null" };
  const createdAtFilters = [];
  if (fromDate) createdAtFilters.push(`gte.${normalizeDateBoundary(fromDate, "start")}`);
  if (toDate) createdAtFilters.push(`lte.${normalizeDateBoundary(toDate, "end")}`);
  if (createdAtFilters.length === 1) query.created_at = createdAtFilters[0];
  else if (createdAtFilters.length > 1) query.created_at = createdAtFilters;
  const rows = await dbRequest("GET", "/personal_entries", { query });
  for (const row of rows || []) ids.add(Number(row.id));
  return ids;
}

async function fetchDateEntriesMap(entryIds) {
  const map = new Map();
  if (!entryIds.length) return map;
  const rows = await dbRequest("GET", "/personal_entry_dates", {
    query: {
      select: "id,personal_entry_id,created_at,updated_at,date_at,description",
      personal_entry_id: `in.(${entryIds.join(",")})`, deleted_at: "is.null", order: "date_at.asc",
    },
  });
  for (const row of rows || []) {
    const entryId = Number(row.personal_entry_id);
    if (!map.has(entryId)) map.set(entryId, []);
    map.get(entryId).push({ id: row.id, created_at: row.created_at, updated_at: row.updated_at, date_at: row.date_at, description: row.description });
  }
  return map;
}

function attachDateEntries(entries, dateEntriesMap) {
  return entries.map((entry) => ({ ...entry, date_entries: dateEntriesMap.get(Number(entry.id)) || [] }));
}

async function fetchFullEntry(entryId) {
  const entry = await dbRequest("GET", "/personal_entries", {
    object: true, query: { select: PERSONAL_ENTRY_RESPONSE_COLUMNS, id: `eq.${entryId}` },
  });
  const dateEntriesMap = await fetchDateEntriesMap([entryId]);
  return attachDateEntries([entry], dateEntriesMap)[0];
}

async function replaceDateEntries(entryId, dateEntries) {
  await dbRequest("DELETE", "/personal_entry_dates", { query: { personal_entry_id: `eq.${entryId}`, deleted_at: "is.null" } });
  if (!dateEntries.length) return;
  await dbRequest("POST", "/personal_entry_dates", {
    body: dateEntries.map((item) => ({ personal_entry_id: entryId, date_at: item.date_at, description: item.description })),
    prefer: "return=minimal",
  });
}

async function recordPersonal(args) {
  const { raw_input, date_entries, remarks, ...insertData } = args;
  if (!String(raw_input || "").trim()) throw new Error("record_personal requires raw_input");
  const normalizedDateEntries = normalizeDateEntries(date_entries);
  const normalizedRemarks = normalizeRemarks(remarks);
  const inserted = await dbRequest("POST", "/personal_entries", {
    body: { raw_input, remarks: normalizedRemarks, ...insertData },
    prefer: "return=representation", object: true, query: { select: "id" },
  });
  const entryId = Number(inserted.id);
  await replaceDateEntries(entryId, normalizedDateEntries);
  return { success: true, current_date_time: nowIso(), data: await fetchFullEntry(entryId) };
}

async function searchPersonal(args) {
  const keyword = String(args.keyword || args.query || "").trim();
  const entryType = args.entry_type ? String(args.entry_type).trim() : "";
  const status = args.status ? String(args.status).trim() : "";
  const limit = sanitizeLimit(args.limit, 20);
  const offset = sanitizeOffset(args.offset);
  const fromDate = String(args.from_date || "").trim();
  const toDate = String(args.to_date || "").trim();

  if (entryType && !ENTRY_TYPES.includes(entryType)) throw new Error("Invalid entry_type");
  if (status && !STATUSES.includes(status)) throw new Error("Invalid status");

  const query = { select: PERSONAL_ENTRY_RESPONSE_COLUMNS, deleted_at: "is.null", order: "created_at.desc" };
  if (entryType) query.entry_type = `eq.${entryType}`;
  if (status) query.status = `eq.${status}`;
  if (keyword) query.search_text = `ilike.%${escapeLike(keyword)}%`;

  const hasDateRange = Boolean(fromDate || toDate);
  if (hasDateRange) {
    const createdMatchedIds = await fetchCreatedMatchedEntryIds(fromDate, toDate);
    const dateMatchedIds = await fetchDateMatchedEntryIds(fromDate, toDate);
    const combinedIds = [...new Set([...createdMatchedIds, ...dateMatchedIds])];
    if (!combinedIds.length) return { success: true, current_date_time: nowIso(), data: [], pagination: buildPagination(0, limit, offset) };
    query.id = `in.(${combinedIds.join(",")})`;
  }

  const baseEntries = await dbRequest("GET", "/personal_entries", { query });
  const dateEntriesMap = await fetchDateEntriesMap((baseEntries || []).map((entry) => Number(entry.id)));
  const mergedEntries = attachDateEntries(baseEntries || [], dateEntriesMap);
  const total = mergedEntries.length;
  const pagedEntries = mergedEntries.slice(offset, offset + limit);

  return {
    success: true, current_date_time: nowIso(), data: pagedEntries,
    pagination: { ...buildPagination(total, limit, offset), returned: pagedEntries.length },
  };
}

async function updatePersonal(args) {
  const { id, date_entries, remarks, ...updates } = args;
  if (!id) throw new Error("update_personal requires id");

  const normalizedUpdateDates = Object.prototype.hasOwnProperty.call(args, "date_entries") ? normalizeDateEntries(date_entries) : null;
  if (Object.prototype.hasOwnProperty.call(args, "remarks")) updates.remarks = normalizeRemarks(remarks);

  if (Object.keys(updates).length) {
    await dbRequest("PATCH", "/personal_entries", {
      body: updates, prefer: "return=representation", object: true,
      query: { id: `eq.${id}`, deleted_at: "is.null", select: "id" },
    });
  } else {
    await dbRequest("GET", "/personal_entries", {
      object: true, query: { select: "id", id: `eq.${id}`, deleted_at: "is.null" },
    });
  }

  if (normalizedUpdateDates) await replaceDateEntries(Number(id), normalizedUpdateDates);
  return { success: true, current_date_time: nowIso(), data: await fetchFullEntry(Number(id)) };
}

async function addPersonalRemark(args) {
  const entryId = Number(args.id);
  const text = String(args.text || "").trim();
  if (!entryId || !text) throw new Error("add_personal_remark requires id and text");

  const current = await dbRequest("GET", "/personal_entries", {
    object: true, query: { select: "id,remarks", id: `eq.${entryId}`, deleted_at: "is.null" },
  });

  const nextRemarks = [...(Array.isArray(current.remarks) ? current.remarks : []), { timestamp: nowIso(), text }];
  await dbRequest("PATCH", "/personal_entries", {
    body: { remarks: nextRemarks }, prefer: "return=representation", object: true,
    query: { id: `eq.${entryId}`, deleted_at: "is.null", select: "id" },
  });
  return { success: true, current_date_time: nowIso(), data: await fetchFullEntry(entryId) };
}

async function deletePersonal(args) {
  const entryId = Number(args.id);
  if (!entryId) throw new Error("delete_personal requires id");
  const deletedAt = nowIso();
  await dbRequest("PATCH", "/personal_entries", {
    body: { deleted_at: deletedAt }, prefer: "return=representation", object: true,
    query: { id: `eq.${entryId}`, deleted_at: "is.null", select: "id" },
  });
  await dbRequest("PATCH", "/personal_entry_dates", {
    body: { deleted_at: deletedAt }, prefer: "return=minimal",
    query: { personal_entry_id: `eq.${entryId}`, deleted_at: "is.null" },
  });
  return { success: true, current_date_time: nowIso(), data: { id: entryId } };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Database Setup (Combined DDL)
// ═══════════════════════════════════════════════════════════════════════════════

const DDL = `
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- EXPENSES
CREATE TABLE IF NOT EXISTS expenses (
    id               BIGSERIAL PRIMARY KEY,
    total_amount     NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
    currency         TEXT           NOT NULL DEFAULT 'MYR',
    transaction_date DATE           NOT NULL DEFAULT CURRENT_DATE,
    merchant_name    TEXT,
    merchant_info    JSONB                   DEFAULT '{}'::JSONB,
    items            JSONB          NOT NULL DEFAULT '[]'::JSONB,
    remarks          JSONB          NOT NULL DEFAULT '[]'::JSONB,
    payment_method   TEXT           NOT NULL,
    is_paylater      BOOLEAN        NOT NULL DEFAULT FALSE,
    deleted_at       TIMESTAMPTZ,
    correction_of    BIGINT REFERENCES expenses (id),
    correction_at    TIMESTAMPTZ,
    search_vector    tsvector,
    created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION expenses_update_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', coalesce(NEW.merchant_name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(NEW.payment_method, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(NEW.merchant_info::text, '{}')), 'C') ||
        setweight(to_tsvector('english', coalesce(NEW.remarks::text, '[]')), 'C') ||
        setweight(to_tsvector('english', (
            SELECT string_agg(
                COALESCE(item->>'name', '') || ' ' || COALESCE(item->>'seller', '') || ' ' ||
                COALESCE(item->'category'::text, '[]') || ' ' || COALESCE(item->'remarks'::text, '[]'),
                ' '
            ) FROM jsonb_array_elements(COALESCE(NEW.items, '[]'::jsonb)) item
        )), 'B');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_expenses_search_vector') THEN
        CREATE TRIGGER trigger_expenses_search_vector BEFORE INSERT OR UPDATE ON expenses
            FOR EACH ROW EXECUTE FUNCTION expenses_update_search_vector();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_expenses_updated_at') THEN
        CREATE TRIGGER trigger_expenses_updated_at BEFORE UPDATE ON expenses
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

CREATE OR REPLACE FUNCTION soft_delete_expense(p_id BIGINT)
RETURNS VOID AS $$
BEGIN UPDATE expenses SET deleted_at = NOW() WHERE id = p_id AND deleted_at IS NULL; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE VIEW active_expenses AS SELECT * FROM expenses WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_search_vector ON expenses USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_expenses_merchant_name_trgm ON expenses USING GIN (merchant_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_expenses_transaction_date ON expenses (transaction_date);
CREATE INDEX IF NOT EXISTS idx_expenses_deleted_at_null ON expenses (deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_correction_of ON expenses (correction_of);
CREATE INDEX IF NOT EXISTS idx_expenses_payment_method ON expenses (payment_method);
CREATE INDEX IF NOT EXISTS idx_expenses_is_paylater ON expenses (is_paylater);
ALTER TABLE expenses DISABLE ROW LEVEL SECURITY;

-- PERSONAL ENTRIES
CREATE TABLE IF NOT EXISTS personal_entries (
    id             BIGSERIAL PRIMARY KEY,
    raw_input      TEXT           NOT NULL,
    processed_text TEXT,
    entry_type     TEXT           NOT NULL DEFAULT 'note',
    status         TEXT           NOT NULL DEFAULT 'open',
    priority       INTEGER        NOT NULL DEFAULT 0,
    tags           TEXT[]                  DEFAULT '{}',
    remarks        JSONB          NOT NULL DEFAULT '[]'::JSONB,
    metadata       JSONB                   DEFAULT '{}'::JSONB,
    search_text    TEXT,
    deleted_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_personal_entries_updated_at') THEN
        CREATE TRIGGER trigger_personal_entries_updated_at BEFORE UPDATE ON personal_entries
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_personal_entries_entry_type ON personal_entries (entry_type);
CREATE INDEX IF NOT EXISTS idx_personal_entries_status ON personal_entries (status);
CREATE INDEX IF NOT EXISTS idx_personal_entries_priority ON personal_entries (priority);
CREATE INDEX IF NOT EXISTS idx_personal_entries_deleted_at_null ON personal_entries (deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_personal_entries_created_at ON personal_entries (created_at);

CREATE TABLE IF NOT EXISTS personal_entry_dates (
    id                 BIGSERIAL PRIMARY KEY,
    personal_entry_id  BIGINT         NOT NULL REFERENCES personal_entries (id),
    date_at            TIMESTAMPTZ    NOT NULL,
    description        TEXT           NOT NULL,
    deleted_at         TIMESTAMPTZ,
    created_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_personal_entry_dates_updated_at') THEN
        CREATE TRIGGER trigger_personal_entry_dates_updated_at BEFORE UPDATE ON personal_entry_dates
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_personal_entry_dates_entry_id ON personal_entry_dates (personal_entry_id);
CREATE INDEX IF NOT EXISTS idx_personal_entry_dates_date_at ON personal_entry_dates (date_at);
CREATE INDEX IF NOT EXISTS idx_personal_entry_dates_deleted_at_null ON personal_entry_dates (deleted_at) WHERE deleted_at IS NULL;
ALTER TABLE personal_entries DISABLE ROW LEVEL SECURITY;
ALTER TABLE personal_entry_dates DISABLE ROW LEVEL SECURITY;
`;

async function ensureTables() {
  const res = await fetch(SQL_BASE, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: DDL }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create tables: ${res.status} ${text}`);
  }
  return buildResponse(true, { message: "Tables ensured successfully" });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MCP Tool Definitions
// ═══════════════════════════════════════════════════════════════════════════════

const toolDefinitions = [
  // ── Expense Tools ──
  {
    name: "record_expense",
    description: "Create a new expense record with merchant, item, payment, and remark details",
    inputSchema: {
      type: "object",
      properties: {
        total_amount: { type: "number" }, currency: { type: "string" }, transaction_date: { type: "string" },
        merchant_name: { type: "string" }, merchant_info: { type: "object", additionalProperties: true },
        items: { type: "array", items: { type: "object", additionalProperties: true } },
        remarks: { type: "array", items: { type: "object", additionalProperties: true } },
        payment_method: { type: "string" }, is_paylater: { type: "boolean" },
      },
      required: ["total_amount", "payment_method"], additionalProperties: true,
    },
  },
  {
    name: "search_expenses",
    description: "Search active expense records by keyword, date range, payment method, paylater flag, and category tags",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string" }, start_date: { type: "string" }, end_date: { type: "string" },
        payment_method: { type: "string" }, is_paylater: { type: "boolean" },
        category_contains: { type: "array", items: { type: "string" } },
        limit: { type: "integer", default: 20 }, offset: { type: "integer", default: 0 },
      },
      additionalProperties: true,
    },
  },
  {
    name: "update_expense",
    description: "Create a corrected replacement record for an existing expense and soft-delete the old version",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer" }, total_amount: { type: "number" }, currency: { type: "string" },
        transaction_date: { type: "string" }, merchant_name: { type: "string" },
        merchant_info: { type: "object", additionalProperties: true },
        items: { type: "array", items: { type: "object", additionalProperties: true } },
        remarks: { type: "array", items: { type: "object", additionalProperties: true } },
        payment_method: { type: "string" }, is_paylater: { type: "boolean" },
      },
      required: ["id"], additionalProperties: true,
    },
  },
  {
    name: "delete_expense",
    description: "Soft-delete an expense record",
    inputSchema: {
      type: "object",
      properties: { id: { type: "integer" } },
      required: ["id"], additionalProperties: true,
    },
  },
  {
    name: "add_expense_remark",
    description: "Append a follow-up remark to an existing expense record",
    inputSchema: {
      type: "object",
      properties: { id: { type: "integer" }, text: { type: "string" } },
      required: ["id", "text"], additionalProperties: true,
    },
  },
  {
    name: "get_expense_history",
    description: "Return the correction chain for an expense record from oldest to newest",
    inputSchema: {
      type: "object",
      properties: { id: { type: "integer" } },
      required: ["id"], additionalProperties: true,
    },
  },

  // ── Personal Tools ──
  {
    name: "record_personal",
    description: "Create a new personal entry and optionally attach structured dates and remarks",
    inputSchema: {
      type: "object",
      properties: {
        raw_input: { type: "string", description: "Original user wording to store verbatim" },
        processed_text: { type: "string", description: "Cleaned or structured summary" },
        entry_type: { type: "string", enum: ENTRY_TYPES },
        status: { type: "string", enum: STATUSES },
        priority: { type: "integer", enum: [0, 1, 2] },
        tags: { type: "array", items: { type: "string" } },
        metadata: { type: "object", additionalProperties: true },
        remarks: {
          type: "array",
          items: {
            oneOf: [
              { type: "string" },
              { type: "object", properties: { timestamp: { type: "string" }, text: { type: "string" } }, required: ["text"], additionalProperties: true },
            ],
          },
        },
        date_entries: {
          type: "array",
          items: {
            type: "object",
            properties: { date_at: { type: "string" }, description: { type: "string" } },
            required: ["date_at", "description"], additionalProperties: true,
          },
        },
      },
      required: ["raw_input"], additionalProperties: true,
    },
  },
  {
    name: "search_personal",
    description: "Search personal entries by keyword, type, status, and date range across both created_at and date_entries",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string" }, query: { type: "string", description: "Legacy alias for keyword" },
        entry_type: { type: "string", enum: ENTRY_TYPES },
        status: { type: "string", enum: STATUSES },
        from_date: { type: "string" }, to_date: { type: "string" },
        limit: { type: "integer", default: 20 }, offset: { type: "integer", default: 0 },
      },
      additionalProperties: true,
    },
  },
  {
    name: "update_personal",
    description: "Update a personal entry and optionally replace its full date_entries array",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer" }, raw_input: { type: "string" }, processed_text: { type: "string" },
        entry_type: { type: "string", enum: ENTRY_TYPES },
        status: { type: "string", enum: STATUSES },
        priority: { type: "integer", enum: [0, 1, 2] },
        tags: { type: "array", items: { type: "string" } },
        metadata: { type: "object", additionalProperties: true },
        remarks: {
          type: "array",
          items: {
            oneOf: [
              { type: "string" },
              { type: "object", properties: { timestamp: { type: "string" }, text: { type: "string" } }, required: ["text"], additionalProperties: true },
            ],
          },
        },
        date_entries: {
          type: "array",
          items: {
            type: "object",
            properties: { date_at: { type: "string" }, description: { type: "string" } },
            required: ["date_at", "description"], additionalProperties: true,
          },
        },
      },
      required: ["id"], additionalProperties: true,
    },
  },
  {
    name: "delete_personal",
    description: "Soft delete a personal entry and mark its child date rows deleted",
    inputSchema: {
      type: "object",
      properties: { id: { type: "integer" } },
      required: ["id"], additionalProperties: true,
    },
  },
  {
    name: "add_personal_remark",
    description: "Append a follow-up remark to an existing personal entry",
    inputSchema: {
      type: "object",
      properties: { id: { type: "integer" }, text: { type: "string" } },
      required: ["id", "text"], additionalProperties: true,
    },
  },

  // ── System Tools ──
  {
    name: "ensure_tables",
    description: "Create database tables if they don't exist. Run this once during setup.",
    inputSchema: { type: "object", properties: {}, additionalProperties: true },
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Tool Handlers Map
// ═══════════════════════════════════════════════════════════════════════════════

const toolHandlers = {
  record_expense: recordExpense,
  search_expenses: searchExpenses,
  update_expense: updateExpense,
  delete_expense: deleteExpense,
  add_expense_remark: addExpenseRemark,
  get_expense_history: getExpenseHistory,
  record_personal: recordPersonal,
  search_personal: searchPersonal,
  update_personal: updatePersonal,
  delete_personal: deletePersonal,
  add_personal_remark: addPersonalRemark,
  ensure_tables: ensureTables,
};

// ═══════════════════════════════════════════════════════════════════════════════
// MCP Protocol Handler
// ═══════════════════════════════════════════════════════════════════════════════

process.stdin.setEncoding("utf8");
let buffer = "";

process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newlineIdx;
  while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newlineIdx).trim();
    buffer = buffer.slice(newlineIdx + 1);
    if (!line) continue;
    try { handleMessage(JSON.parse(line)); } catch (error) {
      process.stderr.write(`Parse error: ${error.message}\n`);
    }
  }
});

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

async function handleMessage(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case "initialize":
      send({
        jsonrpc: "2.0", id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "lifeos-supabase", version: "1.0.0" },
        },
      });
      break;
    case "tools/list":
      send({ jsonrpc: "2.0", id, result: { tools: toolDefinitions } });
      break;
    case "tools/call": {
      const name = params?.name;
      const args = params?.arguments || {};
      const handler = toolHandlers[name];
      if (!handler) {
        send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${name}` } });
        break;
      }
      try {
        const result = await handler(args);
        send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] } });
      } catch (error) {
        send({
          jsonrpc: "2.0", id,
          result: {
            content: [{ type: "text", text: JSON.stringify(buildResponse(false, null, error.message), null, 2) }],
            isError: true,
          },
        });
      }
      break;
    }
    case "notifications/initialized":
      break;
    default:
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method: ${method}` } });
  }
}