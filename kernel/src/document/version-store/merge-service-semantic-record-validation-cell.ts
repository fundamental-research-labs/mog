import type { VersionDiffValue, VersionSemanticValue } from '@mog-sdk/contracts/api';
import { parseCellAddress } from '@mog/spreadsheet-utils/a1';

import { isRecord } from './merge-service-semantic-record-validation-guards';

export function isCellContentMergeDomain(domain: string): boolean {
  return domain === 'cell' || domain === 'cells.values' || domain === 'cells.formulas';
}

export function allowsEmptySemanticPropertyPath(domain: string): boolean {
  return domain === 'cells.values' || domain === 'cells.formulas';
}

export function isSupportedCellPropertyPath(
  domain: string,
  propertyPath: readonly string[],
): boolean {
  if (domain === 'cell') return propertyPath.length === 1 && propertyPath[0] === 'value';
  if (domain === 'cells.values') {
    return propertyPath.length === 0 || (propertyPath.length === 1 && propertyPath[0] === 'value');
  }
  return (
    propertyPath.length === 0 ||
    (propertyPath.length === 1 && (propertyPath[0] === 'formula' || propertyPath[0] === 'value'))
  );
}

export function hasMaterializableCellEntity(entityId: string): boolean {
  const separator = entityId.lastIndexOf('!');
  if (separator <= 0 || separator === entityId.length - 1) return false;
  return Boolean(parseCellAddress(entityId.slice(separator + 1)));
}

export function isMaterializableSemanticCellDiffValue(value: VersionDiffValue): boolean {
  return value.kind === 'value' && isMaterializableSemanticCellValue(value.value);
}

export function isMaterializableFormulaCellDiffValue(value: VersionDiffValue): boolean {
  return value.kind === 'value' && isMaterializableFormulaCellValue(value.value);
}

function isMaterializableSemanticCellValue(value: VersionSemanticValue): boolean {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }
  if (!isRecord(value)) return false;
  if (value.kind === 'blank') return true;
  return value.kind === 'formula' && typeof value.formula === 'string' && value.formula.length > 0;
}

function isMaterializableFormulaCellValue(value: VersionSemanticValue): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (value.kind === 'blank') return true;
  return value.kind === 'formula' && typeof value.formula === 'string' && value.formula.length > 0;
}
