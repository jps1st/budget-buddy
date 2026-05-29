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
  type BudgetRow,
  type BudgetSnapshot,
} from "@/lib/budget-storage";
import {
  syncOwnedBudgets,
  getShareLinks,
  revokeShareLinks,
  fetchByToken,
  updateByToken,
  type ShareLinks,
} from "@/lib/sync-api";

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

function gen6() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function serializeForSync(b: BudgetRow): string {
  const { undoStack: _u, redoStack: _r, syncSource: _s, ...rest } = b;
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
    order: parsed.order ?? Date.now(),
    undoStack: [],
    redoStack: [],
  };
}

type SyncStatus = "idle" | "syncing" | "synced" | "error";

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
  const [closeCode, setCloseCode] = useState("");
  const [closeInput, setCloseInput] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);

  // Sync state
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");

  // Share dialog state
  const [shareOpen, setShareOpen] = useState<string | null>(null); // budget id
  const [shareLinks, setShareLinks] = useState<ShareLinks | null>(null);
  const [shareLinksLoading, setShareLinksLoading] = useState(false);
  const [roCopied, setRoCopied] = useState(false);
  const [rwCopied, setRwCopied] = useState(false);

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
  const SYNC_DEBOUNCE_MS = 3000;

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

      // Initial remote sync in background
      void doInitialSync(did, finalRows);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doInitialSync = async (did: string, localRows: BudgetRow[]) => {
    const owned = localRows.filter((r) => !r.syncSource);
    const payload = owned.map((b) => ({
      id: b.id,
      data: serializeForSync(b),
      updatedAt: b.updatedAt,
    }));

    setSyncStatus("syncing");
    const result = await syncOwnedBudgets(did, payload);
    if (!result) {
      setSyncStatus("error");
      return;
    }

    // Merge server budgets into local state
    const merged: BudgetRow[] = [...localRows];
    for (const sb of result) {
      const localIdx = merged.findIndex((b) => b.id === sb.id);
      if (localIdx === -1) {
        const nb = deserializeFromSync(sb.id, sb.data, sb.updatedAt);
        await putBudget(nb);
        merged.push(nb);
      } else if (sb.updatedAt > merged[localIdx].updatedAt) {
        const nb = deserializeFromSync(sb.id, sb.data, sb.updatedAt);
        await putBudget(nb);
        merged[localIdx] = nb;
      }
    }

    setBudgets(merged);
    budgetsRef.current = merged;
    setSyncStatus("synced");
    setTimeout(() => setSyncStatus("idle"), 3000);

    // Also refresh shared budgets
    await refreshSharedBudgets(merged);
  };

  const refreshSharedBudgets = async (currentBudgets: BudgetRow[]) => {
    const shared = currentBudgets.filter((b) => b.syncSource);
    if (shared.length === 0) return;

    for (const b of shared) {
      const src = b.syncSource!;
      const remote = await fetchByToken(src.token);
      if (!remote) continue;
      if (remote.updatedAt > b.updatedAt) {
        let parsed: Partial<BudgetRow> = {};
        try { parsed = JSON.parse(remote.data) as Partial<BudgetRow>; } catch { /* keep */ }
        const updated: BudgetRow = {
          ...b,
          title: parsed.title ?? b.title,
          subtitle: parsed.subtitle ?? b.subtitle,
          income: Array.isArray(parsed.income) ? parsed.income : b.income,
          expenses: Array.isArray(parsed.expenses) ? parsed.expenses : b.expenses,
          updatedAt: remote.updatedAt,
          syncSource: { token: src.token, canWrite: remote.canWrite },
          undoStack: [],
          redoStack: [],
        };
        await putBudget(updated);
        setBudgets((arr) => arr.map((x) => (x.id === updated.id ? updated : x)));
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

  // SSE: open one EventSource per shared budget; re-open if the set of tokens changes.
  // A stable string key avoids closing/reopening when only budget *data* changes.
  const sharedTokensKey = useMemo(
    () =>
      budgets
        .filter((b) => !!b.syncSource)
        .map((b) => `${b.id}:${b.syncSource!.token}`)
        .sort()
        .join(","),
    [budgets],
  );

  useEffect(() => {
    const sharedBudgets = budgetsRef.current.filter((b) => !!b.syncSource);
    if (sharedBudgets.length === 0) return;

    const sources: EventSource[] = [];

    for (const b of sharedBudgets) {
      const token = b.syncSource!.token;
      const budgetId = b.id;
      const es = new EventSource(`/api/watch/${token}`);

      // On (re)connect fetch the latest state so we never miss an update
      // that happened while the connection was down.
      es.onopen = () => {
        void fetchByToken(token).then((remote) => {
          if (!remote) return;
          setBudgets((arr) => {
            const cur = arr.find((x) => x.id === budgetId);
            if (!cur?.syncSource || remote.updatedAt <= cur.updatedAt) return arr;
            let parsed: Partial<BudgetRow> = {};
            try { parsed = JSON.parse(remote.data) as Partial<BudgetRow>; } catch { /* keep */ }
            const updated: BudgetRow = {
              ...cur,
              title: typeof parsed.title === "string" ? parsed.title : cur.title,
              subtitle: typeof parsed.subtitle === "string" ? parsed.subtitle : cur.subtitle,
              income: Array.isArray(parsed.income) ? parsed.income : cur.income,
              expenses: Array.isArray(parsed.expenses) ? parsed.expenses : cur.expenses,
              updatedAt: remote.updatedAt,
              syncSource: { token, canWrite: remote.canWrite },
              undoStack: [],
              redoStack: [],
            };
            void putBudget(updated);
            return arr.map((x) => (x.id === budgetId ? updated : x));
          });
        });
      };

      // Push event: apply the incoming change immediately
      es.onmessage = (event) => {
        const payload = JSON.parse(event.data as string) as { data: string; updatedAt: number };
        setBudgets((arr) => {
          const cur = arr.find((x) => x.id === budgetId);
          if (!cur?.syncSource || payload.updatedAt <= cur.updatedAt) return arr;
          let parsed: Partial<BudgetRow> = {};
          try { parsed = JSON.parse(payload.data) as Partial<BudgetRow>; } catch { /* keep */ }
          const updated: BudgetRow = {
            ...cur,
            title: typeof parsed.title === "string" ? parsed.title : cur.title,
            subtitle: typeof parsed.subtitle === "string" ? parsed.subtitle : cur.subtitle,
            income: Array.isArray(parsed.income) ? parsed.income : cur.income,
            expenses: Array.isArray(parsed.expenses) ? parsed.expenses : cur.expenses,
            updatedAt: payload.updatedAt,
            syncSource: cur.syncSource,
            undoStack: [],
            redoStack: [],
          };
          void putBudget(updated);
          return arr.map((x) => (x.id === budgetId ? updated : x));
        });
      };

      sources.push(es);
    }

    return () => { for (const es of sources) es.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedTokensKey]);

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
          shareCode: b.shareCode ?? null,
        }));
      const result = await syncOwnedBudgets(did, toSync);
      if (!result) ok = false;
    }

    for (const localId of sharedKeys) {
      const b = budgetsRef.current.find((x) => x.id === localId);
      if (!b?.syncSource?.canWrite || !did) continue;
      const success = await updateByToken(
        b.syncSource.token,
        did,
        serializeForSync(b),
        b.updatedAt,
      );
      if (!success) ok = false;
    }

    setSyncStatus(ok ? "synced" : "error");
    if (ok) setTimeout(() => setSyncStatus("idle"), 3000);
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
    setCloseCode(gen6());
    setCloseInput("");
    setCloseTarget(b);
  };

  const confirmCloseTab = async () => {
    if (!closeTarget || closeInput !== closeCode) return;
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
    await deleteBudget(b.id);
    setBudgets((arr) => arr.filter((x) => x.id !== b.id));
  };

  const totalIncome = useMemo(
    () => (active?.income ?? []).reduce((s, e) => s + (e.amount || 0), 0),
    [active?.income],
  );
  const totalExpenses = useMemo(
    () => (active?.expenses ?? []).reduce((s, e) => s + (e.amount || 0), 0),
    [active?.expenses],
  );
  const leftover = totalIncome - totalExpenses;

  const chartData = [
    { name: "Total income", value: Math.max(totalIncome, 0), color: "var(--chart-1)" },
    { name: "Total expenses", value: Math.max(totalExpenses, 0), color: "var(--chart-2)" },
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
    setShareLinksLoading(false);
  };

  const handleRevokeLinks = async () => {
    if (!shareOpen || !deviceId) return;
    setShareLinksLoading(true);
    await revokeShareLinks(shareOpen, deviceId);
    setShareLinks(null);
    setShareLinksLoading(false);
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
            {openBudgets.map((b, idx) => {
              const isActive = b.id === active.id;
              const isShared = !!b.syncSource;
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
                        disabled={idx === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          void moveTab(b.id, -1);
                        }}
                      >
                        <ChevronUp className="size-3.5 mr-2" /> Move up
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={idx === openBudgets.length - 1}
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
          </nav>

          <div className="border-t border-border p-2 space-y-0.5">
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
            {active.syncSource && (
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Link2 className="size-3 shrink-0" />
                <span>Shared · {active.syncSource.canWrite ? "can edit" : "read only"}</span>
                <span className="flex items-center gap-1 text-emerald-500 font-medium">
                  <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                  Live
                </span>
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
                totalLabel="Total income"
                total={totalIncome}
              />
              <BudgetTable
                title="Money Out"
                variant="expense"
                entries={active.expenses}
                onChange={(expenses, immediate) => updateActive({ expenses }, immediate)}
                totalLabel="Total expenses"
                total={totalExpenses}
              />
            </div>

            <div className="space-y-6">
              <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
                <div className="bg-leftover text-leftover-foreground px-4 py-2.5 text-sm font-semibold tracking-wide uppercase">
                  Money Left Over
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm font-medium">Income minus expenses</span>
                  <span
                    className={`text-lg font-semibold tabular-nums ${leftover < 0 ? "text-destructive" : "text-foreground"}`}
                  >
                    {leftover.toFixed(2)}
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
                          label={({ value }: { value: number }) => value.toFixed(2)}
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
                          formatter={(v: number) => v.toFixed(2)}
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
                  <Stat label="Income" value={totalIncome} colorVar="--income" />
                  <Stat label="Expenses" value={totalExpenses} colorVar="--expense" />
                  <Stat label="Left over" value={leftover} colorVar="--leftover" />
                </div>
              </div>
            </div>
          </div>

          <footer className="mt-10 text-center text-xs text-muted-foreground">
            Saved locally · Synced online when connected · Share budgets via read-only or editable links
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive this budget?</DialogTitle>
            <DialogDescription>
              Closing a tab archives it. Type the 6-digit code below to confirm. You can restore it
              later from the archive.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm">
              Budget: <span className="font-medium">{closeTarget?.title || "Untitled"}</span>
            </div>
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-center">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Confirmation code
              </div>
              <div className="text-2xl font-mono tracking-[0.4em] tabular-nums">{closeCode}</div>
            </div>
            <input
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              autoFocus
              value={closeInput}
              onChange={(e) => setCloseInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="Enter the code"
              className="w-full text-center text-lg font-mono tracking-[0.4em] tabular-nums border border-input rounded-md px-3 py-2 bg-background outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <DialogFooter>
            <button
              onClick={() => setCloseTarget(null)}
              className="inline-flex items-center gap-2 bg-card border border-border rounded-md px-3 py-2 text-sm hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={confirmCloseTab}
              disabled={closeInput !== closeCode}
              className="inline-flex items-center gap-2 bg-destructive text-destructive-foreground rounded-md px-3 py-2 text-sm hover:bg-destructive/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Archive className="size-4" /> Archive tab
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

    </div>
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
        {value.toFixed(2)}
      </div>
    </div>
  );
}
