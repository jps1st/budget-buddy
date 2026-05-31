import { useState } from "react";
import { Trash2, Plus, GripVertical, X } from "lucide-react";

export type Transaction = {
  id: string;
  amount: number;
  fromIncomeId: string;
  date: string;
  description?: string;
};

export type Entry = { id: string; label: string; amount: number; transactions?: Transaction[] };

type Variant = "income" | "expense" | "leftover";

interface Props {
  title: string;
  variant: Variant;
  entries: Entry[];
  onChange: (entries: Entry[], immediate?: boolean) => void;
  totalLabel: string;
  total: number;
  readOnly?: boolean;
  mode?: "editing" | "recording";
  incomeEntries?: Entry[];          // expense table only: drives the "from" dropdown
  remainingOverrides?: Record<string, number>; // income table only: pre-computed remaining per entry id
}

const variantClasses: Record<Variant, string> = {
  income: "bg-income text-income-foreground",
  expense: "bg-expense text-expense-foreground",
  leftover: "bg-leftover text-leftover-foreground",
};

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const emptyTx = () => ({ amount: "", fromId: "", date: todayISO(), description: "" });

export function BudgetTable({
  title, variant, entries, onChange, totalLabel, total,
  readOnly, mode = "editing", incomeEntries = [], remainingOverrides,
}: Props) {
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newTx, setNewTx] = useState<{ amount: string; fromId: string; date: string; description: string }>(emptyTx);

  const updateEntry = (id: string, patch: Partial<Entry>) =>
    onChange(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  const confirmDelete = (id: string) => {
    onChange(entries.filter((e) => e.id !== id), true);
    setPendingDelete(null);
  };

  const addEntry = () =>
    onChange([...entries, { id: crypto.randomUUID(), label: "", amount: 0 }], true);

  const reorder = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const fromIdx = entries.findIndex((e) => e.id === fromId);
    const toIdx   = entries.findIndex((e) => e.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;
    const result = entries.filter((e) => e.id !== fromId);
    const insertAt = fromIdx < toIdx
      ? result.findIndex((e) => e.id === toId) + 1
      : result.findIndex((e) => e.id === toId);
    result.splice(insertAt, 0, entries[fromIdx]);
    onChange(result, true);
  };

  const commitTx = (entryId: string) => {
    const amt = parseFloat(newTx.amount);
    if (!amt || !newTx.fromId || !newTx.date) return;
    const tx: Transaction = {
      id: crypto.randomUUID(),
      amount: amt,
      fromIncomeId: newTx.fromId,
      date: newTx.date,
      description: newTx.description.trim() || undefined,
    };
    updateEntry(entryId, {
      transactions: [...(entries.find((e) => e.id === entryId)?.transactions ?? []), tx],
    });
    setNewTx(emptyTx());
    setAddingTo(null);
  };

  const deleteTx = (entryId: string, txId: string) => {
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return;
    updateEntry(entryId, { transactions: (entry.transactions ?? []).filter((t) => t.id !== txId) });
  };

  const isRecording = mode === "recording";

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
      <div className={`${variantClasses[variant]} px-4 py-2.5 text-sm font-semibold tracking-wide uppercase`}>
        {title}
      </div>
      <div className="divide-y divide-border">
        {entries.map((entry) => {
          const isOver     = dragOverId === entry.id && dragId !== entry.id;
          const isDragging = dragId === entry.id;
          const isPending  = pendingDelete === entry.id;
          const spent      = (entry.transactions ?? []).reduce((s, t) => s + t.amount, 0);
          const remaining  = entry.amount - spent;
          const displayRem = remainingOverrides?.[entry.id] ?? remaining;

          return (
            <div key={entry.id}>
              {/* ── Main row ───────────────────────────────────────────── */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOverId(entry.id); }}
                onDrop={(e)     => { e.preventDefault(); if (dragId) reorder(dragId, entry.id); setDragOverId(null); }}
                className={`group px-3 py-2 transition-colors ${
                  isPending
                    ? "flex flex-col gap-2"
                    : isRecording
                      ? "grid grid-cols-[1fr_auto_auto] items-center gap-2"
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
                      <button onClick={() => confirmDelete(entry.id)}
                        className="flex-1 text-xs px-2 py-1.5 rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors">
                        Remove
                      </button>
                      <button onClick={() => setPendingDelete(null)}
                        className="flex-1 text-xs px-2 py-1.5 rounded border border-border hover:bg-muted transition-colors">
                        Cancel
                      </button>
                    </div>
                  </>
                ) : isRecording ? (
                  /* ── Recording mode row ─────────────────────────────── */
                  <>
                    <span className="text-sm px-2 py-1 truncate">{entry.label || <span className="text-muted-foreground/60">Item</span>}</span>
                    <span className={`text-sm text-right tabular-nums px-2 py-1 ${
                      variant === "expense" ? (remaining < 0 ? "text-destructive font-semibold" : "text-foreground") : ""
                    }`}>
                      {displayRem.toFixed(2)}
                      {variant === "expense" && (
                        <span className="ml-1 text-xs text-muted-foreground/60">/ {entry.amount.toFixed(2)}</span>
                      )}
                    </span>
                    {!readOnly && variant === "expense" ? (
                      <button
                        onClick={() => { setAddingTo(addingTo === entry.id ? null : entry.id); setNewTx(emptyTx()); }}
                        className="p-1 rounded text-foreground/50 hover:text-foreground hover:bg-muted transition-colors shrink-0"
                        aria-label="Add transaction"
                      >
                        <Plus className="size-4" />
                      </button>
                    ) : (
                      <span className="w-6 shrink-0" />
                    )}
                  </>
                ) : (
                  /* ── Editing mode row ────────────────────────────────── */
                  <>
                    {!readOnly ? (
                      <span
                        draggable
                        onDragStart={(e) => { setDragId(entry.id); e.dataTransfer.effectAllowed = "move"; }}
                        onDragEnd={() => { setDragId(null); setDragOverId(null); }}
                        className="flex items-center justify-center cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-muted-foreground/70 transition-colors shrink-0 select-none"
                      >
                        <GripVertical className="size-4" />
                      </span>
                    ) : (
                      <span className="w-4 shrink-0" />
                    )}
                    <input type="text" value={entry.label} readOnly={readOnly}
                      onChange={(e) => updateEntry(entry.id, { label: e.target.value })}
                      placeholder="Item"
                      className="bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 focus:bg-background rounded px-2 py-1 min-w-0"
                    />
                    <input type="number" value={entry.amount === 0 ? "" : entry.amount} readOnly={readOnly}
                      onChange={(e) => updateEntry(entry.id, { amount: parseFloat(e.target.value) || 0 })}
                      placeholder="0.00"
                      className="bg-transparent text-sm text-right outline-none w-16 sm:w-24 tabular-nums placeholder:text-muted-foreground/60 focus:bg-background rounded px-2 py-1"
                    />
                    {!readOnly ? (
                      <button onClick={() => setPendingDelete(entry.id)}
                        className="text-foreground/40 hover:text-destructive p-1 transition-colors shrink-0"
                        aria-label="Remove">
                        <Trash2 className="size-4" />
                      </button>
                    ) : (
                      <span className="w-5 shrink-0" />
                    )}
                  </>
                )}
              </div>

              {/* ── Transaction sub-rows (recording mode, expense only) ── */}
              {isRecording && variant === "expense" && (entry.transactions ?? []).map((tx) => {
                const fromLabel = incomeEntries.find((e) => e.id === tx.fromIncomeId)?.label ?? "(deleted)";
                return (
                  <div key={tx.id}
                    className="flex items-center gap-2 px-4 py-1.5 bg-muted/30 text-xs text-muted-foreground">
                    <span className="tabular-nums text-foreground font-medium">{tx.amount.toFixed(2)}</span>
                    <span>from</span>
                    <span className="font-medium text-foreground truncate">{fromLabel}</span>
                    <span className="text-muted-foreground/60">·</span>
                    <span>{tx.date}</span>
                    {tx.description && (
                      <>
                        <span className="text-muted-foreground/60">·</span>
                        <span className="italic truncate">{tx.description}</span>
                      </>
                    )}
                    {!readOnly && (
                      <button onClick={() => deleteTx(entry.id, tx.id)}
                        className="ml-auto text-muted-foreground hover:text-destructive transition-colors shrink-0"
                        aria-label="Delete transaction">
                        <X className="size-3" />
                      </button>
                    )}
                  </div>
                );
              })}

              {/* ── Add transaction form ───────────────────────────────── */}
              {isRecording && variant === "expense" && addingTo === entry.id && (
                <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-muted/20 border-t border-border">
                  <input
                    type="number" placeholder="Amount" min="0" step="0.01"
                    value={newTx.amount}
                    onChange={(e) => setNewTx((t) => ({ ...t, amount: e.target.value }))}
                    className="w-20 text-sm bg-background border border-input rounded px-2 py-1 tabular-nums outline-none focus:ring-1 focus:ring-ring"
                    autoFocus
                  />
                  <select
                    value={newTx.fromId}
                    onChange={(e) => setNewTx((t) => ({ ...t, fromId: e.target.value }))}
                    className="flex-1 min-w-[8rem] text-sm bg-background border border-input rounded px-2 py-1 outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">From income…</option>
                    {incomeEntries.map((ie) => (
                      <option key={ie.id} value={ie.id}>{ie.label || "Unnamed"}</option>
                    ))}
                  </select>
                  <input
                    type="date" value={newTx.date}
                    onChange={(e) => setNewTx((t) => ({ ...t, date: e.target.value }))}
                    className="text-sm bg-background border border-input rounded px-2 py-1 outline-none focus:ring-1 focus:ring-ring"
                  />
                  <input
                    type="text" placeholder="Note (optional)"
                    value={newTx.description}
                    onChange={(e) => setNewTx((t) => ({ ...t, description: e.target.value }))}
                    className="flex-1 min-w-[8rem] text-sm bg-background border border-input rounded px-2 py-1 outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button onClick={() => commitTx(entry.id)}
                    disabled={!newTx.amount || !newTx.fromId || !newTx.date}
                    className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    Add
                  </button>
                  <button onClick={() => setAddingTo(null)}
                    className="text-xs px-2 py-1.5 rounded border border-border hover:bg-muted transition-colors">
                    Cancel
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {!readOnly && !isRecording && (
          <button onClick={addEntry}
            className="w-full flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
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
