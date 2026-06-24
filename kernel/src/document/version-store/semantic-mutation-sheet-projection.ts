import { toA1 } from '@mog/spreadsheet-utils/a1';

import type { SheetChange, StructureChangeResult } from '../../bridges/compute/compute-types.gen';
import {
  isSheetIndex,
  isStableSheetId,
  metadataChange,
  semanticObjectValue,
  semanticSheetValue,
} from './semantic-mutation-capture-projection-helpers';
import type { VersionSemanticChangeRecord } from './semantic-mutation-capture-projection-types';

export function mapSheetRenameChanges(
  sheetChanges: readonly SheetChange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of sheetChanges) {
    if (
      change.field !== 'name' ||
      typeof change.oldName !== 'string' ||
      typeof change.name !== 'string'
    ) {
      continue;
    }
    changes.push({
      structural: {
        kind: 'metadata',
        changeId: `mutation-${sequence}:sheet:${changes.length}`,
        domain: 'sheet',
        entityId: change.sheetId,
        propertyPath: ['name'],
      },
      before: { kind: 'value', value: change.oldName },
      after: { kind: 'value', value: change.name },
      display: {
        entityLabel: { kind: 'value', value: change.name },
      },
    });
  }
  return changes;
}

export function mapSheetTabColorChanges(
  sheetChanges: readonly SheetChange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of sheetChanges) {
    if (change.field !== 'tabColor') continue;
    if (change.oldColor === undefined && change.color === undefined) continue;
    changes.push({
      structural: {
        kind: 'metadata',
        changeId: `mutation-${sequence}:sheet:${changes.length}`,
        domain: 'sheet',
        entityId: change.sheetId,
        propertyPath: ['tabColor'],
      },
      before: { kind: 'value', value: change.oldColor ?? null },
      after: { kind: 'value', value: change.color ?? null },
    });
  }
  return changes;
}

export function mapSheetFrozenPaneChanges(
  sheetChanges: readonly SheetChange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of sheetChanges) {
    if (change.field !== 'frozen') continue;
    if (
      change.oldFrozenRows === undefined &&
      change.oldFrozenCols === undefined &&
      change.frozenRows === undefined &&
      change.frozenCols === undefined
    ) {
      continue;
    }
    changes.push({
      structural: {
        kind: 'metadata',
        changeId: `mutation-${sequence}:sheet:${changes.length}`,
        domain: 'sheet',
        entityId: change.sheetId,
        propertyPath: ['frozen'],
      },
      before: {
        kind: 'value',
        value: semanticObjectValue([
          { key: 'rows', value: change.oldFrozenRows ?? 0 },
          { key: 'cols', value: change.oldFrozenCols ?? 0 },
        ]),
      },
      after: {
        kind: 'value',
        value: semanticObjectValue([
          { key: 'rows', value: change.frozenRows ?? 0 },
          { key: 'cols', value: change.frozenCols ?? 0 },
        ]),
      },
    });
  }
  return changes;
}

export function mapSheetCreateChanges(
  sheetChanges: readonly SheetChange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of sheetChanges) {
    if (
      change.field !== 'sheet' ||
      change.kind !== 'Set' ||
      !isStableSheetId(change.sheetId) ||
      typeof change.name !== 'string' ||
      !isSheetIndex(change.index) ||
      change.sourceSheetId !== undefined
    ) {
      continue;
    }
    changes.push({
      structural: {
        kind: 'metadata',
        changeId: `mutation-${sequence}:sheet:${changes.length}`,
        domain: 'sheet',
        entityId: change.sheetId,
        propertyPath: ['sheet'],
      },
      before: { kind: 'value', value: null },
      after: {
        kind: 'value',
        value: semanticSheetValue({ name: change.name, index: change.index }),
      },
      display: {
        entityLabel: { kind: 'value', value: change.name },
      },
    });
  }
  return changes;
}

export function mapSheetRemoveChanges(
  sheetChanges: readonly SheetChange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of sheetChanges) {
    if (
      change.field !== 'sheet' ||
      change.kind !== 'Removed' ||
      !isStableSheetId(change.sheetId) ||
      typeof change.name !== 'string'
    ) {
      continue;
    }
    changes.push({
      structural: {
        kind: 'metadata',
        changeId: `mutation-${sequence}:sheet:${changes.length}`,
        domain: 'sheet',
        entityId: change.sheetId,
        propertyPath: ['sheet'],
      },
      before: {
        kind: 'value',
        value: semanticSheetValue({ name: change.name }),
      },
      after: { kind: 'value', value: null },
      display: {
        entityLabel: { kind: 'value', value: change.name },
      },
    });
  }
  return changes;
}

export function mapSheetCopyChanges(
  sheetChanges: readonly SheetChange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of sheetChanges) {
    if (
      change.field !== 'sheet' ||
      change.kind !== 'Set' ||
      !isStableSheetId(change.sheetId) ||
      typeof change.name !== 'string' ||
      !isSheetIndex(change.index) ||
      !isStableSheetId(change.sourceSheetId)
    ) {
      continue;
    }
    changes.push({
      structural: {
        kind: 'metadata',
        changeId: `mutation-${sequence}:sheet:${changes.length}`,
        domain: 'sheet',
        entityId: change.sheetId,
        propertyPath: ['sheet'],
      },
      before: { kind: 'value', value: null },
      after: {
        kind: 'value',
        value: semanticSheetValue({
          name: change.name,
          index: change.index,
          sourceSheetId: change.sourceSheetId,
        }),
      },
      display: {
        entityLabel: { kind: 'value', value: change.name },
      },
    });
  }
  return changes;
}

export function mapSheetMoveChanges(
  sheetChanges: readonly SheetChange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of sheetChanges) {
    if (
      change.field !== 'order' ||
      change.kind !== 'Set' ||
      !isStableSheetId(change.sheetId) ||
      !isSheetIndex(change.oldIndex) ||
      !isSheetIndex(change.index)
    ) {
      continue;
    }
    changes.push({
      structural: {
        kind: 'metadata',
        changeId: `mutation-${sequence}:sheet:${changes.length}`,
        domain: 'sheet',
        entityId: change.sheetId,
        propertyPath: ['order'],
      },
      before: { kind: 'value', value: change.oldIndex },
      after: { kind: 'value', value: change.index },
    });
  }
  return changes;
}

export function mapStructureChanges(
  structureChanges: readonly StructureChangeResult[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of structureChanges) {
    if (!isStableSheetId(change.sheetId) || !isSheetIndex(change.at) || change.count <= 0) {
      continue;
    }

    const axis = structureChangeAxis(change.changeType);
    const removed = structureChangeRemoved(change.changeType);
    if (!axis || removed === undefined) continue;

    for (let offset = 0; offset < change.count; offset += 1) {
      const index = change.at + offset;
      const displayRef = structureDisplayRef(axis, index);
      changes.push(
        metadataChange({
          sequence,
          prefix: axis,
          index: changes.length,
          domain: 'rows-columns',
          entityId: `${change.sheetId}!${axis}:${index}`,
          propertyPath: ['order'],
          value: semanticObjectValue([
            { key: 'axis', value: axis },
            { key: 'sheetId', value: change.sheetId },
            { key: 'index', value: index },
            { key: 'displayRef', value: displayRef },
          ]),
          removed,
          display: { address: { kind: 'value', value: displayRef } },
        }),
      );
    }
  }
  return changes;
}

function structureChangeAxis(
  changeType: StructureChangeResult['changeType'],
): 'row' | 'column' | null {
  switch (changeType) {
    case 'insertRows':
    case 'deleteRows':
      return 'row';
    case 'insertCols':
    case 'deleteCols':
      return 'column';
    default:
      return null;
  }
}

function structureChangeRemoved(
  changeType: StructureChangeResult['changeType'],
): boolean | undefined {
  switch (changeType) {
    case 'deleteRows':
    case 'deleteCols':
      return true;
    case 'insertRows':
    case 'insertCols':
      return false;
    default:
      return undefined;
  }
}

function structureDisplayRef(axis: 'row' | 'column', index: number): string {
  if (axis === 'row') {
    const rowLabel = String(index + 1);
    return `${rowLabel}:${rowLabel}`;
  }
  const columnLabel = toA1(0, index).replace(/\d+$/, '');
  return `${columnLabel}:${columnLabel}`;
}
