import { useEffect, useState } from "react";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** Polls /api/version and flags when the server is running a newer build than this page loaded. */
export function useAppUpdate(currentVersion: string): boolean {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { version?: string };
        if (!cancelled && data.version && data.version !== currentVersion) {
          setUpdateAvailable(true);
        }
      } catch {
        /* offline or transient network error — retry on the next interval */
      }
    };

    void check();
    const interval = setInterval(() => void check(), CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [currentVersion]);

  return updateAvailable;
}
