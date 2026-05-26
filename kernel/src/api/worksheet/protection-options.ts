import type { ProtectionOptions } from '@mog-sdk/contracts/api';
import type { SheetProtectionOptions } from '@mog-sdk/contracts/protection';
import { DEFAULT_PROTECTION_OPTIONS } from '@mog-sdk/contracts/protection';

type ProtectionOptionInput = ProtectionOptions | Partial<SheetProtectionOptions>;

const INTERNAL_OPTION_KEYS = [
  'selectLockedCells',
  'selectUnlockedCells',
  'insertRows',
  'insertColumns',
  'insertHyperlinks',
  'deleteRows',
  'deleteColumns',
  'formatCells',
  'formatColumns',
  'formatRows',
  'sort',
  'useAutoFilter',
  'usePivotTableReports',
  'editObjects',
  'editScenarios',
] as const satisfies readonly (keyof SheetProtectionOptions)[];

/**
 * Normalize public API allow* aliases and app/core SheetProtectionOptions into
 * the canonical compute-owned protection option shape.
 */
export function normalizeProtectionOptions(
  options?: ProtectionOptionInput,
): SheetProtectionOptions {
  const normalized: SheetProtectionOptions = { ...DEFAULT_PROTECTION_OPTIONS };
  if (!options) return normalized;

  const internal = options as Partial<SheetProtectionOptions>;
  for (const key of INTERNAL_OPTION_KEYS) {
    if (internal[key] !== undefined) {
      normalized[key] = internal[key];
    }
  }

  const api = options as ProtectionOptions;
  if (api.allowSelectLockedCells !== undefined)
    normalized.selectLockedCells = api.allowSelectLockedCells;
  if (api.allowSelectUnlockedCells !== undefined)
    normalized.selectUnlockedCells = api.allowSelectUnlockedCells;
  if (api.allowFormatCells !== undefined) normalized.formatCells = api.allowFormatCells;
  if (api.allowFormatColumns !== undefined) normalized.formatColumns = api.allowFormatColumns;
  if (api.allowFormatRows !== undefined) normalized.formatRows = api.allowFormatRows;
  if (api.allowInsertColumns !== undefined) normalized.insertColumns = api.allowInsertColumns;
  if (api.allowInsertRows !== undefined) normalized.insertRows = api.allowInsertRows;
  if (api.allowInsertHyperlinks !== undefined)
    normalized.insertHyperlinks = api.allowInsertHyperlinks;
  if (api.allowDeleteColumns !== undefined) normalized.deleteColumns = api.allowDeleteColumns;
  if (api.allowDeleteRows !== undefined) normalized.deleteRows = api.allowDeleteRows;
  if (api.allowSort !== undefined) normalized.sort = api.allowSort;
  if (api.allowAutoFilter !== undefined) normalized.useAutoFilter = api.allowAutoFilter;
  if (api.allowPivotTables !== undefined) normalized.usePivotTableReports = api.allowPivotTables;
  if (api.allowEditObjects !== undefined) normalized.editObjects = api.allowEditObjects;
  if (api.allowEditScenarios !== undefined) normalized.editScenarios = api.allowEditScenarios;

  return normalized;
}
