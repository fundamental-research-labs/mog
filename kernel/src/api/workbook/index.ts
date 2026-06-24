/**
 * Workbook Sub-API Implementations — Barrel Export
 *
 * Sibling impl files (`workbook-impl.ts`, `sheets.ts`, `create-workbook.ts`)
 * MUST NOT import from this barrel — doing so reintroduces the
 * `impl ↔ barrel` cycle. Use the direct `./<file>` path inside the package.
 */

export { WorkbookHistoryImpl } from './history';
export { WorkbookVersionImpl } from './version';
export { WorkbookNamesImpl } from './names';
export { WorkbookNotificationsImpl } from './notifications';
export { WorkbookPropertiesImpl } from './properties';
export { WorkbookProtectionImpl } from './protection';
export { WorkbookSecurityImpl } from './security';
export { WorkbookScenariosImpl } from './scenarios';
export { WorkbookSheetsImpl } from './sheets';
export { WorkbookSlicerStylesImpl } from './slicer-styles';
export { WorkbookSlicersImpl } from './slicers';
export { WorkbookTimelineStylesImpl } from './timeline-styles';
export { WorkbookPivotTableStylesImpl } from './pivot-styles';
export { WorkbookTableStylesImpl } from './table-styles';
export { WorkbookCellStylesImpl } from './cell-styles';
export { WorkbookThemeImpl } from './theme';
export { WorkbookChangesImpl } from './changes';
export { WorkbookLinksImpl } from './links';
export type { WorkbookLinks } from '@mog-sdk/contracts/api';
export { createWorkbook } from './create-workbook';
export type { CreateWorkbookOptions, WorkbookConfig } from './types';
export type {
  VersionLiveCollaborationState,
  VersionLiveCollaborationStatus,
  VersionLiveCollaborationStatusReader,
} from './version/live-collaboration/version-live-collaboration-status';
export type { Workbook } from '@mog-sdk/contracts/api';
