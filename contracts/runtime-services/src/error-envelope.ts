/**
 * Categorizes errors into a fixed set of buckets so consumers can decide
 * retry strategy, user-facing messaging, and alerting severity without
 * parsing free-text messages.
 */
export type RuntimeErrorCategory =
  | 'auth'
  | 'permission'
  | 'not-found'
  | 'conflict'
  | 'validation'
  | 'quota'
  | 'unsupported'
  | 'runtime'
  | 'internal';

/**
 * Uniform error shape returned by every Mog runtime service.
 *
 * All service boundaries serialize failures into this envelope so that
 * clients, proxies, and observability tooling share a single schema.
 */
export interface RuntimeErrorEnvelope {
  /** Machine-readable error code (e.g. `"DOCUMENT_LOCKED"`, `"QUOTA_EXCEEDED"`). */
  code: string;

  /** Human-readable description safe for logging and developer-facing output. */
  message: string;

  /** HTTP status code when the error originated from an HTTP boundary. */
  status?: number;

  /** Correlation id for the originating request. */
  requestId?: string;

  /** Distributed trace id for cross-service correlation. */
  traceId?: string;

  /** Whether the caller should retry this request (with backoff). */
  retryable: boolean;

  /** Broad category for routing retry/alerting logic. */
  category: RuntimeErrorCategory;

  /**
   * Arbitrary structured context for debugging.
   *
   * SECURITY: Must never contain secrets, tokens, credentials, or raw byte
   * content. Services must sanitize before populating.
   */
  details?: Record<string, unknown>;
}
