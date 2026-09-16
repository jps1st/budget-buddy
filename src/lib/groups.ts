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

// A Money In entry names a group by its own plain label, not by carrying a matching *tag
// itself: an expense tagged "*cash" belongs to the Money In entry literally labeled "cash".
// Returns that entry's (or matching sub-item's) label, used only to name/validate the group —
// the income entry itself is not a group member, since the summary is Money Out only.
function findIncomeGroupName(incomeEntries: GroupableEntry[], key: string): string | null {
  for (const entry of incomeEntries) {
    const subItems = entry.subItems ?? [];
    if (subItems.length > 0) {
      for (const si of subItems) {
        if (si.label.trim().toLowerCase() === key) return si.label.trim();
      }
    } else if (entry.label.trim().toLowerCase() === key) {
      return entry.label.trim();
    }
  }
  return null;
}

// A group is only valid when it's defined on the income (Money In) side, but the summary
// itself only lists Money Out (expense) items — the matching Money In entry just validates
// and names the group, it isn't counted as a member.
export function buildGroups(incomeEntries: GroupableEntry[], expenseEntries: GroupableEntry[]): Group[] {
  const expenseTagged = collectTagged(expenseEntries);

  const groups: Group[] = [];
  for (const [key, expenseGroup] of expenseTagged) {
    const name = findIncomeGroupName(incomeEntries, key);
    if (!name) continue;

    groups.push({
      key,
      name,
      items: expenseGroup.items,
      // Completed items are settled, so they no longer count toward the group's outstanding total.
      total: round2(expenseGroup.items.reduce((s, i) => s + (i.completed ? 0 : i.amount), 0)),
    });
  }

  return groups.sort((a, b) => a.name.localeCompare(b.name));
}
