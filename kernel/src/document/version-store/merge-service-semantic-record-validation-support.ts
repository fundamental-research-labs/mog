import type {
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionRedactedValue,
} from '@mog-sdk/contracts/api';

import type { SemanticValueChangeSupport } from './merge-service-semantic-record-types';
import {
  hasMaterializableCellEntity,
  isCellContentMergeDomain,
  isMaterializableFormulaCellDiffValue,
  isMaterializableSemanticCellDiffValue,
  isSupportedCellPropertyPath,
} from './merge-service-semantic-record-validation-cell';
import {
  isSupportedRowColumnTransition,
  parseRowColumnEntity,
} from './merge-service-semantic-record-validation-row-column';

const SUPPORTED_SEMANTIC_MERGE_DOMAINS = new Set([
  'cell',
  'cells.values',
  'cells.formulas',
  'cells.formats.direct',
  'rows-columns',
]);

export function stableMergePairStructural(
  left: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
  right: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
): Exclude<VersionDiffStructuralMetadata, VersionRedactedValue> {
  if (isCellContentMergeDomain(left.domain) && isCellContentMergeDomain(right.domain)) {
    const formulasOnly = left.domain === 'cells.formulas' && right.domain === 'cells.formulas';
    return {
      kind: 'metadata',
      changeId: left.changeId,
      domain: formulasOnly ? 'cells.formulas' : 'cells.values',
      entityId: left.entityId,
      propertyPath: formulasOnly ? ['formula'] : ['value'],
    };
  }
  if (left.domain === 'rows-columns' && right.domain === 'rows-columns') {
    return { ...left, domain: 'rows-columns', propertyPath: ['order'] };
  }
  if (left.domain === 'cells.formats.direct' && right.domain === 'cells.formats.direct') {
    return { ...left, domain: 'cells.formats.direct', propertyPath: ['format'] };
  }
  return left;
}

export function inspectSupportedSemanticValueChange(
  structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
  before: VersionDiffValue,
  after: VersionDiffValue,
): SemanticValueChangeSupport {
  if (!SUPPORTED_SEMANTIC_MERGE_DOMAINS.has(structural.domain)) {
    return { ok: false, reason: 'unsupportedDomain' };
  }

  if (isCellContentMergeDomain(structural.domain)) {
    if (!hasMaterializableCellEntity(structural.entityId)) {
      return { ok: false, reason: 'unsupportedEntityId' };
    }
    if (!isSupportedCellPropertyPath(structural.domain, structural.propertyPath)) {
      return { ok: false, reason: 'unsupportedPropertyPath' };
    }
    const supported =
      structural.domain === 'cells.formulas'
        ? isMaterializableFormulaCellDiffValue(before) &&
          isMaterializableFormulaCellDiffValue(after)
        : isMaterializableSemanticCellDiffValue(before) &&
          isMaterializableSemanticCellDiffValue(after);
    return supported
      ? { ok: true }
      : {
          ok: false,
          reason:
            structural.domain === 'cells.formulas'
              ? 'unsupportedFormulaValue'
              : 'unsupportedCellValue',
        };
  }

  if (structural.domain === 'rows-columns') {
    const target = parseRowColumnEntity(structural.entityId);
    if (!target) return { ok: false, reason: 'unsupportedEntityId' };
    if (!(structural.propertyPath.length === 1 && structural.propertyPath[0] === 'order')) {
      return { ok: false, reason: 'unsupportedPropertyPath' };
    }
    return isSupportedRowColumnTransition({ before, after }, target)
      ? { ok: true }
      : { ok: false, reason: 'unsupportedRowsColumnsTransition' };
  }

  if (!hasMaterializableCellEntity(structural.entityId)) {
    return { ok: false, reason: 'unsupportedEntityId' };
  }
  if (!(structural.propertyPath.length === 1 && structural.propertyPath[0] === 'format')) {
    return { ok: false, reason: 'unsupportedPropertyPath' };
  }
  return { ok: true };
}

export function semanticMergePropertyKey(
  structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
): string {
  if (isCellContentMergeDomain(structural.domain)) {
    return JSON.stringify(['cells.values', structural.entityId, ['value']]);
  }
  if (structural.domain === 'rows-columns') {
    return JSON.stringify(['rows-columns', structural.entityId, ['order']]);
  }
  if (structural.domain === 'cells.formats.direct') {
    return JSON.stringify(['cells.formats.direct', structural.entityId, ['format']]);
  }
  return JSON.stringify([structural.domain, structural.entityId, structural.propertyPath]);
}
