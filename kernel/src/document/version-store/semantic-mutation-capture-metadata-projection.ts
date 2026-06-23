import { toA1 } from '@mog/spreadsheet-utils/a1';

import type {
  CfChange,
  CommentChange,
  FilterChange,
  FloatingObjectChange,
  NamedRangeChange,
  RangeChange,
  SortingChange,
  TableChange,
} from '../../bridges/compute/compute-types.gen';
import {
  decodeRangeChangeMeta,
  filterEntityId,
  isLikelyDefinedName,
  isSheetIndex,
  isStableSheetId,
  isStableString,
  metadataChange,
  semanticChartSourceValue,
  semanticFilterValue,
  semanticFloatingObjectAnchorValue,
  semanticObjectValue,
  semanticRangeDomain,
  semanticRangeValue,
} from './semantic-mutation-capture-projection-helpers';
import type { VersionSemanticChangeRecord } from './semantic-mutation-capture-projection-types';

export function mapFilterChanges(
  filterChanges: readonly FilterChange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of filterChanges) {
    if (!isStableSheetId(change.sheetId)) continue;

    const entityId = filterEntityId(change);
    const value = semanticFilterValue(change);
    changes.push({
      structural: {
        kind: 'metadata',
        changeId: `mutation-${sequence}:filter:${changes.length}`,
        domain: 'filters',
        entityId,
        propertyPath: ['state'],
      },
      before: { kind: 'value', value: change.kind === 'Removed' ? value : null },
      after: { kind: 'value', value: change.kind === 'Removed' ? null : value },
      display: {
        entityLabel: { kind: 'value', value: entityId },
      },
    });
  }
  return changes;
}

export function mapSortingChanges(
  sortingChanges: readonly SortingChange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of sortingChanges) {
    if (
      !isStableSheetId(change.sheetId) ||
      !isSheetIndex(change.startRow) ||
      !isSheetIndex(change.startCol) ||
      !isSheetIndex(change.endRow) ||
      !isSheetIndex(change.endCol) ||
      change.endRow < change.startRow ||
      change.endCol < change.startCol
    ) {
      continue;
    }

    const rangeLabel = `${toA1(change.startRow, change.startCol)}:${toA1(change.endRow, change.endCol)}`;
    const entityId = `${change.sheetId}!${rangeLabel}`;
    const value = semanticObjectValue([
      { key: 'kind', value: change.kind },
      { key: 'range', value: rangeLabel },
      { key: 'rowsMoved', value: change.rowsMoved },
    ]);
    changes.push({
      structural: {
        kind: 'metadata',
        changeId: `mutation-${sequence}:sort:${changes.length}`,
        domain: 'sorts',
        entityId,
        propertyPath: ['order'],
      },
      before: { kind: 'value', value: change.kind === 'Removed' ? value : null },
      after: { kind: 'value', value: change.kind === 'Removed' ? null : value },
      display: {
        address: { kind: 'value', value: rangeLabel },
      },
    });
  }
  return changes;
}

export function mapNamedRangeChanges(
  namedRangeChanges: readonly NamedRangeChange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of namedRangeChanges) {
    if (!isLikelyDefinedName(change.name)) continue;
    const value = semanticObjectValue([
      { key: 'kind', value: change.kind },
      { key: 'name', value: change.name },
    ]);
    changes.push(
      metadataChange({
        sequence,
        prefix: 'named-range',
        index: changes.length,
        domain: 'named-ranges',
        entityId: `name:${change.name}`,
        propertyPath: ['definition'],
        value,
        removed: change.kind === 'Removed',
        display: { entityLabel: { kind: 'value', value: change.name } },
      }),
    );
  }
  return changes;
}

export function mapTableChanges(
  tableChanges: readonly TableChange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of tableChanges) {
    if (!isStableSheetId(change.sheetId) || !isStableString(change.tableId)) continue;

    const entityId = `${change.sheetId}!table:${change.tableId}`;
    const label = isStableString(change.name) ? change.name : entityId;
    const value = semanticObjectValue([
      { key: 'kind', value: change.kind },
      { key: 'tableId', value: change.tableId },
      ...(isStableString(change.name) ? [{ key: 'name', value: change.name }] : []),
      { key: 'sheetId', value: change.sheetId },
    ]);
    changes.push(
      metadataChange({
        sequence,
        prefix: 'table',
        index: changes.length,
        domain: 'tables',
        entityId,
        propertyPath: ['definition'],
        value,
        removed: change.kind === 'Removed',
        display: { entityLabel: { kind: 'value', value: label } },
      }),
    );
  }
  return changes;
}

export function mapCommentChanges(
  commentChanges: readonly CommentChange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of commentChanges) {
    if (!isStableSheetId(change.sheetId) || !isStableString(change.cellId)) continue;

    const address = change.position ? toA1(change.position.row, change.position.col) : undefined;
    const value = semanticObjectValue([
      { key: 'kind', value: change.kind },
      { key: 'cellId', value: change.cellId },
      ...(address ? [{ key: 'address', value: address }] : []),
    ]);
    changes.push(
      metadataChange({
        sequence,
        prefix: 'comment',
        index: changes.length,
        domain: 'comments-notes',
        entityId: `${change.sheetId}!comment:${change.cellId}`,
        propertyPath: ['cell'],
        value,
        removed: change.kind === 'Removed',
        ...(address ? { display: { address: { kind: 'value', value: address } } } : {}),
      }),
    );
  }
  return changes;
}

export function mapCfChanges(
  cfChanges: readonly CfChange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of cfChanges) {
    if (!isStableSheetId(change.sheetId) || !isStableString(change.ruleId)) continue;
    const value = semanticObjectValue([
      { key: 'kind', value: change.kind },
      { key: 'ruleId', value: change.ruleId },
    ]);
    changes.push(
      metadataChange({
        sequence,
        prefix: 'conditional-format',
        index: changes.length,
        domain: 'conditional-formatting',
        entityId: `${change.sheetId}!cf:${change.ruleId}`,
        propertyPath: ['rule'],
        value,
        removed: change.kind === 'Removed',
        display: { entityLabel: { kind: 'value', value: change.ruleId } },
      }),
    );
  }
  return changes;
}

export function mapFloatingObjectChanges(
  floatingObjectChanges: readonly FloatingObjectChange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of floatingObjectChanges) {
    if (!isStableSheetId(change.sheetId) || !isStableString(change.objectId)) continue;

    const chartValue = semanticChartSourceValue(change);
    if (chartValue) {
      changes.push(
        metadataChange({
          sequence,
          prefix: 'chart',
          index: changes.length,
          domain: 'charts.source-range',
          entityId: `${change.sheetId}!chart:${change.objectId}`,
          propertyPath: ['sourceRange'],
          value: chartValue,
          removed: change.kind.type === 'removed',
          display: { entityLabel: { kind: 'value', value: change.objectId } },
        }),
      );
      continue;
    }

    const objectValue = semanticFloatingObjectAnchorValue(change);
    if (!objectValue) continue;
    changes.push(
      metadataChange({
        sequence,
        prefix: 'floating-object',
        index: changes.length,
        domain: 'floating-objects.anchors',
        entityId: `${change.sheetId}!object:${change.objectId}`,
        propertyPath: ['anchor'],
        value: objectValue,
        removed: change.kind.type === 'removed',
        display: { entityLabel: { kind: 'value', value: change.objectId } },
      }),
    );
  }
  return changes;
}

export function mapRangeChanges(
  rangeChanges: readonly RangeChange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of rangeChanges) {
    if (!isStableSheetId(change.sheetId) || !isStableString(change.rangeId)) continue;

    const meta = decodeRangeChangeMeta(change.data);
    if (!meta || meta.rangeId !== change.rangeId) continue;

    const domain = semanticRangeDomain(meta.kind);
    if (!domain) continue;

    const value = semanticRangeValue(change, meta);
    changes.push(
      metadataChange({
        sequence,
        prefix: 'range',
        index: changes.length,
        domain,
        entityId: `${change.sheetId}!range:${change.rangeId}`,
        propertyPath: ['range'],
        value,
        removed: change.kind === 'Removed',
        display: { entityLabel: { kind: 'value', value: `${meta.kind}:${change.rangeId}` } },
      }),
    );
  }
  return changes;
}
