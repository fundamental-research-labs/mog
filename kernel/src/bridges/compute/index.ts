/**
 * Compute Bridge Module
 *
 * Connects the spreadsheet UI to the Rust compute core via Tauri IPC (desktop)
 * or WASM (web). Public barrel export for:
 * - ComputeBridge (composition root delegating to ComputeCore + generated methods)
 * - Wire types, converters, and generated type definitions
 */

// Compute Bridge - main entry point
export {
  ComputeBridge,
  createComputeBridge,
  createComputeBridgeFromTransport,
  extractMutationData,
  identityFormulaToWire,
  rustSchemaResolveEditor,
  wireTableToTableConfig,
  wireToIdentityFormula,
  type CellChange,
  type CellErrorInfo,
  type CellData as ComputeCellData,
  type CellEdit as ComputeCellEdit,
  type SheetSnapshot as ComputeSheetSnapshot,
  type EditorTypeResolutionInputWire,
  type EditorTypeResolutionResultWire,
  type IdentityFormulaRefWire,
  type IdentityFormulaWire,
  type MutationResult,
  type NamedRangeDef,
  type ProjectionCellData,
  type ProjectionChange,
  type RecalcResult,
  type SchemaConstraintsWire,
  type Scope,
  type StructureChange,
  type SyncApplyMutationMetadataWire,
  type SyncApplyWithMetadataResult,
  type TableDef,
  type UndoState,
  type WorkbookSnapshot,
} from './compute-bridge';

// Generated bridge-method-kind manifest — re-exported so consumers don't
// import from the `.gen.ts` path directly. Source: `MethodAccess` on each
// `#[bridge::*]` method in compute-core.
export { BRIDGE_METHOD_KIND, type BridgeMethodKind } from './manifest.gen';
export {
  classifyWriteOperation,
  type OperationAdmissionClassification,
  type OperationInvocationKind,
} from './operation-classification';
export {
  observeMutationAdmission,
  recordMutationAdmissionDiagnostic,
  withDirectEditRange,
  type DirectEditRange,
  type MutationAdmissionDiagnostic,
  type MutationAdmissionDiagnosticCode,
  type MutationAdmissionOptions,
} from './mutation-admission';
export {
  SyncApplyAdmissionError,
  assertAdmittedSyncApplyContext,
  createAdmittedSyncApplyContext,
  type AdmittedSyncApplyContext,
  type SyncApplyAdmissionContextInput,
  type SyncApplyAdmissionErrorCode,
} from './sync-apply-admission';

// ComputeCore — the real per-doc compute state holder, re-exported so the
// shell-side trap-recovery integration tests
// (`shell/src/services/trap-recovery/__tests__/`) can construct one
// directly without going through `createComputeBridge` (which would
// pull in real WASM module loading via `createTransport`). Production
// callers always go through `ComputeBridge`; ComputeCore is the
// trap-state-bearing primitive underneath.
export { ComputeCore } from './compute-core';
export type { InitPhase } from './compute-core';
