/**
 * @mog-sdk/embed/iframe — Iframe communication layer for embedded Mog.
 *
 * @stability public-experimental
 * @remarks
 * This entrypoint is a Current public transport surface. It exposes the
 * versioned postMessage protocol and the parent/child handles; callers still
 * must provide exact origins and host-side source/effective-state policy.
 */

/** @stability public-experimental */
export {
  PROTOCOL_VERSION,
  SUPPORTED_VERSIONS,
  type MogEmbedMessage,
  type MogEmbedMessageType,
  CorrelationTimeoutError,
  VersionMismatchError,
  createMessage,
  isValidMessage,
  validateMessagePayload,
  validateMessageEvent,
  negotiateVersion,
  validateOrigin,
} from './protocol';

/** @stability public-experimental */
export { MogIframeClient, type MogIframeClientOptions, type ParentEventMap } from './parent-client';

/** @stability public-experimental */
export { MogIframeHost, type MogIframeHostOptions } from './child-host';
