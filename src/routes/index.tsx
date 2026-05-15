import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { BudgetTable, type Entry } from "@/components/BudgetTable";

export const Route = createFileRoute("/")({
  component: BudgetApp,
  head: () => ({
    meta: [
      { title: "Budget — Plan your monthly cash flow" },
      { name: "description", content: "A simple, beautiful spreadsheet to budget your income and expenses for any period." },
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

const STORAGE_KEY = "budget-app-state-v1";

const defaultState: BudgetState = {
  period: "monthly",
  label: "May 2026",
  income: [
    { id: "i1", label: "Salary", amount: 0 },
    { id: "i2", label: "Side income", amount: 0 },
  ],
  expenses: [
    { id: "e1", label: "Rent", amount: 0 },
    { id: "e2", label: "Groceries", amount: 0 },
    { id: "e3", label: "Utilities", amount: 0 },
    { id: "e4", label: "Transport", amount: 0 },
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

  const totalIncome = useMemo(() => state.income.reduce((s, e) => s + (e.amount || 0), 0), [state.income]);
  const totalExpenses = useMemo(() => state.expenses.reduce((s, e) => s + (e.amount || 0), 0), [state.expenses]);
  const leftover = totalIncome - totalExpenses;

  const chartData = [
    { name: "Total income", value: Math.max(totalIncome, 0), color: "var(--chart-1)" },
    { name: "Total expenses", value: Math.max(totalExpenses, 0), color: "var(--chart-2)" },
    { name: "Left over", value: Math.max(leftover, 0), color: "var(--chart-3)" },
  ].filter((d) => d.value > 0);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-foreground">Budget</h1>
            <p className="text-sm text-muted-foreground mt-1">Plan your income and expenses for any period.</p>
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
              title="Money In"
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
