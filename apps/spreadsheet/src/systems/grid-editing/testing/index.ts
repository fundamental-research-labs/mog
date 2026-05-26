export { createGridSimulator } from './grid-simulator';
export type { GridSimulator, SimulatorOptions } from './grid-simulator';

export { createIntegrationSimulator } from './integration-simulator';
export type { IntegrationSimulator } from './integration-simulator';

// Re-export from testing-foundation (promoted infrastructure)
export { createTestSheetContext } from '../../testing-foundation/test-sheet-context';
export type {
  TestSheetConfig,
  TestSheetContextResult,
} from '../../testing-foundation/test-sheet-context';

export { buildKeyCombo } from '../../testing-foundation/key-utils';
export { lookupAction } from './key-action-map';
export type { KeyModifiers, SelectionActionType } from './key-action-map';
