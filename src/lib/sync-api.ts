export type SyncBudget = {
  id: string;
  data: string;
  updatedAt: number;
  shareCode: string | null;
};

export type Permission = {
  deviceId: string;
  canWrite: boolean;
};

export type SharedBudgetResult = {
  id: string;
  data: string;
  updatedAt: number;
  canWrite: boolean;
};

async function apiFetch(path: string, options?: RequestInit & { deviceId: string }): Promise<Response | null> {
  const { deviceId, ...rest } = options ?? { deviceId: "" };
  try {
    const res = await fetch(path, {
      ...rest,
      headers: {
        ...rest.headers,
        "X-Device-Id": deviceId,
        ...(rest.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    return res;
  } catch {
    return null;
  }
}

export async function syncOwnedBudgets(
  deviceId: string,
  budgets: SyncBudget[],
): Promise<SyncBudget[] | null> {
  const res = await apiFetch("/api/sync", {
    deviceId,
    method: "POST",
    body: JSON.stringify({ budgets }),
  });
  if (!res || !res.ok) return null;
  try {
    const data = (await res.json()) as { budgets: SyncBudget[] };
    return data.budgets;
  } catch {
    return null;
  }
}

export async function generateShareCode(budgetId: string, deviceId: string): Promise<string | null> {
  const res = await apiFetch("/api/share/generate", {
    deviceId,
    method: "POST",
    body: JSON.stringify({ budgetId }),
  });
  if (!res || !res.ok) return null;
  try {
    const data = (await res.json()) as { shareCode: string };
    return data.shareCode;
  } catch {
    return null;
  }
}

export async function disableShareCode(budgetId: string, deviceId: string): Promise<boolean> {
  const res = await apiFetch("/api/share/disable", {
    deviceId,
    method: "POST",
    body: JSON.stringify({ budgetId }),
  });
  return !!res?.ok;
}

export async function fetchSharedBudget(
  code: string,
  deviceId: string,
): Promise<SharedBudgetResult | null> {
  const res = await apiFetch(`/api/share/${encodeURIComponent(code)}`, { deviceId });
  if (!res || !res.ok) return null;
  try {
    return (await res.json()) as SharedBudgetResult;
  } catch {
    return null;
  }
}

export async function updateSharedBudget(
  code: string,
  deviceId: string,
  data: string,
  updatedAt: number,
): Promise<boolean> {
  const res = await apiFetch(`/api/share/${encodeURIComponent(code)}`, {
    deviceId,
    method: "PUT",
    body: JSON.stringify({ data, updatedAt }),
  });
  return !!res?.ok;
}

export async function getPermissions(
  budgetId: string,
  deviceId: string,
): Promise<Permission[] | null> {
  const res = await apiFetch(`/api/permissions/${encodeURIComponent(budgetId)}`, { deviceId });
  if (!res || !res.ok) return null;
  try {
    const data = (await res.json()) as { permissions: Permission[] };
    return data.permissions;
  } catch {
    return null;
  }
}

export async function grantPermission(
  budgetId: string,
  ownerDeviceId: string,
  targetDeviceId: string,
  canWrite: boolean,
): Promise<boolean> {
  const res = await apiFetch(`/api/permissions/${encodeURIComponent(budgetId)}`, {
    deviceId: ownerDeviceId,
    method: "POST",
    body: JSON.stringify({ deviceId: targetDeviceId, canWrite }),
  });
  return !!res?.ok;
}

export async function revokePermission(
  budgetId: string,
  ownerDeviceId: string,
  targetDeviceId: string,
): Promise<boolean> {
  const res = await apiFetch(
    `/api/permissions/${encodeURIComponent(budgetId)}/${encodeURIComponent(targetDeviceId)}`,
    { deviceId: ownerDeviceId, method: "DELETE" },
  );
  return !!res?.ok;
}
