function round2(n: number): number {
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
export function buildGroups(entries: GroupableEntry[]): Group[] {
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

  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}
