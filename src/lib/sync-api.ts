export type SyncBudget = {
  id: string;
  data: string;
  updatedAt: number;
  expectedUpdatedAt?: number;
};

export type SyncConflict = { id: string; data: string; updatedAt: number };
export type SyncResult = { budgets: SyncBudget[]; conflicts: SyncConflict[] };

export type SharedPushResult =
  | { ok: true }
  | { conflict: true; serverData: string; serverUpdatedAt: number }
  | null;

export type ShareLinks = {
  roToken: string;
  rwToken: string;
};

export type SharedBudgetResult = {
  id: string;
  data: string;
  updatedAt: number;
  canWrite: boolean;
};

async function apiFetch(
  path: string,
  options?: RequestInit & { deviceId: string },
): Promise<Response | null> {
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
): Promise<SyncResult | null> {
  const res = await apiFetch("/api/sync", {
    deviceId,
    method: "POST",
    body: JSON.stringify({ budgets }),
  });
  if (!res || !res.ok) return null;
  try {
    const data = (await res.json()) as { budgets: SyncBudget[]; conflicts?: SyncConflict[] };
    return { budgets: data.budgets, conflicts: data.conflicts ?? [] };
  } catch {
    return null;
  }
}

export async function getShareLinks(
  budgetId: string,
  deviceId: string,
): Promise<ShareLinks | null> {
  const res = await apiFetch("/api/share/links", {
    deviceId,
    method: "POST",
    body: JSON.stringify({ budgetId }),
  });
  if (!res || !res.ok) return null;
  try {
    return (await res.json()) as ShareLinks;
  } catch {
    return null;
  }
}

export async function revokeShareLinks(
  budgetId: string,
  deviceId: string,
): Promise<boolean> {
  const res = await apiFetch("/api/share/links", {
    deviceId,
    method: "DELETE",
    body: JSON.stringify({ budgetId }),
  });
  return !!res?.ok;
}

export async function fetchByToken(token: string): Promise<SharedBudgetResult | null> {
  try {
    const res = await fetch(`/api/t/${encodeURIComponent(token)}`);
    if (!res.ok) return null;
    return (await res.json()) as SharedBudgetResult;
  } catch {
    return null;
  }
}

export async function updateByToken(
  token: string,
  deviceId: string,
  data: string,
  updatedAt: number,
  expectedUpdatedAt?: number,
): Promise<SharedPushResult> {
  const res = await apiFetch(`/api/t/${encodeURIComponent(token)}`, {
    deviceId,
    method: "PUT",
    body: JSON.stringify({ data, updatedAt, expectedUpdatedAt }),
  });
  if (!res) return null;
  if (res.status === 409) {
    try {
      const body = (await res.json()) as { data: string; updatedAt: number };
      return { conflict: true, serverData: body.data, serverUpdatedAt: body.updatedAt };
    } catch {
      return null;
    }
  }
  return res.ok ? { ok: true } : null;
}

export type WorkspaceLinks = { roToken: string; rwToken: string };
export type WorkspaceMeta = { id: string; name: string; budgetIds: string[] };
export type SharedWorkspaceResult = {
  name: string;
  canWrite: boolean;
  budgets: { id: string; data: string; updatedAt: number }[];
};

export async function createWorkspace(name: string, deviceId: string): Promise<WorkspaceMeta | null> {
  const res = await apiFetch("/api/workspaces", {
    deviceId,
    method: "POST",
    body: JSON.stringify({ name }),
  });
  if (!res || !res.ok) return null;
  try {
    return (await res.json()) as WorkspaceMeta;
  } catch {
    return null;
  }
}

export async function listWorkspaces(deviceId: string): Promise<WorkspaceMeta[] | null> {
  const res = await apiFetch("/api/workspaces", { deviceId, method: "GET" });
  if (!res || !res.ok) return null;
  try {
    return (await res.json()) as WorkspaceMeta[];
  } catch {
    return null;
  }
}

export async function renameWorkspace(id: string, name: string, deviceId: string): Promise<boolean> {
  const res = await apiFetch(`/api/workspaces/${id}`, {
    deviceId,
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
  return !!res?.ok;
}

export async function deleteWorkspaceAPI(id: string, deviceId: string): Promise<boolean> {
  const res = await apiFetch(`/api/workspaces/${id}`, { deviceId, method: "DELETE" });
  return !!res?.ok;
}

export async function addBudgetToWorkspace(workspaceId: string, budgetId: string, deviceId: string): Promise<boolean> {
  const res = await apiFetch(`/api/workspaces/${workspaceId}/budgets`, {
    deviceId,
    method: "POST",
    body: JSON.stringify({ budgetId }),
  });
  return !!res?.ok;
}

export async function removeBudgetFromWorkspace(workspaceId: string, budgetId: string, deviceId: string): Promise<boolean> {
  const res = await apiFetch(`/api/workspaces/${workspaceId}/budgets/${budgetId}`, {
    deviceId,
    method: "DELETE",
  });
  return !!res?.ok;
}

export async function getWorkspaceLinks(workspaceId: string, deviceId: string): Promise<WorkspaceLinks | null> {
  const res = await apiFetch("/api/workspace/links", {
    deviceId,
    method: "POST",
    body: JSON.stringify({ workspaceId }),
  });
  if (!res || !res.ok) return null;
  try {
    return (await res.json()) as WorkspaceLinks;
  } catch {
    return null;
  }
}

export async function revokeWorkspaceLinks(workspaceId: string, deviceId: string): Promise<boolean> {
  const res = await apiFetch("/api/workspace/links", {
    deviceId,
    method: "DELETE",
    body: JSON.stringify({ workspaceId }),
  });
  return !!res?.ok;
}

export async function createBudgetInWorkspace(
  token: string,
  data: string,
  updatedAt: number,
): Promise<{ budgetId: string } | null> {
  try {
    const res = await fetch(`/api/w/${encodeURIComponent(token)}/budgets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data, updatedAt }),
    });
    if (!res.ok) return null;
    return (await res.json()) as { budgetId: string };
  } catch {
    return null;
  }
}

export async function renameWorkspaceByToken(token: string, name: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/w/${encodeURIComponent(token)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function removeBudgetFromWorkspaceByToken(token: string, budgetId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/w/${encodeURIComponent(token)}/budgets/${encodeURIComponent(budgetId)}`, {
      method: "DELETE",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchWorkspaceByToken(token: string): Promise<SharedWorkspaceResult | null> {
  try {
    const res = await fetch(`/api/w/${encodeURIComponent(token)}`);
    if (!res.ok) return null;
    return (await res.json()) as SharedWorkspaceResult;
  } catch {
    return null;
  }
}

export async function forcePushByToken(
  token: string,
  deviceId: string,
  data: string,
  updatedAt: number,
): Promise<{ ok: true } | null> {
  const res = await apiFetch(`/api/t/${encodeURIComponent(token)}`, {
    deviceId,
    method: "PUT",
    body: JSON.stringify({ data, updatedAt, force: true }),
  });
  return res?.ok ? { ok: true } : null;
}

export async function forcePushWorkspaceByToken(
  token: string,
  budgetId: string,
  data: string,
  updatedAt: number,
): Promise<{ ok: true } | null> {
  try {
    const res = await fetch(`/api/w/${encodeURIComponent(token)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ budgetId, data, updatedAt, force: true }),
    });
    return res.ok ? { ok: true } : null;
  } catch {
    return null;
  }
}

export async function updateWorkspaceByToken(
  token: string,
  budgetId: string,
  data: string,
  updatedAt: number,
  expectedUpdatedAt?: number,
): Promise<SharedPushResult> {
  try {
    const res = await fetch(`/api/w/${encodeURIComponent(token)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ budgetId, data, updatedAt, expectedUpdatedAt }),
    });
    if (res.status === 409) {
      const body = (await res.json()) as { data: string; updatedAt: number };
      return { conflict: true, serverData: body.data, serverUpdatedAt: body.updatedAt };
    }
    return res.ok ? { ok: true } : null;
  } catch {
    return null;
  }
}
