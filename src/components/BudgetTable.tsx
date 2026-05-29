import { useState } from "react";
import { Trash2, Plus, GripVertical } from "lucide-react";

export type Entry = { id: string; label: string; amount: number };

type Variant = "income" | "expense" | "leftover";

interface Props {
  title: string;
  variant: Variant;
  entries: Entry[];
  onChange: (entries: Entry[], immediate?: boolean) => void;
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
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const updateEntry = (id: string, patch: Partial<Entry>) => {
    onChange(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };

  const requestDelete = (id: string) => setPendingDelete(id);
  const confirmDelete = (id: string) => {
    onChange(entries.filter((e) => e.id !== id), true);
    setPendingDelete(null);
  };
  const cancelDelete = () => setPendingDelete(null);
  const addEntry = () =>
    onChange([...entries, { id: crypto.randomUUID(), label: "", amount: 0 }], true);

  const reorder = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const from = entries.find((e) => e.id === fromId);
    if (!from) return;
    const rest = entries.filter((e) => e.id !== fromId);
    const toIdx = rest.findIndex((e) => e.id === toId);
    if (toIdx === -1) return;
    onChange([...rest.slice(0, toIdx), from, ...rest.slice(toIdx)], true);
  };

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
      <div className={`${variantClasses[variant]} px-4 py-2.5 text-sm font-semibold tracking-wide uppercase`}>
        {title}
      </div>
      <div className="divide-y divide-border">
        {entries.map((entry) => {
          const isOver = dragOverId === entry.id && dragId !== entry.id;
          const isDragging = dragId === entry.id;
          const isPending = pendingDelete === entry.id;

          return (
            <div
              key={entry.id}
              onDragOver={(e) => { e.preventDefault(); setDragOverId(entry.id); }}
              onDrop={(e) => { e.preventDefault(); if (dragId) reorder(dragId, entry.id); setDragOverId(null); }}
              className={`group px-3 py-2 transition-colors ${
                isPending
                  ? "flex flex-col gap-2"
                  : "grid grid-cols-[auto_1fr_auto_auto] items-center gap-2"
              } ${isOver ? "border-t-2 border-primary bg-primary/5" : "hover:bg-muted/40"} ${
                isDragging ? "opacity-40" : ""
              }`}
            >
              {isPending ? (
                <>
                  <span className="text-sm text-muted-foreground px-1 truncate">
                    Remove <span className="font-medium text-foreground">{entry.label || "this row"}</span>?
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => confirmDelete(entry.id)}
                      className="flex-1 text-xs px-2 py-1.5 rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                    >
                      Remove
                    </button>
                    <button
                      onClick={cancelDelete}
                      className="flex-1 text-xs px-2 py-1.5 rounded border border-border hover:bg-muted transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {!readOnly ? (
                    <span
                      draggable
                      onDragStart={(e) => {
                        setDragId(entry.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => { setDragId(null); setDragOverId(null); }}
                      className="flex items-center justify-center cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-muted-foreground/70 transition-colors shrink-0 select-none"
                    >
                      <GripVertical className="size-4" />
                    </span>
                  ) : (
                    <span className="w-4 shrink-0" />
                  )}
                  <input
                    type="text"
                    value={entry.label}
                    readOnly={readOnly}
                    onChange={(e) => updateEntry(entry.id, { label: e.target.value })}
                    placeholder="Item"
                    className="bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 focus:bg-background rounded px-2 py-1 min-w-0"
                  />
                  <input
                    type="number"
                    value={entry.amount === 0 ? "" : entry.amount}
                    readOnly={readOnly}
                    onChange={(e) => updateEntry(entry.id, { amount: parseFloat(e.target.value) || 0 })}
                    placeholder="0.00"
                    className="bg-transparent text-sm text-right outline-none w-16 sm:w-24 tabular-nums placeholder:text-muted-foreground/60 focus:bg-background rounded px-2 py-1"
                  />
                  {!readOnly ? (
                    <button
                      onClick={() => requestDelete(entry.id)}
                      className="text-muted-foreground hover:text-destructive p-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0"
                      aria-label="Remove"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  ) : (
                    <span className="w-5 shrink-0" />
                  )}
                </>
              )}
            </div>
          );
        })}
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
