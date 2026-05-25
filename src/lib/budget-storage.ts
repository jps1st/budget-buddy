import { openDB, type IDBPDatabase } from "idb";
import type { Entry } from "@/components/BudgetTable";

export type BudgetSnapshot = {
  title: string;
  subtitle: string;
  income: Entry[];
  expenses: Entry[];
};

export type BudgetRow = {
  id: string;
  title: string;
  subtitle: string;
  income: Entry[];
  expenses: Entry[];
  archived: boolean;
  archivedAt?: number;
  updatedAt: number;
  order: number;
  undoStack?: BudgetSnapshot[];
  redoStack?: BudgetSnapshot[];
};

export interface Meta {
  activeId: string | null;
}

const DB_NAME = "budget-app";
const DB_VERSION = 1;
const STORE_BUDGETS = "budgets";
const STORE_META = "meta";

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_BUDGETS)) {
          const s = db.createObjectStore(STORE_BUDGETS, { keyPath: "id" });
          s.createIndex("archived", "archived");
          s.createIndex("order", "order");
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }
      },
    });
  }
  return dbPromise;
}

export async function loadAll(): Promise<BudgetRow[]> {
  const db = await getDB();
  return (await db.getAll(STORE_BUDGETS)) as BudgetRow[];
}

export async function putBudget(b: BudgetRow): Promise<void> {
  const db = await getDB();
  await db.put(STORE_BUDGETS, b);
}

export async function deleteBudget(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_BUDGETS, id);
}

export async function getMeta(): Promise<Meta> {
  const db = await getDB();
  const activeId = (await db.get(STORE_META, "activeId")) as string | null | undefined;
  return { activeId: activeId ?? null };
}

export async function setActiveId(activeId: string | null): Promise<void> {
  const db = await getDB();
  await db.put(STORE_META, activeId, "activeId");
}
