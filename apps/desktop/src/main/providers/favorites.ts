import { settings } from "../core/config.js";

const MAX_PINNED = 500;

/** Keep persisted IDs bounded and deterministic while tolerating old config files. */
export function normalizePinnedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string" || !raw || raw.length > 512 || seen.has(raw)) continue;
    seen.add(raw);
    ids.push(raw);
    if (ids.length >= MAX_PINNED) break;
  }
  return ids;
}

export function getPinnedIds(): string[] {
  return normalizePinnedIds(settings.get().pinnedIds);
}

export function isPinned(id: string): boolean {
  return getPinnedIds().includes(id);
}

export function pin(id: string): string[] {
  const next = normalizePinnedIds([...getPinnedIds(), id]);
  settings.set({ pinnedIds: next });
  return next;
}

export function unpin(id: string): string[] {
  const next = getPinnedIds().filter((candidate) => candidate !== id);
  settings.set({ pinnedIds: next });
  return next;
}

export function setPinnedIds(value: unknown): string[] {
  const next = normalizePinnedIds(value);
  settings.set({ pinnedIds: next });
  return next;
}
