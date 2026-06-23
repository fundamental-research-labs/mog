import type { VersionMergeCommitCaptureInput } from '../../document/version-store/commit-service';
import type { VersionStoreFailure } from '../../document/version-store/provider';
import { unsupportedMergeChange } from './version-merge-materialization-plan-diagnostics';
import { parseCellEntity, parseRowColumnEntity } from './version-merge-materialization-plan-entities';
import { compareParsedMergeChanges } from './version-merge-materialization-plan-ordering';
import {
  parseCellStructural,
  parseDirectFormatStructural,
  parseRowColumnStructural,
} from './version-merge-materialization-plan-structural';
import type { ParsedMergeChange } from './version-merge-materialization-plan-types';
import {
  parseCellMergeValue,
  parseDirectFormatMergeValue,
  parseRowColumnTransition,
} from './version-merge-materialization-plan-values';
import { inspectMaterializableMergeChange } from './version-merge-materializer-support';

export type {
  ParsedCellMergeChange,
  ParsedDirectFormatMergeChange,
  ParsedMergeChange,
  ParsedRowColumnMergeChange,
  RowColumnAxis,
  RowColumnTransition,
} from './version-merge-materialization-plan-types';

export function parseMergeChanges(input: VersionMergeCommitCaptureInput):
  | {
      readonly ok: true;
      readonly changes: readonly ParsedMergeChange[];
    }
  | {
      readonly ok: false;
      readonly failure: VersionStoreFailure;
    } {
  const parsed: ParsedMergeChange[] = [];
  for (let index = 0; index < input.changes.length; index++) {
    const change = input.changes[index];
    const support = inspectMaterializableMergeChange(change);
    if (!support.ok) {
      return unsupportedMergeChange(input, index, change.structural, {
        reason: support.reason,
        ...(support.noop === undefined ? {} : { noop: support.noop }),
      });
    }
    const structural =
      parseCellStructural(change.structural) ??
      parseDirectFormatStructural(change.structural) ??
      parseRowColumnStructural(change.structural);
    if (!structural) {
      return unsupportedMergeChange(input, index, change.structural);
    }
    if (structural.domain === 'cells.formats.direct') {
      const target = parseCellEntity(structural.entityId);
      if (!target) {
        return unsupportedMergeChange(input, index, structural, {
          reason: 'unsupportedEntityId',
        });
      }
      const merged = parseDirectFormatMergeValue(change.merged);
      if (!merged) {
        return unsupportedMergeChange(input, index, structural, {
          reason: 'unsupportedMergedValue',
        });
      }
      parsed.push({
        kind: 'directCellFormat',
        itemIndex: index,
        change,
        structural,
        sheetId: target.sheetId,
        address: target.address,
        row: target.row,
        col: target.col,
        merged,
      });
      continue;
    }
    if (structural.domain === 'rows-columns') {
      const target = parseRowColumnEntity(structural.entityId);
      if (!target) {
        return unsupportedMergeChange(input, index, structural, {
          reason: 'unsupportedEntityId',
        });
      }
      const transition = parseRowColumnTransition(change, target);
      if (!transition) {
        return unsupportedMergeChange(input, index, structural, {
          reason: 'unsupportedRowsColumnsTransition',
        });
      }
      parsed.push({
        kind: 'rowColumnOrder',
        itemIndex: index,
        change,
        structural,
        sheetId: target.sheetId,
        axis: target.axis,
        index: target.index,
        transition,
      });
      continue;
    }
    const target = parseCellEntity(structural.entityId);
    if (!target) {
      return unsupportedMergeChange(input, index, structural, {
        reason: 'unsupportedEntityId',
      });
    }
    const merged = parseCellMergeValue(change.merged, structural.domain);
    if (!merged) {
      return unsupportedMergeChange(input, index, structural, {
        reason: 'unsupportedMergedValue',
      });
    }
    parsed.push({
      kind: 'cellValue',
      itemIndex: index,
      change,
      structural,
      sheetId: target.sheetId,
      address: target.address,
      row: target.row,
      col: target.col,
      merged,
    });
  }
  return { ok: true, changes: parsed.sort(compareParsedMergeChanges) };
}
