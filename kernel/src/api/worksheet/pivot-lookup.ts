import type { SheetId } from '@mog-sdk/contracts/api';
import type { PivotTableConfig as DataPivotTableConfig } from '@mog-sdk/contracts/pivot';
import type { DocumentContext } from '../../context';
import { KernelError } from '../../errors';

export async function requirePivot(
  ctx: DocumentContext,
  sheetId: SheetId,
  pivotId: string,
  operation: string,
): Promise<DataPivotTableConfig> {
  const config = await ctx.pivot.getPivot(sheetId, pivotId);
  if (!config) {
    throw new KernelError('COMPUTE_ERROR', `${operation}: Pivot table not found`);
  }
  return config;
}

export async function findPivotsByName(
  ctx: DocumentContext,
  sheetId: SheetId,
  name: string,
): Promise<DataPivotTableConfig[]> {
  let pivots: DataPivotTableConfig[];
  try {
    pivots = await ctx.pivot.getAllPivots(sheetId);
  } catch {
    return [];
  }
  return pivots.filter((pivot) => (pivot.name ?? pivot.id) === name);
}

export async function findPivotByName(
  ctx: DocumentContext,
  sheetId: SheetId,
  name: string,
): Promise<DataPivotTableConfig | undefined> {
  const matches = await findPivotsByName(ctx, sheetId, name);
  if (matches.length > 1) {
    throw new KernelError(
      'COMPUTE_ERROR',
      `Pivot table name "${name}" is ambiguous; matching pivot IDs: ${matches
        .map((pivot) => pivot.id)
        .join(', ')}`,
    );
  }
  return matches[0];
}

export async function resolvePivotName(
  ctx: DocumentContext,
  sheetId: SheetId,
  name: string,
  operation: string,
): Promise<{ pivotId: string; config: DataPivotTableConfig }> {
  const config = await findPivotByName(ctx, sheetId, name);
  if (!config) {
    throw new KernelError('COMPUTE_ERROR', `${operation}: Pivot table "${name}" not found`);
  }
  return { pivotId: config.id, config };
}
