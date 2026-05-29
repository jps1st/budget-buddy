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
    share_code TEXT UNIQUE,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS budget_access (
    budget_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    can_write INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (budget_id, device_id),
    FOREIGN KEY (budget_id) REFERENCES budgets(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_budgets_owner ON budgets(owner_device_id);
`);

process.on("exit", () => db.close());

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

function generateShareCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// ─── DB row types ─────────────────────────────────────────────────────────────

type DbBudget = {
  id: string;
  owner_device_id: string;
  share_code: string | null;
  data: string;
  updated_at: number;
};

// ─── Route handlers ───────────────────────────────────────────────────────────

async function handleSync(deviceId: string, request: Request): Promise<Response> {
  let body: { budgets: { id: string; data: string; updatedAt: number; shareCode: string | null }[] };
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
    "INSERT INTO budgets (id, owner_device_id, share_code, data, updated_at) VALUES (?, ?, ?, ?, ?)",
  );
  const updateBudget = db.prepare(
    "UPDATE budgets SET data = ?, updated_at = ?, share_code = ? WHERE id = ?",
  );

  for (const b of body.budgets) {
    if (!b.id || typeof b.data !== "string" || typeof b.updatedAt !== "number") continue;

    const existing = findExisting.get(b.id) as
      | { id: string; owner_device_id: string; updated_at: number }
      | undefined;

    if (!existing) {
      insertBudget.run(b.id, deviceId, b.shareCode ?? null, b.data, b.updatedAt);
    } else if (existing.owner_device_id === deviceId && b.updatedAt >= existing.updated_at) {
      updateBudget.run(b.data, b.updatedAt, b.shareCode ?? null, b.id);
    }
  }

  const results = db
    .prepare("SELECT id, share_code, data, updated_at FROM budgets WHERE owner_device_id = ?")
    .all(deviceId) as DbBudget[];

  return json({
    budgets: results.map((r) => ({
      id: r.id,
      data: r.data,
      updatedAt: r.updated_at,
      shareCode: r.share_code,
    })),
  });
}

async function handleShareGenerate(deviceId: string, request: Request): Promise<Response> {
  let body: { budgetId: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const budget = db
    .prepare("SELECT id, owner_device_id, share_code FROM budgets WHERE id = ?")
    .get(body.budgetId) as DbBudget | undefined;

  if (!budget) return json({ error: "Budget not found" }, 404);
  if (budget.owner_device_id !== deviceId) return json({ error: "Forbidden" }, 403);
  if (budget.share_code) return json({ shareCode: budget.share_code });

  let shareCode = "";
  let attempt = 0;
  do {
    shareCode = generateShareCode();
    const conflict = db.prepare("SELECT id FROM budgets WHERE share_code = ?").get(shareCode);
    if (!conflict) break;
  } while (++attempt < 10);

  db.prepare("UPDATE budgets SET share_code = ? WHERE id = ?").run(shareCode, body.budgetId);
  return json({ shareCode });
}

async function handleShareDisable(deviceId: string, request: Request): Promise<Response> {
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

  db.prepare("UPDATE budgets SET share_code = NULL WHERE id = ?").run(body.budgetId);
  return json({ ok: true });
}

function handleShareGet(deviceId: string, code: string): Response {
  const budget = db
    .prepare(
      "SELECT id, owner_device_id, share_code, data, updated_at FROM budgets WHERE share_code = ?",
    )
    .get(code) as DbBudget | undefined;

  if (!budget) return json({ error: "Not found" }, 404);

  const isOwner = budget.owner_device_id === deviceId;
  let canWrite = isOwner;

  if (!isOwner) {
    const access = db
      .prepare("SELECT can_write FROM budget_access WHERE budget_id = ? AND device_id = ?")
      .get(budget.id, deviceId) as { can_write: number } | undefined;
    canWrite = access?.can_write === 1;
  }

  return json({ id: budget.id, data: budget.data, updatedAt: budget.updated_at, canWrite });
}

async function handleSharePut(
  deviceId: string,
  code: string,
  request: Request,
): Promise<Response> {
  const budget = db
    .prepare("SELECT id, owner_device_id, updated_at FROM budgets WHERE share_code = ?")
    .get(code) as DbBudget | undefined;

  if (!budget) return json({ error: "Not found" }, 404);

  const isOwner = budget.owner_device_id === deviceId;
  if (!isOwner) {
    const access = db
      .prepare("SELECT can_write FROM budget_access WHERE budget_id = ? AND device_id = ?")
      .get(budget.id, deviceId) as { can_write: number } | undefined;
    if (access?.can_write !== 1) return json({ error: "Forbidden" }, 403);
  }

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
  }

  return json({ ok: true });
}

function handlePermissionsGet(deviceId: string, budgetId: string): Response {
  const budget = db
    .prepare("SELECT owner_device_id FROM budgets WHERE id = ?")
    .get(budgetId) as { owner_device_id: string } | undefined;

  if (!budget) return json({ error: "Not found" }, 404);
  if (budget.owner_device_id !== deviceId) return json({ error: "Forbidden" }, 403);

  const results = db
    .prepare("SELECT device_id, can_write FROM budget_access WHERE budget_id = ?")
    .all(budgetId) as { device_id: string; can_write: number }[];

  return json({
    permissions: results.map((r) => ({ deviceId: r.device_id, canWrite: r.can_write === 1 })),
  });
}

async function handlePermissionsPost(
  deviceId: string,
  budgetId: string,
  request: Request,
): Promise<Response> {
  const budget = db
    .prepare("SELECT owner_device_id FROM budgets WHERE id = ?")
    .get(budgetId) as { owner_device_id: string } | undefined;

  if (!budget) return json({ error: "Not found" }, 404);
  if (budget.owner_device_id !== deviceId) return json({ error: "Forbidden" }, 403);

  let body: { deviceId: string; canWrite: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (!body.deviceId || body.deviceId === deviceId)
    return json({ error: "Invalid target device ID" }, 400);

  db.prepare(
    "INSERT INTO budget_access (budget_id, device_id, can_write) VALUES (?, ?, ?)" +
      " ON CONFLICT(budget_id, device_id) DO UPDATE SET can_write = excluded.can_write",
  ).run(budgetId, body.deviceId, body.canWrite ? 1 : 0);

  return json({ ok: true });
}

function handlePermissionsDelete(
  deviceId: string,
  budgetId: string,
  targetDeviceId: string,
): Response {
  const budget = db
    .prepare("SELECT owner_device_id FROM budgets WHERE id = ?")
    .get(budgetId) as { owner_device_id: string } | undefined;

  if (!budget) return json({ error: "Not found" }, 404);
  if (budget.owner_device_id !== deviceId) return json({ error: "Forbidden" }, 403);

  db.prepare("DELETE FROM budget_access WHERE budget_id = ? AND device_id = ?").run(
    budgetId,
    targetDeviceId,
  );

  return json({ ok: true });
}

// ─── API router ───────────────────────────────────────────────────────────────

async function handleApiRequest(request: Request, url: URL): Promise<Response> {
  const deviceId = request.headers.get("X-Device-Id");
  if (!deviceId) return json({ error: "Missing X-Device-Id header" }, 401);

  const path = url.pathname;
  const method = request.method;

  try {
    if (path === "/api/sync" && method === "POST") return handleSync(deviceId, request);
    if (path === "/api/share/generate" && method === "POST")
      return handleShareGenerate(deviceId, request);
    if (path === "/api/share/disable" && method === "POST")
      return handleShareDisable(deviceId, request);

    const shareMatch = path.match(/^\/api\/share\/([A-Z0-9]{8})$/);
    if (shareMatch) {
      if (method === "GET") return handleShareGet(deviceId, shareMatch[1]);
      if (method === "PUT") return handleSharePut(deviceId, shareMatch[1], request);
    }

    const permBase = path.match(/^\/api\/permissions\/([^/]+)$/);
    if (permBase) {
      const budgetId = decodeURIComponent(permBase[1]);
      if (method === "GET") return handlePermissionsGet(deviceId, budgetId);
      if (method === "POST") return handlePermissionsPost(deviceId, budgetId, request);
    }

    const permDelete = path.match(/^\/api\/permissions\/([^/]+)\/([^/]+)$/);
    if (permDelete && method === "DELETE") {
      return handlePermissionsDelete(
        deviceId,
        decodeURIComponent(permDelete[1]),
        decodeURIComponent(permDelete[2]),
      );
    }

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
// Guard prevents starting a second HTTP listener when Vite loads this file
// in dev mode (TSS_DEV_SERVER is replaced at compile time with "true"/"false").

if (process.env.TSS_DEV_SERVER !== "true") {
  serve({
    fetch: fetchHandler,
    middleware: [serveStatic({ dir: "dist/client" })],
    port: parseInt(process.env.PORT ?? "4173"),
    hostname: process.env.HOST ?? "0.0.0.0",
  });
}

export default { fetch: fetchHandler };
