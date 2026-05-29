/**
 * Workbook Domain Module
 *
 * Delegates all data access to ComputeBridge (Rust compute-core).
 *
 * Architecture:
 * - Write operations: fire-and-forget via ctx.computeBridge
 * - Read operations: async via ctx.computeBridge
 * - Events: handled by MutationResultHandler from Rust MutationResult
 *
 * Stream L: Settings & Toggles
 *
 * @see compute-core/src/storage/workbook.rs - Rust implementation
 */

import type {
  CalculationSettings,
  WorkbookSettings,
  WorkbookSettingsPatch,
  SheetId,
} from '@mog-sdk/contracts/core';

import { DEFAULT_CALCULATION_SETTINGS, DEFAULT_WORKBOOK_SETTINGS } from './core-defaults';
import type { CustomList } from '@mog-sdk/contracts/fill';
import { BUILT_IN_LISTS } from '../fill/custom-lists';
import type {
  ProtectedWorkbookOperation,
  WorkbookProtectionOptions,
} from '@mog-sdk/contracts/protection';
import { DEFAULT_WORKBOOK_PROTECTION_OPTIONS } from '@mog-sdk/contracts/protection';
import { hashExcelPassword, verifyExcelPassword } from '@mog/spreadsheet-utils/protection';

import type { DocumentContext } from '../../context/types';
import { toComputeWorkbookSettings } from './workbook-settings-wire';
import { publicTableStyleId, tableStyleIdForCompute } from '../tables/style-normalization';

// =============================================================================
// Getters (ComputeBridge delegation)
// =============================================================================

/**
 * Get all workbook settings.
 *
 * Delegates to ComputeBridge.getWorkbookSettings().
 *
 * @param ctx - Store context
 * @returns Promise resolving to WorkbookSettings
 */
export async function getSettings(ctx: DocumentContext): Promise<WorkbookSettings> {
  return ctx.computeBridge.getWorkbookSettings() as Promise<WorkbookSettings>;
}

/**
 * Get a single workbook setting value.
 *
 * Reads full settings from ComputeBridge and extracts the requested key.
 *
 * @param ctx - Store context
 * @param key - Setting key
 * @returns Promise resolving to the setting value
 */
export async function getSetting<K extends keyof WorkbookSettings>(
  ctx: DocumentContext,
  key: K,
): Promise<WorkbookSettings[K]> {
  const settings = await getSettings(ctx);
  const value = settings[key];

  if (value !== undefined) {
    return value;
  }

  // Handle special case: calculationSettings needs nested defaults
  if (key === 'calculationSettings') {
    return { ...DEFAULT_CALCULATION_SETTINGS } as WorkbookSettings[K];
  }

  // Return undefined -- the caller should handle defaults if needed
  return value;
}

// =============================================================================
// Setters (ComputeBridge delegation -- fire-and-forget)
// =============================================================================

/**
 * Set a single workbook setting.
 *
 * Delegates to ComputeBridge.setWorkbookSettings().
 * MutationResultHandler drives event emission.
 *
 * @param ctx - Store context
 * @param key - Setting key
 * @param value - New value
 */
export async function setSetting<K extends keyof WorkbookSettings>(
  ctx: DocumentContext,
  key: K,
  value: WorkbookSettings[K],
): Promise<void> {
  void ctx.computeBridge.patchWorkbookSettings({ [key]: value } as WorkbookSettingsPatch);
}

/**
 * Set multiple workbook settings at once.
 *
 * Delegates to ComputeBridge.setWorkbookSettings().
 * MutationResultHandler drives event emission.
 *
 * @param ctx - Store context
 * @param updates - Partial settings object with values to update
 */
export async function setSettings(
  ctx: DocumentContext,
  updates: WorkbookSettingsPatch,
): Promise<void> {
  void ctx.computeBridge.patchWorkbookSettings(updates);
}

/**
 * Reset all workbook settings to defaults.
 *
 * @param ctx - Store context
 */
export async function resetSettings(ctx: DocumentContext): Promise<void> {
  await ctx.computeBridge.setWorkbookSettings(toComputeWorkbookSettings(DEFAULT_WORKBOOK_SETTINGS));
}

// =============================================================================
// G.3: Calculation Settings Functions
// =============================================================================

/**
 * Get calculation settings from store context.
 *
 * @param ctx - Store context
 * @returns Promise resolving to CalculationSettings with defaults applied
 */
export async function getCalculationSettings(ctx: DocumentContext): Promise<CalculationSettings> {
  const settings = await getSettings(ctx);
  return settings.calculationSettings ?? { ...DEFAULT_CALCULATION_SETTINGS };
}

/**
 * Update calculation settings.
 *
 * @param ctx - Store context
 * @param calcSettings - Partial calculation settings to update
 */
export async function setCalculationSettings(
  ctx: DocumentContext,
  calcSettings: Partial<CalculationSettings>,
): Promise<void> {
  const current = await getCalculationSettings(ctx);
  const updated: CalculationSettings = {
    ...current,
    ...calcSettings,
  };
  await setSetting(ctx, 'calculationSettings', updated);
}

/**
 * Enable or disable iterative calculation.
 *
 * @param ctx - Store context
 * @param enabled - Whether to enable iterative calculation
 */
export async function setIterativeCalculationEnabled(
  ctx: DocumentContext,
  enabled: boolean,
): Promise<void> {
  await setCalculationSettings(ctx, { enableIterativeCalculation: enabled });
}

/**
 * Check if iterative calculation is enabled.
 *
 * @param ctx - Store context
 * @returns Promise resolving to true if iterative calculation is enabled
 */
export async function isIterativeCalculationEnabled(ctx: DocumentContext): Promise<boolean> {
  const calcSettings = await getCalculationSettings(ctx);
  return calcSettings.enableIterativeCalculation;
}

// =============================================================================
// Multi-Sheet Selection (Stream H: Editor & Protection)
// Delegated to ComputeBridge via workbook settings.
// =============================================================================

/**
 * Get the currently selected sheet IDs.
 * Defaults to [activeSheetId] if not set or empty.
 *
 * NOTE: activeSheetId must be passed as a parameter because:
 * - Active sheet is UI state (Zustand), not collaborative state
 * - Domain modules stay pure - no UI store dependencies
 *
 * @param ctx - Store context
 * @param activeSheetId - The currently active sheet ID (from UI state)
 * @returns Promise resolving to array of selected sheet IDs
 */
export async function getSelectedSheetIds(
  ctx: DocumentContext,
  activeSheetId: SheetId,
): Promise<SheetId[]> {
  const settings = await getSettings(ctx);
  const selected = settings.selectedSheetIds ?? [];

  // Default to active sheet if not set or empty
  if (!selected || selected.length === 0) {
    return [activeSheetId];
  }

  // Ensure active sheet is always in selection (validation)
  if (!selected.includes(activeSheetId)) {
    return [activeSheetId, ...selected];
  }

  return selected;
}

/**
 * Set the selected sheet IDs.
 * Validates that all sheet IDs exist and ensures at least one is selected.
 *
 * Fire-and-forget: MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param sheetIds - Array of sheet IDs to select
 * @param _origin - Transaction origin (unused, kept for API compat)
 */
export async function setSelectedSheetIds(
  ctx: DocumentContext,
  sheetIds: SheetId[],
  _origin: string = 'user',
): Promise<void> {
  // Validate all sheets exist
  const order = await getOrder(ctx);
  const validIds = sheetIds.filter((id) => order.includes(id));

  // Must have at least one selected
  if (validIds.length === 0) {
    const firstId = await getFirstId(ctx);
    validIds.push(firstId);
  }

  await ctx.computeBridge.patchWorkbookSettings({ selectedSheetIds: validIds });
}

/**
 * Add a sheet to the current selection.
 * Used for Ctrl+click behavior.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID to add
 * @param activeSheetId - Current active sheet ID
 */
export async function addSelectedSheet(
  ctx: DocumentContext,
  sheetId: SheetId,
  activeSheetId: SheetId,
): Promise<void> {
  const current = await getSelectedSheetIds(ctx, activeSheetId);
  if (!current.includes(sheetId)) {
    await setSelectedSheetIds(ctx, [...current, sheetId]);
  }
}

/**
 * Remove a sheet from the current selection.
 * Must keep at least one sheet selected.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID to remove
 * @param activeSheetId - Current active sheet ID
 */
export async function removeSelectedSheet(
  ctx: DocumentContext,
  sheetId: SheetId,
  activeSheetId: SheetId,
): Promise<void> {
  const current = await getSelectedSheetIds(ctx, activeSheetId);
  // Must keep at least one sheet selected
  if (current.length > 1) {
    await setSelectedSheetIds(
      ctx,
      current.filter((id) => id !== sheetId),
    );
  }
}

/**
 * Toggle a sheet's selection status.
 * Used for Ctrl+click behavior.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID to toggle
 * @param activeSheetId - Current active sheet ID
 */
export async function toggleSelectedSheet(
  ctx: DocumentContext,
  sheetId: SheetId,
  activeSheetId: SheetId,
): Promise<void> {
  const current = await getSelectedSheetIds(ctx, activeSheetId);
  if (current.includes(sheetId)) {
    await removeSelectedSheet(ctx, sheetId, activeSheetId);
  } else {
    await addSelectedSheet(ctx, sheetId, activeSheetId);
  }
}

/**
 * Select all sheets between fromId and toId (inclusive), based on sheet order.
 * Used for Shift+click behavior.
 *
 * @param ctx - Store context
 * @param fromId - Starting sheet ID
 * @param toId - Ending sheet ID
 */
export async function selectSheetRange(
  ctx: DocumentContext,
  fromId: SheetId,
  toId: SheetId,
): Promise<void> {
  const order = await getOrder(ctx);
  const fromIndex = order.indexOf(fromId);
  const toIndex = order.indexOf(toId);

  if (fromIndex === -1 || toIndex === -1) return;

  const startIndex = Math.min(fromIndex, toIndex);
  const endIndex = Math.max(fromIndex, toIndex);

  const rangeIds = order.slice(startIndex, endIndex + 1);
  await setSelectedSheetIds(ctx, rangeIds);
}

/**
 * Clear multi-selection and select only the given sheet.
 * Used for regular (non-Ctrl, non-Shift) click.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID to select
 */
export async function selectSingleSheet(ctx: DocumentContext, sheetId: SheetId): Promise<void> {
  await setSelectedSheetIds(ctx, [sheetId]);
}

/**
 * Check if multiple sheets are currently selected.
 *
 * @param ctx - Store context
 * @param activeSheetId - Current active sheet ID
 * @returns Promise resolving to true if more than one sheet is selected
 */
export async function hasMultipleSheetSelection(
  ctx: DocumentContext,
  activeSheetId: SheetId,
): Promise<boolean> {
  const selected = await getSelectedSheetIds(ctx, activeSheetId);
  return selected.length > 1;
}

// =============================================================================
// Workbook Protection
// Delegated to ComputeBridge via workbook settings.
// =============================================================================

/**
 * Check if the workbook is protected.
 *
 * @param ctx - Store context
 * @returns Promise resolving to true if workbook structure is protected
 */
export async function isProtected(ctx: DocumentContext): Promise<boolean> {
  // Read the flat "isWorkbookProtected" key directly from Yjs settings.
  // We cannot use getSettings() here because Rust's get_settings reads
  // protection from a nested "protection" sub-map, while patchWorkbookSettings
  // writes it as a flat key. Reading the flat key matches the write path.
  const raw = await ctx.computeBridge.getWorkbookSetting('isWorkbookProtected');
  if (typeof raw === 'boolean') return raw;
  // Fallback: also check the nested path via getSettings for protection set
  // through other means (e.g., XLSX import hydration which writes the nested map)
  const settings = await getSettings(ctx);
  return settings.isWorkbookProtected ?? false;
}

/**
 * Get workbook protection options.
 *
 * @param ctx - Store context
 * @returns Promise resolving to WorkbookProtectionOptions with defaults applied
 */
export async function getProtectionOptions(
  ctx: DocumentContext,
): Promise<WorkbookProtectionOptions> {
  // Read the flat key directly (matches patchWorkbookSettings write path)
  const raw = await ctx.computeBridge.getWorkbookSetting('workbookProtectionOptions');
  const options =
    raw != null && typeof raw === 'object'
      ? (raw as Partial<WorkbookProtectionOptions>)
      : undefined;

  return {
    ...DEFAULT_WORKBOOK_PROTECTION_OPTIONS,
    ...options,
  };
}

/**
 * Check if the workbook has a protection password set.
 *
 * @param ctx - Store context
 * @returns Promise resolving to true if password protection is set
 */
export async function hasProtectionPassword(ctx: DocumentContext): Promise<boolean> {
  // Read the flat key directly (matches patchWorkbookSettings write path)
  const hash = await ctx.computeBridge.getWorkbookSetting('workbookProtectionPasswordHash');
  return typeof hash === 'string' && hash.length > 0;
}

/**
 * Protect the workbook with optional password and options.
 * Prevents sheet structure operations (add, delete, move, rename, hide, unhide).
 *
 * Fire-and-forget: MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param password - Optional password (stored as Excel-compatible hash)
 * @param options - Protection options (what operations to prevent)
 * @param _origin - Transaction origin (unused, kept for API compat)
 */
export async function protect(
  ctx: DocumentContext,
  password?: string,
  options?: Partial<WorkbookProtectionOptions>,
  _origin: string = 'user',
): Promise<void> {
  const fullOptions: WorkbookProtectionOptions = {
    ...DEFAULT_WORKBOOK_PROTECTION_OPTIONS,
    ...options,
  };

  const passwordHash = password ? hashExcelPassword(password) : null;
  await ctx.computeBridge.protectWorkbook(passwordHash, fullOptions);
}

/**
 * Unprotect the workbook.
 * If workbook has a password, it must be verified before unprotecting.
 *
 * @param ctx - Store context
 * @param password - Password to verify (if workbook is password-protected)
 * @param _origin - Transaction origin (unused, kept for API compat)
 * @returns Promise resolving to true if unprotected successfully, false if password is incorrect
 */
export async function unprotect(
  ctx: DocumentContext,
  password?: string,
  _origin: string = 'user',
): Promise<boolean> {
  const settings = await getSettings(ctx);

  // Check if workbook is even protected
  if (!settings.isWorkbookProtected) {
    return true; // Already unprotected
  }

  // Verify password if set
  const storedHash = settings.workbookProtectionPasswordHash;
  if (storedHash && !verifyExcelPassword(password ?? '', storedHash)) {
    return false; // Wrong password
  }

  void ctx.computeBridge.patchWorkbookSettings({
    isWorkbookProtected: false,
    workbookProtectionPasswordHash: undefined,
    workbookProtectionOptions: undefined,
  });

  return true;
}

/**
 * Check if a workbook-level operation is allowed.
 * This checks workbook protection only.
 *
 * @param ctx - Store context
 * @param operation - The operation to check
 * @returns Promise resolving to true if operation is allowed
 */
export async function isOperationAllowed(
  ctx: DocumentContext,
  operation: ProtectedWorkbookOperation,
): Promise<boolean> {
  // If workbook is not protected, all operations allowed
  if (!(await isProtected(ctx))) {
    return true;
  }

  const options = await getProtectionOptions(ctx);

  // Structure protection prevents all sheet structure operations
  if (options.structure) {
    switch (operation) {
      case 'addSheet':
      case 'deleteSheet':
      case 'renameSheet':
      case 'moveSheet':
      case 'hideSheet':
      case 'unhideSheet':
      case 'copySheet':
        return false;
      default:
        return true;
    }
  }

  return true;
}

// =============================================================================
// Custom Lists
// Stored as an extension field via the granular workbook setting API
// (not part of the typed WorkbookSettings struct).
// =============================================================================

/** Shape of a serialized custom list entry stored in the 'customLists' setting. */
interface CustomListEntry {
  id: string;
  name: string;
  values: string[];
}

/**
 * Read the raw custom list entries from the granular 'customLists' workbook setting.
 */
async function readCustomListEntries(ctx: DocumentContext): Promise<CustomListEntry[]> {
  const raw = await ctx.computeBridge.getWorkbookSetting('customLists');
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is CustomListEntry =>
      entry != null &&
      typeof entry === 'object' &&
      typeof (entry as CustomListEntry).id === 'string' &&
      typeof (entry as CustomListEntry).name === 'string' &&
      Array.isArray((entry as CustomListEntry).values),
  );
}

/**
 * Get all custom lists (built-in + user-defined).
 *
 * @param ctx - Store context
 * @returns Promise resolving to array of all custom lists
 */
export async function getCustomLists(ctx: DocumentContext): Promise<CustomList[]> {
  const entries = await readCustomListEntries(ctx);

  // Start with built-in lists
  const lists: CustomList[] = [...BUILT_IN_LISTS];

  // Add user-defined lists from settings
  for (const entry of entries) {
    lists.push({
      id: entry.id,
      name: entry.name,
      values: entry.values,
      isBuiltIn: false,
    });
  }

  return lists;
}

/**
 * Get a custom list by ID.
 *
 * @param ctx - Store context
 * @param id - List ID
 * @returns Promise resolving to the custom list, or undefined if not found
 */
export async function getCustomList(
  ctx: DocumentContext,
  id: string,
): Promise<CustomList | undefined> {
  const lists = await getCustomLists(ctx);
  return lists.find((list) => list.id === id);
}

/**
 * Find a custom list that contains a given value.
 *
 * @param ctx - Store context
 * @param value - Value to search for
 * @returns Promise resolving to the custom list containing the value, or undefined
 */
export async function findCustomListContainingValue(
  ctx: DocumentContext,
  value: string,
): Promise<CustomList | undefined> {
  const normalizedValue = value.toLowerCase().trim();
  const lists = await getCustomLists(ctx);

  return lists.find((list) => list.values.some((v) => v.toLowerCase().trim() === normalizedValue));
}

/**
 * Add a new user-defined custom list.
 *
 * Fire-and-forget: MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param name - Display name for the list
 * @param values - The list values in order
 * @param _origin - Transaction origin (unused, kept for API compat)
 * @returns Promise resolving to the created custom list
 */
export async function addCustomList(
  ctx: DocumentContext,
  name: string,
  values: string[],
  _origin: string = 'user',
): Promise<CustomList> {
  // Generate unique ID
  const id = `custom-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  const newList: CustomList = {
    id,
    name,
    values,
    isBuiltIn: false,
  };

  const existingLists = await readCustomListEntries(ctx);
  await ctx.computeBridge.setWorkbookSetting('customLists', [
    ...existingLists,
    { id, name, values },
  ]);

  return newList;
}

/**
 * Update an existing user-defined custom list.
 *
 * Fire-and-forget: MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param id - List ID to update
 * @param values - New list values
 * @param _origin - Transaction origin (unused, kept for API compat)
 * @returns Promise resolving to true if updated, false if list not found or is built-in
 */
export async function updateCustomList(
  ctx: DocumentContext,
  id: string,
  updates: { name?: string; values?: readonly string[] },
  _origin: string = 'user',
): Promise<boolean> {
  // Cannot edit built-in lists
  const builtIn = BUILT_IN_LISTS.find((list) => list.id === id);
  if (builtIn) return false;

  const existingLists = await readCustomListEntries(ctx);
  const listIndex = existingLists.findIndex((l) => l.id === id);
  if (listIndex === -1) return false;

  const updatedLists = [...existingLists];
  updatedLists[listIndex] = {
    ...updatedLists[listIndex],
    ...(updates.name !== undefined ? { name: updates.name } : {}),
    ...(updates.values !== undefined ? { values: [...updates.values] } : {}),
  };

  await ctx.computeBridge.setWorkbookSetting('customLists', updatedLists);

  return true;
}

/**
 * Delete a user-defined custom list.
 *
 * Fire-and-forget: MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param id - List ID to delete
 * @param _origin - Transaction origin (unused, kept for API compat)
 * @returns Promise resolving to true if deleted, false if list not found or is built-in
 */
export async function deleteCustomList(
  ctx: DocumentContext,
  id: string,
  _origin: string = 'user',
): Promise<boolean> {
  // Cannot delete built-in lists
  const builtIn = BUILT_IN_LISTS.find((list) => list.id === id);
  if (builtIn) return false;

  const existingLists = await readCustomListEntries(ctx);
  const listIndex = existingLists.findIndex((l) => l.id === id);
  if (listIndex === -1) return false;

  const updatedLists = existingLists.filter((l) => l.id !== id);
  await ctx.computeBridge.setWorkbookSetting('customLists', updatedLists);

  return true;
}

/**
 * Atomically replace all user-defined custom lists.
 *
 * Builds the full entries array in one pass and writes it in a single
 * setWorkbookSetting call, avoiding the read-modify-write races that
 * occur when composing addCustomList/deleteCustomList in parallel.
 *
 * @param ctx - Store context
 * @param lists - The new set of user-defined lists (empty array clears all)
 */
export async function replaceCustomLists(
  ctx: DocumentContext,
  lists: readonly { name: string; values: readonly string[] }[],
): Promise<void> {
  const entries: CustomListEntry[] = lists.map((list, i) => ({
    id: `custom-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 9)}`,
    name: list.name,
    values: [...list.values],
  }));
  await ctx.computeBridge.setWorkbookSetting('customLists', entries);
}

// =============================================================================
// Default Table Style
// =============================================================================

/**
 * Get the default table style ID for new tables.
 * Returns undefined if no default is set (which means 'medium2' will be used).
 *
 * @param ctx - Store context
 * @returns Promise resolving to default table style ID or undefined
 */
export async function getDefaultTableStyleId(ctx: DocumentContext): Promise<string | undefined> {
  const settings = await getSettings(ctx);
  return publicTableStyleId(settings.defaultTableStyleId);
}

/**
 * Set the default table style ID for new tables in this workbook.
 * Pass undefined to clear the default (will use 'medium2').
 *
 * @param ctx - Store context
 * @param styleId - Style ID (built-in preset or custom style ID), or undefined to clear
 */
export async function setDefaultTableStyleId(
  ctx: DocumentContext,
  styleId: string | undefined,
): Promise<void> {
  const current = await getSettings(ctx);
  const updated = { ...current, defaultTableStyleId: tableStyleIdForCompute(styleId) ?? styleId };
  void ctx.computeBridge.patchWorkbookSettings(updated);
}

// =============================================================================
// Sheet meta helpers (imported here to avoid circular deps with sheet-meta)
// =============================================================================

import { getFirstId, getOrder } from '../sheets/sheet-meta';

// Re-export for callers that do `Workbook.getOrder` etc.
export { getFirstId, getOrder };
