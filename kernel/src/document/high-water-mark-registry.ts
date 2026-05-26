/**
 * HighWaterMarkProofRegistry — issues and validates export-authorization proofs.
 *
 * The registry is the authority for proof lifecycle: issue, validate, consume.
 * Proofs are single-use by default (consumed on first successful validation)
 * or session-scoped (consumed only when explicitly revoked).
 *
 * structural validation only (proofId lookup, field matching, expiry).
 * The `payloadHash` field uses SHA-256 when crypto.subtle is available,
 * falling back to a deterministic FNV-1a hash for Node/test environments.
 * The reserved `signature` field can carry MAC/signature data when needed.
 */

import type {
  HighWaterMarkProof,
  HighWaterMarkProofRequest,
  HighWaterMarkSnapshot,
  ProofValidationError,
  ProofValidationResult,
} from '@mog-sdk/contracts/storage';
import type { WriteGate } from './write-gate';

const DEFAULT_EXPIRY_MS = 30_000;

interface StoredProof {
  proof: HighWaterMarkProof;
  consumed: boolean;
}

export class HighWaterMarkProofRegistry {
  private readonly proofs = new Map<string, StoredProof>();
  private readonly writeGate: WriteGate;

  constructor(writeGate: WriteGate) {
    this.writeGate = writeGate;
  }

  async issueProof(
    request: HighWaterMarkProofRequest,
    providerOriginWatermarks: Record<string, number> = {},
    pendingAssetCount = 0,
  ): Promise<HighWaterMarkProof> {
    const proofId = generateProofId();
    const snapshot = this.writeGate.captureHighWaterMark(
      providerOriginWatermarks,
      pendingAssetCount,
    );
    const expiryMs = request.expiryMs ?? DEFAULT_EXPIRY_MS;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiryMs);

    const canonicalPayload = buildCanonicalPayload(snapshot, request.sessionId, proofId);
    const payloadHash = await computeHash(canonicalPayload);

    const proof: HighWaterMarkProof = {
      proofId,
      sessionId: request.sessionId,
      snapshot,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      payloadHash,
    };

    this.proofs.set(proofId, { proof, consumed: false });
    return proof;
  }

  validateProof(
    proofId: string,
    sessionId: string,
    currentSnapshot?: HighWaterMarkSnapshot,
  ): ProofValidationResult {
    const stored = this.proofs.get(proofId);
    if (!stored) {
      return { valid: false, error: { code: 'PROOF_NOT_FOUND', proofId } };
    }

    const { proof, consumed } = stored;

    if (consumed) {
      return { valid: false, error: { code: 'PROOF_ALREADY_CONSUMED', proofId } };
    }

    if (proof.sessionId !== sessionId) {
      return {
        valid: false,
        error: {
          code: 'PROOF_SESSION_MISMATCH',
          proofId,
          expected: proof.sessionId,
          got: sessionId,
        },
      };
    }

    if (new Date(proof.expiresAt).getTime() < Date.now()) {
      return {
        valid: false,
        error: { code: 'PROOF_EXPIRED', proofId, expiresAt: proof.expiresAt },
      };
    }

    if (currentSnapshot) {
      if (currentSnapshot.mutationWatermark !== proof.snapshot.mutationWatermark) {
        return {
          valid: false,
          error: { code: 'PROOF_SNAPSHOT_MISMATCH', proofId, field: 'mutationWatermark' },
        };
      }
      if (currentSnapshot.inboundBarrierActive) {
        return {
          valid: false,
          error: { code: 'PROOF_SNAPSHOT_MISMATCH', proofId, field: 'inboundBarrierActive' },
        };
      }
    }

    return { valid: true };
  }

  consumeProof(proofId: string, sessionId: string): ProofValidationResult {
    const result = this.validateProof(proofId, sessionId);
    if (result.valid) {
      const stored = this.proofs.get(proofId)!;
      stored.consumed = true;
    }
    return result;
  }

  revokeProof(proofId: string): boolean {
    return this.proofs.delete(proofId);
  }

  /** Remove all expired proofs. Called periodically or before issuance. */
  pruneExpired(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [id, { proof }] of this.proofs) {
      if (new Date(proof.expiresAt).getTime() < now) {
        this.proofs.delete(id);
        pruned++;
      }
    }
    return pruned;
  }

  get size(): number {
    return this.proofs.size;
  }
}

// ---------------------------------------------------------------------------
// Canonical payload + hashing
// ---------------------------------------------------------------------------

function buildCanonicalPayload(
  snapshot: HighWaterMarkSnapshot,
  sessionId: string,
  proofId: string,
): string {
  const obj = {
    proofId,
    sessionId,
    snapshot: {
      inboundBarrierActive: snapshot.inboundBarrierActive,
      mutationWatermark: snapshot.mutationWatermark,
      pendingAssetCount: snapshot.pendingAssetCount,
      providerOriginWatermarks: sortedObject(snapshot.providerOriginWatermarks),
    },
  };
  return JSON.stringify(obj);
}

function sortedObject(obj: Record<string, number>): Record<string, number> {
  const sorted: Record<string, number> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return sorted;
}

async function computeHash(input: string): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest === 'function') {
    const data = new TextEncoder().encode(input);
    const buf = await globalThis.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return fnv1aHex(input);
}

/** FNV-1a 64-bit (emulated via two 32-bit halves) for environments without crypto.subtle. */
function fnv1aHex(str: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ (c & 0xff), 0x01000193);
    h2 = Math.imul(h2 ^ ((c >> 8) & 0xff), 0x01000193);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

function generateProofId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
