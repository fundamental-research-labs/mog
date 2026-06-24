import type { ChartImageExporter, Workbook } from '@mog-sdk/contracts/api';
import type { IChartBridge } from '@mog-sdk/contracts/bridges';
import type { DocumentImportOptions } from '@mog-sdk/contracts/document';
import type { DocumentSecurityConfig } from '@mog-sdk/contracts/security';
import { createHostBackedDocument, importHostBackedDocument } from '@mog/kernel-host-internal';
import {
  createChartImageExporterFactory,
  type ChartRasterWasmGlueLoader,
  createWasmChartImageExporterFactory,
} from './chart-export/node-chart-image-exporter';
export {
  CONTROL_PLANE_ENTRYPOINT_IDS,
  controlPlaneEntrypoints,
  createInertControlPlane,
  observeControlPlaneShadow,
} from './control-plane';
export type * from './control-plane';
import { createNodeHeadlessHost } from './host-adapters/node-headless-host';
import { createPortableRandomUUID } from './host-adapters/portable-host-crypto';
import type {
  ChartRenderingConfig,
  CreateWorkbookOptions as NativeCreateWorkbookOptions,
  MogSdkLogger,
} from './boot';
import {
  createSdkVersionStoreLifecycleConfig,
  type MogSdkVersionStoreConfig,
} from './version-store';
import * as chartRasterWasmGlue from '@mog-sdk/chart-raster-wasm';

type HostBackedDocumentHandle = Awaited<ReturnType<typeof createHostBackedDocument>>;
type ChartImageExporterRegistrationHandle = {
  registerChartImageExporter(factory: (chartBridge: IChartBridge) => ChartImageExporter): void;
};

export type {
  ChartImageFrame,
  ChartRasterBackend,
  ChartRasterRequest,
  ChartRasterResult,
  ChartRenderingConfig,
  ChartRenderingOptions,
  MogSdkLogger,
} from './boot';
export {
  MOG_SDK_SUPPORTED_VERSION_STORE_KINDS,
  MOG_SDK_UNSUPPORTED_VERSION_STORE_KINDS,
  MogSdkVersionStoreConfigError,
  createSdkVersionStoreLifecycleConfig,
  isMogSdkVersionStoreConfigError,
} from './version-store';
export type {
  MogSdkBrowserVersionStoreConfig,
  MogSdkIndexedDbVersionStoreConfig,
  MogSdkMemoryDurableSnapshotVersionStoreConfig,
  MogSdkMemoryVersionStoreConfig,
  MogSdkNodeFileVersionStoreConfig,
  MogSdkSupportedVersionStoreKind,
  MogSdkUnsupportedVersionStoreKind,
  MogSdkVersionStoreConfig,
  MogSdkVersionStoreConfigObject,
  MogSdkVersionStoreDiagnostic,
  MogSdkVersionStoreDiagnosticCode,
  MogSdkVersionStoreLifecycleConfig,
  MogSdkVersionStoreLifecycleOptions,
  MogSdkVersionStoreLifecycleProviderSelection,
  MogSdkVersionStoreRuntime,
  MogSdkVersionStoreScopeOptions,
} from './version-store';
export type {
  Workbook,
  Worksheet,
  ScreenshotOptions,
  WorkbookSecurity,
} from '@mog-sdk/contracts/api';
export type { CellRawValue, CellValue, SheetId } from '@mog-sdk/contracts/core';
export type {
  DocumentImportOptions as ImportOptions,
  DocumentSource,
} from '@mog-sdk/contracts/document';
export type { FormulaA1 } from '@mog-sdk/contracts/cells';

export {
  Utils,
  a1,
  address,
  column,
  columnIndex,
  columnName,
  colToLetter,
  offset,
  parse,
  parseAddress,
  parseCellAddress,
  parseCellRange,
  rangeAddress,
  rangeToA1,
  toA1,
} from './public-kernel-facade';
export type { PublicA1Utils, PublicRangeUtils, PublicUtils } from './public-kernel-facade';

export interface CreateWorkbookOptions {
  documentId?: string;
  wasmModule?: WebAssembly.Module | Promise<WebAssembly.Module>;
  xlsx?: Uint8Array;
  source?: Extract<NativeCreateWorkbookOptions['source'], { readonly type: 'bytes' }>;
  importOptions?: DocumentImportOptions;
  userTimezone?: string;
  principal?: { tags: string[] };
  security?: DocumentSecurityConfig;
  logger?: MogSdkLogger | false;
  debug?: boolean;
  chartRendering?: ChartRenderingConfig;
  versionStore?: MogSdkVersionStoreConfig;
}

export async function createWorkbook(): Promise<Workbook>;
export async function createWorkbook(xlsx: Uint8Array): Promise<Workbook>;
export async function createWorkbook(
  xlsx: Uint8Array,
  importOptions?: DocumentImportOptions,
): Promise<Workbook>;
export async function createWorkbook(options: CreateWorkbookOptions): Promise<Workbook>;
export async function createWorkbook(
  arg?: Uint8Array | CreateWorkbookOptions | string,
  importOptions?: DocumentImportOptions,
): Promise<Workbook> {
  if (typeof arg === 'string') {
    throw new Error(
      'File-path workbook sources are not supported by the WASM SDK entry; pass XLSX bytes instead',
    );
  }

  let opts: CreateWorkbookOptions;
  let xlsxBytes: Uint8Array | undefined;

  if (arg instanceof Uint8Array) {
    xlsxBytes = arg;
    opts = { xlsx: arg, importOptions };
  } else if (arg) {
    opts = arg;
    xlsxBytes = opts.xlsx;
    if (opts.source?.type === 'bytes') {
      xlsxBytes = opts.source.data;
    } else if (opts.source !== undefined) {
      throw new Error(
        'File-path workbook sources are not supported by the WASM SDK entry; pass XLSX bytes instead',
      );
    }
  } else {
    opts = {};
  }

  if ((opts as { readonly runtime?: unknown }).runtime !== undefined) {
    throw new Error(
      '[createWorkbook] runtime is selected by @mog-sdk/sdk package exports; remove runtime or import @mog-sdk/sdk/node for native Node',
    );
  }

  if (opts.principal && !opts.security) {
    const principalTags = opts.principal.tags;
    opts = {
      ...opts,
      security: { resolvePrincipal: () => ({ tags: principalTags }) },
    };
  }

  const documentId = opts.documentId ?? createPortableRandomUUID();
  const versioning = createSdkVersionStoreLifecycleConfig(opts.versionStore, {
    runtime: 'wasm',
    documentId,
  });
  const hostResult = createNodeHeadlessHost({
    documentId,
    operation: xlsxBytes ? 'import' : 'create',
    runtime: 'wasm',
    wasmModule: opts.wasmModule,
    importBytes: xlsxBytes,
    timezone: opts.userTimezone ?? 'UTC',
    principal: opts.principal ? { subjectId: undefined, tags: opts.principal.tags } : undefined,
    logger: opts.logger,
    debug: opts.debug,
  });

  let handle: HostBackedDocumentHandle | undefined;
  try {
    if (xlsxBytes) {
      const result = await importHostBackedDocument(hostResult.kernelContext, hostResult.bindings, {
        importOptions: opts.importOptions ?? importOptions,
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
  if (xlsxBytes) {
    await readyHandle.awaitImportDurability();
  }

  installWasmChartImageExporter(readyHandle, opts.chartRendering);
  const wb = versioning ? await readyHandle.workbook({ versioning }) : await readyHandle.workbook();

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

function installWasmChartImageExporter(
  handle: ChartImageExporterRegistrationHandle,
  chartRendering?: ChartRenderingConfig,
): void {
  handle.registerChartImageExporter(createWasmSdkChartImageExporterFactory(chartRendering));
}

function createWasmSdkChartImageExporterFactory(
  chartRendering?: ChartRenderingConfig,
): (chartBridge: IChartBridge) => ChartImageExporter {
  if (chartRendering === undefined || chartRendering === 'auto') {
    return createChartImageExporterFactory();
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
    return createWasmChartImageExporterFactory(
      chartRendering.rasterModule!,
      loadBundledChartRasterWasmGlue,
    );
  }

  return createChartImageExporterFactory();
}

const loadBundledChartRasterWasmGlue: ChartRasterWasmGlueLoader = async () =>
  chartRasterWasmGlue as unknown as Awaited<ReturnType<ChartRasterWasmGlueLoader>>;

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
  const env = (
    globalThis as typeof globalThis & {
      readonly process?: { readonly env?: Record<string, string | undefined> };
    }
  ).process?.env;
  const value = env?.MOG_SDK_DEBUG ?? env?.MOG_DEBUG;
  return value === '1' || value === 'true' || value === 'yes';
}
