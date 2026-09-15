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

export type GroupItem = { id: string; label: string; amount: number };
export type Group = { key: string; name: string; items: GroupItem[]; total: number };

type GroupableEntry = {
  id: string;
  label: string;
  amount: number;
  subItems?: { id: string; label: string; amount: number }[];
};

// Items with sub-items already fold their sub-items' amounts into their own total, so only
// the sub-items (not the parent) are considered here to avoid double-counting group sums.
function collectTagged(entries: GroupableEntry[]): Map<string, Group> {
  const map = new Map<string, Group>();

  const addItem = (id: string, rawLabel: string, amount: number) => {
    const { name, group } = parseGroupTag(rawLabel);
    if (!group) return;
    const key = group.toLowerCase();
    let g = map.get(key);
    if (!g) {
      g = { key, name: group, items: [], total: 0 };
      map.set(key, g);
    }
    g.items.push({ id, label: name || "Untitled", amount });
    g.total = round2(g.total + amount);
  };

  for (const entry of entries) {
    const subItems = entry.subItems ?? [];
    if (subItems.length > 0) {
      for (const si of subItems) addItem(si.id, si.label, si.amount);
    } else {
      addItem(entry.id, entry.label, entry.amount);
    }
  }

  return map;
}

// A group is only valid when it's defined on the income (Money In) side — expense items
// tagged with a group name that has no matching income entry are left ungrouped.
export function buildGroups(incomeEntries: GroupableEntry[], expenseEntries: GroupableEntry[]): Group[] {
  const incomeTagged = collectTagged(incomeEntries);
  const expenseTagged = collectTagged(expenseEntries);

  const groups: Group[] = [];
  for (const [key, incomeGroup] of incomeTagged) {
    const expenseGroup = expenseTagged.get(key);
    const items = [...incomeGroup.items, ...(expenseGroup?.items ?? [])];
    groups.push({
      key,
      name: incomeGroup.name,
      items,
      total: round2(items.reduce((s, i) => s + i.amount, 0)),
    });
  }

  return groups.sort((a, b) => a.name.localeCompare(b.name));
}
