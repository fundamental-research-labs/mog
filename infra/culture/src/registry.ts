/**
 * Culture Registry
 *
 * Pure lookup functions over culture definitions.
 * Single source of truth — all other packages import from here.
 */

import type { CultureInfo } from '@mog-sdk/contracts/culture';

import {
  DE_DE,
  EN_GB,
  EN_US,
  ES_ES,
  FR_FR,
  IT_IT,
  JA_JP,
  KO_KR,
  PT_BR,
  ZH_CN,
} from './cultures.gen';

const CULTURE_MAP: Map<string, CultureInfo> = new Map([
  ['en-US', EN_US],
  ['en-GB', EN_GB],
  ['de-DE', DE_DE],
  ['fr-FR', FR_FR],
  ['es-ES', ES_ES],
  ['it-IT', IT_IT],
  ['pt-BR', PT_BR],
  ['ja-JP', JA_JP],
  ['zh-CN', ZH_CN],
  ['ko-KR', KO_KR],
]);

/**
 * Get CultureInfo by name.
 * Returns en-US as fallback if the culture is not found.
 */
export function getCulture(name: string): CultureInfo {
  return CULTURE_MAP.get(name) ?? EN_US;
}

/**
 * Get the default culture (en-US).
 */
export function getDefaultCulture(): CultureInfo {
  return EN_US;
}

/**
 * Get list of all supported culture names.
 * Derived from the map — no hand-maintained duplicate list.
 */
export function getSupportedCultures(): readonly string[] {
  return Array.from(CULTURE_MAP.keys());
}

/**
 * Check if a culture is supported.
 */
export function isCultureSupported(name: string): boolean {
  return CULTURE_MAP.has(name);
}

/**
 * Get all cultures as an array sorted by display name (useful for UI dropdowns).
 */
export function getAllCultures(): CultureInfo[] {
  return Array.from(CULTURE_MAP.values()).sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
}
