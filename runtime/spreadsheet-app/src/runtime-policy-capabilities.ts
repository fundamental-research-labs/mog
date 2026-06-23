import type { SpreadsheetCapability } from './public-types';

export const RUNTIME_POLICY_SNAPSHOT_CAPABILITIES: readonly SpreadsheetCapability[] = [
  'workbook:read',
  'workbook:export',
  'workbook:screenshot',
  'workbook:write',
  'workbook:undo-group',
  'decorations:write',
  'version:read',
  'version:diff',
  'version:commit',
  'version:branch',
  'version:checkout',
  'version:reviewRead',
  'version:reviewWrite',
  'version:proposal',
  'version:mergePreview',
  'version:mergeApply',
  'version:revert',
  'version:provenance',
  'version:remotePromote',
];
