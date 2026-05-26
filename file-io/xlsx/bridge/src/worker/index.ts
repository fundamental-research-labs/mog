/**
 * Web Worker Module for XLSX Parsing
 *
 * This module exports all the types and utilities needed for running
 * XLSX parsing in a Web Worker to avoid blocking the main thread.
 *
 * @module xlsx-parser/worker
 *
 * @example Browser usage (main thread):
 * ```typescript
 * import { createWorkerParser } from '@mog/xlsx-parser/worker';
 *
 * const parser = createWorkerParser(
 *   new URL('@mog/xlsx-parser/worker/parse-worker.ts', import.meta.url)
 * );
 *
 * // Wait for worker to be ready
 * const capabilities = await parser.ready;
 * console.log('WASM supported:', capabilities.wasmSupported);
 *
 * // Parse with progress reporting
 * const { promise, cancel } = parser.parse(xlsxArrayBuffer, {
 *   onProgress: (progress) => {
 *     console.log(`${progress.phase}: ${progress.percentage}%`);
 *   }
 * });
 *
 * // Optional: cancel if needed
 * // cancel();
 *
 * const result = await promise;
 * console.log('Parsed workbook:', result);
 *
 * // Clean up when done
 * parser.terminate();
 * ```
 *
 * @example Node.js usage (worker_threads):
 * ```typescript
 * import { Worker } from 'worker_threads';
 * import type { WorkerInboundMessage, WorkerOutboundMessage } from '@mog/xlsx-parser/worker';
 *
 * const worker = new Worker(
 *   new URL('@mog/xlsx-parser/worker/parse-worker.ts', import.meta.url)
 * );
 *
 * worker.on('message', (msg: WorkerOutboundMessage) => {
 *   switch (msg.type) {
 *     case 'ready':
 *       console.log('Worker ready');
 *       break;
 *     case 'progress':
 *       console.log(`Progress: ${msg.progress.percentage}%`);
 *       break;
 *     case 'success':
 *       console.log('Parsed:', msg.result);
 *       break;
 *     case 'error':
 *       console.error('Error:', msg.message);
 *       break;
 *   }
 * });
 *
 * // Send parse request
 * worker.postMessage({
 *   id: '1',
 *   type: 'parse',
 *   data: xlsxBuffer
 * } satisfies WorkerInboundMessage);
 * ```
 */

// Export types for worker communication
export type {
  CancelRequestMessage,
  ParseCancelledMessage,
  ParseErrorMessage,
  ParseHandle,
  ParseRequestMessage,
  ParseSuccessMessage,
  ProgressMessage,
  ReadyMessage,
  TerminateRequestMessage,
  WorkerCapabilities,
  WorkerInboundMessage,
  // Message types: Main Thread -> Worker
  WorkerMessageBase,
  WorkerOutboundMessage,

  // Configuration types
  WorkerParseOptions,
  WorkerParserOptions,
  // Message types: Worker -> Main Thread
  WorkerResponseBase,
} from './types';

// Export utility functions
export {
  createErrorMessage,
  generateMessageId,
  isCancelled,
  isParseError,
  isParseSuccess,
  isProgress,
  isReady,
} from './types';

// Export the worker parser factory (for main thread use)
export { createWorkerParser } from './parse-worker';
