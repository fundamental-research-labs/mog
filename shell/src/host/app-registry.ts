/**
 * App Registry — runtime-mutable registry of discovered apps.
 *
 * Consumers import `APP_IDS`, `APP_MANIFESTS`, `APP_LOADERS` to read
 * the current set of registered apps. Registration happens via
 * `registerApps()`, which is called as a side-effect import from
 * `@mog/app-spreadsheet/register` at each app entrypoint.
 */

import type { AppManifest } from '@mog-sdk/contracts/apps';

import type { AppLoader } from '../apps/types';

// ---------------------------------------------------------------------------
// Mutable registry state
// ---------------------------------------------------------------------------

export const APP_IDS: string[] = [];
export const APP_MANIFESTS: Record<string, AppManifest> = {};
export const APP_LOADERS: Record<string, AppLoader> = {};

// ---------------------------------------------------------------------------
// Registration API
// ---------------------------------------------------------------------------

/**
 * Populate the registry. Called once at startup from a side-effect import
 * (e.g. `@mog/app-spreadsheet/register`).
 *
 * Safe to call multiple times — each call replaces the previous contents.
 */
export function registerApps(
  manifests: Record<string, AppManifest>,
  loaders: Record<string, AppLoader>,
): void {
  // Clear previous entries
  APP_IDS.length = 0;
  for (const k of Object.keys(APP_MANIFESTS)) delete APP_MANIFESTS[k];
  for (const k of Object.keys(APP_LOADERS)) delete APP_LOADERS[k];

  // Populate
  APP_IDS.push(...Object.keys(manifests));
  Object.assign(APP_MANIFESTS, manifests);
  Object.assign(APP_LOADERS, loaders);
}
