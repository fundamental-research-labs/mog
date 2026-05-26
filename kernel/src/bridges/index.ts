/**
 * Bridges Module
 *
 * Bridges connect the spreadsheet engine to external computation engines.
 * They handle the translation between engine data structures and external APIs.
 *
 * @see compute/ - Rust compute core via Tauri IPC (desktop) + WASM (web)
 * @see pivot-bridge.ts - Pivot table computation via ComputeBridge
 * @see schema-bridge.ts - Schema validation via Rust compute-core annotations
 * @see table-bridge.ts - Table engine integration with bitmap caching
 * @see slicer-table-bridge.ts - Slicer → Table filter integration
 */

// --- Grouped modules (subdirectories) ---
export * from './compute';

// Pivot Bridge - Rust pivot engine via ComputeBridge
export { PivotBridge, type PivotResultCallback } from './pivot-bridge';

// Pivot Event Bridge - Event Bus integration for reactive pivot updates
export {
  connectPivotToEventBus,
  createPivotEventBridge,
  type PivotEventBridgeConfig,
} from './pivot-event-bridge';

// Slicer-Pivot Bridge - Slicer visual filter integration
export {
  createSlicerPivotBridge,
  type PivotFieldFilter,
  type SlicerPivotBridgeConfig,
  type SlicerPivotBridgeInstance,
} from './slicer-pivot-bridge';

// Schema Bridge - Schema validation
export { SchemaValidationBridge, type SchemaValidationOptions } from './schema-bridge';

// Slicer Bridges - Slicer visual filter integration (Stream ES)
export {
  createSlicerTableBridge,
  type SlicerTableBridge,
  type SlicerTableBridgeConfig,
} from './slicer-table-bridge';

// Locale Bridge - Locale-aware input normalization (Stream E)
export {
  LocaleInputBridge,
  createMockLocaleBridge,
  type LocaleBridge,
  type LocaleBridgeConfig,
  type LocaleNormalizationResult,
} from './locale-bridge';

// Table Bridge - Table engine integration with bitmap caching
export {
  TableBridge,
  convertFilterCriteria,
  convertTableConfig,
  type TableBridgeConfig,
} from './table-bridge';

// Mutation Result Handler - Processes MutationResult from Rust IPC
export { MutationResultHandler, type MutationSource } from './mutation-result-handler';
