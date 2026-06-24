import type { VersionMergeChange } from '@mog-sdk/contracts/api';

import {
  isNoopMergeChange,
  unsupported,
  unsupportedStructuralReason,
} from './version-merge-materializer-support-diagnostics';
import type { MergeMaterializationSupport } from './version-merge-materializer-support-types';
import {
  isSupportedRowColumnTransition,
  parseCellEntity,
  parseCellMergeValue,
  parseDirectFormatMergeValue,
  parseMaterializableStructural,
  parseRowColumnEntity,
  parseRowColumnMergeValue,
  parseSheetEntity,
  parseSheetMetadataMergeValue,
} from './version-merge-materializer-support-values';

export function inspectMaterializableMergeChange(
  change: Pick<VersionMergeChange, 'structural' | 'merged'> &
    Partial<Pick<VersionMergeChange, 'base' | 'ours'>>,
): MergeMaterializationSupport {
  const structural = parseMaterializableStructural(change.structural);
  if (!structural) {
    return unsupported(change.structural, unsupportedStructuralReason(change.structural), {
      noop: isNoopMergeChange(change),
    });
  }
  if (structural.domain === 'cells.formats.direct') {
    if (!parseCellEntity(structural.entityId)) {
      return unsupported(structural, 'unsupportedEntityId');
    }
    return parseDirectFormatMergeValue(change.merged)
      ? { ok: true }
      : unsupported(structural, 'unsupportedMergedValue');
  }
  if (structural.domain === 'rows-columns') {
    const target = parseRowColumnEntity(structural.entityId);
    if (!target) return unsupported(structural, 'unsupportedEntityId');
    if (!parseRowColumnMergeValue(change.merged, target)) {
      return unsupported(structural, 'unsupportedMergedValue');
    }
    if (change.base !== undefined) {
      const transitionInput = {
        base: change.base,
        merged: change.merged,
        ...(change.ours !== undefined ? { ours: change.ours } : {}),
      };
      if (!isSupportedRowColumnTransition(transitionInput, target)) {
        return unsupported(structural, 'unsupportedRowsColumnsTransition');
      }
    }
    return { ok: true };
  }
  if (structural.domain === 'sheet' || structural.domain === 'sheets') {
    if (!parseSheetEntity(structural.entityId)) {
      return unsupported(structural, 'unsupportedEntityId');
    }
    const property = structural.propertyPath[0];
    if (property !== 'name' && property !== 'tabColor' && property !== 'frozen') {
      return unsupported(structural, 'unsupportedPropertyPath');
    }
    return parseSheetMetadataMergeValue(change.merged, property)
      ? { ok: true }
      : unsupported(structural, 'unsupportedMergedValue');
  }
  if (!parseCellEntity(structural.entityId)) {
    return unsupported(structural, 'unsupportedEntityId');
  }
  return parseCellMergeValue(change.merged, structural.domain)
    ? { ok: true }
    : unsupported(structural, 'unsupportedMergedValue');
}
