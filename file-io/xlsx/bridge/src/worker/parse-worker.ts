/**
 * Web Worker for XLSX Parsing
 *
 * This module provides a Web Worker implementation for parsing XLSX files
 * in a separate thread, avoiding blocking the main thread for large files.
 *
 * Features:
 * - Full WASM-based parsing in worker thread
 * - Progress reporting via postMessage
 * - Cancellation support
 * - Works in both browser (Web Worker) and Node.js (worker_threads)
 *
 * @module xlsx-parser/worker/parse-worker
 *
 * @example Browser Usage:
 * ```typescript
 * // Create a worker from this file
 * const worker = new Worker(new URL('./parse-worker.ts', import.meta.url), {
 *   type: 'module'
 * });
 *
 * // Wait for ready
 * worker.onmessage = (e) => {
 *   if (e.data.type === 'ready') {
 *     // Worker is ready, send parse request
 *     worker.postMessage({
 *       id: 'parse-1',
 *       type: 'parse',
 *       data: xlsxArrayBuffer,
 *       options: { reportProgress: true }
 *     }, [xlsxArrayBuffer]); // Transfer ownership
 *   }
 *
 *   if (e.data.type === 'progress') {
 *     console.log(`Progress: ${e.data.progress.percentage}%`);
 *   }
 *
 *   if (e.data.type === 'success') {
 *     console.log('Parsed:', e.data.result);
 *   }
 *
 *   if (e.data.type === 'error') {
 *     console.error('Error:', e.data.message);
 *   }
 * };
 * ```
 *
 * @example Node.js Usage:
 * ```typescript
 * import { Worker } from 'worker_threads';
 *
 * const worker = new Worker(new URL('./parse-worker.ts', import.meta.url));
 *
 * worker.on('message', (msg) => {
 *   if (msg.type === 'success') {
 *     console.log('Parsed:', msg.result);
 *   }
 * });
 *
 * worker.postMessage({
 *   id: 'parse-1',
 *   type: 'parse',
 *   data: buffer.buffer // ArrayBuffer from Buffer
 * });
 * ```
 */

import { createPostMessageProgress, throttleProgress, type ParseProgress } from '../progress';
import type { FullParseResult } from '../types';
import type {
  CancelRequestMessage,
  ParseRequestMessage,
  WorkerCapabilities,
  WorkerInboundMessage,
  WorkerOutboundMessage,
  WorkerParseOptions,
} from './types';
import { createErrorMessage, generateMessageId } from './types';

// =============================================================================
// Environment Detection
// =============================================================================

/**
 * Detect if running in Node.js worker_threads.
 */
const isNodeWorker =
  typeof process !== 'undefined' && process.versions != null && process.versions.node != null;

/**
 * Detect if running in a browser Web Worker.
 */
const isBrowserWorker =
  typeof self !== 'undefined' && typeof self.postMessage === 'function' && !isNodeWorker;

// =============================================================================
// Cross-Platform PostMessage
// =============================================================================

/**
 * Post a message to the parent context.
 * Works in both browser Web Workers and Node.js worker_threads.
 */
function postToParent(message: WorkerOutboundMessage, transfer?: Transferable[]): void {
  if (isBrowserWorker) {
    // Browser Web Worker
    if (transfer && transfer.length > 0) {
      self.postMessage(message, { transfer });
    } else {
      self.postMessage(message);
    }
  } else if (isNodeWorker) {
    // Node.js worker_threads
    // Dynamic import to avoid bundler issues
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { parentPort } = require('worker_threads');
    parentPort?.postMessage(message);
  }
}

// =============================================================================
// Worker State
// =============================================================================

/** Active parse operations (for cancellation) */
const activeParses = new Map<string, AbortController>();

/** WASM module reference */
let wasmModule: unknown = null;

/** Capabilities detected on init */
let capabilities: WorkerCapabilities | null = null;

// =============================================================================
// Capability Detection
// =============================================================================

/**
 * Detect worker capabilities.
 */
function detectCapabilities(): WorkerCapabilities {
  // Check WebAssembly support
  const wasmSupported =
    typeof WebAssembly !== 'undefined' && typeof WebAssembly.instantiate === 'function';

  // Check SIMD support
  let simdSupported = false;
  if (wasmSupported) {
    try {
      // Minimal WASM module using SIMD i8x16.splat instruction
      const simdModule = new Uint8Array([
        0x00,
        0x61,
        0x73,
        0x6d, // WASM magic
        0x01,
        0x00,
        0x00,
        0x00, // Version 1
        0x01,
        0x05,
        0x01,
        0x60,
        0x00,
        0x01,
        0x7b, // Type section
        0x03,
        0x02,
        0x01,
        0x00, // Function section
        0x0a,
        0x0a,
        0x01,
        0x08,
        0x00,
        0x41,
        0x00,
        0xfd,
        0x0f,
        0x0b,
      ]);
      simdSupported = WebAssembly.validate(simdModule);
    } catch {
      simdSupported = false;
    }
  }

  // Check SharedArrayBuffer support
  const sharedArrayBufferSupported =
    typeof SharedArrayBuffer !== 'undefined' && typeof Atomics !== 'undefined';

  return {
    wasmSupported,
    simdSupported,
    sharedArrayBufferSupported,
  };
}

// =============================================================================
// WASM Module Loading
// =============================================================================

/**
 * Load and initialize the WASM module.
 */
async function loadWasmModule(): Promise<void> {
  if (wasmModule) return;

  try {
    // Dynamic import of the unified @mog-sdk/wasm module.
    // All xlsx commands (xlsx_parse_full, xlsx_version, etc.) are served
    // by @mog-sdk/wasm since the WASM module merge.
    // @ts-ignore - Dynamic import of WASM module
    const wasmImport = await import('@mog-sdk/wasm');

    // Initialize the WASM module (wasm-pack --target web default export)
    if (typeof wasmImport.default === 'function') {
      await wasmImport.default();
    }

    wasmModule = wasmImport;
  } catch (error) {
    throw new Error(
      `Failed to load WASM module: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// =============================================================================
// Parse Operation
// =============================================================================

/**
 * Execute a parse operation.
 */
async function executeParse(
  id: string,
  data: ArrayBuffer,
  options: WorkerParseOptions = {},
): Promise<void> {
  const startTime = performance.now();
  const abortController = new AbortController();
  activeParses.set(id, abortController);

  // Set up progress reporting
  const reportProgress = options.reportProgress !== false;
  const progressIntervalMs = options.progressIntervalMs ?? 50;

  let progressCallback: ((p: ParseProgress) => void) | undefined;
  if (reportProgress) {
    const rawCallback = createPostMessageProgress((message: unknown) => {
      const progress = message as ParseProgress;
      postToParent({ id, type: 'progress', progress });
    }, 'progress');
    progressCallback = throttleProgress(rawCallback, progressIntervalMs);
  }

  try {
    // Ensure WASM is loaded
    await loadWasmModule();

    // Check for cancellation before starting
    if (abortController.signal.aborted) {
      postToParent({ id, type: 'cancelled' });
      return;
    }

    // Report init progress
    progressCallback?.({ phase: 'init' as const, percentage: 0 });

    // Get the parse function from WASM module
    // @ts-expect-error - Dynamic module access
    const parseXlsxFull = wasmModule?.xlsx_parse_full;
    if (!parseXlsxFull) {
      throw new Error('WASM xlsx_parse_full function not available');
    }

    // Report ZIP phase start
    progressCallback?.({ phase: 'zip' as const, percentage: 5 });

    // Check for cancellation before parsing
    if (abortController.signal.aborted) {
      postToParent({ id, type: 'cancelled' });
      return;
    }

    // Convert ArrayBuffer to Uint8Array
    const uint8Data = new Uint8Array(data);

    // Report XML phase
    progressCallback?.({ phase: 'xml' as const, percentage: 20 });

    // Execute parse
    // Note: The WASM parser doesn't support mid-parse cancellation yet,
    // but we check before and after
    const result: FullParseResult = parseXlsxFull(uint8Data, {
      mode: options.mode,
      max_cells: options.maxCells,
      skip_styles: options.skipStyles,
      skip_charts: options.skipCharts,
      skip_drawings: options.skipDrawings,
      skip_comments: options.skipComments,
      skip_data_validation: options.skipDataValidation,
      skip_conditional_formatting: options.skipConditionalFormatting,
      sheet_filter: options.sheetFilter,
      values_only: options.valuesOnly,
    });

    // Check for cancellation after parsing
    if (abortController.signal.aborted) {
      postToParent({ id, type: 'cancelled' });
      return;
    }

    // Report completion
    progressCallback?.({ phase: 'complete' as const, percentage: 100 });

    const parseTimeMs = performance.now() - startTime;

    postToParent({
      id,
      type: 'success',
      result,
      parseTimeMs,
    });
  } catch (error) {
    // Check if this was a cancellation
    if (abortController.signal.aborted) {
      postToParent({ id, type: 'cancelled' });
      return;
    }

    // Report error
    postToParent(createErrorMessage(id, error instanceof Error ? error : new Error(String(error))));
  } finally {
    activeParses.delete(id);
  }
}

/**
 * Cancel an active parse operation.
 */
function cancelParse(parseId: string): void {
  const controller = activeParses.get(parseId);
  if (controller) {
    controller.abort();
  }
}

// =============================================================================
// Message Handler
// =============================================================================

/**
 * Handle incoming messages from the parent context.
 */
function handleMessage(message: WorkerInboundMessage): void {
  switch (message.type) {
    case 'parse': {
      const parseMsg = message as ParseRequestMessage;
      // Execute parse asynchronously
      void executeParse(parseMsg.id, parseMsg.data, parseMsg.options);
      break;
    }

    case 'cancel': {
      const cancelMsg = message as CancelRequestMessage;
      cancelParse(cancelMsg.parseId);
      break;
    }

    case 'terminate': {
      // Clean up and terminate
      activeParses.forEach((controller) => controller.abort());
      activeParses.clear();

      if (isBrowserWorker) {
        self.close();
      } else if (isNodeWorker) {
        process.exit(0);
      }
      break;
    }
  }
}

// =============================================================================
// Worker Initialization
// =============================================================================

/**
 * Initialize the worker.
 */
async function initWorker(): Promise<void> {
  // Detect capabilities
  capabilities = detectCapabilities();

  // Pre-load WASM module
  try {
    await loadWasmModule();
  } catch (error) {
    // WASM loading failure is not fatal - we report it in capabilities
    console.warn('Failed to pre-load WASM module:', error);
  }

  // Get version from WASM or use fallback
  let version = '1.0.0';
  try {
    // @ts-expect-error - Dynamic module access
    version = wasmModule?.xlsx_version?.() ?? version;
  } catch {
    // Ignore version extraction errors
  }

  // Send ready message
  postToParent({
    id: generateMessageId(),
    type: 'ready',
    version,
    capabilities: capabilities!,
  });
}

// =============================================================================
// Message Listener Setup
// =============================================================================

if (isBrowserWorker) {
  // Browser Web Worker
  self.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
    handleMessage(event.data);
  };

  // Initialize on load
  void initWorker();
} else if (isNodeWorker) {
  // Node.js worker_threads
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { parentPort } = require('worker_threads');

  parentPort?.on('message', (message: WorkerInboundMessage) => {
    handleMessage(message);
  });

  // Initialize on load
  void initWorker();
}

// =============================================================================
// Main Thread Helper Functions (not used in worker)
// =============================================================================

/**
 * Create a worker-based XLSX parser.
 *
 * This function creates a Web Worker and returns an interface for parsing
 * XLSX files in the background.
 *
 * @param workerUrl - URL to the worker script
 * @returns Parser interface
 *
 * @example
 * ```typescript
 * const parser = createWorkerParser(
 *   new URL('./parse-worker.ts', import.meta.url)
 * );
 *
 * try {
 *   await parser.ready;
 *
 *   const { promise, cancel } = parser.parse(xlsxArrayBuffer, {
 *     reportProgress: true,
 *     onProgress: (p) => console.log(`${p.percentage}%`)
 *   });
 *
 *   const result = await promise;
 *   console.log('Parsed:', result);
 * } finally {
 *   parser.terminate();
 * }
 * ```
 */
export function createWorkerParser(workerUrl: URL | string): {
  /** Promise that resolves when worker is ready */
  ready: Promise<WorkerCapabilities>;
  /** Parse an XLSX file */
  parse: (
    data: ArrayBuffer,
    options?: WorkerParseOptions & {
      onProgress?: (progress: { phase: string; percentage: number }) => void;
    },
  ) => {
    promise: Promise<FullParseResult>;
    cancel: () => void;
  };
  /** Terminate the worker */
  terminate: () => void;
} {
  // Only available in main thread (browser)
  if (typeof Worker === 'undefined') {
    throw new Error('Web Workers are not supported in this environment');
  }

  const worker = new Worker(workerUrl, { type: 'module' });
  const pendingRequests = new Map<
    string,
    {
      resolve: (result: FullParseResult) => void;
      reject: (error: Error) => void;
      onProgress?: (progress: { phase: string; percentage: number }) => void;
    }
  >();

  let readyResolve: (caps: WorkerCapabilities) => void;
  let readyReject: (error: Error) => void;
  const ready = new Promise<WorkerCapabilities>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  // Set up message handler
  worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
    const msg = event.data;

    switch (msg.type) {
      case 'ready':
        readyResolve(msg.capabilities);
        break;

      case 'progress': {
        const pending = pendingRequests.get(msg.id);
        pending?.onProgress?.(msg.progress);
        break;
      }

      case 'success': {
        const pending = pendingRequests.get(msg.id);
        if (pending) {
          pendingRequests.delete(msg.id);
          pending.resolve(msg.result);
        }
        break;
      }

      case 'error': {
        const pending = pendingRequests.get(msg.id);
        if (pending) {
          pendingRequests.delete(msg.id);
          const error = new Error(msg.message);
          // @ts-expect-error - Adding code property
          error.code = msg.code;
          pending.reject(error);
        }
        break;
      }

      case 'cancelled': {
        const pending = pendingRequests.get(msg.id);
        if (pending) {
          pendingRequests.delete(msg.id);
          const error = new DOMException('Parse operation was cancelled', 'AbortError');
          pending.reject(error);
        }
        break;
      }
    }
  };

  worker.onerror = (error) => {
    readyReject(new Error(`Worker error: ${error.message}`));
  };

  return {
    ready,

    parse(data, options = {}) {
      const id = generateMessageId();
      const { onProgress, ...workerOptions } = options;

      const promise = new Promise<FullParseResult>((resolve, reject) => {
        pendingRequests.set(id, { resolve, reject, onProgress });
      });

      // Transfer the ArrayBuffer to the worker
      worker.postMessage(
        {
          id,
          type: 'parse',
          data,
          options: workerOptions,
        } satisfies ParseRequestMessage,
        [data],
      );

      return {
        promise,
        cancel: () => {
          worker.postMessage({
            id: generateMessageId(),
            type: 'cancel',
            parseId: id,
          } satisfies CancelRequestMessage);
        },
      };
    },

    terminate() {
      worker.postMessage({
        id: generateMessageId(),
        type: 'terminate',
      });
      worker.terminate();
    },
  };
}
