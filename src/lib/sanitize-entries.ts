import { uuid } from "@/lib/utils";
import type { Entry, SubItem, Transaction } from "@/components/BudgetTable";

function sanitizeTransactions(arr: unknown): Transaction[] | undefined {
  if (!Array.isArray(arr)) return undefined;
  const result = arr
    .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
    .map((t) => ({
      id: typeof t.id === "string" ? t.id : uuid(),
      amount: typeof t.amount === "number" ? t.amount : parseFloat(String(t.amount)) || 0,
      fromIncomeId: typeof t.fromIncomeId === "string" ? t.fromIncomeId : undefined,
      date: typeof t.date === "string" ? t.date : "",
      description: typeof t.description === "string" ? t.description : undefined,
      receiptUrl: typeof t.receiptUrl === "string" ? t.receiptUrl : undefined,
    }));
  return result.length > 0 ? result : undefined;
}

function sanitizeSubItems(arr: unknown): SubItem[] | undefined {
  if (!Array.isArray(arr)) return undefined;
  const result = arr
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s) => ({
      id: typeof s.id === "string" ? s.id : uuid(),
      label: typeof s.label === "string" ? s.label : "",
      amount: typeof s.amount === "number" ? s.amount : parseFloat(String(s.amount)) || 0,
      completed: s.completed === true ? true : undefined,
    }));
  return result.length > 0 ? result : undefined;
}

// Used any time entries come back from an external round-trip (server sync, share/workspace
// import, .budget.json import) — must preserve every field an Entry can carry, or that data
// silently disappears the moment it passes through here.
export function sanitizeEntries(arr: unknown): Entry[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => ({
      id: typeof e.id === "string" ? e.id : uuid(),
      label: typeof e.label === "string" ? e.label : "",
      amount: typeof e.amount === "number" ? e.amount : parseFloat(String(e.amount)) || 0,
      completed: e.completed === true ? true : undefined,
      transactions: sanitizeTransactions(e.transactions),
      subItems: sanitizeSubItems(e.subItems),
    }));
}
