import { useSyncExternalStore } from 'react';

export type PasteDefaultTypeV1 = 'all' | 'values' | 'formulas' | 'formats';

export interface PasteDefaultsPreferenceV1 {
  version: 1;
  defaultPasteType: PasteDefaultTypeV1;
  skipBlanks: boolean;
  transpose: boolean;
}

export const PASTE_DEFAULTS_STORAGE_KEY = 'mog.spreadsheet.pasteDefaults.v1';

export const LEGACY_PASTE_DEFAULTS_V1: PasteDefaultsPreferenceV1 = {
  version: 1,
  defaultPasteType: 'all',
  skipBlanks: false,
  transpose: false,
};

const DEFAULT_TYPES = new Set<PasteDefaultTypeV1>(['all', 'values', 'formulas', 'formats']);
const listeners = new Set<() => void>();
let cachedPreference: PasteDefaultsPreferenceV1 | null = null;

function cloneLegacy(): PasteDefaultsPreferenceV1 {
  return { ...LEGACY_PASTE_DEFAULTS_V1 };
}

function samePreference(
  a: PasteDefaultsPreferenceV1 | null,
  b: PasteDefaultsPreferenceV1,
): a is PasteDefaultsPreferenceV1 {
  return (
    a !== null &&
    a.version === b.version &&
    a.defaultPasteType === b.defaultPasteType &&
    a.skipBlanks === b.skipBlanks &&
    a.transpose === b.transpose
  );
}

function cachePreference(next: PasteDefaultsPreferenceV1): PasteDefaultsPreferenceV1 {
  if (samePreference(cachedPreference, next)) return cachedPreference;
  cachedPreference = next;
  return cachedPreference;
}

function getStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function sanitizePasteDefaultsPreference(value: unknown): PasteDefaultsPreferenceV1 {
  if (!value || typeof value !== 'object') return cloneLegacy();

  const candidate = value as Partial<PasteDefaultsPreferenceV1>;
  if (candidate.version !== 1) return cloneLegacy();
  if (!DEFAULT_TYPES.has(candidate.defaultPasteType as PasteDefaultTypeV1)) return cloneLegacy();
  if (typeof candidate.skipBlanks !== 'boolean') return cloneLegacy();
  if (typeof candidate.transpose !== 'boolean') return cloneLegacy();

  return {
    version: 1,
    defaultPasteType: candidate.defaultPasteType as PasteDefaultTypeV1,
    skipBlanks: candidate.skipBlanks,
    transpose: candidate.transpose,
  };
}

export function readPasteDefaultsPreference(): PasteDefaultsPreferenceV1 {
  const storage = getStorage();
  if (!storage) return cachePreference(cloneLegacy());

  try {
    const raw = storage.getItem(PASTE_DEFAULTS_STORAGE_KEY);
    if (!raw) return cachePreference(cloneLegacy());
    return cachePreference(sanitizePasteDefaultsPreference(JSON.parse(raw)));
  } catch {
    return cachePreference(cloneLegacy());
  }
}

export function writePasteDefaultsPreference(next: PasteDefaultsPreferenceV1): void {
  const sanitized = sanitizePasteDefaultsPreference(next);
  cachePreference(sanitized);
  const storage = getStorage();

  try {
    storage?.setItem(PASTE_DEFAULTS_STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    // Paste execution and app boot must never depend on localStorage writes.
  }

  for (const listener of listeners) listener();
}

export function subscribePasteDefaultsPreference(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePasteDefaultsPreference(): PasteDefaultsPreferenceV1 {
  return useSyncExternalStore(
    subscribePasteDefaultsPreference,
    readPasteDefaultsPreference,
    () => LEGACY_PASTE_DEFAULTS_V1,
  );
}
