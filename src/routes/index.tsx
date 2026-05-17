import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { Download, Upload, Plus, X } from "lucide-react";
import { BudgetTable, type Entry } from "@/components/BudgetTable";

export const Route = createFileRoute("/")({
  component: BudgetApp,
  head: () => ({
    meta: [
      { title: "Budget Editor — Import, edit and export your budget" },
      { name: "description", content: "A simple budget editor with tabs. Import, edit and export budgets as .budget.json files." },
    ],
  }),
});

interface Budget {
  id: string;
  title: string;
  subtitle: string;
  income: Entry[];
  expenses: Entry[];
}

interface AppState {
  budgets: Budget[];
  activeId: string;
}

const STORAGE_KEY = "budget-app-state-v3";

function createBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: crypto.randomUUID(),
    title: "My Budget",
    subtitle: "",
    income: [
      { id: crypto.randomUUID(), label: "Salary", amount: 0 },
      { id: crypto.randomUUID(), label: "Side income", amount: 0 },
    ],
    expenses: [
      { id: crypto.randomUUID(), label: "Rent", amount: 0 },
      { id: crypto.randomUUID(), label: "Groceries", amount: 0 },
      { id: crypto.randomUUID(), label: "Utilities", amount: 0 },
      { id: crypto.randomUUID(), label: "Transport", amount: 0 },
    ],
    ...overrides,
  };
}

function sanitizeEntries(arr: unknown): Entry[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => ({
      id: typeof e.id === "string" ? e.id : crypto.randomUUID(),
      label: typeof e.label === "string" ? e.label : "",
      amount: typeof e.amount === "number" ? e.amount : parseFloat(String(e.amount)) || 0,
    }));
}

function defaultAppState(): AppState {
  const b = createBudget();
  return { budgets: [b], activeId: b.id };
}

function BudgetApp() {
  const [state, setState] = useState<AppState>(defaultAppState);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.budgets?.length) setState(parsed);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [state]);

  const active = state.budgets.find((b) => b.id === state.activeId) ?? state.budgets[0];

  const updateActive = (patch: Partial<Budget>) => {
    setState((s) => ({
      ...s,
      budgets: s.budgets.map((b) => (b.id === s.activeId ? { ...b, ...patch } : b)),
    }));
  };

  const openBudget = (b: Budget) => {
    setState((s) => ({ budgets: [...s.budgets, b], activeId: b.id }));
  };

  const newBudget = () => openBudget(createBudget({ title: "Untitled budget" }));

  const closeBudget = (id: string) => {
    setState((s) => {
      const remaining = s.budgets.filter((b) => b.id !== id);
      if (remaining.length === 0) {
        const b = createBudget({ title: "Untitled budget" });
        return { budgets: [b], activeId: b.id };
      }
      const activeId = s.activeId === id ? remaining[remaining.length - 1].id : s.activeId;
      return { budgets: remaining, activeId };
    });
  };

  const totalIncome = useMemo(() => active.income.reduce((s, e) => s + (e.amount || 0), 0), [active.income]);
  const totalExpenses = useMemo(() => active.expenses.reduce((s, e) => s + (e.amount || 0), 0), [active.expenses]);
  const leftover = totalIncome - totalExpenses;

  const chartData = [
    { name: "Total income", value: Math.max(totalIncome, 0), color: "var(--chart-1)" },
    { name: "Total expenses", value: Math.max(totalExpenses, 0), color: "var(--chart-2)" },
    { name: "Left over", value: Math.max(leftover, 0), color: "var(--chart-3)" },
  ].filter((d) => d.value > 0);

  const handleExport = () => {
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
      const imported: Budget[] = [];
      for (const file of files) {
        const text = await file.text();
        const data = JSON.parse(text);
        imported.push(createBudget({
          title: typeof data.title === "string" ? data.title : file.name.replace(/\.budget\.json$|\.json$/i, ""),
          subtitle: typeof data.subtitle === "string" ? data.subtitle : "",
          income: sanitizeEntries(data.income),
          expenses: sanitizeEntries(data.expenses),
        }));
      }
      setState((s) => ({
        budgets: [...s.budgets, ...imported],
        activeId: imported[imported.length - 1].id,
      }));
    } catch {
      setImportError("Could not read that file. Please pick a valid .budget.json file.");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Tab bar */}
      <div className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-6 flex items-center gap-1 overflow-x-auto">
          {state.budgets.map((b) => {
            const isActive = b.id === state.activeId;
            return (
              <div
                key={b.id}
                onClick={() => setState((s) => ({ ...s, activeId: b.id }))}
                className={`group flex items-center gap-2 px-3 py-2 text-sm border-b-2 cursor-pointer whitespace-nowrap transition-colors ${
                  isActive
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className="max-w-[180px] truncate">{b.title || "Untitled"}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeBudget(b.id);
                  }}
                  className="opacity-60 hover:opacity-100 hover:bg-muted rounded p-0.5"
                  aria-label="Close tab"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            );
          })}
          <button
            onClick={newBudget}
            className="ml-1 p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded"
            aria-label="New budget"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-10">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
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
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              multiple
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              onClick={handleImportClick}
              className="inline-flex items-center gap-2 bg-card border border-border rounded-md px-3 py-2 text-sm hover:bg-muted transition-colors"
            >
              <Upload className="size-4" /> Import
            </button>
            <button
              onClick={handleExport}
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-md px-3 py-2 text-sm hover:bg-primary/90 transition-colors"
            >
              <Download className="size-4" /> Export
            </button>
          </div>
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
              onChange={(income) => updateActive({ income })}
              totalLabel="Total income"
              total={totalIncome}
            />
            <BudgetTable
              title="Money Out"
              variant="expense"
              entries={active.expenses}
              onChange={(expenses) => updateActive({ expenses })}
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
                <span className={`text-lg font-semibold tabular-nums ${leftover < 0 ? "text-destructive" : "text-foreground"}`}>
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
          Saved automatically in your browser · Import or export to share budgets as .budget.json files
        </footer>
      </div>
    </div>
  );
}

function Stat({ label, value, colorVar }: { label: string; value: number; colorVar: string }) {
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
