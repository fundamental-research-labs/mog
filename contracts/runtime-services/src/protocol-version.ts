/** Semantic version for protocol negotiation between services. */
export interface ProtocolVersion {
  major: number;
  minor: number;
  patch: number;
}

/** Result of a protocol version compatibility check. */
export type CompatibilityStatus = 'compatible' | 'upgrade-required' | 'incompatible';

/** Outcome of checking two protocol versions against each other. */
export interface CompatibilityResult {
  status: CompatibilityStatus;

  /** Human-readable explanation when status is not `"compatible"`. */
  reason?: string;

  /** The minimum version the peer must upgrade to (when `"upgrade-required"`). */
  minimumRequired?: ProtocolVersion;
}

/**
 * Cross-boundary handshake envelope exchanged when two services first connect.
 *
 * Each side advertises its protocol version so the receiver can decide
 * whether to proceed, request an upgrade, or reject the connection.
 */
export interface ProtocolHandshake {
  /** The protocol version offered by the sender. */
  version: ProtocolVersion;

  /** Service name of the sender. */
  service: string;

  /** Capabilities the sender supports (extensible feature flags). */
  capabilities?: string[];

  /** ISO-8601 timestamp of the handshake initiation. */
  timestamp: string;
}
