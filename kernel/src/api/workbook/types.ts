/**
 * Workbook API — Shared Types
 *
 * Pure type module extracted from `workbook-impl.ts` so that sibling files
 * (including the barrel `index.ts`) can import these types without creating
 * an `impl ↔ barrel` dependency cycle.
 *
 * Runtime values (factories, classes, event-mapping constants) stay in their
 * owning modules. This file is type-only.
 */

import type { IEventBus } from '@mog-sdk/contracts/events';
import type { FeatureGates } from '@mog-sdk/contracts/feature-gates';
import type { IKernelContext } from '@mog-sdk/contracts/kernel';
import type { WorkbookStateProvider } from '@mog-sdk/contracts/api';
import type { CodeExecutionOptions, CodeExecutionResult, SheetId } from '@mog-sdk/contracts/core';
import type { DomainSupportManifest } from '@mog-sdk/contracts/versioning';
import type {
  VersionShadowObservationOptions,
  VersionShadowObservationSink,
} from '@mog-sdk/contracts/versioning';
import type {
  DocumentImportOptions,
  DocumentImportWarning,
  DocumentSource,
} from '@mog-sdk/contracts/document';
import type { DocumentSecurityConfig } from '@mog-sdk/contracts/security';
import type { HostPrincipalLock } from '../../context/host-principal-lock';
import type { DocumentContext } from '../../context';
import type {
  VersionNormalCommitCapture,
  VersionMergeCommitCapture,
  WorkbookVersionCommitService,
} from '../../document/version-store/commit-service';
import type { WorkbookVersionMergeService } from '../../document/version-store/merge-service';
import type { PendingRemotePromotionService } from '../../document/version-store/pending-remote-promotion-service';
import type { ProposalWorkspaceLifecycleService } from '../../document/version-store/proposals/proposal-workspace-lifecycle-service';
import type { WorkbookVersionRevertService } from '../../document/version-store/revert-service';
import type { WorkbookVersionReviewService } from '../../document/version-store/review-service';
import type { VersionProviderWriteActivityTracker } from '../../document/version-store/provider-write-activity';
import type {
  CheckoutSnapshotApplyInput,
  CheckoutSnapshotMaterializer,
} from '../../document/version-store/checkout-apply';
import type { SnapshotRootByteSyncPort } from '../../document/version-store/snapshot-root-capture';
import type { SemanticMutationCaptureServices } from '../../document/version-store/semantic-mutation-capture';
import type { VersionSemanticStateReaderPort } from '../../document/version-store/semantic-state-reader';
import type {
  VersionStoreDiagnostic,
  VersionStoreProvider,
} from '../../document/version-store/provider';
import type { DocumentWorkbookVersioningLifecycleConfig } from '../../document/version-store/lifecycle';
import type { WorkbookVersionProvenanceTruthService } from './version/provenance/version-provenance-truth-service';
import type { VersionLiveCollaborationStatusReader } from './version/live-collaboration/version-live-collaboration-status';
import type { DomainSupportManifestValidationOptions } from '../../document/version-store/domain-support-manifest-validator';
import type { HandleLiveness } from '../lifecycle/handle-liveness';
import type { VersionCheckoutTransactionGuard } from './version-checkout';
import type { SnapshotRootFreshLifecycleMaterialization } from '../document/snapshot-root-lifecycle-hydrator';

// =============================================================================
// Lazy CodeExecutor Types
// =============================================================================

export type CodeExecutorType = {
  execute(code: string, options?: CodeExecutionOptions): Promise<CodeExecutionResult>;
  cancelExecution?(executionId: string): void;
  dispose(): void;
};

export type CodeExecutorFactory = (config: {
  ctx: DocumentContext;
  eventBus: IEventBus;
  getActiveSheetId: () => SheetId;
}) => CodeExecutorType;

type MaybePromise<T> = T | Promise<T>;

export interface WorkbookVersioningConfig {
  readonly provider?: VersionStoreProvider;
  readonly writeService?: Pick<
    WorkbookVersionCommitService,
    'readHead' | 'readRef' | 'listCommits' | 'commit' | 'mergeCommit'
  >;
  readonly mergeService?: Pick<WorkbookVersionMergeService, 'merge'>;
  readonly revertService?: Pick<WorkbookVersionRevertService, 'revert'>;
  readonly reviewService?: WorkbookVersionReviewService;
  readonly proposalService?: unknown;
  readonly proposalWorkspaceService?: ProposalWorkspaceLifecycleService;
  readonly pendingRemotePromotionService?: Pick<
    PendingRemotePromotionService,
    'promotePendingRemoteSegments'
  >;
  readonly provenanceTruthService?: WorkbookVersionProvenanceTruthService;
  readonly providerWriteActivityTracker?: VersionProviderWriteActivityTracker;
  readonly captureNormalCommit?: VersionNormalCommitCapture;
  readonly captureMergeCommit?: VersionMergeCommitCapture;
  readonly semanticMutationCapture?: SemanticMutationCaptureServices;
  readonly semanticStateReader?: VersionSemanticStateReaderPort;
  readonly snapshotRootByteSyncPort?: SnapshotRootByteSyncPort;
  readonly ensureProviderInitialized?: () => MaybePromise<readonly VersionStoreDiagnostic[]>;
  readonly checkoutSnapshotMaterializer?: CheckoutSnapshotMaterializer;
  readonly checkoutTransactionGuard?: VersionCheckoutTransactionGuard;
  readonly readLiveCollaborationStatus?: VersionLiveCollaborationStatusReader;
  readonly domainSupportManifest?: DomainSupportManifest | null;
  readonly readDomainSupportManifest?: () => MaybePromise<DomainSupportManifest | null | undefined>;
  readonly domainSupportManifestOptions?: DomainSupportManifestValidationOptions;
  readonly requireDomainSupportManifest?: boolean;
  readonly shadowObservationSink?: VersionShadowObservationSink;
  readonly shadowObservationOptions?: VersionShadowObservationOptions;
}

// =============================================================================
// WorkbookConfig
// =============================================================================

/**
 * Configuration for creating a WorkbookImpl instance.
 *
 * This is the "power-user" path — callers who manage their own kernel context,
 * event bus, and active sheet tracking (e.g., the browser app with DocumentManager).
 */
export interface WorkbookConfig {
  /** The kernel context providing state access (Tier 2 public API) */
  ctx: IKernelContext;
  /**
   * UI state provider (active sheet, selection, active objects).
   * Optional — when omitted, the workbook creates a default headless provider
   * that tracks activeSheetId internally and returns null for all UI queries.
   */
  stateProvider?: WorkbookStateProvider;
  /** Document-scoped host feature gates visible to version surface admission. */
  featureGates?: FeatureGates;
  /** Dynamic document-scoped host feature gates visible to version surface admission. */
  readFeatureGates?: () => FeatureGates;
  /** Event bus for subscribing to and emitting events */
  eventBus: IEventBus;
  /** Optional factory for creating a code executor (injected by engine layer) */
  codeExecutorFactory?: CodeExecutorFactory;
  /** Whether the workbook was loaded from a previously saved source (e.g. XLSX import). */
  previouslySaved?: boolean;
  /** Workbook name/filename (platform-provided, read-only). Default: '' */
  name?: string;
  /** Whether the workbook is in read-only mode (platform-provided). Default: false */
  readOnly?: boolean;
  /** Platform-provided save handler. Called by save() and close('save'). */
  onSave?: (buffer: Uint8Array) => Promise<void>;
  /**
   * Platform-provided file-write function for `save(path)`.
   * Node.js callers should pass `writeFile` from `node:fs/promises`.
   * Browser callers can omit this — `save()` (no path) always works.
   */
  writeFile?: (path: string, data: Uint8Array) => Promise<void>;
  /** Warnings from XLSX import (empty if created blank). */
  importWarnings?: readonly DocumentImportWarning[];
  /** Shared liveness token for document-owned workbook facades. */
  liveness?: HandleLiveness;
  /** Optional document-scoped version graph services for the public wb.version facade. */
  versioning?: WorkbookVersioningConfig;
  /** Internal owner hook for making published checkout materializations durable. */
  persistCheckoutMaterialization?: (
    materialization: SnapshotRootFreshLifecycleMaterialization,
    input: CheckoutSnapshotApplyInput,
  ) => MaybePromise<void>;
  /**
   * Host principal lock — when present, prevents `setActivePrincipal` and
   * `makePrincipal` from mutating the active principal. Installed by the
   * host-backed construction path after projecting the verified principal
   * into Rust workbook security.
   */
  hostPrincipalLock?: HostPrincipalLock;
}

/**
 * Options for the zero-ceremony createWorkbook() path.
 *
 * Bootstraps everything internally: creates a DocumentHandle, event bus,
 * and active sheet tracking. Caller just gets back a ready Workbook.
 */
export interface CreateWorkbookOptions {
  /** Document ID (defaults to a random UUID v7). */
  documentId?: string;
  /**
   * XLSX data to import. Shorthand — equivalent to
   * `source: { type: 'bytes', data: xlsx }`.
   */
  xlsx?: Uint8Array;
  /**
   * Full XLSX source descriptor. Use `xlsx` for the common buffer case.
   * Kept for the Tauri `{ type: 'path' }` variant.
   */
  source?: DocumentSource;
  /** Import options when importing XLSX (via `xlsx` or `source`). */
  importOptions?: DocumentImportOptions;
  /**
   * Security configuration — principal resolution + scope-based gating. When
   * omitted, the workbook runs without a principal (open-access). See
   * `DocumentSecurityConfig` for the full contract.
   *
   * @example
   * ```typescript
   * const wb = await createWorkbook({
   *   security: {
   *     resolvePrincipal: () => ({ tags: ['agent:copilot'] }),
   *   },
   * });
   * ```
   */
  security?: DocumentSecurityConfig;

  /**
   * IANA timezone name for the user's calendar frame this session
   * (e.g. `'America/Los_Angeles'`, `'UTC'`).
   *
   * Used by every Date → calendar-parts conversion on the date-entry pipeline
   * (`setDateValue`, `setTimeValue`, `setCell(Date)`, `setCells({value: Date})`).
   *
   * Resolution rule:
   *   - If provided here, used as-is.
   *   - Else if running in a real browser (`typeof window !== 'undefined'`),
   *     resolved from `Intl.DateTimeFormat().resolvedOptions().timeZone` —
   *     the browser tab IS the user's device, so its Intl reading is the
   *     user's calendar frame.
   *   - Else (headless Node, cloud worker, agent runtime), throws
   *     `CONFIG_MISSING_USER_TIMEZONE`. The host-process TZ is meaningless
   *     when the host is a cloud worker; the caller must supply the user's
   *     TZ from session metadata.
   *
   * Invalid → `CONFIG_INVALID_USER_TIMEZONE`.
   */
  userTimezone?: string;
  /**
   * Platform-provided file-write function for `save(path)`.
   * Forwarded to `WorkbookConfig.writeFile`.
   */
  writeFile?: (path: string, data: Uint8Array) => Promise<void>;
  /**
   * Explicit version-store lifecycle selection for the document-owned workbook
   * path. This exists because durable providers such as IndexedDB must be
   * selected and initialized asynchronously before the WorkbookImpl constructor
   * receives its concrete versioning services.
   */
  versioning?: DocumentWorkbookVersioningLifecycleConfig;
  /** Document-scoped host feature gates visible to version surface admission. */
  featureGates?: FeatureGates;
  /** Dynamic document-scoped host feature gates visible to version surface admission. */
  readFeatureGates?: () => FeatureGates;
}
