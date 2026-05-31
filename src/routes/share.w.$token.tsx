import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { loadAll, loadAllWorkspaces, putBudget, putWorkspace, type BudgetRow } from "@/lib/budget-storage";
import { fetchWorkspaceByToken } from "@/lib/sync-api";
import type { Entry } from "@/components/BudgetTable";

export const Route = createFileRoute("/share/w/$token")({
  component: ShareWorkspacePage,
  head: () => ({ meta: [{ title: "Opening shared workspace…" }] }),
});

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function sanitize(arr: unknown): Entry[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => ({
      id: typeof e.id === "string" ? e.id : uuid(),
      label: typeof e.label === "string" ? e.label : "",
      amount: typeof e.amount === "number" ? e.amount : parseFloat(String(e.amount)) || 0,
    }));
}

function ShareWorkspacePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const allWorkspaces = await loadAllWorkspaces();
        const existing = allWorkspaces.find((w) => w.syncSource?.token === token);
        if (existing) {
          void navigate({ to: "/" });
          return;
        }

        const result = await fetchWorkspaceByToken(token);
        if (!result) {
          setError("This workspace share link is invalid or has been revoked.");
          return;
        }

        const allBudgets = await loadAll();
        const wsId = uuid();
        const budgetIds: string[] = [];

        for (const remoteBudget of result.budgets) {
          const existingBudget = allBudgets.find((b) => b.syncSource?.workspaceBudgetId === remoteBudget.id && b.syncSource?.token === token);
          if (existingBudget) {
            budgetIds.push(existingBudget.id);
            continue;
          }

          let parsed: Partial<BudgetRow> = {};
          try {
            parsed = JSON.parse(remoteBudget.data) as Partial<BudgetRow>;
          } catch { /* keep defaults */ }

          const nb: BudgetRow = {
            id: uuid(),
            title: typeof parsed.title === "string" ? parsed.title : "Shared Budget",
            subtitle: typeof parsed.subtitle === "string" ? parsed.subtitle : "",
            income: sanitize(parsed.income),
            expenses: sanitize(parsed.expenses),
            archived: false,
            updatedAt: remoteBudget.updatedAt,
            order: Date.now(),
            syncSource: { token, canWrite: result.canWrite, workspaceBudgetId: remoteBudget.id },
            undoStack: [],
            redoStack: [],
          };

          await putBudget(nb);
          budgetIds.push(nb.id);
        }

        await putWorkspace({
          id: wsId,
          name: result.name,
          budgetIds,
          order: Date.now(),
          syncSource: { token, canWrite: result.canWrite },
        });

        void navigate({ to: "/" });
      } catch {
        setError("Failed to open shared workspace. Please try again.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (error) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-4">
        <p className="text-sm text-destructive text-center">{error}</p>
        <a
          href="/"
          className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
        >
          Go to app
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground text-sm">
      Opening shared workspace…
    </div>
  );
}
