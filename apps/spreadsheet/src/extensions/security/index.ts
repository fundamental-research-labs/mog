/**
 * Security Module
 *
 * Exports all security-related utilities for extension communication.
 *
 * @module extensions/security
 */

// Origin validation
export {
  clearOriginCache,
  getTrustedOriginsList,
  isValidExtensionOrigin,
  validateExtensionOrigin,
  validateHostOrigin,
  type OriginValidationResult,
} from './origin-validator';

// Message validation
export {
  extractMessageId,
  formatValidationError,
  isValidMessage,
  validateMessage,
  type MessageValidationResult,
} from './message-validator';
