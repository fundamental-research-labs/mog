/**
 * Scenarios Domain Module (Kernel Domain)
 *
 * Data operations for What-If Analysis Scenarios.
 * Delegates all data access to ComputeBridge (Rust compute core).
 */

import { toCellId, type CellId } from '@mog-sdk/contracts/cell-identity';
import {
  MAX_CHANGING_CELLS_PER_SCENARIO,
  MAX_SCENARIOS,
  MAX_SCENARIO_COMMENT_LENGTH,
  MAX_SCENARIO_NAME_LENGTH,
} from '@mog-sdk/contracts/store';
import type { CellValue } from '@mog-sdk/contracts/core';
import type {
  Scenario,
  ScenarioCreateInput,
  ScenarioUpdateInput,
} from '../../bridges/compute/compute-types.gen';

import type { DocumentContext } from '../../context/types';
import { KernelError } from '../../errors';

// =============================================================================
// Validation Helpers
// =============================================================================

export interface ScenarioValidationError {
  field: 'name' | 'comment' | 'changingCells' | 'values' | 'general';
  message: string;
}

export function validateScenarioName(name: string): ScenarioValidationError[] {
  const errors: ScenarioValidationError[] = [];

  if (!name || name.trim().length === 0) {
    errors.push({ field: 'name', message: 'Scenario name is required' });
  } else if (name.length > MAX_SCENARIO_NAME_LENGTH) {
    errors.push({
      field: 'name',
      message: `Scenario name cannot exceed ${MAX_SCENARIO_NAME_LENGTH} characters`,
    });
  }

  return errors;
}

export function validateScenarioComment(comment: string): ScenarioValidationError[] {
  const errors: ScenarioValidationError[] = [];

  if (comment.length > MAX_SCENARIO_COMMENT_LENGTH) {
    errors.push({
      field: 'comment',
      message: `Scenario comment cannot exceed ${MAX_SCENARIO_COMMENT_LENGTH} characters`,
    });
  }

  return errors;
}

export function validateChangingCells(changingCells: CellId[]): ScenarioValidationError[] {
  const errors: ScenarioValidationError[] = [];

  if (!changingCells || changingCells.length === 0) {
    errors.push({ field: 'changingCells', message: 'At least one changing cell is required' });
  } else if (changingCells.length > MAX_CHANGING_CELLS_PER_SCENARIO) {
    errors.push({
      field: 'changingCells',
      message: `Cannot exceed ${MAX_CHANGING_CELLS_PER_SCENARIO} changing cells per scenario`,
    });
  }

  const seen = new Set<CellId>();
  for (const cellId of changingCells) {
    if (seen.has(cellId)) {
      errors.push({ field: 'changingCells', message: 'Duplicate changing cells are not allowed' });
      break;
    }
    seen.add(cellId);
  }

  return errors;
}

export function validateValues(
  changingCells: CellId[],
  values: CellValue[],
): ScenarioValidationError[] {
  const errors: ScenarioValidationError[] = [];

  if (!values) {
    errors.push({ field: 'values', message: 'Values are required' });
  } else if (values.length !== changingCells.length) {
    errors.push({
      field: 'values',
      message: 'Number of values must match number of changing cells',
    });
  }

  return errors;
}

export function validateScenarioInput(
  input: ScenarioCreateInput,
  existingScenarios: Scenario[],
  excludeScenarioId?: string,
): ScenarioValidationError[] {
  const errors: ScenarioValidationError[] = [];
  const changingCells = input.changingCells.map(toCellId);

  errors.push(...validateScenarioName(input.name));
  errors.push(...validateScenarioComment(input.comment));
  errors.push(...validateChangingCells(changingCells));
  errors.push(...validateValues(changingCells, input.values));

  const nameLower = input.name.toLowerCase().trim();
  const duplicate = existingScenarios.find(
    (s) => s.id !== excludeScenarioId && s.name.toLowerCase().trim() === nameLower,
  );
  if (duplicate) {
    errors.push({ field: 'name', message: 'A scenario with this name already exists' });
  }

  return errors;
}

// =============================================================================
// Getters (async — delegate to ComputeBridge)
// =============================================================================

export async function getAll(ctx: DocumentContext): Promise<Scenario[]> {
  return ctx.computeBridge.getAllScenarios();
}

export async function getById(ctx: DocumentContext, scenarioId: string): Promise<Scenario | null> {
  const scenarios = await getAll(ctx);
  return scenarios.find((s) => s.id === scenarioId) ?? null;
}

export async function getActiveScenarioId(_ctx: DocumentContext): Promise<string | null> {
  return null;
}

export async function getActiveScenario(ctx: DocumentContext): Promise<Scenario | null> {
  const activeId = await getActiveScenarioId(ctx);
  if (!activeId) return null;
  return getById(ctx, activeId);
}

export async function getCount(ctx: DocumentContext): Promise<number> {
  const scenarios = await getAll(ctx);
  return scenarios.length;
}

export async function isAtLimit(ctx: DocumentContext): Promise<boolean> {
  const count = await getCount(ctx);
  return count >= MAX_SCENARIOS;
}

export async function findByName(ctx: DocumentContext, name: string): Promise<Scenario | null> {
  const nameLower = name.toLowerCase().trim();
  const scenarios = await getAll(ctx);
  return scenarios.find((s) => s.name.toLowerCase().trim() === nameLower) ?? null;
}

// =============================================================================
// Create/Update/Delete Operations
// =============================================================================

export interface ScenarioCreateResult {
  success: boolean;
  scenarioId?: string;
  errors?: ScenarioValidationError[];
}

export function create(ctx: DocumentContext, input: ScenarioCreateInput): void {
  void ctx.computeBridge.createScenario(input);
}

export interface ScenarioUpdateResult {
  success: boolean;
  errors?: ScenarioValidationError[];
}

export function update(
  ctx: DocumentContext,
  scenarioId: string,
  updates: ScenarioUpdateInput,
): void {
  void ctx.computeBridge.updateScenario(scenarioId, updates);
}

export function remove(ctx: DocumentContext, scenarioId: string): void {
  void ctx.computeBridge.removeScenario(scenarioId);
}

// =============================================================================
// Active Scenario Management
// =============================================================================

export function setActiveScenarioId(ctx: DocumentContext, scenarioId: string | null): void {
  void ctx;
  void scenarioId;
  throw new KernelError(
    'SCENARIO_ACTIVE_STATE_READ_ONLY',
    'Scenario active state is read-only; use Rust-owned scenario apply/restore once available.',
  );
}
