import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { Download, Upload, Plus, Archive, RotateCcw, Trash2, MoreHorizontal, Copy, ChevronUp, ChevronDown, Menu, X, Undo2, Redo2 } from "lucide-react";
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
  type BudgetRow,
  type BudgetSnapshot,
} from "@/lib/budget-storage";

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const budgetsRef = useRef<BudgetRow[]>([]);
  const burstSnapRef = useRef<BudgetSnapshot | null>(null);
  const burstTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const burstBudgetIdRef = useRef<string | null>(null);
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});

  // Load from IDB on mount
  useEffect(() => {
    (async () => {
      const [rows, meta] = await Promise.all([loadAll(), getMeta()]);
      if (rows.length === 0) {
        const b = createBudget();
        await putBudget(b);
        await persistActiveId(b.id);
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
    })();
  }, []);

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

  // Persist active id
  useEffect(() => {
    if (loaded) persistActiveId(active?.id ?? null);
  }, [active?.id, loaded]);

  // Keep budgets ref in sync for use inside timers
  useEffect(() => { budgetsRef.current = budgets; }, [budgets]);

  const persistRow = (row: BudgetRow) => {
    void putBudget(row);
  };

  const snapOf = (b: BudgetRow): BudgetSnapshot => ({
    title: b.title, subtitle: b.subtitle, income: b.income, expenses: b.expenses,
  });

  const BURST_MS = 600;

  const updateActive = (patch: Partial<BudgetRow>, immediate = false) => {
    if (!active) return;

    if (immediate) {
      // Cancel pending burst and use its pre-burst snapshot (or current state)
      if (burstTimerRef.current) { clearTimeout(burstTimerRef.current); burstTimerRef.current = null; }
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
      // Save the pre-burst snapshot on the first change of a new burst
      if (!burstSnapRef.current || burstBudgetIdRef.current !== active.id) {
        burstSnapRef.current = snapOf(active);
        burstBudgetIdRef.current = active.id;
      }

      // Reset burst timer — commit snapshot to history after quiet period
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

      // Apply the change immediately; clear redo so it can't be re-applied
      const updated: BudgetRow = { ...active, ...patch, redoStack: [], updatedAt: Date.now() };
      setBudgets((arr) => arr.map((b) => (b.id === updated.id ? updated : b)));
      persistRow(updated);
    }
  };

  const undo = () => {
    // Cancel pending burst — restore to pre-burst state
    if (burstTimerRef.current) { clearTimeout(burstTimerRef.current); burstTimerRef.current = null; }
    const burstSnap = burstSnapRef.current;
    burstSnapRef.current = null;
    burstBudgetIdRef.current = null;

    const a = budgetsRef.current.find((b) => b.id === activeId && !b.archived)
      ?? budgetsRef.current.filter((b) => !b.archived).sort((x, y) => x.order - y.order)[0]
      ?? null;
    if (!a) return;

    if (burstSnap) {
      // Undo the uncommitted burst — don't touch the undo/redo stacks
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
    // Discard any pending burst on redo
    if (burstTimerRef.current) { clearTimeout(burstTimerRef.current); burstTimerRef.current = null; }
    burstSnapRef.current = null;
    burstBudgetIdRef.current = null;

    const a = budgetsRef.current.find((b) => b.id === activeId && !b.archived)
      ?? budgetsRef.current.filter((b) => !b.archived).sort((x, y) => x.order - y.order)[0]
      ?? null;
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

  // Update stable refs each render so the keyboard handler always calls the latest versions
  undoRef.current = undo;
  redoRef.current = redo;

  // Keyboard shortcuts — registered once, uses refs to avoid stale closures
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "z" && !e.shiftKey) { e.preventDefault(); undoRef.current(); }
      if (e.key === "y" || (e.key === "z" && e.shiftKey)) { e.preventDefault(); redoRef.current(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const moveTab = async (id: string, direction: -1 | 1) => { // -1 = up, 1 = down
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
    // Pick a new active tab if needed
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
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
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
        const data = JSON.parse(text);
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

  if (!loaded || !active) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* Backdrop - mobile only, closes sidebar on tap */}
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
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Budgets</span>
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Close sidebar"
            >
              <X className="size-4" />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto py-1">
            {openBudgets.map((b, idx) => {
              const isActive = b.id === active.id;
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
                        onClick={(e) => { e.stopPropagation(); void moveTab(b.id, -1); }}
                      >
                        <ChevronUp className="size-3.5 mr-2" /> Move up
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={idx === openBudgets.length - 1}
                        onClick={(e) => { e.stopPropagation(); void moveTab(b.id, 1); }}
                      >
                        <ChevronDown className="size-3.5 mr-2" /> Move down
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={(e) => { e.stopPropagation(); duplicateTab(b); }}
                      >
                        <Copy className="size-3.5 mr-2" /> Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => { e.stopPropagation(); requestCloseTab(b); }}
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
            className="w-full bg-transparent text-4xl font-bold tracking-tight text-foreground outline-none focus:bg-card rounded px-1 -mx-1"
          />
          <input
            type="text"
            value={active.subtitle}
            onChange={(e) => updateActive({ subtitle: e.target.value })}
            placeholder="Add a subtitle (e.g. May 2026, household, trip to Japan…)"
            className="mt-1 w-full bg-transparent text-sm text-muted-foreground outline-none focus:bg-card rounded px-1 -mx-1 placeholder:text-muted-foreground/60"
          />
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
                        label={({ value }) => value.toFixed(2)}
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
          Saved automatically in IndexedDB · Import or export to share budgets as .budget.json files
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

      {/* Close confirmation dialog */}
      <Dialog
        open={!!closeTarget}
        onOpenChange={(o) => {
          if (!o) setCloseTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive this budget?</DialogTitle>
            <DialogDescription>
              Closing a tab archives it. Type the 6-digit code below to confirm.
              You can restore it later from the archive.
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
              <div className="text-2xl font-mono tracking-[0.4em] tabular-nums">
                {closeCode}
              </div>
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

      {/* Archive dialog */}
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
                      <div className="text-sm font-medium truncate">
                        {b.title || "Untitled"}
                      </div>
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
                        if (confirm(`Permanently delete "${b.title || "Untitled"}"? This cannot be undone.`)) {
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
