/**
 * @mog-sdk/embed/publish — Type definitions for the read-only publish product.
 *
 * Publish is a security pipeline, NOT "embed with readOnly=true". Every type
 * here enforces: no mutation path, no collaboration writes, no raw provider
 * payloads, no CRDT/Yrs bytes, no raw storage snapshots.
 *
 * Kernel-level mutation/export/collaboration gates are installed before any
 * public workbook/view handle is reachable. Hidden UI, readOnly props, or
 * missing toolbar commands are not enforcement.
 */

import type { MogEmbedThemeOptions } from '../config';

// ---------------------------------------------------------------------------
// Cache policy
// ---------------------------------------------------------------------------

/**
 * Controls HTTP/CDN caching behavior for the publish artifact.
 *
 * - `immutable`: artifact never changes once published (content-addressed).
 * - `revalidate`: must revalidate with origin on every access.
 * - `versioned`: cache keyed by snapshot version; new version invalidates.
 */
export type PublishCachePolicy = 'immutable' | 'revalidate' | 'versioned';

// ---------------------------------------------------------------------------
// Security / redaction policy
// ---------------------------------------------------------------------------

/**
 * Declares what is redacted from the publish artifact. These are enforced
 * at the Rust/kernel level before the artifact is produced — the TS surface
 * only describes the policy.
 */
export interface PublishSecurityPolicy {
  /** When true, formula source text is stripped; only computed values remain. */
  readonly redactFormulas: boolean;
  /** When true, all comments and notes are stripped from the artifact. */
  readonly stripComments: boolean;
  /** When true, document metadata is sanitized to the PublishMetadata fields only. */
  readonly sanitizeMetadata: boolean;
  /** When true, named ranges and defined names are stripped. */
  readonly stripNamedRanges: boolean;
  /** When true, revision history / change tracking data is stripped. */
  readonly stripRevisionHistory: boolean;
}

// ---------------------------------------------------------------------------
// Public-safe metadata
// ---------------------------------------------------------------------------

/**
 * Metadata that is safe for public consumption. This is the only metadata
 * surface exposed by a publish artifact — no internal IDs, storage paths,
 * provider configs, or raw document properties leak through.
 */
export interface PublishMetadata {
  readonly title: string;
  readonly description: string;
  readonly authorDisplayName: string;
  readonly publishDate: string;
  readonly snapshotVersion: number;
  /** Optional locale hint for the published content. */
  readonly locale?: string;
}

// ---------------------------------------------------------------------------
// Publish artifact reference
// ---------------------------------------------------------------------------

/**
 * Reference to a redacted, read-only publish artifact. The artifact is
 * produced by the Rust-side redaction pipeline; this type is the TS handle
 * to that artifact.
 *
 * The artifact must NOT contain:
 * - Raw Yrs/CRDT bytes or state vectors
 * - Raw the storage provider lifecycle storage snapshots
 * - Provider payloads or collaboration updates
 * - Unrestricted document properties
 */
export interface MogPublishArtifact {
  /** Content-addressed or versioned snapshot identifier. */
  readonly snapshotId: string;
  /** Monotonically increasing version for cache invalidation. */
  readonly version: number;
  /** Public-safe metadata for the artifact. */
  readonly metadata: PublishMetadata;
  /** Cache directive for CDN/HTTP caching. */
  readonly cachePolicy: PublishCachePolicy;
  /** What was redacted when producing this artifact. */
  readonly securityPolicy: PublishSecurityPolicy;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for mounting a publish view. All fields are declarative
 * and read-only-oriented. No mutation, save, export, or collaboration
 * options are available.
 */
export interface MogPublishConfig {
  /** Reference to the publish artifact (snapshot ID or signed URL). */
  readonly snapshotRef: string;
  /** Public-safe metadata to display. */
  readonly metadata: PublishMetadata;
  /** Theme options for workbook and chrome rendering. */
  readonly theme?: MogEmbedThemeOptions;
  /** Cache policy governing how the artifact is fetched and stored. */
  readonly cachePolicy?: PublishCachePolicy;
  /**
   * When true, the renderer must produce deterministic output — same
   * snapshot + same viewport = same pixels. Required for visual regression
   * testing and server-side rendering.
   */
  readonly deterministicRender?: boolean;
  /** Security/redaction policy applied to this artifact. */
  readonly securityPolicy?: PublishSecurityPolicy;
  /** Optional: which sheet to display initially (index or name). */
  readonly sheet?: number | string;
  /** Optional: locale override for number/date formatting. */
  readonly locale?: string;
  /** Chrome options — publish views show minimal read-only chrome. */
  readonly chrome?: PublishChromeOptions;
}

// ---------------------------------------------------------------------------
// Publish chrome options (subset of embed chrome — no edit chrome)
// ---------------------------------------------------------------------------

export interface PublishChromeOptions {
  /** Show sheet tabs for multi-sheet navigation (default: true). */
  readonly sheetTabs?: boolean;
  /** Show row/column headers (default: true). */
  readonly headers?: boolean;
  /** Show gridlines (default: true). */
  readonly gridlines?: boolean;
}

// ---------------------------------------------------------------------------
// Effective state — always read-only, no mutation paths
// ---------------------------------------------------------------------------

/**
 * The effective state of a publish view. Every field is locked to its
 * read-only / no-mutation value. This is NOT derived from the general
 * MogEmbedEffectiveState by narrowing — it is a separate type that
 * structurally cannot represent mutable state.
 */
export interface MogPublishEffectiveState {
  /** Always 'readonly'. Publish views cannot be promoted to any edit mode. */
  readonly mode: 'readonly';
  /** Always 'none'. Publish views have no save path. */
  readonly savePolicy: 'none';
  /** Always 'none'. Publish views do not participate in collaboration writes. */
  readonly collaboration: 'none';
  /** Always false. Publish views cannot become dirty. */
  readonly dirty: false;
  /** Always 'idle'. Publish views have no save lifecycle. */
  readonly saveState: 'idle';
  /** Always false. Publish views cannot export raw data. */
  readonly canExport: false;
  /** Always false. Publish views cannot mutate cells. */
  readonly canMutate: false;
  /** Lifecycle status of the publish view. */
  readonly status: PublishViewStatus;
  /** The resolved chrome options. */
  readonly chrome: Required<PublishChromeOptions>;
  /** Whether deterministic rendering is active. */
  readonly deterministicRender: boolean;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export type PublishViewStatus = 'initializing' | 'loading' | 'ready' | 'error' | 'disposed';

// ---------------------------------------------------------------------------
// Handle returned by createPublishView
// ---------------------------------------------------------------------------

/**
 * Imperative handle for a mounted publish view. Intentionally has NO
 * mutation methods, NO save/export methods, NO collaboration methods,
 * and NO way to obtain a mutable workbook/worksheet reference.
 */
export interface PublishViewHandle {
  /** Resolves when the view is ready (artifact loaded, first paint done). */
  readonly ready: Promise<void>;
  /** Current lifecycle status. */
  getStatus(): PublishViewStatus;
  /** Full effective state — always read-only. */
  getEffectiveState(): MogPublishEffectiveState;
  /** Public-safe metadata for the loaded artifact. */
  getMetadata(): PublishMetadata;
  /** Navigate to a sheet by index or name. */
  setSheet(indexOrName: number | string): Promise<void>;
  /** List available sheet names. */
  getSheetNames(): Promise<string[]>;
  /** Resize the publish view container. */
  resize(width: number, height: number): void;
  /** Tear down the view and release all resources. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Events emitted by publish views
// ---------------------------------------------------------------------------

export interface PublishViewEventMap {
  lifecycleChange: PublishViewStatus;
  sheetChange: { index: number; name: string };
  error: Error;
}
