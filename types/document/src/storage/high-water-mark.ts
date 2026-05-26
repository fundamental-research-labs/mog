/**
 * High-water mark and barrier types
 *
 * Types for checkpoint proofs, export barriers, origin watermarks,
 * and asset state tracking.
 */

// =============================================================================
// Inbound Barrier Proof
// =============================================================================

export interface InboundBarrierProof {
  readonly policy:
    | 'pause-subscriptions'
    | 'queue-behind-barrier'
    | 'include-delivered'
    | 'fail-or-degrade';
  readonly result: 'quiescent' | 'queued' | 'included' | 'degraded' | 'failed';
  readonly issuedAt: number;
}

// =============================================================================
// Provider Origin Watermark
// =============================================================================

export interface ProviderOriginWatermark {
  readonly providerRefId: string;
  readonly providerEpoch: string;
  readonly lastAppliedUpdateId?: string;
  readonly lastAppliedSequence?: string;
  readonly storageCursor?: string;
}

// =============================================================================
// Provider Barrier Receipt
// =============================================================================

export interface ProviderBarrierReceipt {
  readonly providerRefId: string;
  readonly providerEpoch: string;
  readonly serverSequenceOrCursor?: string;
  readonly pauseOrQueueAck: 'paused' | 'queued' | 'not-supported';
  readonly lastDeliveredUpdateId?: string;
  readonly lastServerAcceptedIncluded?: string;
  readonly serverAcceptedButNotDeliveredPolicy:
    | 'excluded'
    | 'queued'
    | 'included'
    | 'fail-or-degrade';
  readonly transportState: 'subscribed' | 'paused' | 'draining' | 'closed' | 'unknown';
  readonly issuedAt: number;
  readonly expiresAt?: number;
  readonly proofBytesOrRef: string;
}

// =============================================================================
// High-Water Asset State Proof
// =============================================================================

export interface HighWaterAssetStateProof {
  readonly reachableAssetManifestFingerprint: string;
  readonly assetProviderCursors: readonly AssetProviderCursor[];
  readonly reachableContentFingerprints: readonly string[];
  readonly pendingAssetTransactions: readonly string[];
  readonly tombstoneGcCursor?: string;
  readonly redactedPublishAssetEligibilityFingerprint?: string;
  readonly unresolvedInboundAssetDependencies: readonly string[];
}

// =============================================================================
// Asset Provider Cursor
// =============================================================================

export interface AssetProviderCursor {
  readonly providerRefId: string;
  readonly cursor: string;
}

// =============================================================================
// High-Water Mark Snapshot (Track B — proof system)
// =============================================================================

export interface HighWaterMarkSnapshot {
  /** Monotonic mutation counter from the write gate. */
  mutationWatermark: number;
  /** Per-provider origin watermarks at capture time. */
  providerOriginWatermarks: Record<string, number>;
  /** Whether an inbound barrier (replay/hydration) was active at capture. */
  inboundBarrierActive: boolean;
  /** Number of assets pending materialization at capture time. */
  pendingAssetCount: number;
}

export interface HighWaterMarkProofRequest {
  /** Caller-chosen session identifier for scoping the proof. */
  sessionId: string;
  /** Requested proof lifetime in milliseconds. Default: 30_000. */
  expiryMs?: number;
}

export interface HighWaterMarkProof {
  /** Unique identifier for this proof instance. */
  proofId: string;
  /** Session that requested this proof. */
  sessionId: string;
  /** Captured watermark snapshot at issuance time. */
  snapshot: HighWaterMarkSnapshot;
  /** ISO-8601 timestamp when this proof was issued. */
  issuedAt: string;
  /** ISO-8601 timestamp when this proof expires. */
  expiresAt: string;
  /** SHA-256 hex digest of the canonical payload (sorted-key JSON). */
  payloadHash: string;
  /** Reserved for future MAC/signature. */
  signature?: string;
}

export type ProofValidationError =
  | { code: 'PROOF_NOT_FOUND'; proofId: string }
  | { code: 'PROOF_EXPIRED'; proofId: string; expiresAt: string }
  | { code: 'PROOF_SESSION_MISMATCH'; proofId: string; expected: string; got: string }
  | { code: 'PROOF_ALREADY_CONSUMED'; proofId: string }
  | { code: 'PROOF_SNAPSHOT_MISMATCH'; proofId: string; field: string }
  | { code: 'EXPORT_BLOCKED_NO_PROOF' };

export interface ProofValidationResult {
  valid: boolean;
  error?: ProofValidationError;
}
