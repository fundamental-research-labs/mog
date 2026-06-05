import type { PivotFieldArea, PivotMemberKey, PlacementId } from '@mog-sdk/contracts/pivot';
import type { PivotTableConfig as DataPivotTableConfig } from '@mog-sdk/contracts/pivot';

const PIVOT_CONFIG_SCHEMA_VERSION = 2;

export function pivotPlacementId(id: string): PlacementId {
  return id as PlacementId;
}

export function pivotCalculatedFieldId(id: string) {
  return id as import('@mog-sdk/contracts/pivot').CalculatedFieldId;
}

export function pivotMemberKey(key: string): PivotMemberKey {
  return key as PivotMemberKey;
}

export function makePlacementId(
  area: PivotFieldArea,
  fieldId: string,
  position: number,
): PlacementId {
  return pivotPlacementId(`${area}:${fieldId}:${position}`);
}

export function cleanPivotFormula(formula: string): string {
  return formula.startsWith('=') ? formula.slice(1) : formula;
}

export function configWithRequiredMetadata(
  config: Omit<DataPivotTableConfig, 'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'>,
  id: string,
): DataPivotTableConfig {
  return {
    schemaVersion: PIVOT_CONFIG_SCHEMA_VERSION,
    ...config,
    id,
  };
}
