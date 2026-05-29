#!/usr/bin/env node

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL) {
  process.stderr.write("ERROR: SUPABASE_URL environment variable is not set\n");
  process.exit(1);
}

if (!SUPABASE_KEY) {
  process.stderr.write("ERROR: SUPABASE_KEY or SUPABASE_ANON_KEY environment variable is not set\n");
  process.exit(1);
}

const REST_BASE = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1`;
const SQL_BASE = `${SUPABASE_URL.replace(/\/$/, "")}/sql`;

const ENTRY_TYPES = ["note", "task", "reminder", "event", "idea", "journal", "grocery", "contact", "other"];
const STATUSES = ["open", "completed", "archived", "cancelled"];
const PERSONAL_ENTRY_RESPONSE_COLUMNS = "id,created_at,updated_at,raw_input,processed_text,entry_type,status,priority,tags,remarks,metadata,deleted_at";

function nowIso() {
  return new Date().toISOString();
}

function normalizeDateEntries(input) {
  if (input == null) return [];
  if (!Array.isArray(input)) throw new Error("date_entries 必须是数组");

  return input.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`date_entries[${index}] 必须是对象`);
    }

    const rawDateAt = String(item.date_at || "").trim();
    const description = String(item.description || "").trim();

    if (!rawDateAt) throw new Error(`date_entries[${index}].date_at 不能为空`);
    if (!description) throw new Error(`date_entries[${index}].description 不能为空`);

    const parsed = new Date(rawDateAt);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`date_entries[${index}].date_at 不是有效日期`);
    }

    return { date_at: parsed.toISOString(), description };
  });
}

function normalizeRemarks(input) {
  if (input == null) return [];
  if (!Array.isArray(input)) throw new Error("remarks 必须是数组");

  return input.map((item, index) => {
    if (typeof item === "string") {
      const text = item.trim();
      if (!text) throw new Error(`remarks[${index}] 不能为空`);
      return { timestamp: nowIso(), text };
    }

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`remarks[${index}] 必须是字符串或对象`);
    }

    const text = String(item.text || "").trim();
    const rawTimestamp = String(item.timestamp || "").trim();
    if (!text) throw new Error(`remarks[${index}].text 不能为空`);

    let timestamp = rawTimestamp;
    if (timestamp) {
      const parsed = new Date(timestamp);
      if (Number.isNaN(parsed.getTime())) throw new Error(`remarks[${index}].timestamp 不是有效日期`);
      timestamp = parsed.toISOString();
    } else {
      timestamp = nowIso();
    }

    return { timestamp, text };
  });
}

// Convert a local date-only boundary (YYYY-MM-DD) to UTC ISO string.
// Server runs locally on the user's machine, so new Date() uses the local timezone.
function dateBoundaryToUtc(dateOnly, boundary) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly);
  if (!match) throw new Error(`无效的日期范围参数：${dateOnly}`);

  const [_, year, month, day] = match;
  const time = boundary === "start" ? "00:00:00" : "23:59:59.999";
  const date = new Date(`${year}-${month}-${day}T${time}`);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`无效的日期范围参数：${dateOnly}`);
  }

  return date.toISOString();
}

function normalizeDateBoundary(input, boundary) {
  const value = String(input || "").trim();
  if (!value) return "";

  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const normalized = isDateOnly
    ? dateBoundaryToUtc(value, boundary)
    : value;

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`无效的日期范围参数：${value}`);
  }

  return parsed.toISOString();
}

function escapeLike(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
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
    total,
    limit,
    offset,
    returned: Math.max(0, Math.min(limit, total - offset)),
    has_more: offset + limit < total,
  };
}

async function request(method, path, { query, body, object = false, prefer } = {}) {
  const url = new URL(`${REST_BASE}${path}`);
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

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const message = typeof data === "object" && data && data.message
      ? data.message
      : typeof data === "string" && data
        ? data
        : `Supabase request failed (${res.status})`;
    const error = new Error(message);
    error.status = res.status;
    error.details = data;
    throw error;
  }

  return data;
}

async function fetchDateMatchedEntryIds(fromDate, toDate) {
  const ids = new Set();
  if (!fromDate && !toDate) return ids;

  const query = { select: "personal_entry_id", deleted_at: "is.null" };
  const dateAtFilters = [];
  if (fromDate) dateAtFilters.push(`gte.${normalizeDateBoundary(fromDate, "start")}`);
  if (toDate) dateAtFilters.push(`lte.${normalizeDateBoundary(toDate, "end")}`);
  if (dateAtFilters.length === 1) {
    query.date_at = dateAtFilters[0];
  } else if (dateAtFilters.length > 1) {
    query.date_at = dateAtFilters;
  }

  const rows = await request("GET", "/personal_entry_dates", { query });
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
  if (createdAtFilters.length === 1) {
    query.created_at = createdAtFilters[0];
  } else if (createdAtFilters.length > 1) {
    query.created_at = createdAtFilters;
  }

  const rows = await request("GET", "/personal_entries", { query });
  for (const row of rows || []) ids.add(Number(row.id));
  return ids;
}

async function fetchDateEntriesMap(entryIds) {
  const map = new Map();
  if (!entryIds.length) return map;

  const rows = await request("GET", "/personal_entry_dates", {
    query: {
      select: "id,personal_entry_id,created_at,updated_at,date_at,description",
      personal_entry_id: `in.(${entryIds.join(",")})`,
      deleted_at: "is.null",
      order: "date_at.asc",
    },
  });

  for (const row of rows || []) {
    const entryId = Number(row.personal_entry_id);
    if (!map.has(entryId)) map.set(entryId, []);
    map.get(entryId).push({
      id: row.id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      date_at: row.date_at,
      description: row.description,
    });
  }

  return map;
}

function attachDateEntries(entries, dateEntriesMap) {
  return entries.map((entry) => ({
    ...entry,
    date_entries: dateEntriesMap.get(Number(entry.id)) || [],
  }));
}

async function fetchFullEntry(entryId) {
  const entry = await request("GET", "/personal_entries", {
    object: true,
    query: {
      select: PERSONAL_ENTRY_RESPONSE_COLUMNS,
      id: `eq.${entryId}`,
    },
  });

  const dateEntriesMap = await fetchDateEntriesMap([entryId]);
  return attachDateEntries([entry], dateEntriesMap)[0];
}

async function replaceDateEntries(entryId, dateEntries) {
  await request("DELETE", "/personal_entry_dates", {
    query: {
      personal_entry_id: `eq.${entryId}`,
      deleted_at: "is.null",
    },
  });

  if (!dateEntries.length) return;

  const rows = dateEntries.map((item) => ({
    personal_entry_id: entryId,
    date_at: item.date_at,
    description: item.description,
  }));

  await request("POST", "/personal_entry_dates", {
    body: rows,
    prefer: "return=minimal",
  });
}

async function recordEntry(args) {
  const { raw_input, date_entries, remarks, ...insertData } = args;
  if (!String(raw_input || "").trim()) throw new Error("record_entry 需要 raw_input");

  const normalizedDateEntries = normalizeDateEntries(date_entries);
  const normalizedRemarks = normalizeRemarks(remarks);

  const inserted = await request("POST", "/personal_entries", {
    body: {
      raw_input,
      remarks: normalizedRemarks,
      ...insertData,
    },
    prefer: "return=representation",
    object: true,
    query: { select: "id" },
  });

  const entryId = Number(inserted.id);
  await replaceDateEntries(entryId, normalizedDateEntries);

  return {
    success: true,
    current_date_time: nowIso(),
    data: await fetchFullEntry(entryId),
  };
}

async function searchEntries(args) {
  const keyword = String(args.keyword || args.query || "").trim();
  const entryType = args.entry_type ? String(args.entry_type).trim() : "";
  const status = args.status ? String(args.status).trim() : "";
  const limit = sanitizeLimit(args.limit, 20);
  const offset = sanitizeOffset(args.offset);
  const fromDate = String(args.from_date || "").trim();
  const toDate = String(args.to_date || "").trim();

  if (entryType && !ENTRY_TYPES.includes(entryType)) throw new Error("entry_type 不合法");
  if (status && !STATUSES.includes(status)) throw new Error("status 不合法");

  const query = {
    select: PERSONAL_ENTRY_RESPONSE_COLUMNS,
    deleted_at: "is.null",
    order: "created_at.desc",
  };

  if (entryType) query.entry_type = `eq.${entryType}`;
  if (status) query.status = `eq.${status}`;
  if (keyword) query.search_text = `ilike.%${escapeLike(keyword)}%`;

  const hasDateRange = Boolean(fromDate || toDate);
  if (hasDateRange) {
    const createdMatchedIds = await fetchCreatedMatchedEntryIds(fromDate, toDate);
    const dateMatchedIds = await fetchDateMatchedEntryIds(fromDate, toDate);
    const combinedIds = [...new Set([...createdMatchedIds, ...dateMatchedIds])];

    if (!combinedIds.length) {
      return {
        success: true,
        current_date_time: nowIso(),
        data: [],
        pagination: buildPagination(0, limit, offset),
      };
    }

    query.id = `in.(${combinedIds.join(",")})`;
  }

  const baseEntries = await request("GET", "/personal_entries", { query });
  const dateEntriesMap = await fetchDateEntriesMap((baseEntries || []).map((entry) => Number(entry.id)));
  const mergedEntries = attachDateEntries(baseEntries || [], dateEntriesMap);
  const total = mergedEntries.length;
  const pagedEntries = mergedEntries.slice(offset, offset + limit);

  return {
    success: true,
    current_date_time: nowIso(),
    data: pagedEntries,
    pagination: {
      ...buildPagination(total, limit, offset),
      returned: pagedEntries.length,
    },
  };
}

async function updateEntry(args) {
  const { id, date_entries, remarks, ...updates } = args;
  if (!id) throw new Error("update_entry 需要 id");

  const normalizedUpdateDates = Object.prototype.hasOwnProperty.call(args, "date_entries")
    ? normalizeDateEntries(date_entries)
    : null;

  if (Object.prototype.hasOwnProperty.call(args, "remarks")) {
    updates.remarks = normalizeRemarks(remarks);
  }

  if (Object.keys(updates).length) {
    await request("PATCH", "/personal_entries", {
      body: updates,
      prefer: "return=representation",
      object: true,
      query: {
        id: `eq.${id}`,
        deleted_at: "is.null",
        select: "id",
      },
    });
  } else {
    await request("GET", "/personal_entries", {
      object: true,
      query: {
        select: "id",
        id: `eq.${id}`,
        deleted_at: "is.null",
      },
    });
  }

  if (normalizedUpdateDates) {
    await replaceDateEntries(Number(id), normalizedUpdateDates);
  }

  return {
    success: true,
    current_date_time: nowIso(),
    data: await fetchFullEntry(Number(id)),
  };
}

async function addEntryRemark(args) {
  const entryId = Number(args.id);
  const text = String(args.text || "").trim();
  if (!entryId || !text) throw new Error("add_entry_remark 需要 id 和 text");

  const current = await request("GET", "/personal_entries", {
    object: true,
    query: {
      select: "id,remarks",
      id: `eq.${entryId}`,
      deleted_at: "is.null",
    },
  });

  const nextRemarks = [
    ...(Array.isArray(current.remarks) ? current.remarks : []),
    { timestamp: nowIso(), text },
  ];

  await request("PATCH", "/personal_entries", {
    body: { remarks: nextRemarks },
    prefer: "return=representation",
    object: true,
    query: {
      id: `eq.${entryId}`,
      deleted_at: "is.null",
      select: "id",
    },
  });

  return {
    success: true,
    current_date_time: nowIso(),
    data: await fetchFullEntry(entryId),
  };
}

async function deleteEntry(args) {
  const entryId = Number(args.id);
  if (!entryId) throw new Error("delete_entry 需要 id");

  const deletedAt = nowIso();

  await request("PATCH", "/personal_entries", {
    body: { deleted_at: deletedAt },
    prefer: "return=representation",
    object: true,
    query: {
      id: `eq.${entryId}`,
      deleted_at: "is.null",
      select: "id",
    },
  });

  await request("PATCH", "/personal_entry_dates", {
    body: { deleted_at: deletedAt },
    prefer: "return=minimal",
    query: {
      personal_entry_id: `eq.${entryId}`,
      deleted_at: "is.null",
    },
  });

  return {
    success: true,
    current_date_time: nowIso(),
    data: { id: entryId },
  };
}

const DDL = `
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_personal_entries_updated_at') THEN
        CREATE TRIGGER trigger_personal_entries_updated_at
            BEFORE UPDATE ON personal_entries
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
        CREATE TRIGGER trigger_personal_entry_dates_updated_at
            BEFORE UPDATE ON personal_entry_dates
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
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: DDL }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create tables: ${res.status} ${text}`);
  }

  return buildResponse(true, { message: "Tables ensured successfully" });
}

const toolDefinitions = [
  {
    name: "record_entry",
    description: "Create a new personal entry and optionally attach structured dates and remarks",
    inputSchema: {
      type: "object",
      properties: {
        raw_input: { type: "string", description: "Original user wording to store verbatim" },
        processed_text: { type: "string", description: "Cleaned or structured summary" },
        entry_type: { type: "string", enum: ENTRY_TYPES, description: "Entry category" },
        status: { type: "string", enum: STATUSES, description: "Entry status" },
        priority: { type: "integer", enum: [0, 1, 2], description: "Priority where 0=low, 1=medium, 2=high" },
        tags: { type: "array", items: { type: "string" }, description: "Keyword tags" },
        metadata: { type: "object", additionalProperties: true, description: "Extra structured metadata" },
        remarks: {
          type: "array",
          description: "Optional remarks as strings or objects with timestamp/text",
          items: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                properties: {
                  timestamp: { type: "string" },
                  text: { type: "string" },
                },
                required: ["text"],
                additionalProperties: true,
              },
            ],
          },
        },
        date_entries: {
          type: "array",
          description: "Optional date records attached to the entry",
          items: {
            type: "object",
            properties: {
              date_at: { type: "string", description: "ISO datetime string" },
              description: { type: "string", description: "What the date refers to" },
            },
            required: ["date_at", "description"],
            additionalProperties: true,
          },
        },
      },
      required: ["raw_input"],
      additionalProperties: true,
    },
  },
  {
    name: "search_entries",
    description: "Search personal entries by keyword, type, status, and date range across both created_at and date_entries",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "Keyword search across stored search text" },
        query: { type: "string", description: "Legacy alias for keyword" },
        entry_type: { type: "string", enum: ENTRY_TYPES, description: "Filter by entry type" },
        status: { type: "string", enum: STATUSES, description: "Filter by status" },
        from_date: { type: "string", description: "Start boundary, usually YYYY-MM-DD or ISO datetime" },
        to_date: { type: "string", description: "End boundary, usually YYYY-MM-DD or ISO datetime" },
        limit: { type: "integer", description: "Max results to return after in-memory paging", default: 20 },
        offset: { type: "integer", description: "Pagination offset applied after merge", default: 0 },
      },
      additionalProperties: true,
    },
  },
  {
    name: "update_entry",
    description: "Update a personal entry and optionally replace its full date_entries array",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer", description: "Entry ID" },
        raw_input: { type: "string" },
        processed_text: { type: "string" },
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
              {
                type: "object",
                properties: {
                  timestamp: { type: "string" },
                  text: { type: "string" },
                },
                required: ["text"],
                additionalProperties: true,
              },
            ],
          },
        },
        date_entries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              date_at: { type: "string" },
              description: { type: "string" },
            },
            required: ["date_at", "description"],
            additionalProperties: true,
          },
        },
      },
      required: ["id"],
      additionalProperties: true,
    },
  },
  {
    name: "delete_entry",
    description: "Soft delete a personal entry and mark its child date rows deleted",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer", description: "Entry ID" },
      },
      required: ["id"],
      additionalProperties: true,
    },
  },
  {
    name: "add_entry_remark",
    description: "Append a follow-up remark to an existing personal entry",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer", description: "Entry ID" },
        text: { type: "string", description: "Remark text to append" },
      },
      required: ["id", "text"],
      additionalProperties: true,
    },
  },
  {
    name: "ensure_tables",
    description: "Create database tables if they don't exist. Run this once during setup.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: true,
    },
  },
];

const toolHandlers = {
  record_entry: recordEntry,
  search_entries: searchEntries,
  update_entry: updateEntry,
  delete_entry: deleteEntry,
  ensure_tables: ensureTables,
  add_entry_remark: addEntryRemark,
};

process.stdin.setEncoding("utf8");
let buffer = "";

process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newlineIdx;
  while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newlineIdx).trim();
    buffer = buffer.slice(newlineIdx + 1);
    if (!line) continue;
    try {
      handleMessage(JSON.parse(line));
    } catch (error) {
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
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "personal-assistant", version: "2.0.0" },
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
        send({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Unknown tool: ${name}` },
        });
        break;
      }

      try {
        const result = await handler(args);
        send({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          },
        });
      } catch (error) {
        send({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
          },
        });
      }
      break;
    }

    case "notifications/initialized":
      break;

    default:
      send({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unknown method: ${method}` },
      });
  }
}
