/**
 * HeadlessLifecycleSystem - Headless Boot Wrapper for the Spreadsheet Engine
 *
 * Thin shim that delegates to DocumentLifecycleSystem via DocumentFactory.
 * DocumentLifecycleSystem accepts `{ environment: 'headless' }` and handles
 * all headless-specific behavior (skipPersistenceLoad, no schema bridge,
 * headless environment stubs, NAPI transport auto-detection).
 *
 * Architecture:
 * - Uses `DocumentFactory.create({ environment: 'headless' })` for blank documents
 * - Uses `DocumentFactory.createFromXlsx(source, { environment: 'headless' })` for XLSX import
 * - No duplicated actor implementations — all lifecycle logic lives in DocumentLifecycleSystem
 * - Legacy headless engine helpers remain package-internal compatibility code
 *
 * @see kernel/src/api/document/document-factory.ts - DocumentFactory
 * @see kernel/src/document/document-lifecycle-system.ts - DocumentLifecycleSystem
 */

import { createWorkbook as _kernelCreateWorkbook } from '@mog-sdk/kernel';
import type { ChartImageExporter, Workbook } from '@mog-sdk/contracts/api';
import type { IChartBridge } from '@mog-sdk/contracts/bridges';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { CodeExecutionResult, CodeExecutionOptions } from '@mog-sdk/contracts/core';
import type {
  DocumentImportWarning,
  DocumentSource,
  DocumentImportOptions,
} from '@mog-sdk/contracts/document';
import type { IKernelContext } from '@mog-sdk/contracts/kernel';
import type { DocumentSecurityConfig } from '@mog-sdk/contracts/security';
import {
  createHeadlessDocument,
  createHostBackedDocument,
  importHeadlessDocumentFromXlsx,
  importHostBackedDocument,
  type DocumentSyncCapableHandle,
} from '@mog/kernel-host-internal';
import {
  createNodeHeadlessHost,
  type NodeHeadlessHostResult,
} from './host-adapters/node-headless-host';
import {
  loadNodeSdkNapiAddon,
  readNodeFileBytes,
  writeNodeFileBytes,
} from './host-adapters/native-node-runtime';
import { createPortableRandomUUID } from './host-adapters/portable-host-crypto';
import {
  createChartImageExporterFactory,
  createNodeChartImageExporterFactory,
  createNodeWasmChartImageExporterFactory,
} from './chart-export/node-chart-image-exporter';
import type { NativeChartRasterAddon } from './chart-export/node-chart-image-exporter';

type KernelCreateWorkbook = (...args: readonly unknown[]) => Promise<Workbook>;
type HostBackedDocumentHandle = Awaited<ReturnType<typeof createHostBackedDocument>>;
type ChartImageExporterRegistrationHandle = {
  registerChartImageExporter(factory: (chartBridge: IChartBridge) => ChartImageExporter): void;
};
type NativeChartRasterAddonCandidate = Record<string, unknown>;
type ChartRasterImageExportFormat = 'png' | 'jpeg';
type ChartRasterBackendRuntime = 'browser-canvas' | 'native-node' | 'wasm' | 'custom';
type ChartImageFittingMode = 'fill' | 'fit' | 'fitAndCenter';
type KernelEventBus = IKernelContext['eventBus'];
type WorkbookLinkStatusScope = {
  readonly requestingDocumentId: string;
  readonly requestingSessionId: string;
  readonly actor: string;
  readonly principal: { readonly tags: readonly string[] };
};
type WorkbookLinkResolver = {
  resolve(request: {
    readonly linkId: string;
    readonly requestingDocumentId: string;
    readonly requestingSessionId: string;
    readonly actor: string;
    readonly principal: { readonly tags: readonly string[] };
    readonly target: unknown;
    readonly expectedWorkbookId: string | null;
  }): any;
};
type WorkbookInternal = Workbook & {
  getActiveSheetId(): string;
  setActiveSheetId(id: unknown): void;
  setCodeExecutorFactory(factory: () => ReturnType<HeadlessCodeExecutorFactory>): void;
};
type ExternalWorkbookSession = { readonly workbook: Pick<Workbook, 'getSheet'> };
const EXTERNAL_WORKBOOK_SESSIONS_KEY = Symbol.for('mog.externalWorkbookSessions');

function registerExternalWorkbookSession(
  sessionId: string,
  session: ExternalWorkbookSession,
): () => void {
  const globalWithRegistry = globalThis as typeof globalThis & {
    [EXTERNAL_WORKBOOK_SESSIONS_KEY]?: Map<string, ExternalWorkbookSession>;
  };
  globalWithRegistry[EXTERNAL_WORKBOOK_SESSIONS_KEY] ??= new Map<string, ExternalWorkbookSession>();
  const sessions = globalWithRegistry[EXTERNAL_WORKBOOK_SESSIONS_KEY];
  sessions.set(sessionId, session);
  return () => {
    if (sessions.get(sessionId) === session) {
      sessions.delete(sessionId);
    }
  };
}

// ---------------------------------------------------------------------------
// SDK-owned types
// ---------------------------------------------------------------------------

/**
 * A compute engine instance. The SDK invokes methods by name
 * through the rust-bridge command protocol.
 *
 * @internal Not part of the public SDK API surface.
 */
export interface ComputeEngineInstance {
  [method: string]: (...args: unknown[]) => unknown;
}

/**
 * Package-local byte-sync capability exposed by the deprecated collaboration
 * helpers. Structurally matches the kernel provider port without publishing a
 * dependency on the kernel storage subpath.
 *
 * @internal
 */
export interface DocumentByteSyncPort {
  readonly docId: string;
  applyUpdate(update: Uint8Array): Promise<void>;
  encodeDiff(remoteSv: Uint8Array): Promise<Uint8Array>;
  currentStateVector(): Promise<Uint8Array>;
}

export interface ChartImageFrame {
  readonly exportWidth: number;
  readonly exportHeight: number;
  readonly sourceWidth?: number;
  readonly sourceHeight?: number;
  readonly contentX: number;
  readonly contentY: number;
  readonly contentWidth: number;
  readonly contentHeight: number;
}

export interface ChartRasterRequest {
  readonly version: 1;
  readonly marks: readonly Record<string, unknown>[];
  readonly options: {
    readonly format: ChartRasterImageExportFormat;
    readonly width: number;
    readonly height: number;
    readonly pixelRatio: number;
    readonly backgroundColor: string;
    readonly quality?: number;
    readonly fittingMode: ChartImageFittingMode;
    readonly frame: ChartImageFrame;
  };
}

export interface ChartRasterResult {
  readonly bytes: Uint8Array;
  readonly format: ChartRasterImageExportFormat;
  readonly width: number;
  readonly height: number;
}

export interface ChartRasterBackend {
  readonly id: string;
  readonly runtime: ChartRasterBackendRuntime;
  readonly supportedFormats: readonly ChartRasterImageExportFormat[];
  render(request: ChartRasterRequest): Promise<ChartRasterResult> | ChartRasterResult;
}

export interface ChartRenderingOptions {
  /**
   * Explicit raster backend. When present, PNG/JPEG chart export uses this
   * backend instead of the native Node raster function.
   */
  readonly rasterBackend?: ChartRasterBackend;
  /**
   * Precompiled chart-raster WASM module. Used by runtimes that must provide
   * a host-approved WebAssembly.Module instead of compiling bytes at request
   * time.
   */
  readonly rasterModule?: WebAssembly.Module | Promise<WebAssembly.Module>;
}

export type ChartRenderingConfig = 'auto' | ChartRenderingOptions;

// ---------------------------------------------------------------------------
// Re-exported createWorkbook types — locally declared so tsup's DTS bundler
// can inline them (it can't resolve @mog-sdk/kernel/api workspace subpath).
// ---------------------------------------------------------------------------

/**
 * @internal Low-level power-user config — bypasses host adapter. Not part of
 * the stable public SDK API.
 */
interface WorkbookConfig {
  ctx: IKernelContext;
  /** UI state provider (active sheet, selection, active objects). */
  stateProvider?: import('@mog-sdk/contracts/api').WorkbookStateProvider;
  eventBus: KernelEventBus;
  // codeExecutorFactory intentionally omitted — SDK consumers wire it
  // via HeadlessEngine._workbookInternal.setCodeExecutorFactory() instead.
}

export interface CreateWorkbookOptions {
  documentId?: string;
  /** XLSX data shorthand — equivalent to `source: { type: 'bytes', data: xlsx }`. */
  xlsx?: Uint8Array;
  /** Full source descriptor (for Tauri path variant). */
  source?: DocumentSource;
  importOptions?: DocumentImportOptions;
  /**
   * IANA timezone name for this headless workbook session.
   *
   * Headless Node hosts cannot infer the user's calendar frame from the
   * process timezone. Pass the user's IANA timezone from session metadata, or
   * `'UTC'` for deterministic tests.
   */
  userTimezone?: string;
  /**
   * Session-level principal shorthand. When provided, the kernel forwards
   * `{ tags: principal.tags }` to Rust via `setActivePrincipal` at session
   * start. Equivalent to `security: { resolvePrincipal: () => principal }`
   * but flattens the common case.
   */
  principal?: { tags: string[] };
  /**
   * Security configuration for data access control (Layer 2). When a
   * `resolvePrincipal` callback is provided, the kernel invokes it once
   * at session start and forwards the result to the Rust security engine.
   * All policy evaluation lives in Rust (compute-security).
   *
   * After creation, use `wb.security` to manage policies.
   *
   * @example
   * ```typescript
   * const wb = await createWorkbook({
   *   security: {
   *     resolvePrincipal: () => ({ tags: ['agent:copilot'] }),
   *   },
   * });
   *
   * await wb.security.addPolicy({
   *   principalTag: 'agent:*',
   *   target: { kind: 'workbook' },
   *   level: 'structure',
   *   priority: 0,
   *   enabled: true,
   *   metadata: { createdBy: 'system', createdAt: Date.now() },
   * });
   * ```
   */
  security?: DocumentSecurityConfig;
  /**
   * Optional diagnostics logger for SDK host/kernel events. The SDK is
   * silent by default so embedding CLIs and TUIs keep stdout/stderr under
   * their own control.
   */
  logger?: MogSdkLogger | false;
  /**
   * Enable SDK diagnostics. When true, diagnostics use `logger` if provided,
   * otherwise `console`. Also enabled by MOG_SDK_DEBUG=1/true/yes.
   */
  debug?: boolean;
  /**
   * Chart image rendering capability selection.
   *
   * Omitted or 'auto' uses the native Node raster backend lazily for PNG/JPEG
   * and the portable SVG renderer for SVG. Supplying `rasterBackend` overrides
   * native rasterization. Supplying `rasterModule` initializes
   * @mog-sdk/chart-raster-wasm lazily for PNG/JPEG export.
   */
  chartRendering?: ChartRenderingConfig;
}

export interface MogSdkLogger {
  debug?(...args: unknown[]): void;
  info?(...args: unknown[]): void;
  warn?(...args: unknown[]): void;
  error?(...args: unknown[]): void;
}

/**
 * Create a Workbook. Data-first overloads for the common case.
 *
 * ```typescript
 * const wb = await createWorkbook();                                    // blank
 * const wb = await createWorkbook(xlsxBytes);                           // from buffer
 * const wb = await createWorkbook('report.xlsx');                       // from file path
 * const wb = await createWorkbook(xlsxBytes, { valuesOnly: true });     // with options
 * const wb = await createWorkbook({ xlsx: buf, documentId: 'my-doc' }); // options bag
 * ```
 */
export async function createWorkbook(): Promise<Workbook>;
export async function createWorkbook(xlsx: Uint8Array): Promise<Workbook>;
export async function createWorkbook(path: string): Promise<Workbook>;
export async function createWorkbook(
  xlsx: Uint8Array,
  importOptions?: DocumentImportOptions,
): Promise<Workbook>;
export async function createWorkbook(
  path: string,
  importOptions?: DocumentImportOptions,
): Promise<Workbook>;
export async function createWorkbook(options: CreateWorkbookOptions): Promise<Workbook>;
export async function createWorkbook(
  arg?: string | Uint8Array | CreateWorkbookOptions | WorkbookConfig,
  importOptions?: DocumentImportOptions,
): Promise<Workbook> {
  // WorkbookConfig power-user path — bypass host adapter, delegate directly.
  if (arg && typeof arg === 'object' && 'ctx' in arg && 'eventBus' in arg) {
    return (_kernelCreateWorkbook as unknown as KernelCreateWorkbook)(arg);
  }

  if (arg && typeof arg === 'object' && !(arg instanceof Uint8Array)) {
    const runtimeOption = (arg as { readonly runtime?: unknown }).runtime;
    if (runtimeOption !== undefined) {
      throw new Error(
        '[createWorkbook] runtime is selected by @mog-sdk/sdk package exports; use @mog-sdk/sdk/wasm for WASM',
      );
    }
    if ((arg as { readonly wasmModule?: unknown }).wasmModule !== undefined) {
      throw new Error('[createWorkbook] wasmModule is only valid from the @mog-sdk/sdk/wasm entry');
    }
  }

  // Normalize all overloads into a unified CreateWorkbookOptions + optional xlsxBytes.
  let opts: CreateWorkbookOptions;
  let xlsxBytes: Uint8Array | undefined;

  if (typeof arg === 'string') {
    // String → file path (Node.js SDK only)
    xlsxBytes = await readNodeFileBytes(arg);
    opts = { xlsx: xlsxBytes, importOptions };
  } else if (arg instanceof Uint8Array) {
    xlsxBytes = arg;
    opts = { xlsx: arg, importOptions };
  } else if (arg) {
    opts = arg as CreateWorkbookOptions;
    xlsxBytes = opts.xlsx;
    if (opts.source?.type === 'bytes') {
      xlsxBytes = opts.source.data;
    } else if (opts.source?.type === 'path') {
      xlsxBytes = await readNodeFileBytes(opts.source.path);
    }
  } else {
    opts = {};
  }

  const runtimeOption = (opts as { readonly runtime?: unknown }).runtime;
  if (runtimeOption !== undefined) {
    throw new Error(
      '[createWorkbook] runtime is selected by @mog-sdk/sdk package exports; use @mog-sdk/sdk/wasm for WASM',
    );
  }
  if ((opts as { readonly wasmModule?: unknown }).wasmModule !== undefined) {
    throw new Error('[createWorkbook] wasmModule is only valid from the @mog-sdk/sdk/wasm entry');
  }

  // Normalize the `principal` shorthand into `security.resolvePrincipal` so
  // downstream layers have a single shape to consume. The shorthand wins
  // over `security.resolvePrincipal` only when `security` wasn't provided.
  if (opts.principal && !opts.security) {
    const principalTags = opts.principal.tags;
    opts = {
      ...opts,
      security: { resolvePrincipal: () => ({ tags: principalTags }) },
    };
  }

  // Default timezone for headless — headless hosts cannot infer user TZ.
  const timezone = opts.userTimezone ?? 'UTC';

  // -------------------------------------------------------------------------
  // Host-backed creation path (trusted-process only)
  //
  // Creates a fully-wired TrustedDocumentHostContext via the node headless
  // host adapter, then delegates to createHostBackedDocument /
  // importHostBackedDocument from @mog/kernel-host-internal.
  //
  // Fails closed if the host-backed path fails. Falling back to the legacy
  // raw construction path would bypass source-handle validation, operation
  // gates, and principal/resource binding.
  // -------------------------------------------------------------------------
  const documentId = opts.documentId ?? createPortableRandomUUID();
  const hostResult: NodeHeadlessHostResult = createNodeHeadlessHost({
    documentId,
    operation: xlsxBytes ? 'import' : 'create',
    runtime: 'native',
    loadNapiAddon: loadNodeSdkNapiAddon,
    importBytes: xlsxBytes,
    timezone,
    locale: undefined, // use adapter default (en-US)
    principal: opts.principal ? { subjectId: undefined, tags: opts.principal.tags } : undefined,
    logger: opts.logger,
    debug: opts.debug,
  });

  let handle: HostBackedDocumentHandle | undefined;
  try {
    if (xlsxBytes) {
      const result = await importHostBackedDocument(hostResult.kernelContext, hostResult.bindings, {
        importOptions,
      });
      handle = result.handle;
    } else {
      handle = await createHostBackedDocument(hostResult.kernelContext, hostResult.bindings);
    }
  } catch (error) {
    hostResult.dispose();
    throw error;
  }
  if (!handle) {
    hostResult.dispose();
    throw new Error('[createWorkbook] host-backed document creation did not return a handle');
  }
  const readyHandle = handle;

  // SDK callers expect imported workbooks to be fully queryable when
  // createWorkbook resolves. Browser hosts may defer this after first paint,
  // but headless imports need charts, objects, and other projections before
  // the caller starts enumerating workbook state.
  if (xlsxBytes) {
    await readyHandle.awaitImportDurability();
  }

  installNodeChartImageExporter(readyHandle, loadNodeSdkNapiAddon, opts.chartRendering);

  // Create a Workbook from the handle — uses the cached workbook() path
  // which wires context, event bus, and sheet metadata internally.
  const wb = await readyHandle.workbook({ writeFile: writeNodeFileBytes });

  // Chain disposal: workbook.dispose → handle.dispose → host.dispose
  const originalDispose = wb.dispose.bind(wb);
  wb.dispose = () => {
    originalDispose();
    void readyHandle.dispose().catch((err: unknown) => {
      logSdkError(opts, '[createWorkbook] handle dispose failed:', err);
    });
    hostResult.dispose();
  };
  const originalSave = wb.save.bind(wb);
  wb.close = async (closeBehavior?: 'save' | 'skipSave') => {
    if (closeBehavior === 'save') {
      await originalSave();
    }
    originalDispose();
    await readyHandle.dispose();
    hostResult.dispose();
  };
  wb[Symbol.asyncDispose] = async () => {
    originalDispose();
    await readyHandle.dispose();
    hostResult.dispose();
  };

  return wb;
}

function logSdkError(
  opts: Pick<CreateWorkbookOptions, 'logger' | 'debug'>,
  message: string,
  error: unknown,
): void {
  if (opts.logger === false) return;
  const logger = opts.logger ?? (isSdkDebugEnabled(opts) ? console : undefined);
  logger?.error?.(message, error);
}

function isSdkDebugEnabled(opts: Pick<CreateWorkbookOptions, 'debug'>): boolean {
  if (opts.debug !== undefined) return opts.debug;
  const value =
    typeof process === 'undefined'
      ? undefined
      : (process.env.MOG_SDK_DEBUG ?? process.env.MOG_DEBUG);
  return value === '1' || value === 'true' || value === 'yes';
}

// =============================================================================
// Types
// =============================================================================

/**
 * NapiAddonModule -- the object returned by the public native platform package.
 * Contains: ComputeEngine class + static free functions (compute_set_current_time, etc.)
 *
 * @internal Raw native addon interface — not part of the stable public SDK API.
 * Use createWorkbook() instead.
 */
export interface NapiAddonModule {
  ComputeEngine: (new (snapshotJson: string) => ComputeEngineInstance) & {
    /** Factory method: create engine from raw Yrs state bytes (collaboration). */
    initFromYrsState?: (state: Buffer) => ComputeEngineInstance;
  };
  render_chart_marks_image?: (requestJson: string) => {
    readonly bytes: Uint8Array;
    readonly format: 'png' | 'jpeg';
    readonly width: number;
    readonly height: number;
  };
  [key: string]: unknown;
}

/**
 * A code-executor factory compatible with WorkbookImpl.setCodeExecutorFactory().
 * Engine layers supply this to wire a VM executor without circular dependencies.
 *
 * The factory receives the HeadlessEngine so it can access the workbook/context.
 * It returns an object whose `execute` method runs agent code and returns the
 * contract CodeExecutionResult.
 *
 * @internal Only used by headless-server executor wiring. Not part of the stable
 * public SDK API.
 */
export type HeadlessCodeExecutorFactory = (engine: HeadlessEngine) => {
  execute(code: string, options?: CodeExecutionOptions): Promise<CodeExecutionResult>;
  cancelExecution?(executionId: string): void;
  dispose(): void;
};

/**
 * Options for creating a HeadlessEngine.
 *
 * @internal Exposes raw NAPI addon handles, initial snapshots, and Yrs state
 * boot paths that are not part of the stable public SDK API. Use
 * createWorkbook() with CreateWorkbookOptions instead.
 */
export interface HeadlessOptions {
  /** Pre-loaded napi addon module from the public native platform package. */
  computeAddon: NapiAddonModule;
  /** Document ID (defaults to random UUID) */
  docId?: string;
  /** XLSX buffer to import on boot (triggers hydrating state) */
  xlsxSource?: Buffer;
  /** XLSX import options for the raw headless import path. */
  importOptions?: DocumentImportOptions;
  /**
   * IANA timezone for the session (e.g. 'America/Los_Angeles', 'UTC').
   *
   * Headless hosts (Node, cloud workers, agent runtimes) are not the user's
   * device, so the kernel never reads host TZ — it must be passed in. Defaults
   * to `'UTC'` here for the deprecated headless boot helpers; production
   * callers should pass the user's actual TZ from session metadata.
   *
   * @see kernel/src/api/document/resolve-user-timezone.ts
   */
  userTimezone?: string;
  /**
   * Optional code-executor factory.  When provided, `wb.executeCode()` will
   * work by delegating to the executor returned by this factory.
   * The factory is called lazily on the first `executeCode()` invocation.
   */
  codeExecutorFactory?: HeadlessCodeExecutorFactory;
  /**
   * Pre-built WorkbookSnapshot to initialize the engine from (for collaboration).
   * When provided, the engine is created with this snapshot instead of an empty one.
   * This ensures the engine shares the same CellIds as the source engine.
   *
   * @internal Raw collaboration boot path — not part of the stable public SDK API.
   */
  initialSnapshot?: Record<string, unknown>;
  /**
   * Raw Yrs document state bytes for engine initialization (for collaboration).
   * When provided, the engine is created from these bytes via `createEngineFromYrsState`
   * instead of the normal `createEngine` path. This ensures the engine shares the
   * same CellIds and history as the authoritative source.
   * Takes precedence over `initialSnapshot` if both are provided.
   *
   * @internal Raw Yrs state boot path — not part of the stable public SDK API.
   */
  yrsState?: Uint8Array;

  /** Trusted host/runtime resolver for cross-workbook links. */
  workbookLinkResolver?: WorkbookLinkResolver;

  /** Trusted host/runtime identity for the current open workbook session. */
  workbookLinkScope?: WorkbookLinkStatusScope;
}

// =============================================================================
// HeadlessLifecycleSystem
// =============================================================================

/**
 * Thin shim that delegates to DocumentFactory with `{ environment: 'headless' }`.
 *
 * Previously contained 5 duplicated actor implementations (createEngine,
 * wireContext, startBridge, hydrateXlsx, disposeBridge). Now all lifecycle
 * logic lives in DocumentLifecycleSystem, which handles headless-specific
 * behavior when environment='headless'.
 *
 * Lifecycle:
 * 1. Constructor stores options
 * 2. create() calls DocumentFactory.create({ environment: 'headless' })
 * 3. createFromXlsx() calls DocumentFactory.createFromXlsx(source, { environment: 'headless' })
 * 4. dispose() calls handle.dispose()
 */
class HeadlessLifecycleSystem {
  // ===========================================================================
  // Private State
  // ===========================================================================

  /** The document handle from the trusted headless creation boundary. */
  private handle: DocumentSyncCapableHandle | undefined;

  /** Warnings from XLSX import (empty if created blank). */
  private _importWarnings: readonly DocumentImportWarning[] = [];

  /** The headless options (kept for backward compat) */
  private readonly options: HeadlessOptions;

  // ===========================================================================
  // Constructor
  // ===========================================================================

  constructor(options: HeadlessOptions) {
    this.options = options;
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Create a new blank document.
   * Delegates to DocumentFactory.create() with headless environment.
   *
   * If `initialSnapshot` is set on options, creates the engine from that snapshot
   * instead of an empty one (for collaboration — ensures same CellIds as origin).
   */
  async create(docId: string): Promise<void> {
    this.handle = await createHeadlessDocument({
      documentId: docId,
      napiAddon: this.options.computeAddon,
      userTimezone: this.options.userTimezone ?? 'UTC',
      initialSnapshot: this.options.initialSnapshot,
      yrsState: this.options.yrsState,
      workbookLinkResolver: this.options.workbookLinkResolver,
      workbookLinkScope: this.options.workbookLinkScope,
    } as any);
    this._importWarnings = this.handle.importWarnings;
    this.registerChartImageExporter();
  }

  /**
   * Create a document from an XLSX buffer.
   * Delegates to DocumentFactory.createFromXlsx() with headless environment.
   */
  async createFromXlsx(docId: string, xlsxSource: Buffer): Promise<void> {
    const source: DocumentSource = {
      type: 'bytes' as const,
      data: new Uint8Array(xlsxSource),
    };

    this.handle = await importHeadlessDocumentFromXlsx(source, {
      documentId: docId,
      napiAddon: this.options.computeAddon,
      userTimezone: this.options.userTimezone ?? 'UTC',
      importOptions: this.options.importOptions,
      workbookLinkResolver: this.options.workbookLinkResolver,
      workbookLinkScope: this.options.workbookLinkScope,
    } as any);
    this._importWarnings = this.handle.importWarnings;
    this.registerChartImageExporter();
  }

  private registerChartImageExporter(): void {
    if (!this.handle) return;
    installNodeChartImageExporter(this.handle, () => this.options.computeAddon);
  }

  /** @internal */
  get importWarnings(): readonly DocumentImportWarning[] {
    return this._importWarnings;
  }

  /** @internal */
  get syncPort(): DocumentByteSyncPort {
    if (!this.handle) {
      throw new Error(
        '[HeadlessLifecycleSystem] sync port accessed before ready -- call create() or createFromXlsx() first',
      );
    }
    return this.handle.createSyncPort();
  }

  get workbookLinkScope(): WorkbookLinkStatusScope | undefined {
    return this.options.workbookLinkScope;
  }

  /** @internal */
  get computeBridge(): unknown {
    if (!this.handle) {
      throw new Error(
        '[HeadlessLifecycleSystem] compute bridge accessed before ready -- call create() or createFromXlsx() first',
      );
    }
    const bridge = (this.handle as unknown as { context?: { computeBridge?: unknown } }).context
      ?.computeBridge;
    if (!bridge) {
      throw new Error('[HeadlessLifecycleSystem] compute bridge unavailable on headless handle');
    }
    return bridge;
  }

  /** @internal */
  async workbook(): Promise<WorkbookInternal> {
    if (!this.handle) {
      throw new Error(
        '[HeadlessLifecycleSystem] workbook accessed before ready -- call create() or createFromXlsx() first',
      );
    }
    return (await this.handle.workbook()) as WorkbookInternal;
  }

  /**
   * Dispose the document and clean up all resources.
   * Safe to call multiple times (idempotent).
   */
  async dispose(): Promise<void> {
    if (this.handle) {
      const h = this.handle;
      this.handle = undefined;
      await h.dispose();
    }
  }
}

// =============================================================================
// HeadlessEngine
// =============================================================================

/**
 * A headless spreadsheet engine instance.
 *
 * Wraps the lifecycle system and provides a clean public API.
 * Created by `createHeadlessEngine()`.
 *
 * @internal Low-level engine wrapper for raw NAPI collaboration paths. Use
 * createWorkbook() for the stable public SDK API.
 * @deprecated Use createWorkbook() instead — it auto-detects headless environments.
 */
export class HeadlessEngine {
  /** Cached unified Workbook instance (owns sheet cache, create once) */
  private _workbook!: WorkbookInternal;
  private _unregisterExternalSession: (() => void) | undefined;

  /** @internal */
  constructor(private readonly lifecycle: HeadlessLifecycleSystem) {}

  // ===========================================================================
  // Unified Spreadsheet API
  // ===========================================================================

  /**
   * The unified Workbook — THE single API for all data and compute operations.
   *
   * Provides:
   * - Sheet access: getSheet(name), getSheetById(id), getSheetByIndex(index), activeSheet
   * - Sheet management: addSheet, removeSheet, moveSheet, renameSheet, etc.
   * - Orchestration: undo, redo, undoGroup, checkpoints, calc control, events
   * - Named ranges, scenarios, introspection, code execution
   *
   * Each Worksheet provides:
   * - Cell read/write with A1 AND numeric (row, col) overloads
   * - Formatting, structure, merges, sort, charts, shapes
   * - Filters, conditional formatting, validation, comments
   * - Grouping, hyperlinks, pivots, slicers
   * - LLM presentation: describe(), describeRange(), summarize()
   *
   * @see contracts/src/api/ — Interface definitions
   */
  get workbook(): Workbook {
    return this._workbook;
  }

  /**
   * @internal Access the WorkbookInternal for infrastructure wiring (e.g. code executor).
   */
  get _workbookInternal(): WorkbookInternal {
    return this._workbook;
  }

  /**
   * Initialize the workbook instance asynchronously.
   * Must be called after construction and before accessing `workbook`.
   * @internal Called by `createHeadlessEngine()`.
   */
  async initWorkbook(): Promise<void> {
    this._workbook = await this.lifecycle.workbook();
    const sessionId = this.lifecycle.workbookLinkScope?.requestingSessionId;
    if (sessionId) {
      this._unregisterExternalSession = registerExternalWorkbookSession(sessionId, {
        workbook: this._workbook,
      });
    }
  }

  /**
   * Get or set the active sheet ID.
   * Delegates to the workbook's internal active-sheet tracking.
   */
  get activeSheetId(): string {
    return this._workbook.getActiveSheetId();
  }

  set activeSheetId(id: string) {
    this._workbook.setActiveSheetId(toSheetId(id));
  }

  /** @internal */
  get syncPort(): DocumentByteSyncPort {
    return this.lifecycle.syncPort;
  }

  /**
   * Dispose the engine and clean up all resources.
   *
   * Sends DISPOSE event to the lifecycle machine and waits for
   * 'disposed' state. Safe to call multiple times (idempotent).
   *
   * MUST be called when done to avoid resource leaks.
   */
  async dispose(): Promise<void> {
    this._unregisterExternalSession?.();
    this._unregisterExternalSession = undefined;
    return this.lifecycle.dispose();
  }
}

// =============================================================================
// Package-internal accessor — NOT re-exported from index.ts
// =============================================================================

/**
 * @internal Package-private bridge accessor for CollaborativeEngine.
 * Not part of the public SDK API — only used within runtime/sdk/src/.
 */
export function _getDocumentSyncPort(engine: HeadlessEngine): DocumentByteSyncPort {
  return engine.syncPort;
}

/**
 * @internal Package-private bridge accessor for kernel/runtime integration
 * tests that must exercise the same ComputeBridge surface as browser sidecars.
 * Not part of the public SDK API.
 */
export function _getComputeBridge(engine: HeadlessEngine): unknown {
  return (engine as unknown as { lifecycle: { computeBridge: unknown } }).lifecycle.computeBridge;
}

/**
 * @internal Package-private chart exporter registration helper for regression tests.
 * Not re-exported from the public package entrypoint.
 */
export function installNodeChartImageExporter(
  handle: ChartImageExporterRegistrationHandle,
  resolveAddon: () => NativeChartRasterAddonCandidate,
  chartRendering?: ChartRenderingConfig,
): void {
  handle.registerChartImageExporter(
    createSdkChartImageExporterFactory(resolveAddon, chartRendering),
  );
}

function createSdkChartImageExporterFactory(
  resolveAddon: () => NativeChartRasterAddonCandidate,
  chartRendering?: ChartRenderingConfig,
): (chartBridge: IChartBridge) => ChartImageExporter {
  if (chartRendering === undefined || chartRendering === 'auto') {
    return createNodeChartImageExporterFactory(() => resolveAddon() as NativeChartRasterAddon);
  }

  const hasRasterBackend = chartRendering.rasterBackend !== undefined;
  const hasRasterModule = chartRendering.rasterModule !== undefined;
  if (hasRasterBackend && hasRasterModule) {
    throw new Error(
      '[createWorkbook] chartRendering cannot provide both rasterBackend and rasterModule',
    );
  }

  if (hasRasterBackend) {
    return createChartImageExporterFactory(
      chartRendering.rasterBackend as unknown as import('@mog/charts/export').ChartRasterBackend,
    );
  }

  if (hasRasterModule) {
    return createNodeWasmChartImageExporterFactory(chartRendering.rasterModule!);
  }

  return createChartImageExporterFactory();
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a headless spreadsheet engine.
 *
 * This boots the full kernel stack (compute-core, bridges, context) in Node.js
 * without any browser dependencies. Uses the same lifecycle state machine as
 * the browser app -- error handling, cleanup, and XLSX import support are shared.
 *
 * The engine uses the public native platform package for the Rust compute core,
 * providing the same performance as the Tauri desktop app.
 *
 * @internal Low-level factory requiring raw NAPI addon handles — not part of the
 * stable public SDK API.
 * @deprecated Use createWorkbook() instead.
 * @param options - Configuration including the pre-loaded napi addon module
 * @returns A ready-to-use HeadlessEngine
 * @throws If engine initialization fails
 *
 * @example
 * ```typescript
 * // Load the public native platform package for the current OS/architecture.
 * const addon = require('@mog-sdk/darwin-arm64');
 *
 * // Create the headless engine
 * const engine = await createHeadlessEngine({ computeAddon: addon });
 *
 * // Use the workbook API
 * const ws = engine.workbook.activeSheet;
 * await ws.setCell('A1', '=1+1');
 *
 * // Clean up
 * await engine.dispose();
 * ```
 */
export async function createHeadlessEngine(options: HeadlessOptions): Promise<HeadlessEngine> {
  const system = new HeadlessLifecycleSystem(options);
  const docId = options.docId ?? crypto.randomUUID();

  if (options.xlsxSource) {
    await system.createFromXlsx(docId, options.xlsxSource);
  } else {
    await system.create(docId);
  }

  const engine = new HeadlessEngine(system);
  await engine.initWorkbook();

  // Wire code-executor factory if provided
  if (options.codeExecutorFactory) {
    const userFactory = options.codeExecutorFactory;
    // Adapt HeadlessCodeExecutorFactory (receives engine) into the internal
    // CodeExecutorFactory shape (receives {ctx, eventBus, getActiveSheetId}).
    // The internal config is ignored — the user factory closes over the engine.
    engine._workbookInternal.setCodeExecutorFactory(() => userFactory(engine));
  }

  return engine;
}

/**
 * Create a headless spreadsheet engine from raw Yrs state bytes.
 *
 * This boots the full kernel stack using Yrs state bytes from an authoritative
 * source (e.g., a collaboration coordinator). The engine shares the same CellIds
 * and history as the source, enabling correct collaboration semantics.
 *
 * @internal Raw Yrs state boot path — not part of the stable public SDK API.
 * Not re-exported from index.ts.
 *
 * @param addon - The pre-loaded napi addon module
 * @param yrsState - Raw Yrs document state bytes from the authoritative source
 * @param options - Optional headless configuration (docId, codeExecutorFactory, etc.)
 * @returns A ready-to-use HeadlessEngine
 * @throws If engine initialization fails
 */
export async function createHeadlessEngineFromYrsState(
  addon: NapiAddonModule,
  yrsState: Uint8Array,
  options?: Partial<HeadlessOptions>,
): Promise<HeadlessEngine> {
  return createHeadlessEngine({
    computeAddon: addon,
    yrsState,
    ...options,
  });
}
