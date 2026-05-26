/**
 * Scenario Operations Module
 *
 * Standalone functions for scenario (What-If Analysis) operations.
 * Scenarios are WORKBOOK-SCOPED, not sheet-scoped.
 *
 * All functions take DocumentContext as first param.
 *
 * @see sheet-api.ts - Main SheetAPI class that delegates to these functions
 */

import type {
  ActiveScenarioState,
  ApplyScenarioResult,
  OriginalCellValue,
  ScenarioConfig,
} from '@mog-sdk/contracts/api';
import { type CellValue, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type {
  Scenario,
  ScenarioActiveState as ScenarioActiveStateWire,
  ScenarioApplyResult as ScenarioApplyResultWire,
  ScenarioCreateInput,
  ScenarioRestoreResult as ScenarioRestoreResultWire,
  ScenarioUpdateInput,
  ScenarioValidationError,
} from '../../../bridges/compute/compute-types.gen';

import type { DocumentContext, OperationResult } from '../../worksheet/operations/shared';
import { operationFailed } from '../../worksheet/operations/shared';
import { KernelError } from '../../../errors';

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Validate scenario ID is non-empty.
 */
function isValidScenarioId(scenarioId: string): boolean {
  return typeof scenarioId === 'string' && scenarioId.length > 0;
}

type ScenarioCreateResultWire = {
  success?: boolean;
  scenarioId?: string;
  errors?: ScenarioValidationError[];
};

type ScenarioUpdateResultWire = {
  success?: boolean;
  errors?: ScenarioValidationError[];
};

type ScenarioRemoveResultWire = {
  success?: boolean;
  scenarioId?: string;
  errors?: ScenarioValidationError[];
};

function formatScenarioErrors(errors: ScenarioValidationError[] | undefined): string {
  if (!errors?.length) return 'unknown scenario validation error';
  return errors.map((error) => `${error.field}: ${error.message}`).join('; ');
}

function decodeScenarioCreateResult(data: unknown): OperationResult<string> {
  const result = data as ScenarioCreateResultWire | undefined;
  if (!result || typeof result.success !== 'boolean') {
    return {
      success: false,
      error: operationFailed('createScenario', 'Rust response missing ScenarioCreateResult'),
    };
  }
  if (!result.success) {
    return {
      success: false,
      error: operationFailed('createScenario', formatScenarioErrors(result.errors)),
    };
  }
  if (!result.scenarioId) {
    return {
      success: false,
      error: operationFailed('createScenario', 'Rust success response missing scenarioId'),
    };
  }
  return { success: true, data: result.scenarioId };
}

function decodeScenarioApplyResult(data: unknown): OperationResult<ApplyScenarioResult> {
  const result = data as ScenarioApplyResultWire | undefined;
  if (!result || typeof result.success !== 'boolean') {
    return {
      success: false,
      error: operationFailed('applyScenarioFull', 'Rust response missing ScenarioApplyResult'),
    };
  }
  if (!result.success) {
    return {
      success: false,
      error: operationFailed('applyScenarioFull', formatScenarioErrors(result.errors)),
    };
  }
  if (!result.baselineId) {
    return {
      success: false,
      error: operationFailed('applyScenarioFull', 'Rust success response missing baselineId'),
    };
  }
  return {
    success: true,
    data: {
      baselineId: result.baselineId,
      documentId: result.documentId ?? undefined,
      cellsUpdated: result.cellsUpdated,
      skippedCells: result.skippedCells ?? [],
      originalValues: (result.originalValues ?? []).map((original) => ({
        sheetId: toSheetId(original.sheetId),
        cellId: original.cellId,
        value: original.value as string | number | boolean | null,
        formula: original.formula ?? undefined,
      })),
    },
  };
}

function decodeScenarioRestoreResult(data: unknown): OperationResult<void> {
  const result = data as ScenarioRestoreResultWire | undefined;
  if (!result || typeof result.success !== 'boolean') {
    return {
      success: false,
      error: operationFailed(
        'restoreScenarioValues',
        'Rust response missing ScenarioRestoreResult',
      ),
    };
  }
  if (!result.success) {
    return {
      success: false,
      error: operationFailed('restoreScenarioValues', formatScenarioErrors(result.errors)),
    };
  }
  return { success: true, data: undefined };
}

function decodeActiveScenarioState(
  state: ScenarioActiveStateWire | null | undefined,
): ActiveScenarioState | null {
  if (!state) return null;
  return {
    scenarioId: state.scenarioId,
    baselineId: state.baselineId,
    documentId: state.documentId,
    definitionStatus: state.definitionStatus as ActiveScenarioState['definitionStatus'],
    cellMutationStatus: state.cellMutationStatus as ActiveScenarioState['cellMutationStatus'],
  };
}

function decodeScenarioUpdateResult(data: unknown): OperationResult<void> {
  const result = data as ScenarioUpdateResultWire | undefined;
  if (!result || typeof result.success !== 'boolean') {
    return {
      success: false,
      error: operationFailed('updateScenario', 'Rust response missing ScenarioUpdateResult'),
    };
  }
  if (!result.success) {
    return {
      success: false,
      error: operationFailed('updateScenario', formatScenarioErrors(result.errors)),
    };
  }
  return { success: true, data: undefined };
}

function decodeScenarioRemoveResult(data: unknown): OperationResult<void> {
  const result = data as ScenarioRemoveResultWire | undefined;
  if (!result || typeof result.success !== 'boolean') {
    return {
      success: false,
      error: operationFailed('deleteScenario', 'Rust response missing ScenarioRemoveResult'),
    };
  }
  if (!result.success) {
    return {
      success: false,
      error: operationFailed('deleteScenario', formatScenarioErrors(result.errors)),
    };
  }
  return { success: true, data: undefined };
}

// =============================================================================
// Scenario Operations
// =============================================================================

/**
 * Create a new scenario.
 *
 * @param ctx - Store context
 * @param input - Scenario configuration
 * @returns OperationResult with the created scenario's ID
 *
 * @example
 * ```typescript
 * const result = await createScenario(ctx, {
 *   name: "Best Case",
 *   changingCells: [{ row: 0, col: 0, value: 100 }]
 * });
 * if (result.success) {
 *   console.log("Scenario ID:", result.data);
 * }
 * ```
 */
export async function createScenario(
  ctx: DocumentContext,
  input: ScenarioConfig,
): Promise<OperationResult<string>> {
  try {
    const bridgeInput: ScenarioCreateInput = {
      name: input.name,
      comment: input.comment ?? '',
      changingCells: input.changingCells,
      values: input.values as CellValue[],
    };
    const result = await ctx.computeBridge.createScenario(bridgeInput);
    return decodeScenarioCreateResult(result.data);
  } catch (e) {
    return {
      success: false,
      error: operationFailed('createScenario', String(e)),
    };
  }
}

/**
 * Update an existing scenario's configuration.
 *
 * @param ctx - Store context
 * @param scenarioId - ID of the scenario to update
 * @param input - Updated scenario configuration
 * @returns OperationResult indicating success or failure
 */
export async function updateScenario(
  ctx: DocumentContext,
  scenarioId: string,
  input: Partial<ScenarioConfig>,
): Promise<OperationResult<void>> {
  if (!isValidScenarioId(scenarioId)) {
    return {
      success: false,
      error: operationFailed('updateScenario', 'scenarioId must be a non-empty string'),
    };
  }

  try {
    const bridgeInput: ScenarioUpdateInput = {
      name: input.name,
      comment: input.comment,
      changingCells: input.changingCells,
      values: input.values as CellValue[] | undefined,
    };
    const result = await ctx.computeBridge.updateScenario(scenarioId, bridgeInput);
    return decodeScenarioUpdateResult(result.data);
  } catch (e) {
    return {
      success: false,
      error: operationFailed('updateScenario', String(e)),
    };
  }
}

/**
 * Delete a scenario.
 *
 * @param ctx - Store context
 * @param scenarioId - ID of the scenario to delete
 * @returns OperationResult indicating success or failure
 */
export async function deleteScenario(
  ctx: DocumentContext,
  scenarioId: string,
): Promise<OperationResult<void>> {
  if (!isValidScenarioId(scenarioId)) {
    return {
      success: false,
      error: operationFailed('deleteScenario', 'scenarioId must be a non-empty string'),
    };
  }

  try {
    const result = await ctx.computeBridge.removeScenario(scenarioId);
    return decodeScenarioRemoveResult(result.data);
  } catch (e) {
    return {
      success: false,
      error: operationFailed('deleteScenario', String(e)),
    };
  }
}

/**
 * Get all scenarios in the workbook.
 *
 * @param ctx - Store context
 * @returns Array of scenario configurations
 */
export async function getAllScenarios(ctx: DocumentContext): Promise<Scenario[]> {
  return ctx.computeBridge.getAllScenarios();
}

/**
 * Read session-scoped active scenario state.
 *
 * The legacy persisted activeScenarioId field is intentionally ignored. Until
 * Rust owns atomic apply/restore/baseline state, no scenario is considered
 * active through workbook storage.
 */
export async function getActiveScenarioState(
  ctx: DocumentContext,
): Promise<OperationResult<ActiveScenarioState | null>> {
  try {
    const state = await ctx.computeBridge.getActiveScenarioState();
    return { success: true, data: decodeActiveScenarioState(state) };
  } catch (e) {
    return {
      success: false,
      error: operationFailed('getActiveScenarioState', String(e)),
    };
  }
}

// =============================================================================
// Apply / Restore — Full Scenario Operations
// =============================================================================

/**
 * Apply a scenario.
 *
 * Scenario active/baseline state is no longer persisted. The previous TS-owned
 * implementation wrote cells and then separately wrote activeScenarioId, which
 * was non-atomic and could leave applied values without a restorable baseline.
 * Reject until Rust-owned compute_apply_scenario provides one mutation result.
 *
 * @param scenarioId - ID of the scenario to apply
 */
export async function applyScenarioFull(
  ctx: DocumentContext,
  scenarioId: string,
): Promise<OperationResult<ApplyScenarioResult>> {
  if (!isValidScenarioId(scenarioId)) {
    return {
      success: false,
      error: operationFailed('applyScenarioFull', 'scenarioId must be a non-empty string'),
    };
  }
  try {
    const result = await ctx.computeBridge.applyScenario(scenarioId);
    return decodeScenarioApplyResult(result.data);
  } catch (e) {
    return {
      success: false,
      error: operationFailed('applyScenarioFull', String(e)),
    };
  }
}

/**
 * Restore original values from the active Rust session baseline.
 *
 * The legacy `originalValues` parameter is accepted only for compatibility with
 * existing UI call sites. It is intentionally ignored so restore cannot regress
 * to TS-owned cell writes.
 *
 * @param originalValues - Legacy originals, ignored.
 */
export async function restoreScenarioValues(
  ctx: DocumentContext,
  _originalValues: OriginalCellValue[],
): Promise<OperationResult<void>> {
  const active = await getActiveScenarioState(ctx);
  if (!active.success) return active;
  if (!active.data?.baselineId) {
    return {
      success: false,
      error: operationFailed('restoreScenarioValues', 'No active scenario baseline'),
    };
  }
  return restoreScenarioBaseline(ctx, active.data.baselineId);
}

/**
 * Restore original values from a named Rust session baseline.
 */
export async function restoreScenarioBaseline(
  ctx: DocumentContext,
  baselineId: string,
): Promise<OperationResult<void>> {
  if (!isValidScenarioId(baselineId)) {
    return {
      success: false,
      error: operationFailed('restoreScenarioValues', 'baselineId must be a non-empty string'),
    };
  }
  try {
    const result = await ctx.computeBridge.restoreScenario(baselineId);
    return decodeScenarioRestoreResult(result.data);
  } catch (e) {
    return {
      success: false,
      error: operationFailed('restoreScenarioValues', String(e)),
    };
  }
}
