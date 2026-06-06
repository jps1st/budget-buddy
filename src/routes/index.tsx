declare const __APP_VERSION__: string;

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import {
  Download,
  Upload,
  Plus,
  Archive,
  RotateCcw,
  Trash2,
  MoreHorizontal,
  Copy,
  ChevronUp,
  ChevronDown,
  Menu,
  X,
  Undo2,
  Redo2,
  Cloud,
  CloudOff,
  Share2,
  Link2,
  Loader2,
  Check,
  FolderOpen,
  FolderClosed,
  FolderPlus,
  PencilLine,
  Receipt,
  CloudUpload,
} from "lucide-react";
import { BudgetTable, type Entry } from "@/components/BudgetTable";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  loadAll,
  putBudget,
  deleteBudget,
  getMeta,
  setActiveId as persistActiveId,
  getDeviceId,
  loadAllWorkspaces,
  putWorkspace,
  deleteWorkspaceIDB,
  type BudgetRow,
  type BudgetSnapshot,
  type WorkspaceRow,
} from "@/lib/budget-storage";
import {
  syncOwnedBudgets,
  getShareLinks,
  revokeShareLinks,
  fetchByToken,
  updateByToken,
  forcePushByToken,
  forcePushWorkspaceByToken,
  createWorkspace,
  listWorkspaces,
  renameWorkspace,
  deleteWorkspaceAPI,
  addBudgetToWorkspace,
  removeBudgetFromWorkspace,
  getWorkspaceLinks,
  revokeWorkspaceLinks,
  fetchWorkspaceByToken,
  updateWorkspaceByToken,
  type ShareLinks,
  type WorkspaceLinks,
  type SharedPushResult,
} from "@/lib/sync-api";
import { fmt } from "@/lib/utils";

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const Route = createFileRoute("/")({
  component: BudgetApp,
  head: () => ({
    meta: [
      { title: "Budget Editor — Import, edit and export your budget" },
      {
        name: "description",
        content:
          "A simple budget editor with tabs, IndexedDB persistence, and archiving. Import, edit and export budgets as .budget.json files.",
      },
    ],
  }),
});

function createBudget(overrides: Partial<BudgetRow> = {}): BudgetRow {
  return {
    id: uuid(),
    title: "My Budget",
    subtitle: "",
    income: [
      { id: uuid(), label: "Salary", amount: 0 },
      { id: uuid(), label: "Side income", amount: 0 },
    ],
    expenses: [
      { id: uuid(), label: "Rent", amount: 0 },
      { id: uuid(), label: "Groceries", amount: 0 },
      { id: uuid(), label: "Utilities", amount: 0 },
      { id: uuid(), label: "Transport", amount: 0 },
    ],
    archived: false,
    updatedAt: Date.now(),
    order: Date.now(),
    ...overrides,
  };
}

function sanitizeEntries(arr: unknown): Entry[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => ({
      id: typeof e.id === "string" ? e.id : uuid(),
      label: typeof e.label === "string" ? e.label : "",
      amount:
        typeof e.amount === "number" ? e.amount : parseFloat(String(e.amount)) || 0,
    }));
}


function serializeForSync(b: BudgetRow): string {
  const { undoStack: _u, redoStack: _r, syncSource: _s, roToken: _ro, serverUpdatedAt: _sa, ...rest } = b;
  return JSON.stringify(rest);
}

function deserializeFromSync(id: string, data: string, updatedAt: number): BudgetRow {
  let parsed: Partial<BudgetRow> = {};
  try {
    parsed = JSON.parse(data) as Partial<BudgetRow>;
  } catch {
    /* keep defaults */
  }
  return {
    id,
    title: parsed.title ?? "Untitled",
    subtitle: parsed.subtitle ?? "",
    income: sanitizeEntries(parsed.income),
    expenses: sanitizeEntries(parsed.expenses),
    archived: parsed.archived ?? false,
    archivedAt: parsed.archivedAt,
    updatedAt,
    serverUpdatedAt: updatedAt,
    order: parsed.order ?? Date.now(),
    undoStack: [],
    redoStack: [],
    mode: parsed.mode === "recording" ? "recording" : "editing",
  };
}

type SyncStatus = "idle" | "syncing" | "synced" | "error";

type ConflictItem = {
  budgetId: string;
  budgetTitle: string;
  localRow: BudgetRow;
  serverData: string;
  serverUpdatedAt: number;
};

function SyncIcon({ status }: { status: SyncStatus; className?: string }) {
  if (status === "syncing")
    return <Loader2 className="size-3.5 animate-spin text-muted-foreground" />;
  if (status === "synced")
    return <Cloud className="size-3.5 text-emerald-500" />;
  if (status === "error")
    return <CloudOff className="size-3.5 text-destructive" />;
  return <Cloud className="size-3.5 text-muted-foreground/40" />;
}

function BudgetApp() {
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [importError, setImportError] = useState<string | null>(null);
  const [closeTarget, setCloseTarget] = useState<BudgetRow | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  // Sync state
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);

  // Force push state
  const [forcePushOpen, setForcePushOpen] = useState(false);
  const [forcePushing, setForcePushing] = useState(false);

  // Share dialog state
  const [shareOpen, setShareOpen] = useState<string | null>(null); // budget id
  const [shareLinks, setShareLinks] = useState<ShareLinks | null>(null);
  const [shareLinksLoading, setShareLinksLoading] = useState(false);
  const [roCopied, setRoCopied] = useState(false);
  const [rwCopied, setRwCopied] = useState(false);

  // Workspace state
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [expandedWs, setExpandedWs] = useState<Set<string>>(new Set());
  const [wsShareOpen, setWsShareOpen] = useState<string | null>(null);
  const [wsShareLinks, setWsShareLinks] = useState<WorkspaceLinks | null>(null);
  const [wsShareLoading, setWsShareLoading] = useState(false);
  const [wsRoCopied, setWsRoCopied] = useState(false);
  const [wsRwCopied, setWsRwCopied] = useState(false);
  const [moveToWsTarget, setMoveToWsTarget] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const budgetsRef = useRef<BudgetRow[]>([]);
  const burstSnapRef = useRef<BudgetSnapshot | null>(null);
  const burstTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const burstBudgetIdRef = useRef<string | null>(null);
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});
  const deviceIdRef = useRef<string | null>(null);

  // Sync scheduling
  const syncDirtyRef = useRef<Set<string>>(new Set());
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const SYNC_DEBOUNCE_MS = 600;
  // Stable ref so the flush-on-hide effect can always call the latest flushSync
  const flushSyncRef = useRef<() => Promise<void>>(async () => {});

  // Load from IDB on mount, then do initial remote sync
  useEffect(() => {
    (async () => {
      const [rows, meta, did] = await Promise.all([loadAll(), getMeta(), getDeviceId()]);
      setDeviceId(did);
      deviceIdRef.current = did;

      let finalRows = rows;

      if (rows.length === 0) {
        const b = createBudget();
        await putBudget(b);
        await persistActiveId(b.id);
        finalRows = [b];
        setBudgets([b]);
        setActiveIdState(b.id);
      } else {
        setBudgets(rows);
        const openRows = rows.filter((r) => !r.archived);
        const id =
          meta.activeId && openRows.find((r) => r.id === meta.activeId)
            ? meta.activeId
            : openRows[0]?.id ?? null;
        setActiveIdState(id);
      }

      setLoaded(true);

      // Load workspaces
      const wsRows = await loadAllWorkspaces();
      setWorkspaces(wsRows.sort((a, b) => a.order - b.order));
      if (did) void syncWorkspaces(did, wsRows);

      // Initial remote sync in background
      void doInitialSync(did, finalRows);

      // Cleanup budgets archived for 30+ days (server deletes receipts too)
      void fetch("/api/maintenance/cleanup-expired", { method: "POST" })
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (!data) return;
          const { deletedIds } = data as { deletedIds: string[] };
          if (!deletedIds?.length) return;
          void Promise.all(deletedIds.map((id) => deleteBudget(id)));
          setBudgets((arr) => arr.filter((b) => !deletedIds.includes(b.id)));
        })
        .catch(() => { /* non-critical */ });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doInitialSync = async (did: string, localRows: BudgetRow[]) => {
    const owned = localRows.filter((r) => !r.syncSource);
    const payload = owned.map((b) => ({
      id: b.id,
      data: serializeForSync(b),
      updatedAt: b.updatedAt,
      expectedUpdatedAt: b.serverUpdatedAt,
    }));

    setSyncStatus("syncing");
    const result = await syncOwnedBudgets(did, payload);
    if (!result) {
      setSyncStatus("error");
      return;
    }

    // Register server-reported conflicts
    const conflictIds = new Set(result.conflicts.map((c) => c.id));
    for (const conflict of result.conflicts) {
      const localRow = localRows.find((b) => b.id === conflict.id);
      if (localRow) {
        setConflicts((prev) =>
          prev.some((c) => c.budgetId === conflict.id) ? prev :
          [...prev, {
            budgetId: conflict.id,
            budgetTitle: localRow.title,
            localRow,
            serverData: conflict.data,
            serverUpdatedAt: conflict.updatedAt,
          }]
        );
      }
    }

    // Merge non-conflicted server budgets into local state
    const merged: BudgetRow[] = [...localRows];
    for (const sb of result.budgets) {
      if (conflictIds.has(sb.id)) continue;
      const localIdx = merged.findIndex((b) => b.id === sb.id);
      if (localIdx === -1) {
        const nb = deserializeFromSync(sb.id, sb.data, sb.updatedAt);
        await putBudget(nb);
        merged.push(nb);
      } else if (sb.updatedAt > merged[localIdx].updatedAt) {
        const nb = {
          ...deserializeFromSync(sb.id, sb.data, sb.updatedAt),
          roToken: merged[localIdx].roToken,
        };
        await putBudget(nb);
        merged[localIdx] = nb;
      } else if (merged[localIdx].serverUpdatedAt === undefined) {
        // First sync for a legacy budget — record the server timestamp
        const updated = { ...merged[localIdx], serverUpdatedAt: sb.updatedAt };
        await putBudget(updated);
        merged[localIdx] = updated;
      }
    }

    setBudgets(merged);
    budgetsRef.current = merged;
    setSyncStatus("synced");
    setTimeout(() => setSyncStatus("idle"), 3000);

    await refreshSharedBudgets(merged);
  };

  const syncWorkspaces = async (did: string, localWs: WorkspaceRow[]) => {
    const serverWs = await listWorkspaces(did);
    if (!serverWs) return;
    const merged: WorkspaceRow[] = serverWs.map((sw) => ({
      id: sw.id,
      name: sw.name,
      budgetIds: sw.budgetIds,
      order: localWs.find((lw) => lw.id === sw.id)?.order ?? Date.now(),
    }));
    for (const lw of localWs) {
      if (lw.syncSource && !merged.find((m) => m.id === lw.id)) {
        merged.push(lw);
      }
    }
    for (const w of merged) await putWorkspace(w);
    setWorkspaces(merged.sort((a, b) => a.order - b.order));
  };

  const refreshSharedBudgets = async (currentBudgets: BudgetRow[]) => {
    const shared = currentBudgets.filter((b) => b.syncSource);
    if (shared.length === 0) return;

    for (const b of shared) {
      const src = b.syncSource!;
      const remote = await fetchByToken(src.token);
      if (!remote) continue;

      const base = b.serverUpdatedAt;
      const serverIsNewer = base === undefined
        ? remote.updatedAt > b.updatedAt
        : remote.updatedAt !== base;
      const localHasChanges = base !== undefined && b.updatedAt !== base;

      if (serverIsNewer && localHasChanges) {
        setConflicts((prev) =>
          prev.some((c) => c.budgetId === b.id) ? prev :
          [...prev, {
            budgetId: b.id,
            budgetTitle: b.title,
            localRow: b,
            serverData: remote.data,
            serverUpdatedAt: remote.updatedAt,
          }]
        );
        continue;
      }

      if (serverIsNewer) {
        let parsed: Partial<BudgetRow> = {};
        try { parsed = JSON.parse(remote.data) as Partial<BudgetRow>; } catch { /* keep */ }
        const updated: BudgetRow = {
          ...b,
          title: parsed.title ?? b.title,
          subtitle: parsed.subtitle ?? b.subtitle,
          income: Array.isArray(parsed.income) ? parsed.income : b.income,
          expenses: Array.isArray(parsed.expenses) ? parsed.expenses : b.expenses,
          updatedAt: remote.updatedAt,
          serverUpdatedAt: remote.updatedAt,
          syncSource: { token: src.token, canWrite: remote.canWrite },
          undoStack: [],
          redoStack: [],
          mode: parsed.mode === "recording" ? "recording" : "editing",
        };
        await putBudget(updated);
        setBudgets((arr) => arr.map((x) => (x.id === updated.id ? updated : x)));
      } else if (localHasChanges) {
        // Local has unsynced changes and server hasn't moved — re-queue push
        syncDirtyRef.current.add(`shared:${b.id}`);
        if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
        syncTimerRef.current = setTimeout(() => void flushSync(), SYNC_DEBOUNCE_MS);
      }
    }
  };

  const openBudgets = useMemo(
    () => budgets.filter((b) => !b.archived).sort((a, b) => a.order - b.order),
    [budgets],
  );
  const archivedBudgets = useMemo(
    () =>
      budgets
        .filter((b) => b.archived)
        .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0)),
    [budgets],
  );

  const active =
    budgets.find((b) => b.id === activeId && !b.archived) ?? openBudgets[0] ?? null;

  useEffect(() => {
    if (loaded) persistActiveId(active?.id ?? null);
  }, [active?.id, loaded]);

  useEffect(() => {
    budgetsRef.current = budgets;
  }, [budgets]);

  // Re-sync on reconnect
  useEffect(() => {
    const onOnline = () => {
      if (deviceIdRef.current) {
        void doInitialSync(deviceIdRef.current, budgetsRef.current);
      }
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SSE: open one EventSource per shared budget AND per owned budget with an active share link.
  // Keyed on a stable string so connections survive data-only state updates.
  const sharedTokensKey = useMemo(
    () =>
      [
        ...budgets
          .filter((b) => !!b.syncSource)
          .map((b) => `s:${b.id}:${b.syncSource!.token}`),
        ...budgets
          .filter((b) => !b.syncSource && !!b.roToken)
          .map((b) => `o:${b.id}:${b.roToken}`),
      ]
        .sort()
        .join(","),
    [budgets],
  );

  useEffect(() => {
    const current = budgetsRef.current;
    const sharedBudgets = current.filter((b) => !!b.syncSource);
    const ownedShared = current.filter((b) => !b.syncSource && !!b.roToken);
    if (sharedBudgets.length === 0 && ownedShared.length === 0) return;

    const sources: EventSource[] = [];

    function applyParsed(
      cur: BudgetRow,
      remoteData: string,
      remoteUpdatedAt: number,
    ): Partial<BudgetRow> | null {
      if (remoteUpdatedAt <= cur.updatedAt) return null;
      let parsed: Partial<BudgetRow> = {};
      try { parsed = JSON.parse(remoteData) as Partial<BudgetRow>; } catch { /* keep */ }
      return {
        title: typeof parsed.title === "string" ? parsed.title : cur.title,
        subtitle: typeof parsed.subtitle === "string" ? parsed.subtitle : cur.subtitle,
        income: Array.isArray(parsed.income) ? parsed.income : cur.income,
        expenses: Array.isArray(parsed.expenses) ? parsed.expenses : cur.expenses,
        updatedAt: remoteUpdatedAt,
        serverUpdatedAt: remoteUpdatedAt,
        undoStack: [],
        redoStack: [],
        mode: parsed.mode === "recording" ? "recording" : "editing",
      };
    }

    function checkSseConflict(cur: BudgetRow, remoteData: string, remoteUpdatedAt: number): boolean {
      const base = cur.serverUpdatedAt;
      if (base === undefined) return false;
      const localChanged = cur.updatedAt !== base;
      const serverChanged = remoteUpdatedAt !== base;
      if (!localChanged || !serverChanged) return false;
      setConflicts((prev) =>
        prev.some((c) => c.budgetId === cur.id) ? prev :
        [...prev, {
          budgetId: cur.id,
          budgetTitle: cur.title,
          localRow: cur,
          serverData: remoteData,
          serverUpdatedAt: remoteUpdatedAt,
        }]
      );
      return true;
    }

    // ── Shared (recipient) budgets ─────────────────────────────────────────
    for (const b of sharedBudgets) {
      const token = b.syncSource!.token;
      const budgetId = b.id;
      const es = new EventSource(`/api/watch/${token}`);

      es.onopen = () => {
        void fetchByToken(token).then((remote) => {
          if (!remote) return;
          const cur = budgetsRef.current.find((x) => x.id === budgetId);
          if (!cur?.syncSource) return;
          if (checkSseConflict(cur, remote.data, remote.updatedAt)) return;
          setBudgets((arr) => {
            const latest = arr.find((x) => x.id === budgetId);
            if (!latest?.syncSource) return arr;
            const patch = applyParsed(latest, remote.data, remote.updatedAt);
            if (!patch) return arr;
            const updated: BudgetRow = {
              ...latest, ...patch,
              syncSource: { token, canWrite: remote.canWrite },
            };
            void putBudget(updated);
            return arr.map((x) => (x.id === budgetId ? updated : x));
          });
        });
      };

      es.onmessage = (event) => {
        const payload = JSON.parse(event.data as string) as { data: string; updatedAt: number };
        const cur = budgetsRef.current.find((x) => x.id === budgetId);
        if (!cur?.syncSource) return;
        if (checkSseConflict(cur, payload.data, payload.updatedAt)) return;
        setBudgets((arr) => {
          const latest = arr.find((x) => x.id === budgetId);
          if (!latest?.syncSource) return arr;
          const patch = applyParsed(latest, payload.data, payload.updatedAt);
          if (!patch) return arr;
          const updated: BudgetRow = { ...latest, ...patch, syncSource: latest.syncSource };
          void putBudget(updated);
          return arr.map((x) => (x.id === budgetId ? updated : x));
        });
      };

      sources.push(es);
    }

    // ── Owned budgets with active share links (owner sees editor edits live) ─
    for (const b of ownedShared) {
      const token = b.roToken!;
      const budgetId = b.id;
      const es = new EventSource(`/api/watch/${token}`);

      es.onopen = () => {
        void fetchByToken(token).then((remote) => {
          if (!remote) return;
          const cur = budgetsRef.current.find((x) => x.id === budgetId);
          if (!cur || cur.syncSource) return;
          if (checkSseConflict(cur, remote.data, remote.updatedAt)) return;
          setBudgets((arr) => {
            const latest = arr.find((x) => x.id === budgetId);
            if (!latest || latest.syncSource) return arr;
            const patch = applyParsed(latest, remote.data, remote.updatedAt);
            if (!patch) return arr;
            const updated: BudgetRow = { ...latest, ...patch };
            void putBudget(updated);
            return arr.map((x) => (x.id === budgetId ? updated : x));
          });
        });
      };

      es.onmessage = (event) => {
        const payload = JSON.parse(event.data as string) as { data: string; updatedAt: number };
        const cur = budgetsRef.current.find((x) => x.id === budgetId);
        if (!cur || cur.syncSource) return;
        if (checkSseConflict(cur, payload.data, payload.updatedAt)) return;
        setBudgets((arr) => {
          const latest = arr.find((x) => x.id === budgetId);
          if (!latest || latest.syncSource) return arr;
          const patch = applyParsed(latest, payload.data, payload.updatedAt);
          if (!patch) return arr;
          const updated: BudgetRow = { ...latest, ...patch };
          void putBudget(updated);
          return arr.map((x) => (x.id === budgetId ? updated : x));
        });
      };

      sources.push(es);
    }

    return () => { for (const es of sources) es.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedTokensKey]);

  // ── Workspace SSE: subscribe to structure + budget-data events ─────────────
  const wsTokensKey = useMemo(
    () =>
      workspaces
        .filter((w) => !!w.syncSource)
        .map((w) => `${w.id}:${w.syncSource!.token}`)
        .sort()
        .join(","),
    [workspaces],
  );

  useEffect(() => {
    const sharedWs = workspaces.filter((w) => !!w.syncSource);
    if (sharedWs.length === 0) return;

    const sources: EventSource[] = [];

    for (const ws of sharedWs) {
      const { token, canWrite } = ws.syncSource!;
      const wsId = ws.id;

      const es = new EventSource(`/api/wwatch/${token}`);

      es.onmessage = (event) => {
        type WsPayload =
          | { type: "structure"; serverBudgetIds: string[] }
          | { type: "budget"; budgetId: string; data: string; updatedAt: number };
        const payload = JSON.parse(event.data as string) as WsPayload;

        if (payload.type === "structure") {
          // Re-fetch the full workspace to get data for any newly-added budgets
          void fetchWorkspaceByToken(token).then((result) => {
            if (!result) return;

            setBudgets((arr) => {
              const currentServerIds = new Set(
                arr
                  .filter((b) => b.syncSource?.token === token && b.syncSource.workspaceBudgetId)
                  .map((b) => b.syncSource!.workspaceBudgetId!),
              );

              const newRemote = result.budgets.filter((rb) => !currentServerIds.has(rb.id));
              const removedServerIds = new Set(
                [...currentServerIds].filter((id) => !payload.serverBudgetIds.includes(id)),
              );

              const added: BudgetRow[] = newRemote.map((rb) => {
                let parsed: Partial<BudgetRow> = {};
                try { parsed = JSON.parse(rb.data) as Partial<BudgetRow>; } catch { /* keep */ }
                return {
                  id: uuid(),
                  title: typeof parsed.title === "string" ? parsed.title : "Shared Budget",
                  subtitle: typeof parsed.subtitle === "string" ? parsed.subtitle : "",
                  income: sanitizeEntries(parsed.income),
                  expenses: sanitizeEntries(parsed.expenses),
                  archived: false,
                  updatedAt: rb.updatedAt,
                  order: Date.now(),
                  syncSource: { token, canWrite, workspaceBudgetId: rb.id },
                  undoStack: [],
                  redoStack: [],
                };
              });
              for (const b of added) void putBudget(b);

              const removedLocalIds = arr
                .filter((b) => b.syncSource?.token === token && removedServerIds.has(b.syncSource.workspaceBudgetId ?? ""))
                .map((b) => b.id);
              for (const id of removedLocalIds) void deleteBudget(id);

              const next = [...arr.filter((b) => !removedLocalIds.includes(b.id)), ...added];

              // Keep workspace budgetIds in sync
              setWorkspaces((wsList) =>
                wsList.map((w) => {
                  if (w.id !== wsId) return w;
                  const keep = (w.budgetIds ?? []).filter((bid) => !removedLocalIds.includes(bid));
                  const updated = { ...w, budgetIds: [...keep, ...added.map((b) => b.id)] };
                  void putWorkspace(updated);
                  return updated;
                }),
              );

              return next;
            });
          });
        } else if (payload.type === "budget") {
          const wsCur = budgetsRef.current.find(
            (b) => b.syncSource?.token === token && b.syncSource.workspaceBudgetId === payload.budgetId,
          );
          if (wsCur) {
            const base = wsCur.serverUpdatedAt;
            const localChanged = base !== undefined && wsCur.updatedAt !== base;
            const serverChanged = base !== undefined && payload.updatedAt !== base;
            if (localChanged && serverChanged) {
              setConflicts((prev) =>
                prev.some((c) => c.budgetId === wsCur.id) ? prev :
                [...prev, {
                  budgetId: wsCur.id,
                  budgetTitle: wsCur.title,
                  localRow: wsCur,
                  serverData: payload.data,
                  serverUpdatedAt: payload.updatedAt,
                }]
              );
            } else {
              setBudgets((arr) => {
                const cur = arr.find(
                  (b) => b.syncSource?.token === token && b.syncSource.workspaceBudgetId === payload.budgetId,
                );
                if (!cur || payload.updatedAt <= cur.updatedAt) return arr;
                let parsed: Partial<BudgetRow> = {};
                try { parsed = JSON.parse(payload.data) as Partial<BudgetRow>; } catch { /* keep */ }
                const updated: BudgetRow = {
                  ...cur,
                  title: typeof parsed.title === "string" ? parsed.title : cur.title,
                  subtitle: typeof parsed.subtitle === "string" ? parsed.subtitle : cur.subtitle,
                  income: Array.isArray(parsed.income) ? parsed.income : cur.income,
                  expenses: Array.isArray(parsed.expenses) ? parsed.expenses : cur.expenses,
                  updatedAt: payload.updatedAt,
                  serverUpdatedAt: payload.updatedAt,
                  undoStack: [],
                  redoStack: [],
                };
                void putBudget(updated);
                return arr.map((b) => (b.id === cur.id ? updated : b));
              });
            }
          }
        }
      };

      sources.push(es);
    }

    return () => { for (const es of sources) es.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsTokensKey]);

  // Keep the ref pointing at the latest flushSync (which only uses other refs internally)
  // so the flush-on-hide effect below can be registered once without stale closure risk.
  useEffect(() => { flushSyncRef.current = flushSync; });

  // Flush any pending dirty writes when the tab hides or the window closes,
  // so shared-budget edits are not lost if the user navigates away before the debounce fires.
  useEffect(() => {
    const flush = () => { void flushSyncRef.current(); };
    const onVisChange = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onVisChange);
    window.addEventListener("beforeunload", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisChange);
      window.removeEventListener("beforeunload", flush);
    };
  }, []);

  const scheduleSync = (row: BudgetRow) => {
    const did = deviceIdRef.current;
    if (!did) return;

    if (row.syncSource?.canWrite) {
      // Shared budget with write access — debounce push
      syncDirtyRef.current.add(`shared:${row.id}`);
    } else if (!row.syncSource) {
      // Owned budget
      syncDirtyRef.current.add(row.id);
    }

    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => void flushSync(), SYNC_DEBOUNCE_MS);
  };

  const flushSync = async () => {
    const did = deviceIdRef.current;
    if (!did) return;

    const dirty = [...syncDirtyRef.current];
    syncDirtyRef.current.clear();
    if (dirty.length === 0) return;

    setSyncStatus("syncing");

    const ownedIds = dirty.filter((k) => !k.startsWith("shared:"));
    const sharedKeys = dirty.filter((k) => k.startsWith("shared:")).map((k) => k.slice(7));

    let ok = true;

    if (ownedIds.length > 0) {
      const toSync = budgetsRef.current
        .filter((b) => ownedIds.includes(b.id))
        .map((b) => ({
          id: b.id,
          data: serializeForSync(b),
          updatedAt: b.updatedAt,
          expectedUpdatedAt: b.serverUpdatedAt,
        }));
      const result = await syncOwnedBudgets(did, toSync);
      if (!result) {
        ownedIds.forEach((id) => syncDirtyRef.current.add(id));
        ok = false;
      } else {
        const conflictIds = new Set(result.conflicts.map((c) => c.id));
        for (const conflict of result.conflicts) {
          const localRow = budgetsRef.current.find((b) => b.id === conflict.id);
          if (localRow) {
            setConflicts((prev) =>
              prev.some((c) => c.budgetId === conflict.id) ? prev :
              [...prev, {
                budgetId: conflict.id,
                budgetTitle: localRow.title,
                localRow,
                serverData: conflict.data,
                serverUpdatedAt: conflict.updatedAt,
              }]
            );
          }
        }
        for (const b of budgetsRef.current.filter((b) => ownedIds.includes(b.id) && !conflictIds.has(b.id))) {
          const updated = { ...b, serverUpdatedAt: b.updatedAt };
          void putBudget(updated);
          setBudgets((arr) => arr.map((x) => (x.id === b.id ? { ...x, serverUpdatedAt: b.updatedAt } : x)));
        }
      }
    }

    for (const localId of sharedKeys) {
      const b = budgetsRef.current.find((x) => x.id === localId);
      if (!b?.syncSource?.canWrite || !did) continue;
      let pushResult: SharedPushResult;
      if (b.syncSource.workspaceBudgetId) {
        pushResult = await updateWorkspaceByToken(
          b.syncSource.token,
          b.syncSource.workspaceBudgetId,
          serializeForSync(b),
          b.updatedAt,
          b.serverUpdatedAt,
        );
      } else {
        pushResult = await updateByToken(
          b.syncSource.token,
          did,
          serializeForSync(b),
          b.updatedAt,
          b.serverUpdatedAt,
        );
      }
      if (pushResult === null) {
        syncDirtyRef.current.add(`shared:${localId}`);
        ok = false;
      } else if ("conflict" in pushResult) {
        setConflicts((prev) =>
          prev.some((c) => c.budgetId === b.id) ? prev :
          [...prev, {
            budgetId: b.id,
            budgetTitle: b.title,
            localRow: b,
            serverData: pushResult.serverData,
            serverUpdatedAt: pushResult.serverUpdatedAt,
          }]
        );
      } else {
        const updated = { ...b, serverUpdatedAt: b.updatedAt };
        void putBudget(updated);
        setBudgets((arr) => arr.map((x) => (x.id === b.id ? { ...x, serverUpdatedAt: b.updatedAt } : x)));
      }
    }

    setSyncStatus(ok ? "synced" : "error");
    if (ok) setTimeout(() => setSyncStatus("idle"), 3000);
  };

  const doForcePush = async () => {
    if (!active || !active.syncSource?.canWrite) return;
    setForcePushing(true);
    setSyncStatus("syncing");
    const data = serializeForSync(active);
    const updatedAt = Date.now();
    let ok = false;
    if (active.syncSource.workspaceBudgetId) {
      const result = await forcePushWorkspaceByToken(active.syncSource.token, active.syncSource.workspaceBudgetId, data, updatedAt);
      ok = !!result;
    } else {
      const result = await forcePushByToken(active.syncSource.token, deviceIdRef.current!, data, updatedAt);
      ok = !!result;
    }
    if (ok) {
      const updated = { ...active, updatedAt, serverUpdatedAt: updatedAt };
      void putBudget(updated);
      setBudgets((arr) => arr.map((b) => (b.id === active.id ? updated : b)));
      setSyncStatus("synced");
      setTimeout(() => setSyncStatus("idle"), 3000);
    } else {
      setSyncStatus("error");
    }
    setForcePushing(false);
    setForcePushOpen(false);
  };

  const persistRow = (row: BudgetRow) => {
    void putBudget(row);
    scheduleSync(row);
  };

  const snapOf = (b: BudgetRow): BudgetSnapshot => ({
    title: b.title,
    subtitle: b.subtitle,
    income: b.income,
    expenses: b.expenses,
  });

  const BURST_MS = 600;

  const updateActive = (patch: Partial<BudgetRow>, immediate = false) => {
    if (!active) return;

    if (immediate) {
      if (burstTimerRef.current) {
        clearTimeout(burstTimerRef.current);
        burstTimerRef.current = null;
      }
      const snapToPush = burstSnapRef.current ?? snapOf(active);
      burstSnapRef.current = null;
      burstBudgetIdRef.current = null;

      const updated: BudgetRow = {
        ...active,
        ...patch,
        undoStack: [...(active.undoStack ?? []), snapToPush].slice(-16),
        redoStack: [],
        updatedAt: Date.now(),
      };
      setBudgets((arr) => arr.map((b) => (b.id === updated.id ? updated : b)));
      persistRow(updated);
    } else {
      if (!burstSnapRef.current || burstBudgetIdRef.current !== active.id) {
        burstSnapRef.current = snapOf(active);
        burstBudgetIdRef.current = active.id;
      }

      if (burstTimerRef.current) clearTimeout(burstTimerRef.current);
      const budgetId = active.id;
      burstTimerRef.current = setTimeout(() => {
        burstTimerRef.current = null;
        const snap = burstSnapRef.current;
        burstSnapRef.current = null;
        burstBudgetIdRef.current = null;
        if (!snap) return;
        const latest = budgetsRef.current.find((b) => b.id === budgetId);
        if (!latest) return;
        const committed: BudgetRow = {
          ...latest,
          undoStack: [...(latest.undoStack ?? []), snap].slice(-16),
          redoStack: [],
        };
        setBudgets((arr) => arr.map((b) => (b.id === budgetId ? committed : b)));
        void putBudget(committed);
      }, BURST_MS);

      const updated: BudgetRow = { ...active, ...patch, redoStack: [], updatedAt: Date.now() };
      setBudgets((arr) => arr.map((b) => (b.id === updated.id ? updated : b)));
      persistRow(updated);
    }
  };

  const undo = () => {
    if (burstTimerRef.current) {
      clearTimeout(burstTimerRef.current);
      burstTimerRef.current = null;
    }
    const burstSnap = burstSnapRef.current;
    burstSnapRef.current = null;
    burstBudgetIdRef.current = null;

    const a =
      budgetsRef.current.find((b) => b.id === activeId && !b.archived) ??
      budgetsRef.current.filter((b) => !b.archived).sort((x, y) => x.order - y.order)[0] ??
      null;
    if (!a) return;

    if (burstSnap) {
      const restored: BudgetRow = { ...a, ...burstSnap, updatedAt: Date.now() };
      setBudgets((arr) => arr.map((b) => (b.id === restored.id ? restored : b)));
      persistRow(restored);
      return;
    }

    const undoStack = a.undoStack ?? [];
    if (!undoStack.length) return;
    const prev = undoStack[undoStack.length - 1];
    const restored: BudgetRow = {
      ...a,
      ...prev,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...(a.redoStack ?? []), snapOf(a)].slice(-16),
      updatedAt: Date.now(),
    };
    setBudgets((arr) => arr.map((b) => (b.id === restored.id ? restored : b)));
    persistRow(restored);
  };

  const redo = () => {
    if (burstTimerRef.current) {
      clearTimeout(burstTimerRef.current);
      burstTimerRef.current = null;
    }
    burstSnapRef.current = null;
    burstBudgetIdRef.current = null;

    const a =
      budgetsRef.current.find((b) => b.id === activeId && !b.archived) ??
      budgetsRef.current.filter((b) => !b.archived).sort((x, y) => x.order - y.order)[0] ??
      null;
    if (!a) return;

    const redoStack = a.redoStack ?? [];
    if (!redoStack.length) return;
    const next = redoStack[redoStack.length - 1];
    const restored: BudgetRow = {
      ...a,
      ...next,
      undoStack: [...(a.undoStack ?? []), snapOf(a)].slice(-16),
      redoStack: redoStack.slice(0, -1),
      updatedAt: Date.now(),
    };
    setBudgets((arr) => arr.map((b) => (b.id === restored.id ? restored : b)));
    persistRow(restored);
  };

  undoRef.current = undo;
  redoRef.current = redo;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undoRef.current();
      }
      if (e.key === "y" || (e.key === "z" && e.shiftKey)) {
        e.preventDefault();
        redoRef.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const moveTab = async (id: string, direction: -1 | 1) => {
    const idx = openBudgets.findIndex((b) => b.id === id);
    const newIdx = idx + direction;
    if (idx === -1 || newIdx < 0 || newIdx >= openBudgets.length) return;
    const next = [...openBudgets];
    const [moved] = next.splice(idx, 1);
    next.splice(newIdx, 0, moved);
    const base = Date.now();
    const updated = next.map((b, i) => ({ ...b, order: base + i }));
    setBudgets((arr) => arr.map((b) => updated.find((u) => u.id === b.id) ?? b));
    await Promise.all(updated.map(putBudget));
  };

  const addBudget = (b: BudgetRow) => {
    setBudgets((arr) => [...arr, b]);
    persistRow(b);
    setActiveIdState(b.id);
  };

  const newBudget = () =>
    addBudget(createBudget({ title: "Untitled budget", order: Date.now() }));

  const duplicateTab = (b: BudgetRow) => {
    addBudget(
      createBudget({
        title: `${b.title || "Untitled"} (copy)`,
        subtitle: b.subtitle,
        income: b.income.map((e) => ({ ...e, id: uuid() })),
        expenses: b.expenses.map((e) => ({ ...e, id: uuid() })),
        order: Date.now(),
      }),
    );
  };

  const requestCloseTab = (b: BudgetRow) => {
    setCloseTarget(b);
  };

  const confirmCloseTab = async () => {
    if (!closeTarget) return;
    const archived: BudgetRow = {
      ...closeTarget,
      archived: true,
      archivedAt: Date.now(),
      updatedAt: Date.now(),
    };
    await putBudget(archived);
    setBudgets((arr) => arr.map((b) => (b.id === archived.id ? archived : b)));
    if (activeId === archived.id) {
      const remaining = openBudgets.filter((b) => b.id !== archived.id);
      if (remaining.length > 0) {
        setActiveIdState(remaining[remaining.length - 1].id);
      } else {
        const nb = createBudget({ title: "Untitled budget" });
        await putBudget(nb);
        setBudgets((arr) => [...arr, nb]);
        setActiveIdState(nb.id);
      }
    }
    setCloseTarget(null);
  };

  const restoreArchived = async (b: BudgetRow) => {
    const restored: BudgetRow = {
      ...b,
      archived: false,
      archivedAt: undefined,
      order: Date.now(),
      updatedAt: Date.now(),
    };
    await putBudget(restored);
    setBudgets((arr) => arr.map((x) => (x.id === restored.id ? restored : x)));
    setActiveIdState(restored.id);
    setArchiveOpen(false);
  };

  const permanentlyDelete = async (b: BudgetRow) => {
    // Delete associated receipt files from the server before removing the budget
    const allEntries = [...b.expenses, ...b.income];
    for (const entry of allEntries) {
      for (const tx of entry.transactions ?? []) {
        if (tx.receiptUrl) {
          const filename = tx.receiptUrl.split("/").pop();
          if (filename) void fetch(`/api/receipts/${encodeURIComponent(filename)}`, { method: "DELETE" });
        }
      }
    }
    await deleteBudget(b.id);
    setBudgets((arr) => arr.filter((x) => x.id !== b.id));
  };

  const handleConflictKeepMine = (conflict: ConflictItem) => {
    const newUpdatedAt = Date.now();
    const updated: BudgetRow = { ...conflict.localRow, updatedAt: newUpdatedAt, serverUpdatedAt: newUpdatedAt };
    void putBudget(updated);
    setBudgets((arr) => arr.map((b) => (b.id === updated.id ? updated : b)));
    if (updated.syncSource?.canWrite) {
      syncDirtyRef.current.add(`shared:${updated.id}`);
    } else if (!updated.syncSource) {
      syncDirtyRef.current.add(updated.id);
    }
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => void flushSync(), SYNC_DEBOUNCE_MS);
    setConflicts((prev) => prev.filter((c) => c.budgetId !== conflict.budgetId));
  };

  const handleConflictUseTheirs = async (conflict: ConflictItem) => {
    let parsed: Partial<BudgetRow> = {};
    try { parsed = JSON.parse(conflict.serverData) as Partial<BudgetRow>; } catch { /* keep */ }
    const updated: BudgetRow = {
      ...conflict.localRow,
      title: typeof parsed.title === "string" ? parsed.title : conflict.localRow.title,
      subtitle: typeof parsed.subtitle === "string" ? parsed.subtitle : conflict.localRow.subtitle,
      income: Array.isArray(parsed.income) ? parsed.income : conflict.localRow.income,
      expenses: Array.isArray(parsed.expenses) ? parsed.expenses : conflict.localRow.expenses,
      updatedAt: conflict.serverUpdatedAt,
      serverUpdatedAt: conflict.serverUpdatedAt,
      undoStack: [],
      redoStack: [],
    };
    await putBudget(updated);
    setBudgets((arr) => arr.map((b) => (b.id === updated.id ? updated : b)));
    syncDirtyRef.current.delete(updated.id);
    syncDirtyRef.current.delete(`shared:${updated.id}`);
    setConflicts((prev) => prev.filter((c) => c.budgetId !== conflict.budgetId));
  };

  // budgetMode is stored on the active budget so it persists and syncs to all viewers
  const budgetMode = active?.mode ?? "editing";

  const totalIncome = useMemo(
    () => (active?.income ?? []).reduce((s, e) => s + (e.amount || 0), 0),
    [active?.income],
  );
  const totalExpenses = useMemo(
    () => (active?.expenses ?? []).reduce((s, e) => s + (e.amount || 0), 0),
    [active?.expenses],
  );

  // Recording-mode: remaining per income entry, accounting for transfers in/out and expense draws
  const incomeRemainingMap = useMemo<Record<string, number>>(() => {
    if (budgetMode !== "recording") return {};

    // Money drawn from each income entry by expense transactions
    const drawnByExpenses: Record<string, number> = {};
    for (const exp of active?.expenses ?? []) {
      for (const tx of exp.transactions ?? []) {
        if (tx.fromIncomeId) {
          drawnByExpenses[tx.fromIncomeId] = (drawnByExpenses[tx.fromIncomeId] ?? 0) + tx.amount;
        }
      }
    }

    // Money transferred into each income entry (income transactions on that entry)
    const transfersIn: Record<string, number> = {};
    // Money transferred out of an income entry (when another income entry lists it as source)
    const transfersOut: Record<string, number> = {};
    for (const inc of active?.income ?? []) {
      for (const tx of inc.transactions ?? []) {
        transfersIn[inc.id] = (transfersIn[inc.id] ?? 0) + tx.amount;
        if (tx.fromIncomeId) {
          transfersOut[tx.fromIncomeId] = (transfersOut[tx.fromIncomeId] ?? 0) + tx.amount;
        }
      }
    }

    const result: Record<string, number> = {};
    for (const inc of active?.income ?? []) {
      result[inc.id] =
        inc.amount +
        (transfersIn[inc.id] ?? 0) -
        (transfersOut[inc.id] ?? 0) -
        (drawnByExpenses[inc.id] ?? 0);
    }
    return result;
  }, [budgetMode, active?.income, active?.expenses]);

  const totalIncomeRecording = useMemo(
    () => Object.values(incomeRemainingMap).reduce((s, v) => s + v, 0),
    [incomeRemainingMap],
  );
  const totalExpensesRecording = useMemo(
    () => (active?.expenses ?? []).reduce((s, e) => {
      const spent = (e.transactions ?? []).reduce((sum, t) => sum + t.amount, 0);
      return s + (e.amount - spent);
    }, 0),
    [active?.expenses],
  );

  const displayTotalIncome   = budgetMode === "recording" ? totalIncomeRecording   : totalIncome;
  const displayTotalExpenses = budgetMode === "recording" ? totalExpensesRecording : totalExpenses;

  const leftover = displayTotalIncome - displayTotalExpenses;

  const chartData = [
    { name: budgetMode === "recording" ? "Remaining income" : "Total income", value: Math.max(displayTotalIncome, 0), color: "var(--chart-1)" },
    { name: budgetMode === "recording" ? "Remaining budget" : "Total expenses", value: Math.max(displayTotalExpenses, 0), color: "var(--chart-2)" },
    { name: "Left over", value: Math.max(leftover, 0), color: "var(--chart-3)" },
  ].filter((d) => d.value > 0);

  const handleExport = () => {
    if (!active) return;
    const payload = {
      type: "lovable-budget",
      version: 1,
      title: active.title,
      subtitle: active.subtitle,
      income: active.income,
      expenses: active.expenses,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName = (active.title || "budget").replace(/[^\w\-]+/g, "_").toLowerCase();
    a.href = url;
    a.download = `${safeName}.budget.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setImportError(null);
    try {
      const imported: BudgetRow[] = [];
      let i = 0;
      for (const file of files) {
        const text = await file.text();
        const data = JSON.parse(text) as Record<string, unknown>;
        const b = createBudget({
          title:
            typeof data.title === "string"
              ? data.title
              : file.name.replace(/\.budget\.json$|\.json$/i, ""),
          subtitle: typeof data.subtitle === "string" ? data.subtitle : "",
          income: sanitizeEntries(data.income),
          expenses: sanitizeEntries(data.expenses),
          order: Date.now() + i++,
        });
        imported.push(b);
        await putBudget(b);
      }
      setBudgets((arr) => [...arr, ...imported]);
      setActiveIdState(imported[imported.length - 1].id);
    } catch {
      setImportError("Could not read that file. Please pick a valid .budget.json file.");
    }
  };

  // Share dialog handlers
  const openShareDialog = async (budgetId: string) => {
    setShareLinks(null);
    setShareOpen(budgetId);
    if (!deviceId) return;
    setShareLinksLoading(true);
    const links = await getShareLinks(budgetId, deviceId);
    setShareLinks(links);
    if (links) {
      // Persist roToken so the SSE effect can subscribe the owner to editor updates
      setBudgets((arr) =>
        arr.map((b) => {
          if (b.id !== budgetId || b.syncSource || b.roToken === links.roToken) return b;
          const updated = { ...b, roToken: links.roToken };
          void putBudget(updated);
          return updated;
        }),
      );
    }
    setShareLinksLoading(false);
  };

  const handleRevokeLinks = async () => {
    if (!shareOpen || !deviceId) return;
    setShareLinksLoading(true);
    await revokeShareLinks(shareOpen, deviceId);
    setShareLinks(null);
    setBudgets((arr) =>
      arr.map((b) => {
        if (b.id !== shareOpen || b.syncSource || !b.roToken) return b;
        const updated = { ...b, roToken: undefined };
        void putBudget(updated);
        return updated;
      }),
    );
    setShareLinksLoading(false);
  };

  const createNewWorkspace = async () => {
    if (!deviceId) return;
    const name = "New workspace";
    const result = await createWorkspace(name, deviceId);
    if (!result) return;
    const wRow: WorkspaceRow = { id: result.id, name: result.name, budgetIds: [], order: Date.now() };
    await putWorkspace(wRow);
    setWorkspaces((ws) => [...ws, wRow]);
    setExpandedWs((s) => new Set([...s, wRow.id]));
  };

  const renameWorkspaceFn = async (id: string, name: string) => {
    if (!deviceId) return;
    await renameWorkspace(id, name, deviceId);
    setWorkspaces((ws) => ws.map((w) => (w.id === id ? { ...w, name } : w)));
    const current = workspaces.find((w) => w.id === id);
    if (current) await putWorkspace({ ...current, name });
  };

  const deleteWorkspaceFn = async (id: string) => {
    if (!deviceId) return;
    await deleteWorkspaceAPI(id, deviceId);
    await deleteWorkspaceIDB(id);
    setWorkspaces((ws) => ws.filter((w) => w.id !== id));
  };

  const assignBudgetToWorkspace = async (budgetId: string, workspaceId: string) => {
    if (!deviceId) return;
    for (const w of workspaces) {
      if (w.budgetIds.includes(budgetId) && w.id !== workspaceId) {
        await removeBudgetFromWorkspace(w.id, budgetId, deviceId);
        const updated = { ...w, budgetIds: w.budgetIds.filter((id) => id !== budgetId) };
        await putWorkspace(updated);
        setWorkspaces((ws) => ws.map((x) => (x.id === w.id ? updated : x)));
      }
    }
    if (workspaceId === "") return;
    await addBudgetToWorkspace(workspaceId, budgetId, deviceId);
    const target = workspaces.find((w) => w.id === workspaceId);
    if (!target || target.budgetIds.includes(budgetId)) return;
    const updated = { ...target, budgetIds: [...target.budgetIds, budgetId] };
    await putWorkspace(updated);
    setWorkspaces((ws) => ws.map((x) => (x.id === workspaceId ? updated : x)));
  };

  const openWsShareDialog = async (workspaceId: string) => {
    setWsShareLinks(null);
    setWsShareOpen(workspaceId);
    if (!deviceId) return;
    setWsShareLoading(true);
    const links = await getWorkspaceLinks(workspaceId, deviceId);
    setWsShareLinks(links);
    setWsShareLoading(false);
  };

  const handleRevokeWsLinks = async () => {
    if (!wsShareOpen || !deviceId) return;
    setWsShareLoading(true);
    await revokeWorkspaceLinks(wsShareOpen, deviceId);
    setWsShareLinks(null);
    setWsShareLoading(false);
  };

  const copyLink = (text: string, setCopied: (v: boolean) => void) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!loaded || !active) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  const shareBudget = shareOpen ? budgets.find((b) => b.id === shareOpen) : null;
  const shareBase = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="min-h-screen bg-background flex">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      {sidebarOpen && (
        <aside className="fixed top-0 left-0 h-full z-50 w-56 border-r border-border bg-card flex flex-col lg:sticky lg:h-screen lg:shrink-0">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Budgets
            </span>
            <div className="flex items-center gap-1.5">
              <span title={syncStatus === "idle" ? "Sync idle" : syncStatus}>
                <SyncIcon status={syncStatus} />
              </span>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label="Close sidebar"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto py-1">
            {openBudgets
              .filter((b) => !workspaces.some((w) => w.budgetIds.includes(b.id)))
              .map((b) => {
                const isActive = b.id === active.id;
                const isShared = !!b.syncSource;
                const globalIdx = openBudgets.findIndex((x) => x.id === b.id);
                return (
                  <div
                    key={b.id}
                    onClick={() => setActiveIdState(b.id)}
                    className={`group flex items-center gap-1 px-2 py-1.5 mx-1 rounded cursor-pointer transition-colors ${
                      isActive
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    }`}
                  >
                    {isShared && (
                      <span title="Shared budget"><Link2 className="size-3 shrink-0 text-muted-foreground/60" /></span>
                    )}
                    <span className="flex-1 text-sm truncate">{b.title || "Untitled"}</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          onClick={(e) => e.stopPropagation()}
                          className="opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-muted rounded p-0.5 transition-opacity"
                          aria-label="Budget options"
                        >
                          <MoreHorizontal className="size-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem
                          disabled={globalIdx === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            void moveTab(b.id, -1);
                          }}
                        >
                          <ChevronUp className="size-3.5 mr-2" /> Move up
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={globalIdx === openBudgets.length - 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            void moveTab(b.id, 1);
                          }}
                        >
                          <ChevronDown className="size-3.5 mr-2" /> Move down
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            duplicateTab(b);
                          }}
                        >
                          <Copy className="size-3.5 mr-2" /> Duplicate
                        </DropdownMenuItem>
                        {!isShared && (
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              void openShareDialog(b.id);
                            }}
                          >
                            <Share2 className="size-3.5 mr-2" /> Share
                          </DropdownMenuItem>
                        )}
                        {!isShared && workspaces.length > 0 && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                setMoveToWsTarget(b.id);
                              }}
                            >
                              <FolderPlus className="size-3.5 mr-2" /> Move to workspace
                            </DropdownMenuItem>
                          </>
                        )}
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            requestCloseTab(b);
                          }}
                        >
                          <Archive className="size-3.5 mr-2" /> Archive
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}

            {workspaces.map((ws) => {
              const wsBudgets = ws.budgetIds
                .map((bid) => openBudgets.find((b) => b.id === bid))
                .filter(Boolean) as BudgetRow[];
              const expanded = expandedWs.has(ws.id);
              return (
                <div key={ws.id}>
                  <div
                    className="group flex items-center gap-1 px-2 py-1.5 mx-1 rounded cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() =>
                      setExpandedWs((s) => {
                        const n = new Set(s);
                        n.has(ws.id) ? n.delete(ws.id) : n.add(ws.id);
                        return n;
                      })
                    }
                  >
                    {expanded ? (
                      <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <FolderClosed className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="flex-1 text-sm truncate text-muted-foreground">{ws.name}</span>
                    {!ws.syncSource && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            onClick={(e) => e.stopPropagation()}
                            className="opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-muted rounded p-0.5 transition-opacity"
                            aria-label="Workspace options"
                          >
                            <MoreHorizontal className="size-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              void openWsShareDialog(ws.id);
                            }}
                          >
                            <Share2 className="size-3.5 mr-2" /> Share workspace
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              const b = createBudget({ title: "Untitled budget", order: Date.now() });
                              addBudget(b);
                              void assignBudgetToWorkspace(b.id, ws.id);
                              setExpandedWs((s) => new Set([...s, ws.id]));
                            }}
                          >
                            <Plus className="size-3.5 mr-2" /> New budget here
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              const name = prompt("Rename workspace", ws.name);
                              if (name?.trim()) void renameWorkspaceFn(ws.id, name.trim());
                            }}
                          >
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`Delete workspace "${ws.name}"? Budgets will not be deleted.`))
                                void deleteWorkspaceFn(ws.id);
                            }}
                          >
                            Delete folder
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                  {expanded &&
                    wsBudgets.map((b) => {
                      const isActive = b.id === active.id;
                      const isShared = !!b.syncSource;
                      const globalIdx = openBudgets.findIndex((x) => x.id === b.id);
                      return (
                        <div key={b.id} className="pl-4">
                          <div
                            onClick={() => setActiveIdState(b.id)}
                            className={`group flex items-center gap-1 px-2 py-1.5 mx-1 rounded cursor-pointer transition-colors ${
                              isActive
                                ? "bg-muted text-foreground"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                            }`}
                          >
                            {isShared && (
                              <span title="Shared budget"><Link2 className="size-3 shrink-0 text-muted-foreground/60" /></span>
                            )}
                            <span className="flex-1 text-sm truncate">{b.title || "Untitled"}</span>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  onClick={(e) => e.stopPropagation()}
                                  className="opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-muted rounded p-0.5 transition-opacity"
                                  aria-label="Budget options"
                                >
                                  <MoreHorizontal className="size-3.5" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start">
                                <DropdownMenuItem
                                  disabled={globalIdx === 0}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void moveTab(b.id, -1);
                                  }}
                                >
                                  <ChevronUp className="size-3.5 mr-2" /> Move up
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={globalIdx === openBudgets.length - 1}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void moveTab(b.id, 1);
                                  }}
                                >
                                  <ChevronDown className="size-3.5 mr-2" /> Move down
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    duplicateTab(b);
                                  }}
                                >
                                  <Copy className="size-3.5 mr-2" /> Duplicate
                                </DropdownMenuItem>
                                {!isShared && (
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void openShareDialog(b.id);
                                    }}
                                  >
                                    <Share2 className="size-3.5 mr-2" /> Share
                                  </DropdownMenuItem>
                                )}
                                {!isShared && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setMoveToWsTarget(b.id);
                                      }}
                                    >
                                      <FolderPlus className="size-3.5 mr-2" /> Move to workspace
                                    </DropdownMenuItem>
                                  </>
                                )}
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    requestCloseTab(b);
                                  }}
                                >
                                  <Archive className="size-3.5 mr-2" /> Archive
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      );
                    })}
                </div>
              );
            })}
          </nav>

          <div className="border-t border-border p-2 space-y-0.5">
            <button
              onClick={() => void createNewWorkspace()}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors"
            >
              <FolderPlus className="size-4" /> New workspace
            </button>
            <button
              onClick={newBudget}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors"
            >
              <Plus className="size-4" /> New budget
            </button>
            <button
              onClick={() => setArchiveOpen(true)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors"
            >
              <Archive className="size-4" />
              Archive
              {archivedBudgets.length > 0 && (
                <span className="ml-auto inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-muted text-foreground text-[10px] font-medium">
                  {archivedBudgets.length}
                </span>
              )}
            </button>
            <button
              onClick={handleImportClick}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors"
            >
              <Upload className="size-4" /> Import
            </button>
            <button
              onClick={handleExport}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors"
            >
              <Download className="size-4" /> Export
            </button>
          </div>
        </aside>
      )}

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {!sidebarOpen && (
          <div className="border-b border-border bg-card px-4 py-2">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Open sidebar"
            >
              <Menu className="size-4" />
            </button>
          </div>
        )}

        <div className="max-w-6xl mx-auto px-6 py-10">
          <header className="mb-8">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              multiple
              onChange={handleFileChange}
              className="hidden"
            />
            <input
              type="text"
              value={active.title}
              onChange={(e) => updateActive({ title: e.target.value })}
              placeholder="Untitled budget"
              readOnly={!!active.syncSource && !active.syncSource.canWrite}
              className="w-full bg-transparent text-4xl font-bold tracking-tight text-foreground outline-none focus:bg-card rounded px-1 -mx-1 read-only:cursor-default"
            />
            <input
              type="text"
              value={active.subtitle}
              onChange={(e) => updateActive({ subtitle: e.target.value })}
              placeholder="Add a subtitle (e.g. May 2026, household, trip to Japan…)"
              readOnly={!!active.syncSource && !active.syncSource.canWrite}
              className="mt-1 w-full bg-transparent text-sm text-muted-foreground outline-none focus:bg-card rounded px-1 -mx-1 placeholder:text-muted-foreground/60 read-only:cursor-default"
            />
            <button
              onClick={() => {
                if (!active) return;
                const newMode = budgetMode === "editing" ? "recording" : "editing";
                const updated = { ...active, mode: newMode as "editing" | "recording", updatedAt: Date.now() };
                setBudgets((arr) => arr.map((b) => (b.id === updated.id ? updated : b)));
                persistRow(updated);
              }}
              className={`mt-2 inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${
                budgetMode === "editing"
                  ? "bg-muted text-foreground border-border hover:bg-muted/70"
                  : "bg-primary/10 text-primary border-primary/30 hover:bg-primary/20"
              }`}
            >
              {budgetMode === "editing"
                ? <><PencilLine className="size-3" /> Editing budget</>
                : <><Receipt className="size-3" /> Recording transactions</>}
            </button>
            {active.syncSource && (
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Link2 className="size-3 shrink-0" />
                <span>Shared · {active.syncSource.canWrite ? "can edit" : "read only"}</span>
                <span className="flex items-center gap-1 text-emerald-500 font-medium">
                  <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                  Live
                </span>
                {active.syncSource.canWrite && (
                  <button
                    onClick={() => setForcePushOpen(true)}
                    className="ml-1 flex items-center gap-1 px-2 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 transition-colors"
                    title="Force push: override server with your local version"
                  >
                    <CloudUpload className="size-3" />
                    Push
                  </button>
                )}
              </div>
            )}
          </header>

          {importError && (
            <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 text-destructive px-3 py-2 text-sm">
              {importError}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-6">
              <BudgetTable
                title="Money In"
                variant="income"
                entries={active.income}
                onChange={(income, immediate) => updateActive({ income }, immediate)}
                totalLabel={budgetMode === "recording" ? "Remaining income" : "Total income"}
                total={displayTotalIncome}
                mode={budgetMode}
                remainingOverrides={budgetMode === "recording" ? incomeRemainingMap : undefined}
                incomeEntries={budgetMode === "recording" ? active.income : undefined}
                readOnly={!!active.syncSource && !active.syncSource.canWrite}
              />
              <BudgetTable
                title="Money Out"
                variant="expense"
                entries={active.expenses}
                onChange={(expenses, immediate) => updateActive({ expenses }, immediate)}
                totalLabel={budgetMode === "recording" ? "Remaining budget" : "Total expenses"}
                total={displayTotalExpenses}
                mode={budgetMode}
                incomeEntries={budgetMode === "recording" ? active.income.filter((e) => e.label.trim() !== "") : undefined}
                incomeRemaining={budgetMode === "recording" ? incomeRemainingMap : undefined}
                readOnly={!!active.syncSource && !active.syncSource.canWrite}
              />
            </div>

            <div className="space-y-6">
              <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
                <div className="bg-leftover text-leftover-foreground px-4 py-2.5 text-sm font-semibold tracking-wide uppercase">
                  Money Left Over
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm font-medium">
                    {budgetMode === "recording" ? "Remaining income vs remaining budget" : "Income minus expenses"}
                  </span>
                  <span
                    className={`text-lg font-semibold tabular-nums ${leftover < 0 ? "text-destructive" : "text-foreground"}`}
                  >
                    {fmt(leftover)}
                  </span>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground text-center mb-4">
                  Income / Expenses
                </h2>
                <div className="h-72">
                  {chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={chartData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={100}
                          label={({ value }: { value: number }) => fmt(value)}
                          labelLine={false}
                        >
                          {chartData.map((entry, i) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "var(--popover)",
                            border: "1px solid var(--border)",
                            borderRadius: "0.5rem",
                            fontSize: "0.875rem",
                          }}
                          formatter={(v: number) => fmt(v)}
                        />
                        <Legend iconType="circle" wrapperStyle={{ fontSize: "0.75rem" }} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                      Add income or expenses to see the chart.
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <Stat label={budgetMode === "recording" ? "Rem. income" : "Income"} value={displayTotalIncome} colorVar="--income" />
                  <Stat label={budgetMode === "recording" ? "Rem. budget" : "Expenses"} value={displayTotalExpenses} colorVar="--expense" />
                  <Stat label="Left over" value={leftover} colorVar="--leftover" />
                </div>
              </div>
            </div>
          </div>

          <footer className="mt-10 text-center text-xs text-muted-foreground">
            Saved locally · Synced online when connected · Share budgets via read-only or editable links
            <span className="ml-2 opacity-50">v{__APP_VERSION__}</span>
          </footer>
        </div>
      </div>

      {/* Floating undo/redo bar */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 rounded-full border border-border bg-card/90 backdrop-blur-sm shadow-lg px-2 py-1.5">
        <button
          onClick={undo}
          disabled={!active.undoStack?.length}
          className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
        >
          <Undo2 className="size-4" />
        </button>
        <span className="text-xs text-muted-foreground/60 w-10 text-center tabular-nums select-none">
          {active.undoStack?.length ?? 0} / 16
        </span>
        <button
          onClick={redo}
          disabled={!active.redoStack?.length}
          className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Redo (Ctrl+Y)"
          aria-label="Redo"
        >
          <Redo2 className="size-4" />
        </button>
      </div>

      {/* ── Close/archive confirmation ─────────────────────────────── */}
      <Dialog open={!!closeTarget} onOpenChange={(o) => { if (!o) setCloseTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Archive this budget?</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{closeTarget?.title || "Untitled"}</span>
              {" "}will be moved to the archive. You can restore it any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={() => setCloseTarget(null)}
              className="inline-flex items-center gap-2 bg-card border border-border rounded-md px-3 py-2 text-sm hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={confirmCloseTab}
              className="inline-flex items-center gap-2 bg-destructive text-destructive-foreground rounded-md px-3 py-2 text-sm hover:bg-destructive/90 transition-colors"
            >
              <Archive className="size-4" /> Archive
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Archive dialog ─────────────────────────────────────────── */}
      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Archived budgets</DialogTitle>
            <DialogDescription>
              Restore an archived budget to reopen it as a tab, or permanently delete it.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1">
            {archivedBudgets.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">
                No archived budgets.
              </div>
            ) : (
              <ul className="space-y-2">
                {archivedBudgets.map((b) => (
                  <li
                    key={b.id}
                    className="flex items-center gap-3 border border-border rounded-md px-3 py-2"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{b.title || "Untitled"}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {b.subtitle || "—"}
                        {b.archivedAt
                          ? ` · archived ${new Date(b.archivedAt).toLocaleDateString()}`
                          : ""}
                      </div>
                    </div>
                    <button
                      onClick={() => restoreArchived(b)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-border rounded hover:bg-muted"
                    >
                      <RotateCcw className="size-3.5" /> Restore
                    </button>
                    <button
                      onClick={() => {
                        if (
                          confirm(
                            `Permanently delete "${b.title || "Untitled"}"? This cannot be undone.`,
                          )
                        ) {
                          void permanentlyDelete(b);
                        }
                      }}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-destructive/40 text-destructive rounded hover:bg-destructive/10"
                    >
                      <Trash2 className="size-3.5" /> Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Move to workspace dialog ───────────────────────────────── */}
      <Dialog open={!!moveToWsTarget} onOpenChange={(o) => { if (!o) setMoveToWsTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Move to workspace</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            {workspaces.filter((w) => !w.syncSource).map((ws) => (
              <button
                key={ws.id}
                onClick={() => { void assignBudgetToWorkspace(moveToWsTarget!, ws.id); setMoveToWsTarget(null); }}
                className="w-full text-left px-3 py-2 rounded hover:bg-muted text-sm flex items-center gap-2"
              >
                <FolderClosed className="size-4" /> {ws.name}
              </button>
            ))}
            {workspaces.filter((w) => !w.syncSource).length === 0 && (
              <p className="text-sm text-muted-foreground px-3">No workspaces yet. Create one first.</p>
            )}
          </div>
          {workspaces.some((w) => w.budgetIds.includes(moveToWsTarget ?? "")) && (
            <button
              onClick={() => { void assignBudgetToWorkspace(moveToWsTarget!, ""); setMoveToWsTarget(null); }}
              className="w-full text-left px-3 py-2 rounded hover:bg-muted text-sm text-muted-foreground"
            >
              Remove from workspace
            </button>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Workspace share dialog ─────────────────────────────────── */}
      <Dialog open={!!wsShareOpen} onOpenChange={(o) => { if (!o) setWsShareOpen(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Share workspace</DialogTitle>
            <DialogDescription>
              Share this workspace folder. Read-only viewers can see all budgets. Editors can also make changes.
            </DialogDescription>
          </DialogHeader>
          {wsShareLoading && (
            <div className="flex justify-center py-6">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {!wsShareLoading && wsShareLinks && (
            <div className="space-y-3">
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Read-only link</div>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={`${shareBase}/share/w/${wsShareLinks.roToken}`}
                    className="flex-1 min-w-0 text-xs font-mono bg-muted/40 border border-border rounded-md px-2 py-1.5 text-muted-foreground truncate outline-none"
                  />
                  <button
                    onClick={() => copyLink(`${shareBase}/share/w/${wsShareLinks.roToken}`, setWsRoCopied)}
                    className="shrink-0 inline-flex items-center gap-1 border border-border rounded-md px-2 py-1.5 text-xs hover:bg-muted transition-colors"
                  >
                    {wsRoCopied ? <Check className="size-3 text-emerald-500" /> : <Link2 className="size-3" />}
                    {wsRoCopied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Editor link</div>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={`${shareBase}/share/w/${wsShareLinks.rwToken}`}
                    className="flex-1 min-w-0 text-xs font-mono bg-muted/40 border border-border rounded-md px-2 py-1.5 text-muted-foreground truncate outline-none"
                  />
                  <button
                    onClick={() => copyLink(`${shareBase}/share/w/${wsShareLinks.rwToken}`, setWsRwCopied)}
                    className="shrink-0 inline-flex items-center gap-1 border border-border rounded-md px-2 py-1.5 text-xs hover:bg-muted transition-colors"
                  >
                    {wsRwCopied ? <Check className="size-3 text-emerald-500" /> : <Link2 className="size-3" />}
                    {wsRwCopied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
              <button
                onClick={() => void handleRevokeWsLinks()}
                className="w-full inline-flex items-center justify-center gap-2 border border-destructive/40 text-destructive rounded-md px-3 py-2 text-sm hover:bg-destructive/10 transition-colors mt-1"
              >
                Revoke all workspace links
              </button>
            </div>
          )}
          {!wsShareLoading && !wsShareLinks && wsShareOpen && (
            <p className="text-sm text-muted-foreground text-center py-2">
              Failed to generate links. Check your connection and try again.
            </p>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Share dialog ───────────────────────────────────────────── */}
      <Dialog open={!!shareOpen} onOpenChange={(o) => { if (!o) setShareOpen(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="size-4" /> Share Budget
            </DialogTitle>
            <DialogDescription>
              Share <span className="font-medium">{shareBudget?.title || "this budget"}</span> via
              a link. Anyone with the link can access it.
            </DialogDescription>
          </DialogHeader>

          {shareLinksLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : shareLinks ? (
            <div className="space-y-3">
              {(
                [
                  { label: "View only", token: shareLinks.roToken, copied: roCopied, setCopied: setRoCopied },
                  { label: "Can edit", token: shareLinks.rwToken, copied: rwCopied, setCopied: setRwCopied },
                ] as const
              ).map(({ label, token, copied, setCopied }) => (
                <div key={token} className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">{label}</p>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={`${shareBase}/share/${token}`}
                      className="flex-1 min-w-0 text-xs font-mono bg-muted/40 border border-border rounded-md px-2 py-1.5 text-muted-foreground truncate outline-none"
                    />
                    <button
                      onClick={() => copyLink(`${shareBase}/share/${token}`, setCopied)}
                      className="shrink-0 inline-flex items-center gap-1 border border-border rounded-md px-2 py-1.5 text-xs hover:bg-muted transition-colors"
                    >
                      {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
              ))}
              <button
                onClick={handleRevokeLinks}
                className="w-full inline-flex items-center justify-center gap-2 border border-destructive/40 text-destructive rounded-md px-3 py-2 text-sm hover:bg-destructive/10 transition-colors mt-1"
              >
                Revoke all links
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-2">
              Failed to generate links. Check your connection and try again.
            </p>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Force push confirmation dialog ─────────────────────────── */}
      <Dialog open={forcePushOpen} onOpenChange={(o) => { if (!o && !forcePushing) setForcePushOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Force push to all users?</DialogTitle>
            <DialogDescription>
              Your local version of <span className="font-medium text-foreground">{active?.title || "this budget"}</span> will be pushed to the server and will override any changes made by other users. Everyone with access will receive your version on their next sync.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={() => setForcePushOpen(false)}
              disabled={forcePushing}
              className="px-4 py-2 rounded-md border border-border text-sm hover:bg-muted disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => void doForcePush()}
              disabled={forcePushing}
              className="px-4 py-2 rounded-md bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              {forcePushing ? <Loader2 className="size-4 animate-spin" /> : <CloudUpload className="size-4" />}
              {forcePushing ? "Pushing…" : "Force Push"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Conflict resolution dialog ─────────────────────────────── */}
      {conflicts.length > 0 && (
        <ConflictDialog
          conflict={conflicts[0]}
          remaining={conflicts.length - 1}
          onKeepMine={() => handleConflictKeepMine(conflicts[0])}
          onUseTheirs={() => void handleConflictUseTheirs(conflicts[0])}
        />
      )}

    </div>
  );
}

function ConflictDialog({
  conflict,
  remaining,
  onKeepMine,
  onUseTheirs,
}: {
  conflict: ConflictItem;
  remaining: number;
  onKeepMine: () => void;
  onUseTheirs: () => void;
}) {
  const local = conflict.localRow;
  const localIncome = (local.income ?? []).reduce((s, e) => s + (e.amount || 0), 0);
  const localExpenses = (local.expenses ?? []).reduce((s, e) => s + (e.amount || 0), 0);

  let serverParsed: Partial<BudgetRow> = {};
  try { serverParsed = JSON.parse(conflict.serverData) as Partial<BudgetRow>; } catch { /* keep */ }
  const serverIncome = Array.isArray(serverParsed.income)
    ? serverParsed.income.reduce((s: number, e: { amount?: number }) => s + (e.amount || 0), 0)
    : 0;
  const serverExpenses = Array.isArray(serverParsed.expenses)
    ? serverParsed.expenses.reduce((s: number, e: { amount?: number }) => s + (e.amount || 0), 0)
    : 0;

  return (
    <Dialog open>
      <DialogContent className="max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Sync conflict in &quot;{conflict.budgetTitle}&quot;</DialogTitle>
          <DialogDescription>
            This budget was edited on two devices while offline. Choose which version to keep.
            {remaining > 0 && (
              <span className="ml-1 text-muted-foreground">({remaining} more conflict{remaining > 1 ? "s" : ""} queued)</span>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 my-2">
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1">
            <div className="text-xs font-semibold text-foreground">Your version</div>
            <div className="text-xs text-muted-foreground">{(local.income ?? []).length} income · {(local.expenses ?? []).length} expenses</div>
            <div className="text-xs">Income: <span className="font-medium">{fmt(localIncome)}</span></div>
            <div className="text-xs">Expenses: <span className="font-medium">{fmt(localExpenses)}</span></div>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1">
            <div className="text-xs font-semibold text-foreground">Server version</div>
            <div className="text-xs text-muted-foreground">
              {Array.isArray(serverParsed.income) ? serverParsed.income.length : "?"} income · {Array.isArray(serverParsed.expenses) ? serverParsed.expenses.length : "?"} expenses
            </div>
            <div className="text-xs">Income: <span className="font-medium">{fmt(serverIncome)}</span></div>
            <div className="text-xs">Expenses: <span className="font-medium">{fmt(serverExpenses)}</span></div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <button
            onClick={onUseTheirs}
            className="flex-1 border border-border rounded-md px-3 py-2 text-sm hover:bg-muted transition-colors"
          >
            Use server version
          </button>
          <button
            onClick={onKeepMine}
            className="flex-1 bg-primary text-primary-foreground rounded-md px-3 py-2 text-sm hover:bg-primary/90 transition-colors"
          >
            Keep my changes
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({
  label,
  value,
  colorVar,
}: {
  label: string;
  value: number;
  colorVar: string;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className="text-xl font-semibold tabular-nums mt-1"
        style={{ color: `var(${colorVar})` }}
      >
        {fmt(value)}
      </div>
    </div>
  );
}
