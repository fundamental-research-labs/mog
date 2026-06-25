/**
 * Named Ranges Domain Module
 *
 * CRUD operations for Excel-style named ranges.
 * Pure functions that take DocumentContext as first parameter.
 *
 * Write operations delegate to ComputeBridge (Rust compute core).
 * Read operations are async, querying ComputeBridge.
 * MutationResultHandler drives event emission -- no manual event emission here.
 *
 * CRITICAL ARCHITECTURE (why IdentityFormula):
 * Named ranges store refersTo as IdentityFormula, NOT A1 strings.
 * This ensures:
 * - CRDT-safe storage (concurrent structure changes compose correctly)
 * - Insert/delete row/col operations don't corrupt named ranges
 * - Display regenerated at render time from stable CellIds
 *
 * @example
 * // User creates "SalesData" -> =Sheet1!$A$1:$B$10
 * // Stored with IdentityFormula referencing CellIds for A1 and B10
 * // If user inserts column at A:
 * // - CellIds unchanged, positions shift
 * // - getRefersToA1() regenerates: "=Sheet1!$B$1:$C$10"
 *
 * @see contracts/src/named-ranges.ts
 */

import { type CellRange, type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { StructureChangeSource } from '@mog-sdk/contracts/event-base';
import type {
  DefinedName,
  DefinedNameInput,
  NameValidationResult,
} from '@mog-sdk/contracts/named-ranges';
import { getDefinedNameKey, validateName } from '@mog/spreadsheet-utils/data/named-ranges';

import type { IKernelContext } from '@mog-sdk/contracts/kernel';
import { identityFormulaToWire, type NamedRangeDef } from '../../bridges/compute';
import type { RangeCellData } from '../../bridges/compute/compute-types.gen';
import type { DocumentContext } from '../../context/types';
import { KernelError } from '../../errors';
import {
  createGroupedNamedRangeMutationOptions,
  createNamedRangeMutationOptions,
  namedRangeSheetIds,
  nextNamedRangeMutationOptions,
  type NamedRangeMutationOptionsInput,
} from './named-range-mutation-context';
import { mapRustNamedRange } from './named-range-wire';

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate a potential name.
 *
 * Queries ComputeBridge for existing names to check for duplicates.
 *
 * @param ctx - Store context
 * @param name - Name to validate
 * @param scope - Scope of the name
 * @param excludeId - Optional ID to exclude from duplicate check (for updates)
 * @returns Validation result
 */
export async function validate(
  ctx: DocumentContext,
  name: string,
  scope: SheetId | undefined,
  excludeId?: string,
): Promise<NameValidationResult> {
  const all = await getAll(ctx);
  const existingKeys = new Set(all.map((n) => getDefinedNameKey(n.name, n.scope)));

  if (excludeId) {
    const existing = all.find((n) => n.id === excludeId);
    if (existing) {
      existingKeys.delete(getDefinedNameKey(existing.name, existing.scope));
    }
  }

  return validateName(name, existingKeys, scope);
}

// =============================================================================
// Getters — Async CB Queries
// =============================================================================

/**
 * Get all defined names.
 *
 * Delegates to ComputeBridge.
 *
 * @param ctx - Store context
 * @returns Array of all defined names
 */
export async function getAll(ctx: DocumentContext): Promise<DefinedName[]> {
  const rustNames = await ctx.computeBridge.getAllNamedRangesWire();
  return rustNames.map(mapRustNamedRange);
}

/**
 * Get a defined name by its key (name + scope).
 *
 * @param ctx - Store context
 * @param name - The name to find
 * @param scope - Optional scope (undefined = workbook scope)
 * @returns DefinedName or undefined if not found
 */
export async function getByName(
  ctx: DocumentContext,
  name: string,
  scope?: SheetId,
): Promise<DefinedName | undefined> {
  const all = await getAll(ctx);
  const key = getDefinedNameKey(name, scope);
  return all.find((n) => getDefinedNameKey(n.name, n.scope) === key);
}

/**
 * Get a defined name by its ID.
 *
 * @param ctx - Store context
 * @param id - The unique ID
 * @returns DefinedName or undefined if not found
 */
export async function getById(ctx: DocumentContext, id: string): Promise<DefinedName | undefined> {
  const all = await getAll(ctx);
  return all.find((n) => n.id === id);
}

/**
 * Resolve a name reference, respecting scope precedence.
 *
 * Sheet-scoped names have higher precedence than workbook-scoped names.
 *
 * @param ctx - Store context
 * @param name - The name to resolve
 * @param currentSheet - Current sheet for scope resolution
 * @returns DefinedName or undefined if not found
 */
export async function resolve(
  ctx: DocumentContext,
  name: string,
  currentSheet?: SheetId,
): Promise<DefinedName | undefined> {
  // First try sheet-scoped name (higher precedence)
  if (currentSheet) {
    const sheetScoped = await getByName(ctx, name, currentSheet);
    if (sheetScoped) return sheetScoped;
  }

  // Fall back to workbook-scoped
  return getByName(ctx, name);
}

/**
 * Get the A1-style display string for a defined name's refersTo.
 *
 * Delegates to ComputeBridge.toA1Display() which resolves
 * CellIds to current positions in Rust.
 *
 * @param ctx - Store context
 * @param name - The defined name
 * @returns A1-style string (e.g., "=Sheet1!$A$1:$B$10")
 */
export async function getRefersToA1(ctx: DocumentContext, name: DefinedName): Promise<string> {
  // Named-range references are workbook-scoped and have no implicit sheet
  // context, so the displayed A1 string must be fully sheet-qualified
  // (e.g. "Sheet1!A1:A10" instead of "A1:A10"). `toA1DisplayQualified` is
  // workbook-scope and always emits qualified output regardless of the
  // sheet argument — pass the name's scope when present, otherwise nil.
  const wire = identityFormulaToWire(name.refersTo);
  const sheetCtx = name.scope ?? toSheetId('00000000-0000-0000-0000-000000000000');
  try {
    const a1 = await ctx.computeBridge.toA1DisplayQualified(sheetCtx, wire);
    return a1.startsWith('=') ? a1 : `=${a1}`;
  } catch {
    // Constant formulas (e.g. =0.08) have no cell references and
    // toA1DisplayQualified cannot produce a range string for them.
    // Fall back to the raw template so list() / exportNames() can still
    // return the entry instead of throwing.
    const template = name.refersTo.template;
    return template.startsWith('=') ? template : `=${template}`;
  }
}

/**
 * Get all defined names in a specific scope.
 *
 * @param ctx - Store context
 * @param scope - Optional scope filter (undefined = workbook scope only)
 * @returns Array of defined names in that scope
 */
export async function getByScope(ctx: DocumentContext, scope?: SheetId): Promise<DefinedName[]> {
  const all = await getAll(ctx);
  return all.filter((name) => name.scope === scope);
}

/**
 * Get all visible defined names (for Name Manager).
 *
 * @param ctx - Store context
 * @returns Array of visible defined names
 */
export async function getVisible(ctx: DocumentContext): Promise<DefinedName[]> {
  const rustNames = await ctx.computeBridge.getVisibleNamedRanges();
  return rustNames.map(mapRustNamedRange);
}

// =============================================================================
// Value Evaluation (requires IKernelContext)
// =============================================================================

/**
 * Evaluate the current value of a defined name.
 *
 * This function requires the full IKernelContext (not just DocumentContext)
 * because it needs the recalc subsystem to create a CalculatorContext.
 *
 * NOTE: This function performs computation, unlike other NamedRanges functions
 * which are pure storage operations. The dependency is explicit in the type.
 *
 * @param ctx - Full kernel context (requires recalc subsystem)
 * @param name - The defined name to evaluate
 * @param contextSheetId - Sheet context for scope resolution
 * @returns The evaluated value (number, string, boolean, error, 2D array, or undefined)
 */
export function evaluateValue(
  _ctx: IKernelContext,
  _name: DefinedName,
  _contextSheetId: SheetId,
): unknown {
  // All formula evaluation handled by Rust compute-core.
  return undefined;
}

/** Type guard: checks whether a value is a 2D array (array of arrays). */
function is2DArray(v: unknown): v is unknown[][] {
  return Array.isArray(v) && v.length > 0 && Array.isArray(v[0]);
}

/**
 * Format an evaluated value for display in the Name Manager.
 *
 * Follows Excel conventions:
 * - Single values: Return as string representation
 * - Arrays: Format as `{val1, val2; val3, val4}` (comma = column sep, semicolon = row sep)
 * - Errors: Return error string (`#REF!`, `#NAME?`, etc.)
 * - Null/undefined: Return empty string
 *
 * @param value - The evaluated value to format
 * @returns Formatted string for display
 */
export function formatValueForDisplay(value: unknown): string {
  // Null/undefined -> empty string
  if (value === null || value === undefined) {
    return '';
  }

  // Error objects (from calculator)
  if (typeof value === 'object' && value !== null && 'type' in value) {
    const typed = value as { type: string; value?: unknown };
    if (typed.type === 'error') {
      return String(typed.value ?? '#ERROR!');
    }
  }

  // 2D Array -> Excel format {row1; row2; ...} where rows are comma-separated
  if (is2DArray(value)) {
    const rows = value.map((row) => row.map((cell) => formatSingleValue(cell)).join(', '));
    return `{${rows.join('; ')}}`;
  }
  if (Array.isArray(value)) {
    // 1D array (treat as single row)
    return `{${value.map((cell: unknown) => formatSingleValue(cell)).join(', ')}}`;
  }

  // Single value
  return formatSingleValue(value);
}

/**
 * Format a single (non-array) value for display.
 * @internal
 */
function formatSingleValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  // Error objects
  if (typeof value === 'object' && value !== null && 'type' in value) {
    const typed = value as { type: string; value?: unknown };
    if (typed.type === 'error') {
      return String(typed.value ?? '#ERROR!');
    }
  }

  // Boolean
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }

  // Number - use toLocaleString for reasonable formatting
  if (typeof value === 'number') {
    // Avoid scientific notation for reasonable numbers
    if (Math.abs(value) < 1e10 && Math.abs(value) > 1e-10) {
      return value.toString();
    }
    return value.toExponential(2);
  }

  // String
  return String(value);
}

// =============================================================================
// CRUD Operations — Write Operations (fire-and-forget to CB)
// =============================================================================

/**
 * Create a new defined name.
 *
 * Converts the A1-style refersTo input to IdentityFormulaWire via ComputeBridge,
 * then sends the NamedRangeDef to Rust for persistence.
 * MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param input - Name input with A1-style reference
 * @param contextSheet - Sheet context for resolving relative references
 * @param _origin - Transaction origin (unused -- Rust handles persistence)
 */
export async function create(
  ctx: DocumentContext,
  input: DefinedNameInput,
  contextSheet: SheetId,
  _origin: StructureChangeSource = 'user',
  mutationOptions?: NamedRangeMutationOptionsInput,
): Promise<void> {
  // Convert A1 to IdentityFormula via Rust.
  // The transport auto-camelCases field names but keeps externally-tagged enums,
  // so the result has { Range: { startId, endId, ... } } format.
  // We need to convert to wire format { Range: { start_id, end_id, ... } }.
  const formula = await ctx.computeBridge.toIdentityFormula(contextSheet, input.refersToA1);
  const rawFormula = formula as any;

  const wireRefs = (rawFormula.refs ?? []).map((ref: any) => {
    if (ref.Cell) {
      return {
        Cell: {
          id: ref.Cell.id,
          row_absolute: ref.Cell.rowAbsolute ?? false,
          col_absolute: ref.Cell.colAbsolute ?? false,
        },
      };
    }
    if (ref.Range) {
      return {
        Range: {
          start_id: ref.Range.startId,
          end_id: ref.Range.endId,
          start_row_absolute: ref.Range.startRowAbsolute ?? false,
          start_col_absolute: ref.Range.startColAbsolute ?? false,
          end_row_absolute: ref.Range.endRowAbsolute ?? false,
          end_col_absolute: ref.Range.endColAbsolute ?? false,
        },
      };
    }
    if (ref.FullRow) {
      return {
        FullRow: {
          row_id: ref.FullRow.rowId,
          absolute: ref.FullRow.absolute ?? false,
        },
      };
    }
    if (ref.FullCol) {
      return {
        FullCol: {
          col_id: ref.FullCol.colId,
          absolute: ref.FullCol.absolute ?? false,
        },
      };
    }
    if (ref.RowRange) {
      return {
        RowRange: {
          start_row_id: ref.RowRange.startRowId,
          end_row_id: ref.RowRange.endRowId,
          start_absolute: ref.RowRange.startAbsolute ?? false,
          end_absolute: ref.RowRange.endAbsolute ?? false,
        },
      };
    }
    if (ref.ColRange) {
      return {
        ColRange: {
          start_col_id: ref.ColRange.startColId,
          end_col_id: ref.ColRange.endColId,
          start_absolute: ref.ColRange.startAbsolute ?? false,
          end_absolute: ref.ColRange.endAbsolute ?? false,
        },
      };
    }
    return ref;
  });

  const def: NamedRangeDef = {
    name: input.name,
    scope: input.scope ? { Sheet: input.scope } : 'Workbook',
    refers_to: {
      template: rawFormula.template,
      refs: wireRefs,
      is_dynamic_array: rawFormula.isDynamicArray ?? false,
      is_volatile: rawFormula.isVolatile ?? false,
    },
    // Pass the A1 formula as raw_expression so the evaluator can resolve it
    // even if CellId-based refs fail to deserialize across the bridge boundary.
    raw_expression: input.refersToA1,
  };

  const hasComment = typeof input.comment === 'string' && input.comment.length > 0;
  const options =
    mutationOptions ??
    (hasComment
      ? createGroupedNamedRangeMutationOptions(ctx, {
          operationIdPrefix: 'namedRanges.create',
          sheetIds: namedRangeSheetIds(input.scope, contextSheet),
        })
      : createNamedRangeMutationOptions(ctx, {
          operationIdPrefix: 'namedRanges.create',
          sheetIds: namedRangeSheetIds(input.scope, contextSheet),
        }));

  await ctx.computeBridge.setNamedRange(input.name, def, nextNamedRangeMutationOptions(options));

  if (hasComment) {
    const created = await getByName(ctx, input.name, input.scope);
    if (!created) {
      throw new KernelError(
        'DOMAIN_DEFINED_NAME_NOT_FOUND',
        `Created defined name ${input.name} could not be read back for comment persistence`,
      );
    }

    await ctx.computeBridge.updateNamedRange(
      created.id,
      {
        name: null,
        refersTo: null,
        comment: input.comment ?? null,
        visible: null,
      },
      nextNamedRangeMutationOptions(options),
    );
  }
}

/**
 * Update an existing defined name.
 *
 * Delegates to ComputeBridge. MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param id - ID of the name to update
 * @param updates - Fields to update
 * @param contextSheet - Sheet context for resolving relative references (if refersToA1 changes)
 * @param _origin - Transaction origin (unused -- Rust handles persistence)
 */
export async function update(
  ctx: DocumentContext,
  id: string,
  updates: Partial<Omit<DefinedNameInput, 'scope'>> & { visible?: boolean },
  contextSheet: SheetId,
  _origin: StructureChangeSource = 'user',
  mutationOptions?: NamedRangeMutationOptionsInput,
): Promise<void> {
  const existing = await getById(ctx, id);
  if (!existing) {
    throw new KernelError('DOMAIN_DEFINED_NAME_NOT_FOUND', `Defined name with ID ${id} not found`);
  }

  // Single atomic Rust mutation. On rename, `mutation_named_range_update`
  // rewrites every formula referencing the old name in both Yrs storage
  // (via update_formula_templates_on_named_range_rename) and the in-memory
  // mirror (via update_mirror_formulas_on_named_range_rename) inside one
  // transaction. The kernel must not split this into remove+set — that
  // would orphan dependents into #NAME? before the new key exists, and the
  // formula-text rewrite would never run.
  await ctx.computeBridge.updateNamedRange(
    id,
    {
      name: updates.name ?? null,
      refersTo: updates.refersToA1 ?? null,
      comment: updates.comment ?? null,
      visible: updates.visible ?? null,
    },
    nextNamedRangeMutationOptions(
      mutationOptions ??
        createNamedRangeMutationOptions(ctx, {
          operationIdPrefix: 'namedRanges.update',
          sheetIds: namedRangeSheetIds(existing.scope, contextSheet),
        }),
    ),
  );
}

/**
 * Delete a defined name by ID.
 *
 * Delegates to ComputeBridge. MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param id - ID of the name to delete
 * @param _origin - Transaction origin (unused -- Rust handles persistence)
 */
export async function remove(
  ctx: DocumentContext,
  id: string,
  _origin: StructureChangeSource = 'user',
  mutationOptions?: NamedRangeMutationOptionsInput,
): Promise<void> {
  const existing = await getById(ctx, id);
  if (!existing) {
    throw new KernelError('DOMAIN_DEFINED_NAME_NOT_FOUND', `Defined name with ID ${id} not found`);
  }

  await ctx.computeBridge.removeNamedRangeById(
    existing.id,
    nextNamedRangeMutationOptions(
      mutationOptions ??
        createNamedRangeMutationOptions(ctx, {
          operationIdPrefix: 'namedRanges.remove',
          sheetIds: namedRangeSheetIds(existing.scope),
        }),
    ),
  );
}

/**
 * Delete all defined names in a scope.
 * Useful when deleting a sheet (removes all sheet-scoped names).
 *
 * Delegates to ComputeBridge. MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param scope - Scope to clear (undefined = workbook scope)
 * @param _origin - Transaction origin (unused -- Rust handles persistence)
 */
export async function removeByScope(
  ctx: DocumentContext,
  scope: SheetId | undefined,
  _origin: StructureChangeSource = 'system',
  mutationOptions?: NamedRangeMutationOptionsInput,
): Promise<void> {
  const names = await getByScope(ctx, scope);
  const options =
    mutationOptions ??
    createGroupedNamedRangeMutationOptions(ctx, {
      operationIdPrefix: 'namedRanges.removeByScope',
      sheetIds: namedRangeSheetIds(scope),
    });
  await Promise.all(
    names.map((name) =>
      ctx.computeBridge.removeNamedRange(name.name, nextNamedRangeMutationOptions(options)),
    ),
  );
}

// =============================================================================
// Bulk Operations
// =============================================================================

/**
 * Import multiple defined names (e.g., from XLSX).
 *
 * Each name's IdentityFormula is converted to wire format and sent to CB.
 * Duplicates are skipped.
 *
 * @param ctx - Store context
 * @param names - Array of defined names to import (already with IdentityFormula)
 * @param _origin - Transaction origin (unused -- Rust handles persistence)
 * @returns Number of successfully imported names
 */
export async function importNames(
  ctx: DocumentContext,
  names: DefinedName[],
  _origin: StructureChangeSource = 'import',
  mutationOptions?: NamedRangeMutationOptionsInput,
): Promise<number> {
  const existing = await getAll(ctx);
  const existingKeys = new Set(existing.map((n) => getDefinedNameKey(n.name, n.scope)));

  let imported = 0;
  for (const name of names) {
    const key = getDefinedNameKey(name.name, name.scope);
    if (existingKeys.has(key)) {
      continue;
    }

    const def: NamedRangeDef = {
      name: name.name,
      scope: name.scope ? { Sheet: name.scope } : 'Workbook',
      refers_to: identityFormulaToWire(name.refersTo),
    };

    void ctx.computeBridge.setNamedRange(
      name.name,
      def,
      nextNamedRangeMutationOptions(
        mutationOptions ??
          createNamedRangeMutationOptions(ctx, {
            operationIdPrefix: 'namedRanges.import',
            sheetIds: namedRangeSheetIds(name.scope),
          }),
      ),
    );
    existingKeys.add(key);
    imported++;
  }

  return imported;
}

/**
 * Export all defined names (for XLSX export).
 *
 * Returns names with their A1 display strings resolved via ComputeBridge.
 *
 * @param ctx - Store context
 * @returns Array of names with refersToA1 property added
 */
export async function exportNames(
  ctx: DocumentContext,
): Promise<Array<DefinedName & { refersToA1: string }>> {
  const all = await getAll(ctx);
  const results: Array<DefinedName & { refersToA1: string }> = [];

  for (const name of all) {
    const a1 = await getRefersToA1(ctx, name);
    results.push({ ...name, refersToA1: a1 });
  }

  return results;
}

// =============================================================================
// Query Utilities
// =============================================================================

/**
 * Check if a name exists.
 *
 * @param ctx - Store context
 * @param name - Name to check
 * @param scope - Optional scope
 * @returns true if name exists
 */
export async function exists(
  ctx: DocumentContext,
  name: string,
  scope?: SheetId,
): Promise<boolean> {
  const found = await getByName(ctx, name, scope);
  return found !== undefined;
}

/**
 * Get count of defined names.
 *
 * @param ctx - Store context
 * @returns Total number of defined names
 */
export async function count(ctx: DocumentContext): Promise<number> {
  const all = await getAll(ctx);
  return all.length;
}

// =============================================================================
// Create from Selection
// =============================================================================

/**
 * Options for creating names from selection.
 */
export interface CreateFromSelectionOptions {
  /** Use first row as column names (names refer to cells below) */
  topRow: boolean;
  /** Use first column as row names (names refer to cells to the right) */
  leftColumn: boolean;
  /** Use last row as column names (names refer to cells above) */
  bottomRow: boolean;
  /** Use last column as row names (names refer to cells to the left) */
  rightColumn: boolean;
}

/**
 * Result of creating names from selection.
 */
export interface CreateFromSelectionResult {
  /** Number of names successfully created */
  success: number;
  /** Number of names skipped (blank labels, invalid names, duplicates) */
  skipped: number;
  /** Details about skipped names */
  skippedReasons: Array<{ label: string; reason: string }>;
}

/**
 * Sanitize a label to make it a valid name.
 *
 * Follows Excel's rules for defined names:
 * - Replace spaces with underscores
 * - Remove invalid characters
 * - Ensure starts with letter or underscore
 *
 * @param label - The label to sanitize
 * @returns Sanitized name or null if cannot be made valid
 */
function sanitizeLabel(label: string): string | null {
  if (!label || label.trim() === '') return null;

  let name = label.trim();

  // Replace spaces with underscores
  name = name.replace(/\s+/g, '_');

  // Remove characters that are not letters, digits, underscores, periods, or backslashes
  name = name.replace(/[^a-zA-Z0-9_.\\]/g, '');

  // If empty after sanitization, return null
  if (name === '') return null;

  // If starts with a digit, prepend underscore
  if (/^[0-9]/.test(name)) {
    name = '_' + name;
  }

  // If it looks like a cell reference (e.g., A1, XFD1048576), prepend underscore
  if (/^[A-Za-z]{1,3}[0-9]+$/.test(name)) {
    name = '_' + name;
  }

  return name;
}

/**
 * Convert column index to Excel column letter(s).
 * 0 = A, 1 = B, ..., 25 = Z, 26 = AA, etc.
 */
function colToLetter(col: number): string {
  let result = '';
  let c = col;
  while (c >= 0) {
    result = String.fromCharCode((c % 26) + 65) + result;
    c = Math.floor(c / 26) - 1;
  }
  return result;
}

/**
 * Create named ranges from row/column labels in a selection.
 *
 * This implements Excel's "Create Names from Selection" functionality
 * (Ctrl+Shift+F3). It extracts names from row/column headers and creates
 * named ranges referring to the associated data cells.
 *
 * Example:
 * Selection A1:C3 with topRow=true and leftColumn=true:
 * ```
 *       A      B      C
 * 1    Name   Sales  Profit
 * 2    Alice  100    20
 * 3    Bob    200    40
 * ```
 * Creates:
 * - Sales -> B2:B3
 * - Profit -> C2:C3
 * - Alice -> B2:C2
 * - Bob -> B3:C3
 *
 * @param ctx - Store context
 * @param sheetId - Sheet containing the selection
 * @param range - The selected range
 * @param options - Which edges to use as label sources
 * @param _origin - Transaction origin (unused -- Rust handles persistence)
 * @returns Result with count of created and skipped names
 */
export async function createFromSelection(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
  options: CreateFromSelectionOptions,
  _origin: StructureChangeSource = 'user',
): Promise<CreateFromSelectionResult> {
  const { startRow, startCol, endRow, endCol } = range;
  const result: CreateFromSelectionResult = {
    success: 0,
    skipped: 0,
    skippedReasons: [],
  };

  // Calculate data bounds based on which edges are label sources
  const dataStartRow = options.topRow ? startRow + 1 : startRow;
  const dataEndRow = options.bottomRow ? endRow - 1 : endRow;
  const dataStartCol = options.leftColumn ? startCol + 1 : startCol;
  const dataEndCol = options.rightColumn ? endCol - 1 : endCol;

  // Validate we have at least some data area
  if (dataStartRow > dataEndRow || dataStartCol > dataEndCol) {
    return result;
  }

  // Batch-read all cells in the selection range with a single IPC call
  // to avoid per-cell getDisplayValue() calls (each doing 2 IPC round-trips).
  const rangeResult = await ctx.computeBridge.queryRange(
    sheetId,
    startRow,
    startCol,
    endRow,
    endCol,
  );

  // Build (row, col) -> display string lookup from batch result
  const displayMap = new Map<string, string>();
  if (rangeResult?.cells) {
    for (const cell of rangeResult.cells as RangeCellData[]) {
      // Replicate getDisplayValue logic:
      // - formatted string if available
      // - otherwise convert value to string
      // - formula cells evaluating to null display as '0'
      let display: string;
      if (cell.formatted != null && cell.formatted !== '') {
        display = cell.formatted;
      } else {
        const value = cell.value;
        if (value === null || value === undefined) {
          display = cell.formula != null ? '0' : '';
        } else if (typeof value === 'object' && value !== null && 'type' in value) {
          const typed = value as { type: string; value?: unknown };
          display = typed.type === 'error' ? String(typed.value ?? '#ERROR!') : String(value);
        } else {
          display = String(value);
        }
      }
      displayMap.set(`${cell.row}:${cell.col}`, display);
    }
  }

  /** Look up display value from the batch-read map. */
  const getLabel = (row: number, col: number): string => {
    return displayMap.get(`${row}:${col}`) ?? '';
  };

  // Snapshot existing names for duplicate checking
  const existingNames = await getAll(ctx);
  const existingKeys = new Set(existingNames.map((n) => getDefinedNameKey(n.name, n.scope)));

  // Helper to create a single name
  const createSingleName = async (
    name: string,
    refStartRow: number,
    refStartCol: number,
    refEndRow: number,
    refEndCol: number,
  ) => {
    const sanitized = sanitizeLabel(name);
    if (!sanitized) {
      result.skipped++;
      result.skippedReasons.push({ label: name, reason: 'blank or invalid label' });
      return;
    }

    // Check for duplicates
    const key = getDefinedNameKey(sanitized, undefined);
    if (existingKeys.has(key)) {
      result.skipped++;
      result.skippedReasons.push({ label: name, reason: 'name already exists' });
      return;
    }

    // Validate the sanitized name
    const validation = validateName(sanitized, existingKeys, undefined);
    if (!validation.valid) {
      result.skipped++;
      result.skippedReasons.push({ label: name, reason: validation.message ?? 'invalid name' });
      return;
    }

    // Build A1 reference string
    const refersToA1 =
      refStartRow === refEndRow && refStartCol === refEndCol
        ? `=$${colToLetter(refStartCol)}$${refStartRow + 1}`
        : `=$${colToLetter(refStartCol)}$${refStartRow + 1}:$${colToLetter(refEndCol)}$${refEndRow + 1}`;

    try {
      await create(ctx, { name: sanitized, refersToA1 }, sheetId);
      existingKeys.add(key);
      result.success++;
    } catch (e) {
      result.skipped++;
      result.skippedReasons.push({ label: name, reason: String(e) });
    }
  };

  // Top row: each cell in top row becomes a name for the column below
  if (options.topRow) {
    for (let col = dataStartCol; col <= dataEndCol; col++) {
      const label = getLabel(startRow, col);
      await createSingleName(label, dataStartRow, col, dataEndRow, col);
    }
  }

  // Bottom row: each cell in bottom row becomes a name for the column above
  if (options.bottomRow) {
    for (let col = dataStartCol; col <= dataEndCol; col++) {
      const label = getLabel(endRow, col);
      await createSingleName(label, dataStartRow, col, dataEndRow, col);
    }
  }

  // Left column: each cell in left column becomes a name for the row to the right
  if (options.leftColumn) {
    for (let row = dataStartRow; row <= dataEndRow; row++) {
      const label = getLabel(row, startCol);
      await createSingleName(label, row, dataStartCol, row, dataEndCol);
    }
  }

  // Right column: each cell in right column becomes a name for the row to the left
  if (options.rightColumn) {
    for (let row = dataStartRow; row <= dataEndRow; row++) {
      const label = getLabel(row, endCol);
      await createSingleName(label, row, dataStartCol, row, dataEndCol);
    }
  }

  return result;
}
