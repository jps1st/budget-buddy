export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// A trailing "*group-name" tag on a label assigns the item to a summary group,
// e.g. "Milk *cash" → name "Milk", group "cash".
export function parseGroupTag(label: string): { name: string; group: string | null } {
  const m = label.match(/\*([^\s*]+)\s*$/);
  if (!m) return { name: label.trim(), group: null };
  const name = label.slice(0, m.index).trim();
  return { name: name || label.trim(), group: m[1] };
}

export type GroupItem = { id: string; label: string; amount: number; completed?: boolean };
export type Group = { key: string; name: string; items: GroupItem[]; total: number };

type GroupableItem = { id: string; label: string; amount: number; completed?: boolean };
type GroupableEntry = GroupableItem & { subItems?: GroupableItem[] };

// Items with sub-items already fold their sub-items' amounts into their own total, so only
// the sub-items (not the parent) are considered here to avoid double-counting group sums.
function collectTagged(entries: GroupableEntry[]): Map<string, Group> {
  const map = new Map<string, Group>();

  const addItem = (id: string, rawLabel: string, amount: number, completed: boolean | undefined) => {
    const { name, group } = parseGroupTag(rawLabel);
    if (!group) return;
    const key = group.toLowerCase();
    let g = map.get(key);
    if (!g) {
      g = { key, name: group, items: [], total: 0 };
      map.set(key, g);
    }
    g.items.push({ id, label: name || "Untitled", amount, completed });
    g.total = round2(g.total + amount);
  };

  for (const entry of entries) {
    const subItems = entry.subItems ?? [];
    if (subItems.length > 0) {
      for (const si of subItems) addItem(si.id, si.label, si.amount, si.completed);
    } else {
      addItem(entry.id, entry.label, entry.amount, entry.completed);
    }
  }

  return map;
}

// A group is only valid when it's defined on the income (Money In) side — but a Money In
// entry names a group by its own plain label, not by carrying a matching *tag itself: an
// expense tagged "*cash" belongs to the Money In entry literally labeled "cash".
export function buildGroups(incomeEntries: GroupableEntry[], expenseEntries: GroupableEntry[]): Group[] {
  const expenseTagged = collectTagged(expenseEntries);

  const groups: Group[] = [];
  for (const [key, expenseGroup] of expenseTagged) {
    const incomeItems: GroupItem[] = [];
    for (const entry of incomeEntries) {
      const subItems = entry.subItems ?? [];
      if (subItems.length > 0) {
        for (const si of subItems) {
          if (si.label.trim().toLowerCase() === key) {
            incomeItems.push({ id: si.id, label: si.label.trim(), amount: si.amount, completed: si.completed });
          }
        }
      } else if (entry.label.trim().toLowerCase() === key) {
        incomeItems.push({ id: entry.id, label: entry.label.trim(), amount: entry.amount, completed: entry.completed });
      }
    }
    if (incomeItems.length === 0) continue;

    const items = [...incomeItems, ...expenseGroup.items];
    groups.push({
      key,
      name: incomeItems[0].label,
      items,
      total: round2(items.reduce((s, i) => s + i.amount, 0)),
    });
  }

  return groups.sort((a, b) => a.name.localeCompare(b.name));
}
