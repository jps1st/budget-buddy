import { Trash2, Plus } from "lucide-react";

export type Entry = {
  id: string;
  label: string;
  amount: number;
  accountId?: string;
};

type Variant = "income" | "expense" | "leftover";

export type AccountOption = { id: string; label: string };

interface Props {
  title: string;
  variant: Variant;
  entries: Entry[];
  onChange: (entries: Entry[]) => void;
  totalLabel: string;
  total: number;
  readOnly?: boolean;
  accounts?: AccountOption[];
}

const variantClasses: Record<Variant, string> = {
  income: "bg-income text-income-foreground",
  expense: "bg-expense text-expense-foreground",
  leftover: "bg-leftover text-leftover-foreground",
};

export function BudgetTable({
  title,
  variant,
  entries,
  onChange,
  totalLabel,
  total,
  readOnly,
  accounts,
}: Props) {
  const updateEntry = (id: string, patch: Partial<Entry>) => {
    onChange(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };
  const removeEntry = (id: string) => onChange(entries.filter((e) => e.id !== id));
  const addEntry = () =>
    onChange([
      ...entries,
      {
        id: crypto.randomUUID(),
        label: "",
        amount: 0,
        accountId: accounts && accounts.length > 0 ? accounts[0].id : undefined,
      },
    ]);

  const showAccount = !!accounts;
  const gridCols = showAccount
    ? "grid-cols-[1fr_8rem_6rem_auto]"
    : "grid-cols-[1fr_auto_auto]";

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
      <div className={`${variantClasses[variant]} px-4 py-2.5 text-sm font-semibold tracking-wide uppercase`}>
        {title}
      </div>
      <div className="divide-y divide-border">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className={`group grid ${gridCols} items-center gap-2 px-3 py-2 hover:bg-muted/40 transition-colors`}
          >
            <input
              type="text"
              value={entry.label}
              readOnly={readOnly}
              onChange={(e) => updateEntry(entry.id, { label: e.target.value })}
              placeholder="Item"
              className="bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 focus:bg-background rounded px-2 py-1"
            />
            {showAccount && (
              <select
                value={entry.accountId ?? ""}
                onChange={(e) => updateEntry(entry.id, { accountId: e.target.value || undefined })}
                disabled={readOnly}
                className="bg-transparent text-xs outline-none rounded px-2 py-1 border border-border/60 focus:bg-background"
              >
                <option value="">— Account —</option>
                {accounts!.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label || "Untitled"}
                  </option>
                ))}
              </select>
            )}
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
                onClick={() => removeEntry(entry.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-1"
                aria-label="Remove"
              >
                <Trash2 className="size-3.5" />
              </button>
            ) : (
              <span className="w-5" />
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
