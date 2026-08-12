import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { FolderClosed, FolderOpen, FileText, ArrowLeft, RefreshCw } from "lucide-react";
import type { Entry } from "@/components/BudgetTable";

export const Route = createFileRoute("/all")({
  component: AllPage,
  head: () => ({ meta: [{ title: "All budgets — audit" }] }),
});

type AdminBudget = {
  id: string;
  ownerDeviceId: string;
  data: string;
  updatedAt: number;
  hasRoToken: boolean;
  hasRwToken: boolean;
};

type AdminWorkspace = {
  id: string;
  ownerDeviceId: string;
  name: string;
  updatedAt: number;
  hasRoToken: boolean;
  hasRwToken: boolean;
};

type AdminDump = {
  budgets: AdminBudget[];
  workspaces: AdminWorkspace[];
  workspaceBudgets: { workspaceId: string; budgetId: string; position: number }[];
};

type ParsedBudgetData = {
  title?: string;
  subtitle?: string;
  income?: Entry[];
  expenses?: Entry[];
  archived?: boolean;
  type?: string;
};

const UNFILED = "__unfiled__";

function parseBudgetData(raw: string): ParsedBudgetData {
  try {
    return JSON.parse(raw) as ParsedBudgetData;
  } catch {
    return {};
  }
}

function sum(entries: Entry[] | undefined): number {
  if (!Array.isArray(entries)) return 0;
  return entries.reduce((acc, e) => acc + (typeof e.amount === "number" ? e.amount : 0), 0);
}

function fmtDate(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

function fmtAmount(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function AllPage() {
  const [dump, setDump] = useState<AdminDump | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [budgetId, setBudgetId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/all");
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = (await res.json()) as AdminDump;
      setDump(json);
    } catch {
      setError("Failed to load data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const budgetsById = useMemo(() => {
    const m = new Map<string, AdminBudget>();
    for (const b of dump?.budgets ?? []) m.set(b.id, b);
    return m;
  }, [dump]);

  const budgetIdsByFolder = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const wb of dump?.workspaceBudgets ?? []) {
      const list = m.get(wb.workspaceId) ?? [];
      list.push(wb.budgetId);
      m.set(wb.workspaceId, list);
    }
    return m;
  }, [dump]);

  const filedBudgetIds = useMemo(() => {
    const s = new Set<string>();
    for (const wb of dump?.workspaceBudgets ?? []) s.add(wb.budgetId);
    return s;
  }, [dump]);

  const unfiledBudgets = useMemo(
    () => (dump?.budgets ?? []).filter((b) => !filedBudgetIds.has(b.id)),
    [dump, filedBudgetIds],
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (error || !dump) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-4">
        <p className="text-sm text-destructive">{error ?? "No data."}</p>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-md border border-input px-4 py-2 text-sm hover:bg-accent"
        >
          <RefreshCw className="size-3.5" /> Retry
        </button>
      </div>
    );
  }

  const selectedBudget = budgetId ? budgetsById.get(budgetId) : undefined;

  if (selectedBudget) {
    return <BudgetDetail budget={selectedBudget} onBack={() => setBudgetId(null)} />;
  }

  if (folderId !== null) {
    const isUnfiled = folderId === UNFILED;
    const folder = isUnfiled ? undefined : dump.workspaces.find((w) => w.id === folderId);
    const ids = isUnfiled
      ? unfiledBudgets.map((b) => b.id)
      : budgetIdsByFolder.get(folderId) ?? [];
    const budgets = ids.map((id) => budgetsById.get(id)).filter((b): b is AdminBudget => !!b);

    return (
      <div className="min-h-screen bg-background px-4 py-8">
        <div className="mx-auto max-w-3xl">
          <button
            onClick={() => setFolderId(null)}
            className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> All folders
          </button>
          <h1 className="text-xl font-semibold text-foreground mb-1">
            {isUnfiled ? "Unfiled budgets" : folder?.name ?? "Unknown folder"}
          </h1>
          {!isUnfiled && folder && (
            <p className="text-xs text-muted-foreground mb-6">
              owner: {folder.ownerDeviceId} · updated {fmtDate(folder.updatedAt)}
            </p>
          )}
          {isUnfiled && <p className="text-xs text-muted-foreground mb-6">not in any workspace folder</p>}

          <div className="flex flex-col gap-2">
            {budgets.length === 0 && (
              <p className="text-sm text-muted-foreground">No budgets here.</p>
            )}
            {budgets.map((b) => {
              const parsed = parseBudgetData(b.data);
              return (
                <button
                  key={b.id}
                  onClick={() => setBudgetId(b.id)}
                  className="flex items-center gap-3 rounded-md border border-border px-4 py-3 text-left hover:bg-accent transition-colors"
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">
                      {parsed.title || "Untitled"}
                      {parsed.archived && (
                        <span className="ml-2 text-xs text-muted-foreground">(archived)</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      owner: {b.ownerDeviceId} · updated {fmtDate(b.updatedAt)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-foreground">All budgets &amp; folders</h1>
            <p className="text-xs text-muted-foreground mt-1">
              {dump.budgets.length} budget{dump.budgets.length === 1 ? "" : "s"} ·{" "}
              {dump.workspaces.length} folder{dump.workspaces.length === 1 ? "" : "s"} across all
              devices — for auditing/recovery only.
            </p>
          </div>
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-md border border-input px-3 py-1.5 text-xs hover:bg-accent shrink-0"
          >
            <RefreshCw className="size-3.5" /> Refresh
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {dump.workspaces.map((w) => {
            const count = (budgetIdsByFolder.get(w.id) ?? []).length;
            return (
              <button
                key={w.id}
                onClick={() => setFolderId(w.id)}
                className="flex items-center gap-3 rounded-md border border-border px-4 py-3 text-left hover:bg-accent transition-colors"
              >
                <FolderClosed className="size-4 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{w.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    owner: {w.ownerDeviceId} · {count} budget{count === 1 ? "" : "s"} · updated{" "}
                    {fmtDate(w.updatedAt)}
                  </div>
                </div>
              </button>
            );
          })}

          <button
            onClick={() => setFolderId(UNFILED)}
            className="flex items-center gap-3 rounded-md border border-border px-4 py-3 text-left hover:bg-accent transition-colors"
          >
            <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-foreground truncate">Unfiled budgets</div>
              <div className="text-xs text-muted-foreground truncate">
                {unfiledBudgets.length} budget{unfiledBudgets.length === 1 ? "" : "s"} not in a
                folder
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

function BudgetDetail({ budget, onBack }: { budget: AdminBudget; onBack: () => void }) {
  const parsed = parseBudgetData(budget.data);
  const income = Array.isArray(parsed.income) ? parsed.income : [];
  const expenses = Array.isArray(parsed.expenses) ? parsed.expenses : [];
  const [showRaw, setShowRaw] = useState(false);

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <button
          onClick={onBack}
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Back
        </button>

        <h1 className="text-xl font-semibold text-foreground mb-1">{parsed.title || "Untitled"}</h1>
        {parsed.subtitle && <p className="text-sm text-muted-foreground mb-1">{parsed.subtitle}</p>}
        <p className="text-xs text-muted-foreground mb-6">
          id: {budget.id} · owner: {budget.ownerDeviceId} · updated {fmtDate(budget.updatedAt)}
          {parsed.archived && " · archived"}
          {budget.hasRoToken && " · has read-only share link"}
          {budget.hasRwToken && " · has read-write share link"}
        </p>

        <div className="grid gap-6 sm:grid-cols-2">
          <EntryList title="Income" entries={income} />
          <EntryList title="Expenses" entries={expenses} />
        </div>

        <div className="mt-6">
          <button
            onClick={() => setShowRaw((v) => !v)}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {showRaw ? "Hide" : "Show"} raw JSON
          </button>
          {showRaw && (
            <pre className="mt-2 max-h-96 overflow-auto rounded-md border border-border bg-muted p-3 text-xs">
              {JSON.stringify(parsed, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function EntryList({ title, entries }: { title: string; entries: Entry[] }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        <span className="text-xs text-muted-foreground">{fmtAmount(sum(entries))}</span>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">None</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center justify-between text-xs">
              <span className="text-foreground truncate">{e.label || "(unlabeled)"}</span>
              <span className="text-muted-foreground shrink-0 ml-2">{fmtAmount(e.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
