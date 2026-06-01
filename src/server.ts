import "./lib/error-capture";

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { join, extname } from "node:path";
import { serve } from "srvx/node";
import { serveStatic } from "srvx/static";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

// ─── SQLite ───────────────────────────────────────────────────────────────────

mkdirSync("./data", { recursive: true });
mkdirSync("./data/receipts", { recursive: true });

const RECEIPTS_DIR = "./data/receipts";
const RECEIPT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const RECEIPT_MIME: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".gif": "image/gif", ".webp": "image/webp", ".heic": "image/heic",
  ".pdf": "application/pdf",
};

async function handleUploadReceipt(request: Request): Promise<Response> {
  let formData: FormData;
  try { formData = await request.formData(); } catch { return json({ error: "Invalid form data" }, 400); }
  const file = formData.get("file");
  if (!(file instanceof File)) return json({ error: "No file provided" }, 400);
  if (file.size > RECEIPT_MAX_BYTES) return json({ error: "File too large (max 10 MB)" }, 413);
  const ext = extname(file.name).toLowerCase();
  if (!RECEIPT_MIME[ext]) return json({ error: "Unsupported file type" }, 415);
  const filename = `${generateToken()}${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  writeFileSync(join(RECEIPTS_DIR, filename), buffer);
  return json({ url: `/api/receipts/${filename}` });
}

function handleServeReceipt(filename: string): Response {
  if (/[/\\.]\./.test(filename)) return json({ error: "Invalid filename" }, 400);
  const filepath = join(RECEIPTS_DIR, filename);
  if (!existsSync(filepath)) return json({ error: "Not found" }, 404);
  const ext = extname(filename).toLowerCase();
  const contentType = RECEIPT_MIME[ext] ?? "application/octet-stream";
  return new Response(readFileSync(filepath), {
    headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=31536000" },
  });
}

function deleteReceiptFile(url: string) {
  const filename = url.split("/").pop() ?? "";
  if (!filename || /[/\\.]\./.test(filename)) return;
  try { unlinkSync(join(RECEIPTS_DIR, filename)); } catch { /* already gone */ }
}

function handleDeleteReceipt(filename: string): Response {
  if (/[/\\.]\./.test(filename)) return json({ error: "Invalid filename" }, 400);
  try { unlinkSync(join(RECEIPTS_DIR, filename)); } catch { /* already gone */ }
  return json({ ok: true });
}

function handleCleanupExpired(): Response {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const rows = db.prepare("SELECT id, data FROM budgets").all() as { id: string; data: string }[];
  const deletedIds: string[] = [];

  for (const row of rows) {
    let parsed: { archived?: boolean; archivedAt?: number; expenses?: unknown[] } = {};
    try { parsed = JSON.parse(row.data) as typeof parsed; } catch { continue; }
    if (!parsed.archived || !parsed.archivedAt || parsed.archivedAt >= cutoff) continue;

    // Delete any receipt files attached to transactions in this budget
    const expenses = Array.isArray(parsed.expenses) ? parsed.expenses : [];
    for (const exp of expenses) {
      if (!exp || typeof exp !== "object") continue;
      const txs = (exp as { transactions?: unknown[] }).transactions ?? [];
      for (const tx of txs) {
        if (tx && typeof tx === "object") {
          const url = (tx as { receiptUrl?: string }).receiptUrl;
          if (url) deleteReceiptFile(url);
        }
      }
    }

    db.prepare("DELETE FROM budgets WHERE id = ?").run(row.id);
    deletedIds.push(row.id);
  }

  return json({ deletedIds });
}

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
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    owner_device_id TEXT NOT NULL,
    name TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces(owner_device_id);
  CREATE TABLE IF NOT EXISTS workspace_budgets (
    workspace_id TEXT NOT NULL,
    budget_id TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (workspace_id, budget_id)
  );
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
  [
    "ALTER TABLE workspaces ADD COLUMN ro_token TEXT",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_ro_token ON workspaces(ro_token) WHERE ro_token IS NOT NULL",
  ],
  [
    "ALTER TABLE workspaces ADD COLUMN rw_token TEXT",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_rw_token ON workspaces(rw_token) WHERE rw_token IS NOT NULL",
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

// workspaceId → connected workspace-level watchers
const wsSseClients = new Map<string, Set<SseController>>();

function notifyWsClients(workspaceId: string, payload: object) {
  const clients = wsSseClients.get(workspaceId);
  if (!clients?.size) return;
  const chunk = enc.encode(`data: ${JSON.stringify(payload)}\n\n`);
  for (const ctrl of clients) {
    try { ctrl.enqueue(chunk); } catch { clients.delete(ctrl); }
  }
}

function registerWsWatcher(workspaceId: string, ctrl: SseController) {
  if (!wsSseClients.has(workspaceId)) wsSseClients.set(workspaceId, new Set());
  wsSseClients.get(workspaceId)!.add(ctrl);
}

function unregisterWsWatcher(workspaceId: string, ctrl: SseController) {
  const set = wsSseClients.get(workspaceId);
  if (!set) return;
  set.delete(ctrl);
  if (set.size === 0) wsSseClients.delete(workspaceId);
}

// Notify workspace SSE clients when a budget's data changes
function notifyBudgetInWorkspaces(budgetId: string, data: string, updatedAt: number) {
  const rows = db
    .prepare("SELECT workspace_id FROM workspace_budgets WHERE budget_id = ?")
    .all(budgetId) as { workspace_id: string }[];
  for (const { workspace_id } of rows) {
    notifyWsClients(workspace_id, { type: "budget", budgetId, data, updatedAt });
  }
}

// Notify workspace SSE clients when the workspace membership changes
function notifyWsStructureChange(workspaceId: string) {
  const rows = db
    .prepare("SELECT budget_id FROM workspace_budgets WHERE workspace_id = ? ORDER BY position ASC")
    .all(workspaceId) as { budget_id: string }[];
  notifyWsClients(workspaceId, { type: "structure", serverBudgetIds: rows.map((r) => r.budget_id) });
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

function generateUUID(): string {
  const hex = "0123456789abcdef";
  const s = Array.from({ length: 32 }, () => hex[Math.floor(Math.random() * 16)]);
  s[12] = "4";
  s[16] = hex[(parseInt(s[16], 16) & 0x3) | 0x8];
  return `${s.slice(0, 8).join("")}-${s.slice(8, 12).join("")}-${s.slice(12, 16).join("")}-${s.slice(16, 20).join("")}-${s.slice(20).join("")}`;
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

type DbWorkspace = {
  id: string;
  owner_device_id: string;
  name: string;
  updated_at: number;
  ro_token: string | null;
  rw_token: string | null;
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
      notifyBudgetInWorkspaces(b.id, b.data, b.updatedAt);
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
    notifyBudgetInWorkspaces(budget.id, body.data, body.updatedAt);
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

// POST /api/workspaces
async function handleCreateWorkspace(deviceId: string, request: Request): Promise<Response> {
  let body: { name: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (typeof body?.name !== "string" || !body.name.trim()) return json({ error: "Invalid body" }, 400);
  const id = generateUUID();
  const now = Date.now();
  db.prepare("INSERT INTO workspaces (id, owner_device_id, name, updated_at) VALUES (?, ?, ?, ?)")
    .run(id, deviceId, body.name.trim(), now);
  return json({ id, name: body.name.trim(), budgetIds: [] });
}

// GET /api/workspaces
function handleListWorkspaces(deviceId: string): Response {
  const rows = db.prepare("SELECT id, name FROM workspaces WHERE owner_device_id = ? ORDER BY updated_at ASC")
    .all(deviceId) as { id: string; name: string }[];
  const result = rows.map((w) => {
    const budgetRows = db.prepare("SELECT budget_id FROM workspace_budgets WHERE workspace_id = ? ORDER BY position ASC")
      .all(w.id) as { budget_id: string }[];
    return { id: w.id, name: w.name, budgetIds: budgetRows.map((r) => r.budget_id) };
  });
  return json(result);
}

// PATCH /api/workspaces/:id
async function handleRenameWorkspace(deviceId: string, id: string, request: Request): Promise<Response> {
  let body: { name: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (typeof body?.name !== "string" || !body.name.trim()) return json({ error: "Invalid body" }, 400);
  const ws = db.prepare("SELECT owner_device_id FROM workspaces WHERE id = ?").get(id) as { owner_device_id: string } | undefined;
  if (!ws) return json({ error: "Not found" }, 404);
  if (ws.owner_device_id !== deviceId) return json({ error: "Forbidden" }, 403);
  db.prepare("UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?").run(body.name.trim(), Date.now(), id);
  return json({ ok: true });
}

// DELETE /api/workspaces/:id
function handleDeleteWorkspace(deviceId: string, id: string): Response {
  const ws = db.prepare("SELECT owner_device_id FROM workspaces WHERE id = ?").get(id) as { owner_device_id: string } | undefined;
  if (!ws) return json({ error: "Not found" }, 404);
  if (ws.owner_device_id !== deviceId) return json({ error: "Forbidden" }, 403);
  db.prepare("DELETE FROM workspace_budgets WHERE workspace_id = ?").run(id);
  db.prepare("DELETE FROM workspaces WHERE id = ?").run(id);
  return json({ ok: true });
}

// POST /api/workspaces/:id/budgets
async function handleAddBudgetToWorkspace(deviceId: string, workspaceId: string, request: Request): Promise<Response> {
  let body: { budgetId: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (typeof body?.budgetId !== "string") return json({ error: "Invalid body" }, 400);
  const ws = db.prepare("SELECT owner_device_id FROM workspaces WHERE id = ?").get(workspaceId) as { owner_device_id: string } | undefined;
  if (!ws) return json({ error: "Not found" }, 404);
  if (ws.owner_device_id !== deviceId) return json({ error: "Forbidden" }, 403);
  const countRow = db.prepare("SELECT COUNT(*) as cnt FROM workspace_budgets WHERE workspace_id = ?").get(workspaceId) as { cnt: number };
  try {
    db.prepare("INSERT INTO workspace_budgets (workspace_id, budget_id, position) VALUES (?, ?, ?)").run(workspaceId, body.budgetId, countRow.cnt);
  } catch { /* already exists */ }
  notifyWsStructureChange(workspaceId);
  return json({ ok: true });
}

// DELETE /api/workspaces/:id/budgets/:budgetId
function handleRemoveBudgetFromWorkspace(deviceId: string, workspaceId: string, budgetId: string): Response {
  const ws = db.prepare("SELECT owner_device_id FROM workspaces WHERE id = ?").get(workspaceId) as { owner_device_id: string } | undefined;
  if (!ws) return json({ error: "Not found" }, 404);
  if (ws.owner_device_id !== deviceId) return json({ error: "Forbidden" }, 403);
  db.prepare("DELETE FROM workspace_budgets WHERE workspace_id = ? AND budget_id = ?").run(workspaceId, budgetId);
  notifyWsStructureChange(workspaceId);
  return json({ ok: true });
}

// POST /api/workspace/links
async function handleGetWorkspaceLinks(deviceId: string, request: Request): Promise<Response> {
  let body: { workspaceId: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const ws = db.prepare("SELECT id, owner_device_id, ro_token, rw_token FROM workspaces WHERE id = ?").get(body.workspaceId) as DbWorkspace | undefined;
  if (!ws) return json({ error: "Not found" }, 404);
  if (ws.owner_device_id !== deviceId) return json({ error: "Forbidden" }, 403);

  let roToken = ws.ro_token;
  let rwToken = ws.rw_token;

  if (!roToken) {
    roToken = generateToken();
    db.prepare("UPDATE workspaces SET ro_token = ? WHERE id = ?").run(roToken, body.workspaceId);
  }
  if (!rwToken) {
    rwToken = generateToken();
    db.prepare("UPDATE workspaces SET rw_token = ? WHERE id = ?").run(rwToken, body.workspaceId);
  }

  return json({ roToken, rwToken });
}

// DELETE /api/workspace/links
async function handleRevokeWorkspaceLinks(deviceId: string, request: Request): Promise<Response> {
  let body: { workspaceId: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const ws = db.prepare("SELECT owner_device_id FROM workspaces WHERE id = ?").get(body.workspaceId) as { owner_device_id: string } | undefined;
  if (!ws) return json({ error: "Not found" }, 404);
  if (ws.owner_device_id !== deviceId) return json({ error: "Forbidden" }, 403);
  db.prepare("UPDATE workspaces SET ro_token = NULL, rw_token = NULL WHERE id = ?").run(body.workspaceId);
  return json({ ok: true });
}

// GET /api/w/:token
function handleGetWorkspaceByToken(token: string): Response {
  const ws = db.prepare("SELECT id, name, ro_token, rw_token FROM workspaces WHERE ro_token = ? OR rw_token = ?").get(token, token) as DbWorkspace | undefined;
  if (!ws) return json({ error: "Not found" }, 404);
  const canWrite = ws.rw_token === token;
  const budgetRows = db.prepare(
    "SELECT wb.budget_id, b.data, b.updated_at FROM workspace_budgets wb LEFT JOIN budgets b ON b.id = wb.budget_id WHERE wb.workspace_id = ? ORDER BY wb.position ASC"
  ).all(ws.id) as { budget_id: string; data: string | null; updated_at: number | null }[];
  const budgets = budgetRows
    .filter((r) => r.data !== null)
    .map((r) => ({ id: r.budget_id, data: r.data as string, updatedAt: r.updated_at as number }));
  return json({ name: ws.name, canWrite, budgets });
}

// PUT /api/w/:token
async function handleUpdateWorkspaceByToken(token: string, request: Request): Promise<Response> {
  const ws = db.prepare("SELECT id, rw_token FROM workspaces WHERE rw_token = ?").get(token) as DbWorkspace | undefined;
  if (!ws) return json({ error: "Not found or read-only" }, 403);

  let body: { budgetId: string; data: string; updatedAt: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const member = db.prepare("SELECT budget_id FROM workspace_budgets WHERE workspace_id = ? AND budget_id = ?").get(ws.id, body.budgetId) as { budget_id: string } | undefined;
  if (!member) return json({ error: "Budget not in workspace" }, 403);

  const existing = db.prepare("SELECT id, updated_at FROM budgets WHERE id = ?").get(body.budgetId) as { id: string; updated_at: number } | undefined;
  if (!existing) return json({ error: "Budget not found" }, 404);

  if (body.updatedAt > existing.updated_at) {
    db.prepare("UPDATE budgets SET data = ?, updated_at = ? WHERE id = ?").run(body.data, body.updatedAt, body.budgetId);
    notifyWatchers(body.budgetId, body.data, body.updatedAt);
    notifyBudgetInWorkspaces(body.budgetId, body.data, body.updatedAt);
  }

  return json({ ok: true });
}

// ─── API router ───────────────────────────────────────────────────────────────

async function handleApiRequest(request: Request, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = request.method;

  // GET /api/wwatch/:token — SSE for workspace structure + budget data changes
  const wwatchMatch = path.match(/^\/api\/wwatch\/([A-Za-z0-9]{32})$/);
  if (wwatchMatch && method === "GET") {
    const token = wwatchMatch[1];
    const ws = db
      .prepare("SELECT id FROM workspaces WHERE ro_token = ? OR rw_token = ?")
      .get(token, token) as { id: string } | undefined;
    if (!ws) return json({ error: "Not found" }, 404);
    const workspaceId = ws.id;
    let ctrl: SseController;
    let heartbeat: ReturnType<typeof setInterval>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        ctrl = controller;
        registerWsWatcher(workspaceId, ctrl);
        controller.enqueue(enc.encode(": connected\n\n"));
        heartbeat = setInterval(() => {
          try { controller.enqueue(enc.encode(": ping\n\n")); } catch { clearInterval(heartbeat); }
        }, 25_000);
      },
      cancel() {
        clearInterval(heartbeat);
        unregisterWsWatcher(workspaceId, ctrl);
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

  // Receipt endpoints (no auth required)
  if (path === "/api/receipts" && method === "POST") return handleUploadReceipt(request);
  const receiptMatch = path.match(/^\/api\/receipts\/([A-Za-z0-9_.-]{10,80})$/);
  if (receiptMatch && method === "GET") return handleServeReceipt(receiptMatch[1]);
  if (receiptMatch && method === "DELETE") return handleDeleteReceipt(receiptMatch[1]);

  // Maintenance (no auth required — only affects data past its retention period)
  if (path === "/api/maintenance/cleanup-expired" && method === "POST") return handleCleanupExpired();

  // Token endpoints don't require device ID
  const tokenMatch = path.match(/^\/api\/t\/([A-Za-z0-9]{32})$/);
  if (tokenMatch) {
    if (method === "GET") return handleGetByToken(tokenMatch[1]);
    if (method === "PUT") return handlePutByToken(tokenMatch[1], request);
  }

  const watchMatch = path.match(/^\/api\/watch\/([A-Za-z0-9]{32})$/);
  if (watchMatch && method === "GET") return handleWatch(watchMatch[1]);

  // Workspace public endpoints (no auth required)
  const wsTokenMatch = path.match(/^\/api\/w\/([A-Za-z0-9]{32})$/);
  if (wsTokenMatch) {
    if (method === "GET") return handleGetWorkspaceByToken(wsTokenMatch[1]);
    if (method === "PUT") return handleUpdateWorkspaceByToken(wsTokenMatch[1], request);
  }

  const deviceId = request.headers.get("X-Device-Id");
  if (!deviceId) return json({ error: "Missing X-Device-Id header" }, 401);

  try {
    if (path === "/api/sync" && method === "POST") return handleSync(deviceId, request);
    if (path === "/api/share/links" && method === "POST")
      return handleGetShareLinks(deviceId, request);
    if (path === "/api/share/links" && method === "DELETE")
      return handleRevokeShareLinks(deviceId, request);

    if (path === "/api/workspaces" && method === "POST") return handleCreateWorkspace(deviceId, request);
    if (path === "/api/workspaces" && method === "GET") return handleListWorkspaces(deviceId);

    const wsIdMatch = path.match(/^\/api\/workspaces\/([a-z0-9-]{36})$/);
    if (wsIdMatch) {
      if (method === "PATCH") return handleRenameWorkspace(deviceId, wsIdMatch[1], request);
      if (method === "DELETE") return handleDeleteWorkspace(deviceId, wsIdMatch[1]);
    }

    const wsIdBudgetsMatch = path.match(/^\/api\/workspaces\/([a-z0-9-]{36})\/budgets$/);
    if (wsIdBudgetsMatch && method === "POST") return handleAddBudgetToWorkspace(deviceId, wsIdBudgetsMatch[1], request);

    const wsIdBudgetIdMatch = path.match(/^\/api\/workspaces\/([a-z0-9-]{36})\/budgets\/(.+)$/);
    if (wsIdBudgetIdMatch && method === "DELETE") return handleRemoveBudgetFromWorkspace(deviceId, wsIdBudgetIdMatch[1], wsIdBudgetIdMatch[2]);

    if (path === "/api/workspace/links" && method === "POST") return handleGetWorkspaceLinks(deviceId, request);
    if (path === "/api/workspace/links" && method === "DELETE") return handleRevokeWorkspaceLinks(deviceId, request);

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
