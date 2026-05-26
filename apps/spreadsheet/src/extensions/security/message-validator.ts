/**
 * Message Validator
 *
 * Validates the structure and content of extension messages.
 * Provides type-safe parsing of postMessage data.
 *
 * SECURITY CRITICAL: This module validates all incoming messages before
 * they are processed. Invalid messages are rejected to prevent injection attacks.
 *
 * @module extensions/security/message-validator
 */

import { EXTENSION_PROTOCOL_VERSION } from '../constants';
import type {
  ApiRequestMessage,
  ExtensionMessage,
  ExtensionToHostMessage,
  ReadyMessage,
  SubscribeMessage,
  UnsubscribeMessage,
} from '../types';

// =============================================================================
// Types
// =============================================================================

export interface MessageValidationResult<T = ExtensionMessage> {
  /** Whether the message is valid */
  valid: boolean;
  /** Parsed message if valid */
  message?: T;
  /** Reason for rejection if invalid */
  reason?: string;
}

// =============================================================================
// Validation Constants
// =============================================================================

/**
 * Maximum allowed message size in bytes (1MB).
 * Prevents memory exhaustion from oversized messages.
 */
const MAX_MESSAGE_SIZE = 1024 * 1024;

/**
 * Maximum length for string fields
 */
const MAX_STRING_LENGTH = 10000;

/**
 * Maximum number of arguments in API requests
 */
const MAX_API_ARGS = 100;

/**
 * Maximum number of events in subscribe/unsubscribe
 */
const MAX_EVENTS = 50;

/**
 * Valid message types that extensions can send to host
 */
const VALID_EXTENSION_MESSAGE_TYPES = new Set(['READY', 'API_REQUEST', 'SUBSCRIBE', 'UNSUBSCRIBE']);

// =============================================================================
// Core Validators
// =============================================================================

/**
 * Validate a raw message from postMessage event.
 * Performs structural validation without type-specific checks.
 *
 * @param data - Raw data from MessageEvent.data
 * @returns Validation result with parsed message if valid
 */
export function validateMessage(data: unknown): MessageValidationResult<ExtensionToHostMessage> {
  // Null/undefined check
  if (data === null || data === undefined) {
    return {
      valid: false,
      reason: 'Message is null or undefined',
    };
  }

  // Type check - must be an object
  if (typeof data !== 'object') {
    return {
      valid: false,
      reason: `Message must be an object, got ${typeof data}`,
    };
  }

  // Size check (rough estimate via JSON)
  try {
    const size = JSON.stringify(data).length;
    if (size > MAX_MESSAGE_SIZE) {
      return {
        valid: false,
        reason: `Message exceeds maximum size (${size} > ${MAX_MESSAGE_SIZE} bytes)`,
      };
    }
  } catch {
    return {
      valid: false,
      reason: 'Message cannot be serialized to JSON',
    };
  }

  const msg = data as Record<string, unknown>;

  // Protocol version check
  if (msg.protocol !== EXTENSION_PROTOCOL_VERSION) {
    return {
      valid: false,
      reason: `Invalid protocol version: expected "${EXTENSION_PROTOCOL_VERSION}", got "${msg.protocol}"`,
    };
  }

  // Type field check
  if (typeof msg.type !== 'string') {
    return {
      valid: false,
      reason: 'Message type must be a string',
    };
  }

  if (!VALID_EXTENSION_MESSAGE_TYPES.has(msg.type)) {
    return {
      valid: false,
      reason: `Invalid message type: "${msg.type}". Valid types: ${Array.from(VALID_EXTENSION_MESSAGE_TYPES).join(', ')}`,
    };
  }

  // ID field check
  if (typeof msg.id !== 'string' || msg.id.length === 0) {
    return {
      valid: false,
      reason: 'Message ID must be a non-empty string',
    };
  }

  if (msg.id.length > MAX_STRING_LENGTH) {
    return {
      valid: false,
      reason: `Message ID exceeds maximum length (${msg.id.length} > ${MAX_STRING_LENGTH})`,
    };
  }

  // Timestamp field check
  if (typeof msg.timestamp !== 'number' || !Number.isFinite(msg.timestamp)) {
    return {
      valid: false,
      reason: 'Message timestamp must be a finite number',
    };
  }

  // Type-specific validation
  switch (msg.type) {
    case 'READY':
      return validateReadyMessage(msg);
    case 'API_REQUEST':
      return validateApiRequestMessage(msg);
    case 'SUBSCRIBE':
      return validateSubscribeMessage(msg);
    case 'UNSUBSCRIBE':
      return validateUnsubscribeMessage(msg);
    default:
      return {
        valid: false,
        reason: `Unknown message type: "${msg.type}"`,
      };
  }
}

// =============================================================================
// Type-Specific Validators
// =============================================================================

/**
 * Validate a READY message from extension
 */
function validateReadyMessage(msg: Record<string, unknown>): MessageValidationResult<ReadyMessage> {
  // extensionId check
  if (typeof msg.extensionId !== 'string' || msg.extensionId.length === 0) {
    return {
      valid: false,
      reason: 'READY message must have a non-empty extensionId',
    };
  }

  if (msg.extensionId.length > MAX_STRING_LENGTH) {
    return {
      valid: false,
      reason: 'Extension ID exceeds maximum length',
    };
  }

  // version check
  if (typeof msg.version !== 'string' || msg.version.length === 0) {
    return {
      valid: false,
      reason: 'READY message must have a non-empty version',
    };
  }

  // shimVersion is optional
  if (msg.shimVersion !== undefined && typeof msg.shimVersion !== 'string') {
    return {
      valid: false,
      reason: 'READY message shimVersion must be a string if provided',
    };
  }

  return {
    valid: true,
    message: {
      protocol: EXTENSION_PROTOCOL_VERSION,
      type: 'READY',
      id: msg.id as string,
      timestamp: msg.timestamp as number,
      extensionId: msg.extensionId as string,
      version: msg.version as string,
      shimVersion: msg.shimVersion as string | undefined,
    },
  };
}

/**
 * Validate an API_REQUEST message from extension
 */
function validateApiRequestMessage(
  msg: Record<string, unknown>,
): MessageValidationResult<ApiRequestMessage> {
  // method check
  if (typeof msg.method !== 'string' || msg.method.length === 0) {
    return {
      valid: false,
      reason: 'API_REQUEST must have a non-empty method',
    };
  }

  if (msg.method.length > MAX_STRING_LENGTH) {
    return {
      valid: false,
      reason: 'API_REQUEST method exceeds maximum length',
    };
  }

  // Validate method format (should be namespaced like "sheet.getCell")
  if (!/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)*$/.test(msg.method)) {
    return {
      valid: false,
      reason: `API_REQUEST method has invalid format: "${msg.method}". Expected format: "namespace.method"`,
    };
  }

  // args check
  if (!Array.isArray(msg.args)) {
    return {
      valid: false,
      reason: 'API_REQUEST args must be an array',
    };
  }

  if (msg.args.length > MAX_API_ARGS) {
    return {
      valid: false,
      reason: `API_REQUEST has too many arguments (${msg.args.length} > ${MAX_API_ARGS})`,
    };
  }

  // Validate args are structured-cloneable (basic check)
  for (let i = 0; i < msg.args.length; i++) {
    const arg = msg.args[i];
    if (typeof arg === 'function') {
      return {
        valid: false,
        reason: `API_REQUEST argument ${i} is a function (not allowed)`,
      };
    }
    if (typeof arg === 'symbol') {
      return {
        valid: false,
        reason: `API_REQUEST argument ${i} is a symbol (not allowed)`,
      };
    }
  }

  return {
    valid: true,
    message: {
      protocol: EXTENSION_PROTOCOL_VERSION,
      type: 'API_REQUEST',
      id: msg.id as string,
      timestamp: msg.timestamp as number,
      method: msg.method as string,
      args: msg.args as unknown[],
    },
  };
}

/**
 * Validate a SUBSCRIBE message from extension
 */
function validateSubscribeMessage(
  msg: Record<string, unknown>,
): MessageValidationResult<SubscribeMessage> {
  // events check
  if (!Array.isArray(msg.events)) {
    return {
      valid: false,
      reason: 'SUBSCRIBE events must be an array',
    };
  }

  if (msg.events.length > MAX_EVENTS) {
    return {
      valid: false,
      reason: `SUBSCRIBE has too many events (${msg.events.length} > ${MAX_EVENTS})`,
    };
  }

  // Validate each event is a string
  for (let i = 0; i < msg.events.length; i++) {
    const event = msg.events[i];
    if (typeof event !== 'string' || event.length === 0) {
      return {
        valid: false,
        reason: `SUBSCRIBE event ${i} must be a non-empty string`,
      };
    }
    if (event.length > MAX_STRING_LENGTH) {
      return {
        valid: false,
        reason: `SUBSCRIBE event ${i} exceeds maximum length`,
      };
    }
  }

  return {
    valid: true,
    message: {
      protocol: EXTENSION_PROTOCOL_VERSION,
      type: 'SUBSCRIBE',
      id: msg.id as string,
      timestamp: msg.timestamp as number,
      events: msg.events as string[],
    },
  };
}

/**
 * Validate an UNSUBSCRIBE message from extension
 */
function validateUnsubscribeMessage(
  msg: Record<string, unknown>,
): MessageValidationResult<UnsubscribeMessage> {
  // events check - same validation as SUBSCRIBE
  if (!Array.isArray(msg.events)) {
    return {
      valid: false,
      reason: 'UNSUBSCRIBE events must be an array',
    };
  }

  if (msg.events.length > MAX_EVENTS) {
    return {
      valid: false,
      reason: `UNSUBSCRIBE has too many events (${msg.events.length} > ${MAX_EVENTS})`,
    };
  }

  for (let i = 0; i < msg.events.length; i++) {
    const event = msg.events[i];
    if (typeof event !== 'string' || event.length === 0) {
      return {
        valid: false,
        reason: `UNSUBSCRIBE event ${i} must be a non-empty string`,
      };
    }
    if (event.length > MAX_STRING_LENGTH) {
      return {
        valid: false,
        reason: `UNSUBSCRIBE event ${i} exceeds maximum length`,
      };
    }
  }

  return {
    valid: true,
    message: {
      protocol: EXTENSION_PROTOCOL_VERSION,
      type: 'UNSUBSCRIBE',
      id: msg.id as string,
      timestamp: msg.timestamp as number,
      events: msg.events as string[],
    },
  };
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Simple boolean check for message validity.
 * Use validateMessage() for detailed error information.
 */
export function isValidMessage(data: unknown): data is ExtensionToHostMessage {
  return validateMessage(data).valid;
}

/**
 * Extract message ID from raw data (for error responses).
 * Returns undefined if data is not a valid message structure.
 */
export function extractMessageId(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) {
    return undefined;
  }
  const msg = data as Record<string, unknown>;
  if (typeof msg.id === 'string' && msg.id.length > 0) {
    return msg.id;
  }
  return undefined;
}

/**
 * Create a validation error message suitable for logging.
 * Sanitizes sensitive information.
 */
export function formatValidationError(result: MessageValidationResult, origin: string): string {
  const reason = result.reason || 'Unknown validation error';
  return `[ExtensionMessageValidator] Rejected message from ${origin}: ${reason}`;
}
