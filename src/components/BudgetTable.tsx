import { useState } from "react";
import { Trash2, Plus, GripVertical, X, ChevronRight, ChevronDown, Paperclip, Camera, ImageIcon, FileText } from "lucide-react";
import { fmt } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type Transaction = {
  id: string;
  amount: number;
  fromIncomeId: string;
  date: string;
  description?: string;
  receiptUrl?: string;
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
  incomeRemaining?: Record<string, number>;    // expense table only: remaining per income entry id for overspend check
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

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function formatTxDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${MONTHS[parseInt(m, 10) - 1]} ${parseInt(d, 10)}`;
}

const emptyTx = () => ({ amount: "", fromId: "", date: todayISO(), description: "" });

export function BudgetTable({
  title, variant, entries, onChange, totalLabel, total,
  readOnly, mode = "editing", incomeEntries = [], remainingOverrides, incomeRemaining,
}: Props) {
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newTx, setNewTx] = useState<{ amount: string; fromId: string; date: string; description: string }>(emptyTx);
  const [viewTx, setViewTx] = useState<{ tx: Transaction; fromLabel: string; rowLabel: string } | null>(null);
  const [overspendWarn, setOverspendWarn] = useState<{ entryId: string; message: string } | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const toggleRow = (id: string) =>
    setExpandedRows((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

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

  const commitTx = async (entryId: string, force = false) => {
    const amt = parseFloat(newTx.amount);
    if (!amt || !newTx.fromId || !newTx.date) return;

    if (!force) {
      const warnings: string[] = [];

      if (incomeRemaining) {
        const rem = incomeRemaining[newTx.fromId];
        if (rem !== undefined && amt > rem) {
          const label = incomeEntries.find((e) => e.id === newTx.fromId)?.label ?? "this source";
          warnings.push(`Exceeds the remaining balance of "${label}" by ${fmt(amt - rem)}.`);
        }
      }

      const row = entries.find((e) => e.id === entryId);
      if (row) {
        const spent = (row.transactions ?? []).reduce((s, t) => s + t.amount, 0);
        const newRemaining = row.amount - spent - amt;
        if (newRemaining < 0) {
          warnings.push(`Turns the budget for "${row.label || "this row"}" negative by ${fmt(Math.abs(newRemaining))}.`);
        }
      }

      if (warnings.length > 0) {
        setOverspendWarn({ entryId, message: warnings.join(" ") });
        return;
      }
    }

    setOverspendWarn(null);

    let receiptUrl: string | undefined;
    if (receiptFile) {
      setUploading(true);
      try {
        const fd = new FormData();
        fd.append("file", receiptFile);
        const res = await fetch("/api/receipts", { method: "POST", body: fd });
        if (res.ok) {
          const data = await res.json() as { url: string };
          receiptUrl = data.url;
        }
      } catch { /* proceed without receipt if upload fails */ }
      setUploading(false);
    }

    const tx: Transaction = {
      id: crypto.randomUUID(),
      amount: amt,
      fromIncomeId: newTx.fromId,
      date: newTx.date,
      description: newTx.description.trim() || undefined,
      receiptUrl,
    };
    updateEntry(entryId, {
      transactions: [...(entries.find((e) => e.id === entryId)?.transactions ?? []), tx],
    });
    setNewTx(emptyTx());
    setReceiptFile(null);
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
          const txCount    = (entry.transactions ?? []).length;
          const isExpanded = isRecording && variant === "expense" && expandedRows.has(entry.id);

          return (
            <div key={entry.id}>
              {/* ── Main row ───────────────────────────────────────────── */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOverId(entry.id); }}
                onDrop={(e)     => { e.preventDefault(); if (dragId) reorder(dragId, entry.id); setDragOverId(null); }}
                onClick={() => { if (isRecording && variant === "expense" && !isPending) toggleRow(entry.id); }}
                className={`group px-3 py-2 transition-colors ${
                  isPending
                    ? "flex flex-col gap-2"
                    : isRecording
                      ? "grid grid-cols-[auto_1fr_auto_auto] items-center gap-2"
                      : "grid grid-cols-[auto_1fr_auto_auto] items-center gap-2"
                } ${isOver ? "border-t-2 border-primary bg-primary/5" : "hover:bg-muted/40"} ${
                  isDragging ? "opacity-40" : ""
                } ${isRecording && variant === "expense" ? "cursor-pointer" : ""}`}
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
                    {variant === "expense" ? (
                      <span className="text-muted-foreground/50 shrink-0">
                        {isExpanded
                          ? <ChevronDown className="size-3.5" />
                          : <ChevronRight className="size-3.5" />}
                      </span>
                    ) : (
                      <span className="w-3.5 shrink-0" />
                    )}
                    <span className="text-sm px-2 py-1 truncate flex items-center gap-1.5">
                      {entry.label || <span className="text-muted-foreground/60">Item</span>}
                      {variant === "expense" && txCount > 0 && !isExpanded && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                          {txCount}
                        </span>
                      )}
                    </span>
                    <span className={`text-sm text-right tabular-nums px-2 py-1 ${
                      variant === "expense" ? (remaining < 0 ? "text-destructive font-semibold" : "text-foreground") : ""
                    }`}>
                      {fmt(displayRem)}
                      {variant === "expense" && (
                        <span className="ml-1 text-xs text-muted-foreground/60">/ {fmt(entry.amount)}</span>
                      )}
                    </span>
                    {!readOnly && variant === "expense" ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isExpanded) toggleRow(entry.id);
                          setAddingTo(addingTo === entry.id ? null : entry.id);
                          setNewTx(emptyTx());
                        }}
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
              {isExpanded && (entry.transactions ?? []).map((tx) => {
                const fromLabel = incomeEntries.find((e) => e.id === tx.fromIncomeId)?.label ?? "(deleted)";
                return (
                  <div key={tx.id}
                    onClick={(e) => { e.stopPropagation(); setViewTx({ tx, fromLabel, rowLabel: entry.label }); }}
                    className="flex items-start gap-2 px-4 py-1.5 bg-muted/30 text-xs text-muted-foreground cursor-pointer hover:bg-muted/50 transition-colors">
                    <div className="flex-1 min-w-0 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                      <span className="tabular-nums text-foreground font-medium">{fmt(tx.amount)}</span>
                      <span>←</span>
                      <span className="font-medium text-foreground">{fromLabel}</span>
                      <span className="text-muted-foreground/60">·</span>
                      <span>{formatTxDate(tx.date)}</span>
                      {tx.description && (
                        <>
                          <span className="text-muted-foreground/60">·</span>
                          <span className="italic text-foreground/70">{tx.description}</span>
                        </>
                      )}
                      {tx.receiptUrl && (
                        /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(tx.receiptUrl)
                          ? <ImageIcon className="size-4 text-primary shrink-0" aria-label="Has image receipt" />
                          : <FileText className="size-4 text-primary shrink-0" aria-label="Has receipt" />
                      )}
                    </div>
                    {!readOnly && (
                      <button onClick={(e) => { e.stopPropagation(); deleteTx(entry.id, tx.id); }}
                        className="mt-0.5 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                        aria-label="Delete transaction">
                        <X className="size-3" />
                      </button>
                    )}
                  </div>
                );
              })}

              {/* ── Add transaction form ───────────────────────────────── */}
              {isExpanded && addingTo === entry.id && (
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
                    <option value="">Source…</option>
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
                    type="text" placeholder="Description (optional)"
                    value={newTx.description}
                    onChange={(e) => setNewTx((t) => ({ ...t, description: e.target.value }))}
                    className="flex-1 min-w-[8rem] text-sm bg-background border border-input rounded px-2 py-1 outline-none focus:ring-1 focus:ring-ring"
                  />
                  <label className="flex items-center gap-1 text-xs px-2 py-1.5 rounded border border-border hover:bg-muted cursor-pointer transition-colors shrink-0"
                    title={receiptFile ? receiptFile.name : "Attach receipt"}>
                    {receiptFile
                      ? <><Paperclip className="size-3.5 text-primary" /><span className="max-w-[6rem] truncate text-primary">{receiptFile.name}</span></>
                      : <><Camera className="size-3.5" /> Receipt</>}
                    <input type="file" accept="image/*,.pdf" className="hidden"
                      onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)} />
                  </label>
                  <button onClick={() => void commitTx(entry.id)}
                    disabled={!newTx.amount || !newTx.fromId || !newTx.date || uploading}
                    className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    {uploading ? "Uploading…" : "Add"}
                  </button>
                  <button onClick={() => { setAddingTo(null); setOverspendWarn(null); setReceiptFile(null); }}
                    className="text-xs px-2 py-1.5 rounded border border-border hover:bg-muted transition-colors">
                    Cancel
                  </button>
                  {overspendWarn?.entryId === entry.id && (
                    <div className="w-full rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive">
                      <p className="mb-2">{overspendWarn.message} Add anyway?</p>
                      <div className="flex gap-2">
                        <button onClick={() => void commitTx(entry.id, true)}
                          className="px-2.5 py-1 rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors">
                          Yes, add
                        </button>
                        <button onClick={() => setOverspendWarn(null)}
                          className="px-2.5 py-1 rounded border border-destructive/40 hover:bg-destructive/10 transition-colors">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
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
          <span className="tabular-nums">{fmt(total)}</span>
        </div>
      </div>

      {/* ── Transaction detail modal ───────────────────────────────────── */}
      <Dialog open={!!viewTx} onOpenChange={(o) => { if (!o) setViewTx(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transaction</DialogTitle>
          </DialogHeader>
          {viewTx && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md bg-muted/50 px-4 py-3">
                  <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Amount</div>
                  <div className="text-2xl font-semibold tabular-nums">{fmt(viewTx.tx.amount)}</div>
                </div>
                <div className="rounded-md bg-muted/50 px-4 py-3">
                  <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Date</div>
                  <div className="text-sm font-medium">{viewTx.tx.date}</div>
                </div>
              </div>
              <div className="rounded-md bg-muted/50 px-4 py-3">
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Expense row</div>
                <div className="text-sm font-medium">{viewTx.rowLabel || "—"}</div>
              </div>
              <div className="rounded-md bg-muted/50 px-4 py-3">
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">← From</div>
                <div className="text-sm font-medium">{viewTx.fromLabel}</div>
              </div>
              {viewTx.tx.description && (
                <div className="rounded-md bg-muted/50 px-4 py-3">
                  <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Description</div>
                  <div className="text-sm whitespace-pre-wrap">{viewTx.tx.description}</div>
                </div>
              )}
              {viewTx.tx.receiptUrl && (
                <div className="rounded-md overflow-hidden border border-border">
                  <div className="text-xs text-muted-foreground uppercase tracking-wide px-4 py-2 bg-muted/50">Receipt</div>
                  {/\.(jpg|jpeg|png|gif|webp|heic)$/i.test(viewTx.tx.receiptUrl) ? (
                    <a href={viewTx.tx.receiptUrl} target="_blank" rel="noopener noreferrer" className="block">
                      <img
                        src={viewTx.tx.receiptUrl}
                        alt="Receipt"
                        className="w-full object-contain max-h-96 bg-muted/20"
                      />
                    </a>
                  ) : (
                    <div className="px-4 py-3">
                      <a href={viewTx.tx.receiptUrl} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm text-primary underline underline-offset-2">
                        <FileText className="size-4" /> View receipt
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
