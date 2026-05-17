import { useState } from "react";
import { Trash2, Plus } from "lucide-react";

export type Entry = { id: string; label: string; amount: number };

type Variant = "income" | "expense" | "leftover";

interface Props {
  title: string;
  variant: Variant;
  entries: Entry[];
  onChange: (entries: Entry[]) => void;
  totalLabel: string;
  total: number;
  readOnly?: boolean;
}

const variantClasses: Record<Variant, string> = {
  income: "bg-income text-income-foreground",
  expense: "bg-expense text-expense-foreground",
  leftover: "bg-leftover text-leftover-foreground",
};

export function BudgetTable({ title, variant, entries, onChange, totalLabel, total, readOnly }: Props) {
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const updateEntry = (id: string, patch: Partial<Entry>) => {
    onChange(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };

  const requestDelete = (id: string) => setPendingDelete(id);

  const confirmDelete = (id: string) => {
    onChange(entries.filter((e) => e.id !== id));
    setPendingDelete(null);
  };

  const cancelDelete = () => setPendingDelete(null);

  const addEntry = () =>
    onChange([...entries, { id: crypto.randomUUID(), label: "", amount: 0 }]);

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
      <div className={`${variantClasses[variant]} px-4 py-2.5 text-sm font-semibold tracking-wide uppercase`}>
        {title}
      </div>
      <div className="divide-y divide-border">
        {entries.map((entry) => (
          <div key={entry.id} className="group grid grid-cols-[1fr_auto_auto] items-center gap-2 px-3 py-2 hover:bg-muted/40 transition-colors">
            {pendingDelete === entry.id ? (
              <>
                <span className="text-sm text-muted-foreground px-2 truncate">
                  Remove <span className="font-medium text-foreground">{entry.label || "this row"}</span>?
                </span>
                <button
                  onClick={() => confirmDelete(entry.id)}
                  className="text-xs px-2 py-1 rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                >
                  Remove
                </button>
                <button
                  onClick={cancelDelete}
                  className="text-xs px-2 py-1 rounded border border-border hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <input
                  type="text"
                  value={entry.label}
                  readOnly={readOnly}
                  onChange={(e) => updateEntry(entry.id, { label: e.target.value })}
                  placeholder="Item"
                  className="bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 focus:bg-background rounded px-2 py-1"
                />
                <input
                  type="number"
                  value={entry.amount === 0 ? "" : entry.amount}
                  readOnly={readOnly}
                  onChange={(e) => updateEntry(entry.id, { amount: parseFloat(e.target.value) || 0 })}
                  placeholder="0.00"
                  className="bg-transparent text-sm text-right outline-none w-24 tabular-nums placeholder:text-muted-foreground/60 focus:bg-background rounded px-2 py-1"
                />
                {!readOnly ? (
                  <button
                    onClick={() => requestDelete(entry.id)}
                    className="text-muted-foreground hover:text-destructive p-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                    aria-label="Remove"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                ) : (
                  <span className="w-5" />
                )}
              </>
            )}
          </div>
        ))}
        {!readOnly && (
          <button
            onClick={addEntry}
            className="w-full flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
          >
            <Plus className="size-3.5" /> Add row
          </button>
        )}
        <div className="flex items-center justify-between px-4 py-2.5 bg-muted/50 font-semibold text-sm">
          <span className="uppercase tracking-wide">{totalLabel}</span>
          <span className="tabular-nums">{total.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
