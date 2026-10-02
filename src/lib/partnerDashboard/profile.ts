// =============================================================================
// Partner Dashboard — client-side localStorage helpers
// =============================================================================
// No full auth yet (per the brief), so identity is a name in localStorage.
// Every accessor is wrapped in try/catch: Safari private mode and quota-full
// states throw on localStorage access, and a storage failure must never take
// the dashboard down.
// =============================================================================

import { DEFAULT_AUTHOR, LS_KEYS } from "./config";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable or full — best effort only */
  }
}

function readJson<T>(key: string, fallback: T): T {
  const raw = read(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    write(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

// --- Author profile ---------------------------------------------------------

export function getAuthor(): string {
  return read(LS_KEYS.profile) || DEFAULT_AUTHOR;
}

export function setAuthor(author: string): void {
  write(LS_KEYS.profile, author);
}

// --- Shared passcode --------------------------------------------------------

export function getPasscode(): string {
  return read(LS_KEYS.passcode) || "";
}

export function setPasscode(passcode: string): void {
  write(LS_KEYS.passcode, passcode);
}

export function clearPasscode(): void {
  try {
    window.localStorage.removeItem(LS_KEYS.passcode);
  } catch {
    /* ignore */
  }
}

// --- "Last seen" markers, used for the unread badge -------------------------
// Stored as { [projectId]: ISO timestamp }. A row shows a notify badge when
// its newest comment (not authored by the current user) is later than the
// stored marker.

export function getLastSeenMap(): Record<string, string> {
  return readJson<Record<string, string>>(LS_KEYS.lastSeen, {});
}

export function getLastSeen(projectId: string): string | null {
  return getLastSeenMap()[projectId] ?? null;
}

export function markSeen(projectId: string, isoTimestamp: string): void {
  const map = getLastSeenMap();
  const existing = map[projectId];
  // Never move the marker backwards.
  if (!existing || new Date(isoTimestamp) > new Date(existing)) {
    map[projectId] = isoTimestamp;
  }
  writeJson(LS_KEYS.lastSeen, map);
}

// --- Which threads are expanded --------------------------------------------
// Persisted so a refresh does not collapse the thread you were reading.

export function getOpenThreads(): string[] {
  return readJson<string[]>(LS_KEYS.openThreads, []);
}

export function setOpenThreads(ids: string[]): void {
  writeJson(LS_KEYS.openThreads, ids);
}

// --- Offline comment cache --------------------------------------------------

export function cacheComments(projectId: string, comments: unknown): void {
  const all = readJson<Record<string, unknown>>(LS_KEYS.comments, {});
  all[projectId] = comments;
  writeJson(LS_KEYS.comments, all);
}

export function readCachedComments<T>(projectId: string): T | null {
  const all = readJson<Record<string, T>>(LS_KEYS.comments, {} as Record<string, T>);
  return all[projectId] ?? null;
}

export function readAllCachedComments<T>(): Record<string, T> {
  return readJson<Record<string, T>>(LS_KEYS.comments, {} as Record<string, T>);
}
