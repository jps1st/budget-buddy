import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { BudgetTable, type Entry, type AccountOption } from "@/components/BudgetTable";

export const Route = createFileRoute("/")({
  component: BudgetApp,
  head: () => ({
    meta: [
      { title: "Budget — Plan your monthly cash flow" },
      {
        name: "description",
        content:
          "A simple, beautiful spreadsheet to budget your income and expenses across accounts for any period.",
      },
    ],
  }),
});

type Period = "weekly" | "bi-monthly" | "monthly" | "quarterly";

interface BudgetState {
  period: Period;
  label: string;
  income: Entry[];
  expenses: Entry[];
}

const STORAGE_KEY = "budget-app-state-v2";

const defaultState: BudgetState = {
  period: "monthly",
  label: "May 2026",
  income: [
    { id: "i1", label: "Checking", amount: 0 },
    { id: "i2", label: "Savings", amount: 0 },
  ],
  expenses: [
    { id: "e1", label: "Rent", amount: 0, accountId: "i1" },
    { id: "e2", label: "Groceries", amount: 0, accountId: "i1" },
    { id: "e3", label: "Utilities", amount: 0, accountId: "i1" },
    { id: "e4", label: "Transport", amount: 0, accountId: "i1" },
  ],
};

function BudgetApp() {
  const [state, setState] = useState<BudgetState>(defaultState);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setState(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [state]);

  const totalIncome = useMemo(
    () => state.income.reduce((s, e) => s + (e.amount || 0), 0),
    [state.income],
  );
  const totalExpenses = useMemo(
    () => state.expenses.reduce((s, e) => s + (e.amount || 0), 0),
    [state.expenses],
  );
  const leftover = totalIncome - totalExpenses;

  const accountOptions: AccountOption[] = useMemo(
    () => state.income.map((i) => ({ id: i.id, label: i.label || "Untitled" })),
    [state.income],
  );

  const accountSummary = useMemo(() => {
    const spentByAccount = new Map<string, number>();
    let unassigned = 0;
    for (const e of state.expenses) {
      if (e.accountId && state.income.some((i) => i.id === e.accountId)) {
        spentByAccount.set(e.accountId, (spentByAccount.get(e.accountId) || 0) + (e.amount || 0));
      } else {
        unassigned += e.amount || 0;
      }
    }
    return {
      rows: state.income.map((acc) => {
        const spent = spentByAccount.get(acc.id) || 0;
        return {
          id: acc.id,
          label: acc.label || "Untitled",
          income: acc.amount || 0,
          spent,
          remaining: (acc.amount || 0) - spent,
        };
      }),
      unassigned,
    };
  }, [state.income, state.expenses]);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-foreground">Budget</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Plan income and expenses across accounts for any period.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={state.label}
              onChange={(e) => setState({ ...state, label: e.target.value })}
              className="bg-card border border-border rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder="Period name"
            />
            <select
              value={state.period}
              onChange={(e) => setState({ ...state, period: e.target.value as Period })}
              className="bg-card border border-border rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="weekly">Weekly</option>
              <option value="bi-monthly">Bi-monthly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
            </select>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-6">
            <BudgetTable
              title="Money In (Accounts)"
              variant="income"
              entries={state.income}
              onChange={(income) => setState({ ...state, income })}
              totalLabel="Total income"
              total={totalIncome}
            />
            <BudgetTable
              title="Money Out"
              variant="expense"
              entries={state.expenses}
              onChange={(expenses) => setState({ ...state, expenses })}
              totalLabel="Total expenses"
              total={totalExpenses}
              accounts={accountOptions}
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
                  className={`text-lg font-semibold tabular-nums ${
                    leftover < 0 ? "text-destructive" : "text-foreground"
                  }`}
                >
                  {leftover.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
              <div className="px-4 py-2.5 text-sm font-semibold tracking-wide uppercase bg-muted/60 text-foreground">
                Accounts
              </div>
              <div className="divide-y divide-border">
                <div className="grid grid-cols-[1fr_5rem_5rem_5rem] gap-2 px-4 py-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <span>Account</span>
                  <span className="text-right">Income</span>
                  <span className="text-right">Spent</span>
                  <span className="text-right">Remaining</span>
                </div>
                {accountSummary.rows.length === 0 && (
                  <div className="px-4 py-6 text-sm text-muted-foreground text-center">
                    Add an account in Money In to start tracking.
                  </div>
                )}
                {accountSummary.rows.map((row) => (
                  <div
                    key={row.id}
                    className="grid grid-cols-[1fr_5rem_5rem_5rem] gap-2 px-4 py-2.5 text-sm items-center"
                  >
                    <span className="font-medium truncate">{row.label}</span>
                    <span className="text-right tabular-nums text-muted-foreground">
                      {row.income.toFixed(2)}
                    </span>
                    <span className="text-right tabular-nums" style={{ color: "var(--expense)" }}>
                      {row.spent.toFixed(2)}
                    </span>
                    <span
                      className={`text-right tabular-nums font-semibold ${
                        row.remaining < 0 ? "text-destructive" : ""
                      }`}
                      style={row.remaining >= 0 ? { color: "var(--income)" } : undefined}
                    >
                      {row.remaining.toFixed(2)}
                    </span>
                  </div>
                ))}
                {accountSummary.unassigned > 0 && (
                  <div className="grid grid-cols-[1fr_5rem_5rem_5rem] gap-2 px-4 py-2.5 text-sm items-center bg-muted/30">
                    <span className="italic text-muted-foreground">Unassigned</span>
                    <span className="text-right tabular-nums text-muted-foreground">—</span>
                    <span className="text-right tabular-nums" style={{ color: "var(--expense)" }}>
                      {accountSummary.unassigned.toFixed(2)}
                    </span>
                    <span className="text-right tabular-nums text-muted-foreground">—</span>
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
          Saved automatically to your browser · {state.period} budget for {state.label}
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
