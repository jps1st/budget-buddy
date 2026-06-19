import { useState } from "react";
import { Trash2, Plus, GripVertical, X, ChevronRight, ChevronDown } from "lucide-react";

export type TodoChild = {
  id: string;
  label: string;
  checked: boolean;
};

export type TodoEntry = {
  id: string;
  label: string;
  checked: boolean;
  children?: TodoChild[];
};

interface Props {
  entries: TodoEntry[];
  onChange: (entries: TodoEntry[], immediate?: boolean) => void;
  readOnly?: boolean;
}

export function TodoList({ entries, onChange, readOnly }: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingNest, setPendingNest] = useState<{ fromId: string; toId: string } | null>(null);

  const toggleExpand = (id: string) =>
    setExpandedRows((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const updateEntry = (id: string, patch: Partial<TodoEntry>) =>
    onChange(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  const toggleParent = (id: string, checked: boolean) => {
    onChange(
      entries.map((e) =>
        e.id === id
          ? { ...e, checked, children: (e.children ?? []).map((c) => ({ ...c, checked })) }
          : e,
      ),
      true,
    );
  };

  const toggleChild = (parentId: string, childId: string, checked: boolean) => {
    onChange(
      entries.map((e) => {
        if (e.id !== parentId) return e;
        const newChildren = (e.children ?? []).map((c) =>
          c.id === childId ? { ...c, checked } : c,
        );
        const allChecked = newChildren.length > 0 && newChildren.every((c) => c.checked);
        return { ...e, checked: allChecked, children: newChildren };
      }),
      true,
    );
  };

  const addEntry = () => {
    onChange([...entries, { id: crypto.randomUUID(), label: "", checked: false }], true);
  };

  const addChild = (parentId: string) => {
    onChange(
      entries.map((e) =>
        e.id === parentId
          ? {
              ...e,
              children: [
                ...(e.children ?? []),
                { id: crypto.randomUUID(), label: "", checked: false },
              ],
            }
          : e,
      ),
      true,
    );
    setExpandedRows((s) => new Set([...s, parentId]));
  };

  const deleteChild = (parentId: string, childId: string) => {
    onChange(
      entries.map((e) => {
        if (e.id !== parentId) return e;
        const newChildren = (e.children ?? []).filter((c) => c.id !== childId);
        const allChecked = newChildren.length > 0 && newChildren.every((c) => c.checked);
        return {
          ...e,
          children: newChildren,
          checked: newChildren.length > 0 ? allChecked : e.checked,
        };
      }),
      true,
    );
  };

  const confirmDelete = (id: string) => {
    onChange(entries.filter((e) => e.id !== id), true);
    setPendingDelete(null);
  };

  const reorder = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const fromIdx = entries.findIndex((e) => e.id === fromId);
    const toIdx = entries.findIndex((e) => e.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;
    const result = entries.filter((e) => e.id !== fromId);
    const insertAt =
      fromIdx < toIdx
        ? result.findIndex((e) => e.id === toId) + 1
        : result.findIndex((e) => e.id === toId);
    result.splice(insertAt, 0, entries[fromIdx]);
    onChange(result, true);
  };

  const nestInto = (fromId: string, toId: string) => {
    const from = entries.find((e) => e.id === fromId);
    if (!from) return;
    const fromAsChild: TodoChild = { id: from.id, label: from.label, checked: from.checked };
    const fromKids: TodoChild[] = from.children ?? [];
    const newEntries = entries
      .filter((e) => e.id !== fromId)
      .map((e) => {
        if (e.id !== toId) return e;
        const merged = [...(e.children ?? []), fromAsChild, ...fromKids];
        return { ...e, checked: merged.length > 0 && merged.every((c) => c.checked), children: merged };
      });
    onChange(newEntries, true);
    setExpandedRows((s) => new Set([...s, toId]));
    setPendingNest(null);
  };

  const totalCount = entries.reduce((s, e) => {
    const kids = e.children ?? [];
    return s + (kids.length > 0 ? kids.length : 1);
  }, 0);

  const checkedCount = entries.reduce((s, e) => {
    const kids = e.children ?? [];
    return s + (kids.length > 0 ? kids.filter((c) => c.checked).length : e.checked ? 1 : 0);
  }, 0);

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
      <div className="bg-todo text-todo-foreground px-4 py-2.5 text-sm font-semibold tracking-wide uppercase flex items-center justify-between">
        <span>To-Do</span>
        {totalCount > 0 && (
          <span className="text-xs font-normal opacity-80 tabular-nums">
            {checkedCount} / {totalCount}
          </span>
        )}
      </div>
      <div className="divide-y divide-border">
        {pendingNest && (() => {
          const from = entries.find((e) => e.id === pendingNest.fromId);
          const to = entries.find((e) => e.id === pendingNest.toId);
          if (!from || !to) return null;
          const kidCount = (from.children ?? []).length;
          return (
            <div className="px-3 py-2.5 bg-todo/10 border-b border-todo/30 flex flex-col gap-2">
              <span className="text-sm text-muted-foreground">
                Move{" "}
                <span className="font-medium text-foreground">{from.label || "Untitled"}</span>
                {kidCount > 0 && (
                  <> (+{kidCount} sub-item{kidCount !== 1 ? "s" : ""})</>
                )}{" "}
                under{" "}
                <span className="font-medium text-foreground">{to.label || "Untitled"}</span>?
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => nestInto(pendingNest.fromId, pendingNest.toId)}
                  className="flex-1 text-xs px-2 py-1.5 rounded bg-todo text-todo-foreground hover:bg-todo/90 transition-colors"
                >
                  Nest here
                </button>
                <button
                  onClick={() => { reorder(pendingNest.fromId, pendingNest.toId); setPendingNest(null); }}
                  className="flex-1 text-xs px-2 py-1.5 rounded bg-muted hover:bg-muted/70 transition-colors"
                >
                  Move
                </button>
                <button
                  onClick={() => setPendingNest(null)}
                  className="flex-1 text-xs px-2 py-1.5 rounded border border-border hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          );
        })()}
        {entries.map((entry) => {
          const isOver = dragOverId === entry.id && dragId !== entry.id;
          const isDragging = dragId === entry.id;
          const isPending = pendingDelete === entry.id;
          const isExpanded = expandedRows.has(entry.id);
          const hasChildren = (entry.children ?? []).length > 0;

          return (
            <div key={entry.id}>
              {/* Parent row */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOverId(entry.id); }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId && dragId !== entry.id) {
                    setPendingNest({ fromId: dragId, toId: entry.id });
                  }
                  setDragId(null);
                  setDragOverId(null);
                }}
                className={`group px-3 py-2 transition-colors ${
                  isPending
                    ? "flex flex-col gap-2"
                    : "grid grid-cols-[auto_auto_1fr_auto] items-center gap-2"
                } ${isOver ? "border-t-2 border-todo bg-todo/5" : "hover:bg-muted/40"} ${
                  isDragging ? "opacity-40" : ""
                }`}
              >
                {isPending ? (
                  <>
                    <span className="text-sm text-muted-foreground px-1 truncate">
                      Remove{" "}
                      <span className="font-medium text-foreground">
                        {entry.label || "this item"}
                      </span>
                      ?
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => confirmDelete(entry.id)}
                        className="flex-1 text-xs px-2 py-1.5 rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                      >
                        Remove
                      </button>
                      <button
                        onClick={() => setPendingDelete(null)}
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
                        className="flex items-center justify-center cursor-grab active:cursor-grabbing text-muted-foreground/60 hover:text-muted-foreground transition-colors shrink-0 select-none"
                      >
                        <GripVertical className="size-4" />
                      </span>
                    ) : (
                      <span className="w-4 shrink-0" />
                    )}

                    <input
                      type="checkbox"
                      checked={entry.checked}
                      disabled={readOnly}
                      onChange={(e) => toggleParent(entry.id, e.target.checked)}
                      className="size-4 accent-[var(--todo)] cursor-pointer shrink-0 disabled:cursor-default"
                    />

                    <div className="flex items-center gap-1 min-w-0">
                      {hasChildren && (
                        <button
                          onClick={() => toggleExpand(entry.id)}
                          className="text-muted-foreground/50 hover:text-muted-foreground transition-colors shrink-0"
                        >
                          {isExpanded ? (
                            <ChevronDown className="size-3.5" />
                          ) : (
                            <ChevronRight className="size-3.5" />
                          )}
                        </button>
                      )}
                      <input
                        type="text"
                        value={entry.label}
                        readOnly={readOnly}
                        onChange={(e) => updateEntry(entry.id, { label: e.target.value })}
                        placeholder="Item"
                        className={`bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 focus:bg-background rounded px-1 py-1 min-w-0 flex-1 read-only:cursor-default ${
                          entry.checked ? "line-through text-muted-foreground" : ""
                        }`}
                      />
                      {hasChildren && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0 tabular-nums">
                          {(entry.children ?? []).filter((c) => c.checked).length}/
                          {(entry.children ?? []).length}
                        </span>
                      )}
                    </div>

                    {!readOnly ? (
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          onClick={() => addChild(entry.id)}
                          className="p-1 rounded text-foreground/30 hover:text-foreground hover:bg-muted transition-colors"
                          title="Add sub-item"
                        >
                          <Plus className="size-3.5" />
                        </button>
                        <button
                          onClick={() => setPendingDelete(entry.id)}
                          className="p-1 rounded text-foreground/30 hover:text-destructive transition-colors"
                          title="Remove item"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    ) : (
                      <span className="w-[3.25rem] shrink-0" />
                    )}
                  </>
                )}
              </div>

              {/* Children */}
              {isExpanded &&
                (entry.children ?? []).map((child) => (
                  <div
                    key={child.id}
                    className="group flex items-center gap-2 pl-10 pr-3 py-1.5 bg-muted/20 hover:bg-muted/40 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={child.checked}
                      disabled={readOnly}
                      onChange={(e) => toggleChild(entry.id, child.id, e.target.checked)}
                      className="size-3.5 accent-[var(--todo)] cursor-pointer shrink-0 disabled:cursor-default"
                    />
                    <input
                      type="text"
                      value={child.label}
                      readOnly={readOnly}
                      onChange={(e) =>
                        updateEntry(entry.id, {
                          children: (entry.children ?? []).map((c) =>
                            c.id === child.id ? { ...c, label: e.target.value } : c,
                          ),
                        })
                      }
                      placeholder="Sub-item"
                      className={`flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 focus:bg-background rounded px-1 py-0.5 min-w-0 read-only:cursor-default ${
                        child.checked ? "line-through text-muted-foreground" : ""
                      }`}
                    />
                    {!readOnly && (
                      <button
                        onClick={() => deleteChild(entry.id, child.id)}
                        className="p-0.5 rounded text-foreground/30 hover:text-destructive transition-colors shrink-0"
                        title="Remove sub-item"
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </div>
                ))}
            </div>
          );
        })}

        {!readOnly && (
          <button
            onClick={addEntry}
            className="w-full flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
          >
            <Plus className="size-3.5" /> Add item
          </button>
        )}
        {entries.length === 0 && readOnly && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No items yet.
          </div>
        )}
      </div>
    </div>
  );
}
