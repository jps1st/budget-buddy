CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  owner_device_id TEXT NOT NULL,
  ro_token TEXT UNIQUE,
  rw_token TEXT UNIQUE,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_budgets_owner ON budgets(owner_device_id);
