import "./lib/error-capture";

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { serve } from "srvx/node";
import { serveStatic } from "srvx/static";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

// ─── SQLite ───────────────────────────────────────────────────────────────────

mkdirSync("./data", { recursive: true });

const db = new DatabaseSync("./data/budget-sync.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS budgets (
    id TEXT PRIMARY KEY,
    owner_device_id TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_budgets_owner ON budgets(owner_device_id);
  DROP TABLE IF EXISTS budget_access;
`);

// Idempotent migrations: SQLite doesn't support UNIQUE on ALTER TABLE ADD COLUMN,
// so we add the column then create the index separately.
for (const [col, idx] of [
  [
    "ALTER TABLE budgets ADD COLUMN ro_token TEXT",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_ro_token ON budgets(ro_token) WHERE ro_token IS NOT NULL",
  ],
  [
    "ALTER TABLE budgets ADD COLUMN rw_token TEXT",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_rw_token ON budgets(rw_token) WHERE rw_token IS NOT NULL",
  ],
] as [string, string][]) {
  try { db.exec(col); } catch { /* column already exists */ }
  try { db.exec(idx); } catch { /* index already exists */ }
}

process.on("exit", () => db.close());

// ─── SSE registry ─────────────────────────────────────────────────────────────

const enc = new TextEncoder();

type SseController = ReadableStreamDefaultController<Uint8Array>;
// budgetId → connected watchers
const sseClients = new Map<string, Set<SseController>>();

function notifyWatchers(budgetId: string, data: string, updatedAt: number) {
  const clients = sseClients.get(budgetId);
  if (!clients?.size) return;
  const chunk = enc.encode(`data: ${JSON.stringify({ data, updatedAt })}\n\n`);
  for (const ctrl of clients) {
    try { ctrl.enqueue(chunk); } catch { clients.delete(ctrl); }
  }
}

function registerWatcher(budgetId: string, ctrl: SseController) {
  if (!sseClients.has(budgetId)) sseClients.set(budgetId, new Set());
  sseClients.get(budgetId)!.add(ctrl);
}

function unregisterWatcher(budgetId: string, ctrl: SseController) {
  const set = sseClients.get(budgetId);
  if (!set) return;
  set.delete(ctrl);
  if (set.size === 0) sseClients.delete(budgetId);
}

// ─── SSR entry ────────────────────────────────────────────────────────────────

type ServerEntry = {
  fetch: (request: Request) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => ((m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry)),
    );
  }
  return serverEntryPromise;
}

// ─── Error helpers ────────────────────────────────────────────────────────────

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") return false;

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) return false;

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return brandedErrorResponse();
}

// ─── API helpers ──────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function generateToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// ─── DB row types ─────────────────────────────────────────────────────────────

type DbBudget = {
  id: string;
  owner_device_id: string;
  ro_token: string | null;
  rw_token: string | null;
  data: string;
  updated_at: number;
};

// ─── Route handlers ───────────────────────────────────────────────────────────

async function handleSync(deviceId: string, request: Request): Promise<Response> {
  let body: { budgets: { id: string; data: string; updatedAt: number }[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (!Array.isArray(body?.budgets)) return json({ error: "Invalid body" }, 400);

  const findExisting = db.prepare(
    "SELECT id, owner_device_id, updated_at FROM budgets WHERE id = ?",
  );
  const insertBudget = db.prepare(
    "INSERT INTO budgets (id, owner_device_id, data, updated_at) VALUES (?, ?, ?, ?)",
  );
  const updateBudget = db.prepare(
    "UPDATE budgets SET data = ?, updated_at = ? WHERE id = ?",
  );

  for (const b of body.budgets) {
    if (!b.id || typeof b.data !== "string" || typeof b.updatedAt !== "number") continue;

    const existing = findExisting.get(b.id) as
      | { id: string; owner_device_id: string; updated_at: number }
      | undefined;

    if (!existing) {
      insertBudget.run(b.id, deviceId, b.data, b.updatedAt);
    } else if (existing.owner_device_id === deviceId && b.updatedAt >= existing.updated_at) {
      updateBudget.run(b.data, b.updatedAt, b.id);
      notifyWatchers(b.id, b.data, b.updatedAt);
    }
  }

  const results = db
    .prepare("SELECT id, data, updated_at FROM budgets WHERE owner_device_id = ?")
    .all(deviceId) as DbBudget[];

  return json({
    budgets: results.map((r) => ({
      id: r.id,
      data: r.data,
      updatedAt: r.updated_at,
    })),
  });
}

// POST /api/share/links — generate (idempotent) and return both tokens
async function handleGetShareLinks(deviceId: string, request: Request): Promise<Response> {
  let body: { budgetId: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const budget = db
    .prepare("SELECT id, owner_device_id, ro_token, rw_token FROM budgets WHERE id = ?")
    .get(body.budgetId) as DbBudget | undefined;

  if (!budget) return json({ error: "Budget not found" }, 404);
  if (budget.owner_device_id !== deviceId) return json({ error: "Forbidden" }, 403);

  let roToken = budget.ro_token;
  let rwToken = budget.rw_token;

  if (!roToken) {
    roToken = generateToken();
    db.prepare("UPDATE budgets SET ro_token = ? WHERE id = ?").run(roToken, body.budgetId);
  }
  if (!rwToken) {
    rwToken = generateToken();
    db.prepare("UPDATE budgets SET rw_token = ? WHERE id = ?").run(rwToken, body.budgetId);
  }

  return json({ roToken, rwToken });
}

// DELETE /api/share/links — revoke both tokens
async function handleRevokeShareLinks(deviceId: string, request: Request): Promise<Response> {
  let body: { budgetId: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const budget = db
    .prepare("SELECT owner_device_id FROM budgets WHERE id = ?")
    .get(body.budgetId) as { owner_device_id: string } | undefined;

  if (!budget) return json({ error: "Budget not found" }, 404);
  if (budget.owner_device_id !== deviceId) return json({ error: "Forbidden" }, 403);

  db.prepare("UPDATE budgets SET ro_token = NULL, rw_token = NULL WHERE id = ?").run(
    body.budgetId,
  );
  return json({ ok: true });
}

// GET /api/t/:token — fetch budget by token (no auth header required)
function handleGetByToken(token: string): Response {
  const budget = db
    .prepare(
      "SELECT id, data, updated_at, ro_token, rw_token FROM budgets WHERE ro_token = ? OR rw_token = ?",
    )
    .get(token, token) as DbBudget | undefined;

  if (!budget) return json({ error: "Not found" }, 404);

  const canWrite = budget.rw_token === token;
  return json({ id: budget.id, data: budget.data, updatedAt: budget.updated_at, canWrite });
}

// PUT /api/t/:token — update budget via rw token
async function handlePutByToken(token: string, request: Request): Promise<Response> {
  const budget = db
    .prepare("SELECT id, updated_at FROM budgets WHERE rw_token = ?")
    .get(token) as DbBudget | undefined;

  if (!budget) return json({ error: "Not found or read-only" }, 403);

  let body: { data: string; updatedAt: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (body.updatedAt > budget.updated_at) {
    db.prepare("UPDATE budgets SET data = ?, updated_at = ? WHERE id = ?").run(
      body.data,
      body.updatedAt,
      budget.id,
    );
    notifyWatchers(budget.id, body.data, body.updatedAt);
  }

  return json({ ok: true });
}

// GET /api/watch/:token — SSE stream; pushes events whenever the budget is updated
function handleWatch(token: string): Response {
  const budget = db
    .prepare("SELECT id FROM budgets WHERE ro_token = ? OR rw_token = ?")
    .get(token, token) as { id: string } | undefined;

  if (!budget) return json({ error: "Not found" }, 404);

  const budgetId = budget.id;
  let ctrl: SseController;
  let heartbeat: ReturnType<typeof setInterval>;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller;
      registerWatcher(budgetId, ctrl);
      // Send an initial ping so the client knows the connection is live
      controller.enqueue(enc.encode(": connected\n\n"));
      // Keepalive comment every 25 s — prevents proxies from closing idle connections
      heartbeat = setInterval(() => {
        try { controller.enqueue(enc.encode(": ping\n\n")); } catch { clearInterval(heartbeat); }
      }, 25_000);
    },
    cancel() {
      clearInterval(heartbeat);
      unregisterWatcher(budgetId, ctrl);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// ─── API router ───────────────────────────────────────────────────────────────

async function handleApiRequest(request: Request, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = request.method;

  // Token endpoints don't require device ID
  const tokenMatch = path.match(/^\/api\/t\/([A-Za-z0-9]{32})$/);
  if (tokenMatch) {
    if (method === "GET") return handleGetByToken(tokenMatch[1]);
    if (method === "PUT") return handlePutByToken(tokenMatch[1], request);
  }

  const watchMatch = path.match(/^\/api\/watch\/([A-Za-z0-9]{32})$/);
  if (watchMatch && method === "GET") return handleWatch(watchMatch[1]);

  const deviceId = request.headers.get("X-Device-Id");
  if (!deviceId) return json({ error: "Missing X-Device-Id header" }, 401);

  try {
    if (path === "/api/sync" && method === "POST") return handleSync(deviceId, request);
    if (path === "/api/share/links" && method === "POST")
      return handleGetShareLinks(deviceId, request);
    if (path === "/api/share/links" && method === "DELETE")
      return handleRevokeShareLinks(deviceId, request);

    return json({ error: "Not found" }, 404);
  } catch (err) {
    console.error("API error:", err);
    return json({ error: "Internal server error" }, 500);
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

async function fetchHandler(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname.startsWith("/api/")) {
    return handleApiRequest(request, url);
  }

  try {
    const handler = await getServerEntry();
    const response = await handler.fetch(request);
    return await normalizeCatastrophicSsrResponse(response);
  } catch (error) {
    console.error(error);
    return brandedErrorResponse();
  }
}

// ─── Server startup ───────────────────────────────────────────────────────────

if (process.env.TSS_DEV_SERVER !== "true") {
  serve({
    fetch: fetchHandler,
    middleware: [serveStatic({ dir: "dist/client" })],
    port: parseInt(process.env.PORT ?? "4173"),
    hostname: process.env.HOST ?? "0.0.0.0",
  });
}

export default { fetch: fetchHandler };
