/**
 * Document Module
 *
 * Manages document lifecycle and persistence.
 *
 * RustDocument is the sole document implementation.
 * The lifecycle state machine manages initialization, wiring, and teardown.
 *
 * @see rust-document.ts - Document lifecycle, persistence, ComputeBridge integration
 * @see document-lifecycle-machine.ts - Pure XState v5 state machine definition
 * @see document-lifecycle-system.ts - System class with actor implementations
 */

// Primary exports: Rust-backed document
export {
  RustDocument,
  createRustDocument,
  type DocumentStatus,
  type ProviderInboundUpdateResult,
  type RustDocumentOptions,
  type StatusChangeCallback,
  type UpdateOrigin,
} from './rust-document';
export type { ProviderInboundUpdateEnvelope } from '@mog-sdk/types-document/storage/inbound-updates';

// Lifecycle state machine and system
export {
  DocumentLifecycleEvents,
  documentLifecycleMachine,
  documentLifecycleSelectors,
  type CreateEngineInput,
  type CreateEngineOutput,
  type DisposeBridgeInput,
  type DocumentLifecycleActor,
  type DocumentLifecycleContext,
  type DocumentLifecycleEvent,
  type DocumentLifecycleMachine,
  type DocumentLifecycleState,
  type HydrateXlsxInput,
  type HydrateXlsxOutput,
  type StartBridgeInput,
  type StartBridgeOutput,
  type WireContextInput,
  type WireContextOutput,
} from './document-lifecycle-machine';

export {
  DocumentLifecycleSystem,
  type DocumentLifecycleConfig,
  type DocumentLifecycleConfigLegacy,
  type DocumentLifecycleConfigHost,
} from './document-lifecycle-system';

// Host runtime transport mapping (host-compliant path)
export {
  mapHostRuntimeToTransportConfig,
  type ExplicitTransportConfig,
} from './host-runtime-transport';

// Host storage preflight (host-compliant path)
export {
  preflightAuthorizedStorage,
  StoragePreflightError,
  type PreflightResult,
  type ProviderPreflightConfig,
  type ProviderReadiness,
} from './host-storage-preflight';

// Host-backed import source-handle validation (host-compliant path)
export {
  validateAndResolveImportSource,
  ImportSourceError,
  type ImportSourceValidationConfig,
  type ValidatedImportSource,
} from './host-import-source';

// Kernel state mirror (state mirror): single sync read view of bounded
// direct workbook/sheet state. Read API is exposed via `DocumentContext.mirror`
// (typed as `MirrorReadView`); the writable `StateMirror` instance is
// constructor-injected into `MutationResultHandler`.
export {
  StateMirror,
  createStateMirror,
  type MirrorReadView,
  type FrozenPanes,
  type ScrollPosition,
  type SheetMetaSnapshot,
  type ViewSelectionSnapshot,
} from './state-mirror';

// Write gate — mutation admission control during lifecycle transitions.
export {
  WriteGate,
  PHASE_TO_GATE_MODE,
  type GateMode,
  type CheckpointResult as WriteGateCheckpointResult,
  type CloseResult as WriteGateCloseResult,
} from './write-gate';

// High-water-mark proof registry and host operation gate.
export { HighWaterMarkProofRegistry } from './high-water-mark-registry';
export {
  HostOperationGate,
  type ExportAuthorizationRequest,
  type ExportAuthorizationResult,
} from './host-operation-gate';

// Provider Protocol surface.
// Boot-time consumers (e.g. `dev/app/src/App.tsx`) need the Meta
// API for `lastActiveDocId` lookup and `hasPersistedSnapshot` for the URL
// precedence table. Shell consumers can `import { readMeta, touchDoc } from
// '@mog-sdk/kernel/lifecycle'` without piercing into the providers/ subdir.
// Meta API is provider-free per §5.1.1; the shell uses it directly during boot.
export {
  IndexedDBProvider,
  hasPersistedSnapshot,
  readMeta,
  touchDoc,
  forgetDoc,
  clearMeta,
  emptyMeta,
} from './providers';
export type {
  Provider,
  ProviderDoc,
  ProviderFactory,
  ProviderInstance,
  ProviderPreflightResult,
  IndexedDBProviderOptions,
  IndexedDBProviderTestOptions,
  MetaState,
  RecentDoc,
} from './providers';
export { StorageProviderRegistry, validateComposition, determineReadyMode } from './providers';
