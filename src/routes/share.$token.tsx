import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getDeviceId, loadAll, putBudget, type BudgetRow } from "@/lib/budget-storage";
import { fetchByToken } from "@/lib/sync-api";
import { sanitizeEntries } from "@/lib/sanitize-entries";
import { uuid } from "@/lib/utils";

export const Route = createFileRoute("/share/$token")({
  component: SharePage,
  head: () => ({ meta: [{ title: "Opening shared budget…" }] }),
});

function SharePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // If already imported, just navigate home
        const all = await loadAll();
        const existing = all.find((b) => b.syncSource?.token === token);
        if (existing) {
          void navigate({ to: "/" });
          return;
        }

        const result = await fetchByToken(token);
        if (!result) {
          setError("This share link is invalid or has been revoked.");
          return;
        }

        let parsed: Partial<BudgetRow> = {};
        try {
          parsed = JSON.parse(result.data) as Partial<BudgetRow>;
        } catch { /* keep defaults */ }

        const nb: BudgetRow = {
          id: uuid(),
          title: typeof parsed.title === "string" ? parsed.title : "Shared Budget",
          subtitle: typeof parsed.subtitle === "string" ? parsed.subtitle : "",
          income: sanitizeEntries(parsed.income),
          expenses: sanitizeEntries(parsed.expenses),
          archived: false,
          updatedAt: result.updatedAt,
          order: Date.now(),
          syncSource: { token, canWrite: result.canWrite },
          undoStack: [],
          redoStack: [],
        };

        await putBudget(nb);
        void navigate({ to: "/" });
      } catch {
        setError("Failed to open shared budget. Please try again.");
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
      Opening shared budget…
    </div>
  );
}
