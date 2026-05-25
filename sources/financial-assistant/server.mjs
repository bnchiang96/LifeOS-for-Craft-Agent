#!/usr/bin/env node

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
const DEFAULT_CURRENCY = process.env.DEFAULT_CURRENCY || "MYR";
const SYSTEM_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

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
const EXPENSE_RESPONSE_COLUMNS = "id,total_amount,currency,transaction_date,merchant_name,merchant_info,items,remarks,payment_method,is_paylater,deleted_at,correction_of,correction_at,created_at,updated_at";

function nowIso() {
  return new Date().toISOString();
}

function formatDateInTimeZone(date = new Date(), timeZone = SYSTEM_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function itemHasCategoryTag(item, tag) {
  return Boolean(item && Array.isArray(item.category) && item.category.includes(tag));
}

function buildResponse(success, data = null, error = null) {
  return {
    success,
    data,
    error,
    current_date_time: nowIso(),
  };
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

async function request(base, method, path, { query, body, object = false, prefer } = {}) {
  const url = new URL(`${base}${path}`);
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

async function dbRequest(method, path, options) {
  return request(REST_BASE, method, path, options);
}

async function rpcRequest(name, body) {
  return request(RPC_BASE, "POST", `/${name}`, {
    body,
    prefer: "return=minimal",
  });
}

function normalizeExpensePayload(payload = {}, { isUpdate = false } = {}) {
  const next = { ...payload };

  if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, "currency")) {
    next.currency = String(payload.currency || DEFAULT_CURRENCY).trim() || DEFAULT_CURRENCY;
  }

  if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, "transaction_date")) {
    next.transaction_date = String(payload.transaction_date || formatDateInTimeZone()).trim() || formatDateInTimeZone();
  }

  if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, "merchant_info")) {
    next.merchant_info = payload.merchant_info && typeof payload.merchant_info === "object" && !Array.isArray(payload.merchant_info)
      ? payload.merchant_info
      : {};
  }

  if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, "items")) {
    next.items = Array.isArray(payload.items) ? payload.items : [];
  }

  if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, "remarks")) {
    next.remarks = Array.isArray(payload.remarks) ? payload.remarks : [];
  }

  const paymentMethodProvided = Object.prototype.hasOwnProperty.call(payload, "payment_method") || !isUpdate;
  if (paymentMethodProvided) {
    next.payment_method = String(payload.payment_method || "").trim();
  }

  if (Object.prototype.hasOwnProperty.call(payload, "is_paylater") || paymentMethodProvided) {
    const method = String(next.payment_method || payload.payment_method || "").toLowerCase();
    next.is_paylater = Boolean(payload.is_paylater) ||
      method.includes("paylater") ||
      method.includes("later") ||
      method.includes("atome") ||
      method.includes("spaylater") ||
      method.includes("grab paylater");
  }

  return next;
}

async function recordExpense(args) {
  const payload = normalizeExpensePayload(args);

  if (!(Number(payload.total_amount) >= 0) || !payload.payment_method) {
    return buildResponse(false, null, "Missing required fields: total_amount and payment_method");
  }

  const data = await dbRequest("POST", "/expenses", {
    body: {
      total_amount: payload.total_amount,
      currency: payload.currency,
      transaction_date: payload.transaction_date,
      merchant_name: payload.merchant_name,
      merchant_info: payload.merchant_info,
      items: payload.items,
      remarks: payload.remarks,
      payment_method: payload.payment_method,
      is_paylater: payload.is_paylater,
    },
    query: { select: EXPENSE_RESPONSE_COLUMNS },
    prefer: "return=representation",
    object: true,
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

  const query = {
    select: EXPENSE_RESPONSE_COLUMNS,
    order: "transaction_date.desc",
  };

  if (keyword) query.search_vector = `fts(english).${keyword}`;
  if (startDate) query.transaction_date = `gte.${startDate}`;
  if (endDate) {
    query.transaction_date = query.transaction_date ? [query.transaction_date, `lte.${endDate}`] : `lte.${endDate}`;
  }
  if (paymentMethod) query.payment_method = `eq.${paymentMethod}`;
  if (typeof args.is_paylater === "boolean") query.is_paylater = `eq.${args.is_paylater}`;

  const normalizedQuery = {};
  for (const [key, value] of Object.entries(query)) {
    normalizedQuery[key] = Array.isArray(value) ? value : value;
  }

  const data = await dbRequest("GET", "/active_expenses", {
    query: normalizedQuery,
  });

  let filteredResults = data || [];
  if (Array.isArray(args.category_contains) && args.category_contains.length > 0) {
    filteredResults = filteredResults.filter((row) =>
      args.category_contains.every((tag) =>
        Array.isArray(row.items) && row.items.some((item) => itemHasCategoryTag(item, tag))
      )
    );
  }

  const total = filteredResults.length;
  const pagedResults = filteredResults.slice(offset, offset + limit);

  return buildResponse(true, {
    result: pagedResults,
    count: total,
    pagination: {
      ...buildPagination(total, limit, offset),
      returned: pagedResults.length,
    },
  });
}

async function updateExpense(args) {
  const id = Number(args.id);
  if (!id) return buildResponse(false, null, "Missing id");

  const old = await dbRequest("GET", "/expenses", {
    object: true,
    query: {
      select: EXPENSE_RESPONSE_COLUMNS,
      id: `eq.${id}`,
    },
  }).catch(() => null);

  if (!old) return buildResponse(false, null, "Record not found");

  const updates = normalizeExpensePayload(args, { isUpdate: true });
  delete updates.id;

  const newRecord = {
    ...old,
    ...updates,
    correction_of: id,
    correction_at: nowIso(),
  };
  delete newRecord.id;
  delete newRecord.created_at;
  delete newRecord.updated_at;
  delete newRecord.deleted_at;

  const inserted = await dbRequest("POST", "/expenses", {
    body: newRecord,
    query: { select: "id" },
    prefer: "return=representation",
    object: true,
  });

  await dbRequest("PATCH", "/expenses", {
    body: { deleted_at: nowIso() },
    query: { id: `eq.${id}` },
    prefer: "return=minimal",
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
    object: true,
    query: {
      select: "remarks",
      id: `eq.${id}`,
    },
  }).catch(() => null);

  if (!current) return buildResponse(false, null, "Record not found");

  const newRemarks = [...(Array.isArray(current.remarks) ? current.remarks : []), { timestamp: nowIso(), text }];

  await dbRequest("PATCH", "/expenses", {
    body: { remarks: newRemarks },
    query: { id: `eq.${id}` },
    prefer: "return=minimal",
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
      id: data.id,
      total_amount: data.total_amount,
      payment_method: data.payment_method,
      date: data.transaction_date,
      merchant: data.merchant_name,
      remarks_count: Array.isArray(data.remarks) ? data.remarks.length : 0,
      correction_of: data.correction_of,
      corrected_at: data.correction_at,
      created_at: data.created_at,
    });

    currentId = data.correction_of;
  }

  return buildResponse(true, { result: history.reverse() });
}

const toolDefinitions = [
  {
    name: "record_expense",
    description: "Create a new expense record with merchant, item, payment, and remark details",
    inputSchema: {
      type: "object",
      properties: {
        total_amount: { type: "number" },
        currency: { type: "string" },
        transaction_date: { type: "string" },
        merchant_name: { type: "string" },
        merchant_info: { type: "object", additionalProperties: true },
        items: { type: "array", items: { type: "object", additionalProperties: true } },
        remarks: { type: "array", items: { type: "object", additionalProperties: true } },
        payment_method: { type: "string" },
        is_paylater: { type: "boolean" }
      },
      required: ["total_amount", "payment_method"],
      additionalProperties: true
    }
  },
  {
    name: "search_expenses",
    description: "Search active expense records by keyword, date range, payment method, paylater flag, and category tags",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string" },
        start_date: { type: "string" },
        end_date: { type: "string" },
        payment_method: { type: "string" },
        is_paylater: { type: "boolean" },
        category_contains: { type: "array", items: { type: "string" } },
        limit: { type: "integer", default: 20 },
        offset: { type: "integer", default: 0 }
      },
      additionalProperties: true
    }
  },
  {
    name: "update_expense",
    description: "Create a corrected replacement record for an existing expense and soft-delete the old version",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer" },
        total_amount: { type: "number" },
        currency: { type: "string" },
        transaction_date: { type: "string" },
        merchant_name: { type: "string" },
        merchant_info: { type: "object", additionalProperties: true },
        items: { type: "array", items: { type: "object", additionalProperties: true } },
        remarks: { type: "array", items: { type: "object", additionalProperties: true } },
        payment_method: { type: "string" },
        is_paylater: { type: "boolean" }
      },
      required: ["id"],
      additionalProperties: true
    }
  },
  {
    name: "delete_expense",
    description: "Soft-delete an expense record",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer" }
      },
      required: ["id"],
      additionalProperties: true
    }
  },
  {
    name: "add_expense_remark",
    description: "Append a follow-up remark to an existing expense record",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer" },
        text: { type: "string" }
      },
      required: ["id", "text"],
      additionalProperties: true
    }
  },
  {
    name: "get_expense_history",
    description: "Return the correction chain for an expense record from oldest to newest",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer" }
      },
      required: ["id"],
      additionalProperties: true
    }
  }
];

const toolHandlers = {
  record_expense: recordExpense,
  search_expenses: searchExpenses,
  update_expense: updateExpense,
  delete_expense: deleteExpense,
  add_expense_remark: addExpenseRemark,
  get_expense_history: getExpenseHistory,
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
          serverInfo: { name: "financial-assistant", version: "1.0.0" },
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
          jsonrpc: "2.0",
          id,
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
