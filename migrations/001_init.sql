CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  owner_device_id TEXT NOT NULL,
  share_code TEXT UNIQUE,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS budget_access (
  budget_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  can_write INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (budget_id, device_id),
  FOREIGN KEY (budget_id) REFERENCES budgets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_budgets_owner ON budgets(owner_device_id);
