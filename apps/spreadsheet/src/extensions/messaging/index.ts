/**
 * Extension Messaging Module
 *
 * Provides the infrastructure for secure postMessage communication
 * between the host and extensions.
 *
 * @module extensions/messaging
 */

// Request Tracker
export {
  RequestTimeoutError,
  RequestTracker,
  RequestTrackerError,
  TooManyRequestsError,
  createRequestTracker,
  type RequestTrackerOptions,
  type RequestTrackerStats,
  type TrackRequestOptions,
} from './RequestTracker';

// Message Bridge
export {
  MessageBridge,
  MessageBridgeError,
  OriginValidationError,
  RateLimitError,
  createMessageBridge,
  type MessageBridgeOptions,
  type MessageBridgeStats,
  type SendMessageOptions,
} from './MessageBridge';

// Handshake Manager
export {
  HandshakeError,
  HandshakeManager,
  HandshakeTimeoutError,
  HandshakeValidationError,
  createHandshakeManager,
  type HandshakeContext,
  type HandshakeOptions,
  type HandshakeResult,
  type HandshakeState,
} from './HandshakeManager';
