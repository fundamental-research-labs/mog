/**
 * Web Worker Message Types for XLSX Parsing
 *
 * This module defines the message types used for communication between
 * the main thread and the Web Worker during XLSX parsing operations.
 *
 * The protocol supports:
 * - Initiating parse operations with configuration
 * - Progress reporting during parsing
 * - Result delivery upon completion
 * - Error reporting
 * - Cancellation requests
 *
 * @module xlsx-parser/worker/types
 */

import type { ParseProgress } from '../progress';
import type { FullParseOptions, FullParseResult } from '../types';
import { ParseErrorCode } from '../types';

// =============================================================================
// Message Types: Main Thread -> Worker
// =============================================================================

/**
 * Base interface for all messages to the worker.
 */
export interface WorkerMessageBase {
  /** Unique message ID for correlation */
  id: string;
  /** Message type discriminator */
  type: string;
}

/**
 * Request to parse an XLSX file.
 */
export interface ParseRequestMessage extends WorkerMessageBase {
  type: 'parse';
  /** XLSX file data as ArrayBuffer (transferred) */
  data: ArrayBuffer;
  /** Parse options */
  options?: WorkerParseOptions;
}

/**
 * Request to cancel an in-progress parse operation.
 */
export interface CancelRequestMessage extends WorkerMessageBase {
  type: 'cancel';
  /** ID of the parse request to cancel */
  parseId: string;
}

/**
 * Request to terminate the worker.
 */
export interface TerminateRequestMessage extends WorkerMessageBase {
  type: 'terminate';
}

/**
 * All possible messages from main thread to worker.
 */
export type WorkerInboundMessage =
  | ParseRequestMessage
  | CancelRequestMessage
  | TerminateRequestMessage;

// =============================================================================
// Message Types: Worker -> Main Thread
// =============================================================================

/**
 * Base interface for all messages from the worker.
 */
export interface WorkerResponseBase {
  /** ID of the original request */
  id: string;
  /** Message type discriminator */
  type: string;
}

/**
 * Progress update during parsing.
 */
export interface ProgressMessage extends WorkerResponseBase {
  type: 'progress';
  /** Current progress state */
  progress: ParseProgress;
}

/**
 * Successful parse result.
 */
export interface ParseSuccessMessage extends WorkerResponseBase {
  type: 'success';
  /** Parsed workbook result */
  result: FullParseResult;
  /** Time taken in milliseconds */
  parseTimeMs: number;
}

/**
 * Parse error result.
 */
export interface ParseErrorMessage extends WorkerResponseBase {
  type: 'error';
  /** Error code */
  code: ParseErrorCode;
  /** Error message */
  message: string;
  /** Stack trace if available */
  stack?: string;
}

/**
 * Parse was cancelled.
 */
export interface ParseCancelledMessage extends WorkerResponseBase {
  type: 'cancelled';
}

/**
 * Worker is ready to accept requests.
 */
export interface ReadyMessage extends WorkerResponseBase {
  type: 'ready';
  /** Worker version */
  version: string;
  /** Supported features */
  capabilities: WorkerCapabilities;
}

/**
 * All possible messages from worker to main thread.
 */
export type WorkerOutboundMessage =
  | ProgressMessage
  | ParseSuccessMessage
  | ParseErrorMessage
  | ParseCancelledMessage
  | ReadyMessage;

// =============================================================================
// Worker Configuration
// =============================================================================

/**
 * Parse options that can be passed to the worker.
 * Extends FullParseOptions but without callback functions
 * (which can't be transferred to workers).
 */
export interface WorkerParseOptions extends Omit<FullParseOptions, 'onProgress'> {
  /**
   * Whether to report progress.
   * If true, the worker will send ProgressMessage updates.
   * @default true
   */
  reportProgress?: boolean;

  /**
   * Minimum interval between progress updates (ms).
   * @default 50
   */
  progressIntervalMs?: number;
}

/**
 * Worker capabilities reported on initialization.
 */
export interface WorkerCapabilities {
  /** WebAssembly is supported */
  wasmSupported: boolean;
  /** WASM SIMD is supported */
  simdSupported: boolean;
  /** SharedArrayBuffer is available */
  sharedArrayBufferSupported: boolean;
}

// =============================================================================
// Worker Client Types
// =============================================================================

/**
 * Options for creating a worker-based parser.
 */
export interface WorkerParserOptions {
  /**
   * Path to the worker script.
   * @default Attempts to find bundled worker
   */
  workerUrl?: string | URL;

  /**
   * Use a shared worker instead of dedicated worker.
   * Useful for multiple tabs sharing the same parser.
   * @default false
   */
  shared?: boolean;

  /**
   * Maximum time to wait for worker to be ready (ms).
   * @default 5000
   */
  initTimeoutMs?: number;
}

/**
 * Handle to an active parse operation.
 */
export interface ParseHandle {
  /** Promise that resolves with the parse result */
  promise: Promise<FullParseResult>;

  /** Cancel the parse operation */
  cancel(): void;

  /** Whether the operation is still in progress */
  readonly isActive: boolean;

  /** The request ID */
  readonly id: string;
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Generate a unique message ID.
 */
export function generateMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Type guard for ParseSuccessMessage.
 */
export function isParseSuccess(msg: WorkerOutboundMessage): msg is ParseSuccessMessage {
  return msg.type === 'success';
}

/**
 * Type guard for ParseErrorMessage.
 */
export function isParseError(msg: WorkerOutboundMessage): msg is ParseErrorMessage {
  return msg.type === 'error';
}

/**
 * Type guard for ProgressMessage.
 */
export function isProgress(msg: WorkerOutboundMessage): msg is ProgressMessage {
  return msg.type === 'progress';
}

/**
 * Type guard for ParseCancelledMessage.
 */
export function isCancelled(msg: WorkerOutboundMessage): msg is ParseCancelledMessage {
  return msg.type === 'cancelled';
}

/**
 * Type guard for ReadyMessage.
 */
export function isReady(msg: WorkerOutboundMessage): msg is ReadyMessage {
  return msg.type === 'ready';
}

// =============================================================================
// Error Handling
// =============================================================================

/**
 * Create an error message from an Error object.
 */
export function createErrorMessage(id: string, error: Error): ParseErrorMessage {
  // Try to extract error code from XlsxParseError
  let code: ParseErrorCode = ParseErrorCode.ParseError;
  if ('code' in error && typeof error.code === 'string') {
    // Check if it's a valid ParseErrorCode enum value
    const errorCode = error.code as string;
    if (Object.values(ParseErrorCode).includes(errorCode as ParseErrorCode)) {
      code = errorCode as ParseErrorCode;
    }
  }

  return {
    id,
    type: 'error',
    code,
    message: error.message,
    stack: error.stack,
  };
}
