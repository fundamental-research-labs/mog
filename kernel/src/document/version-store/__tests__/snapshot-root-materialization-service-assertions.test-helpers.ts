import type { VersionGraphInitializeResult } from '../provider';
import type { SnapshotRootMaterializationResult } from '../snapshot-root-materialization-service';

export function expectMaterializationSuccess<TMaterialized>(
  result: SnapshotRootMaterializationResult<TMaterialized>,
): asserts result is Extract<SnapshotRootMaterializationResult<TMaterialized>, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`expected materialization success: ${result.error.code}`);
  }
}

export function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

export function cellRangeEquals(
  range: { startRow: number; startCol: number; endRow: number; endCol: number },
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
): boolean {
  return (
    range.startRow === startRow &&
    range.startCol === startCol &&
    range.endRow === endRow &&
    range.endCol === endCol
  );
}
