/**
 * MockProviderDoc — TS-side ProviderDoc for conformance tests.
 *
 * The real `ProviderDoc` is wired to a compute-bridge surface that forwards
 * bytes to a yrs Doc inside the compute engine (Rust). The Provider contract
 * ships with a conformance suite without depending
 * on a working bridge, so the bridge work and the Provider work can land in
 * either order.
 *
 * This mock simulates the contract a real ProviderDoc fulfils:
 *   - `applyUpdate(bytes)` — idempotent: re-applying the same update is a
 *     no-op (CRDT property of yrs).
 *   - `currentStateVector()` — encodes "which updates have been applied"
 *     as a deterministic, sortable byte-stream.
 *   - `encodeDiff(remoteSv)` — returns the updates the local doc has that
 *     the `remoteSv`-described remote does not.
 *
 * The byte format is **not** yrs-compatible (no Rust yrs JS port lives in
 * the workspace). It is consistent within itself: a MockProviderDoc that
 * applies updates emitted by another MockProviderDoc converges to the same
 * state vector. That's all the conformance suite needs.
 *
 * **Reusable.** IndexedDBProvider and TauriFileProvider tests build on this
 * mock. Don't rewrite — extend if a Provider variant needs richer simulation.
 */

/**
 * Compute a deterministic 128-bit fingerprint of an update's bytes. We use
 * a simple FNV-1a 64-bit hash, doubled, because:
 *   - yrs-correctness is not the goal; collision-resistance over distinct
 *     conformance updates is sufficient.
 *   - 128 bits is plenty of headroom against the 100-update FIFO row.
 *   - No external crypto dependency (works under jsdom + node test env).
 */
function fingerprint(bytes: Uint8Array): bigint {
  // FNV-1a 64-bit. Two independent seeds give us 128 bits when concatenated.
  const FNV_PRIME = 0x100000001b3n;
  const MASK_64 = 0xffffffffffffffffn;

  let h1 = 0xcbf29ce484222325n;
  let h2 = 0x84222325cbf29ce4n;

  for (let i = 0; i < bytes.length; i++) {
    h1 = ((h1 ^ BigInt(bytes[i] ?? 0)) * FNV_PRIME) & MASK_64;
    // Rotate the second seed against the byte index to decorrelate from h1.
    h2 = ((h2 ^ BigInt((bytes[i] ?? 0) ^ (i & 0xff))) * FNV_PRIME) & MASK_64;
  }

  return (h1 << 64n) | h2;
}

/**
 * Encode a sorted set of update-fingerprints as a single byte stream, for
 * use as a state vector. Sorting makes encoding canonical: two MockProviderDocs
 * that have applied the same set of updates always produce identical SV bytes,
 * regardless of arrival order.
 */
function encodeStateVector(fingerprints: Set<bigint>): Uint8Array {
  const sorted = Array.from(fingerprints).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  // 16 bytes per fingerprint (128 bits).
  const out = new Uint8Array(sorted.length * 16);
  for (let i = 0; i < sorted.length; i++) {
    let fp = sorted[i] ?? 0n;
    for (let j = 15; j >= 0; j--) {
      out[i * 16 + j] = Number(fp & 0xffn);
      fp >>= 8n;
    }
  }
  return out;
}

/**
 * Decode a state vector back into the fingerprint set it encodes.
 * Inverse of `encodeStateVector`.
 */
function decodeStateVector(sv: Uint8Array): Set<bigint> {
  const out = new Set<bigint>();
  if (sv.length === 0) return out;
  if (sv.length % 16 !== 0) {
    throw new Error(
      `MockProviderDoc.decodeStateVector: invalid length ${sv.length}, expected multiple of 16`,
    );
  }
  for (let i = 0; i < sv.length; i += 16) {
    let fp = 0n;
    for (let j = 0; j < 16; j++) {
      fp = (fp << 8n) | BigInt(sv[i + j] ?? 0);
    }
    out.add(fp);
  }
  return out;
}

/**
 * Encode N updates as a single byte stream. Format:
 *   [4-byte big-endian length][update bytes]...
 *
 * Inverse of `decodeUpdateBatch`. Used by `encodeDiff` to pack the
 * "missing" updates into one Uint8Array.
 */
function encodeUpdateBatch(updates: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const u of updates) total += 4 + u.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const u of updates) {
    const len = u.length;
    out[off + 0] = (len >>> 24) & 0xff;
    out[off + 1] = (len >>> 16) & 0xff;
    out[off + 2] = (len >>> 8) & 0xff;
    out[off + 3] = len & 0xff;
    off += 4;
    out.set(u, off);
    off += len;
  }
  return out;
}

/**
 * Inverse of `encodeUpdateBatch`. Used by `applyUpdate` to ingest a
 * batch produced by `encodeDiff`.
 */
function decodeUpdateBatch(batch: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let off = 0;
  while (off < batch.length) {
    if (off + 4 > batch.length) {
      throw new Error('MockProviderDoc.decodeUpdateBatch: truncated header');
    }
    const len =
      ((batch[off + 0] ?? 0) << 24) |
      ((batch[off + 1] ?? 0) << 16) |
      ((batch[off + 2] ?? 0) << 8) |
      (batch[off + 3] ?? 0);
    off += 4;
    if (off + len > batch.length) {
      throw new Error('MockProviderDoc.decodeUpdateBatch: truncated payload');
    }
    out.push(batch.slice(off, off + len));
    off += len;
  }
  return out;
}

/**
 * Marker prefix byte used by `applyUpdate` to detect a batch (output of
 * `encodeDiff`) vs. a single raw update. Single-byte prefix; if a producer
 * happens to emit raw updates that begin with this byte, they'll still
 * round-trip correctly because the alternative parse path treats the rest
 * as a single update with no batch wrapper.
 */
const BATCH_MARKER = 0xfb;

/**
 * Wrap a batch payload with the marker byte so `applyUpdate` can
 * distinguish "I'm being given an `encodeDiff` output" from "I'm being
 * given one raw update."
 */
function wrapBatch(batch: Uint8Array): Uint8Array {
  const out = new Uint8Array(batch.length + 1);
  out[0] = BATCH_MARKER;
  out.set(batch, 1);
  return out;
}

/**
 * Reusable, dependency-free `ProviderDoc` for conformance and Provider tests.
 *
 * Real ProviderDocs (built on the compute bridge) wrap a yrs Doc; this mock
 * holds an in-memory `Map<fingerprint, bytes>`. Functionally equivalent
 * for the conformance suite's purposes.
 */
export class MockProviderDoc {
  readonly docId: string;

  /**
   * Map from update-fingerprint → exact bytes. Insertion order is preserved
   * so `replayApplied` can hand updates back in the order they arrived (for
   * Provider tests that care about FIFO).
   */
  private readonly applied: Map<bigint, Uint8Array> = new Map();

  constructor(docId: string) {
    this.docId = docId;
  }

  /**
   * Apply one update or a batch (the wrapped output of `encodeDiff`).
   * Idempotent — re-applying any input is a no-op.
   */
  async applyUpdate(update: Uint8Array): Promise<void> {
    if (update.length === 0) return;

    if (update[0] === BATCH_MARKER) {
      // Treat as a batch produced by encodeDiff.
      const inner = update.slice(1);
      const items = decodeUpdateBatch(inner);
      for (const item of items) {
        this.applyOne(item);
      }
      return;
    }

    this.applyOne(update);
  }

  /** Internal: apply a single raw update (idempotent). */
  private applyOne(update: Uint8Array): void {
    const fp = fingerprint(update);
    if (this.applied.has(fp)) return;
    // Defensive copy — Provider implementations may reuse the input buffer.
    this.applied.set(fp, new Uint8Array(update));
  }

  async encodeDiff(remoteSv: Uint8Array): Promise<Uint8Array> {
    const remoteFps = decodeStateVector(remoteSv);
    const missing: Uint8Array[] = [];
    for (const [fp, bytes] of this.applied) {
      if (!remoteFps.has(fp)) missing.push(bytes);
    }
    return wrapBatch(encodeUpdateBatch(missing));
  }

  async currentStateVector(): Promise<Uint8Array> {
    return encodeStateVector(new Set(this.applied.keys()));
  }

  /**
   * Test helper: number of distinct updates currently applied.
   * Not part of the ProviderDoc interface — used only by conformance
   * assertions to verify state convergence after a reattach.
   */
  appliedCount(): number {
    return this.applied.size;
  }

  /**
   * Test helper: list applied updates in insertion order.
   * Not part of the ProviderDoc interface.
   */
  appliedInOrder(): Uint8Array[] {
    return Array.from(this.applied.values());
  }
}

/**
 * Build a fresh MockProviderDoc keyed by `docId`. Convenience factory used
 * by `runProviderConformance(factory, buildProviderDoc)`.
 */
export function buildMockProviderDoc(docId: string): MockProviderDoc {
  return new MockProviderDoc(docId);
}

/**
 * Build a deterministic Uint8Array update payload from a numeric seed.
 * Conformance assertions need to reproduce the exact bytes a Provider
 * persisted; this lets tests say "produce update #7" without coupling to
 * any internal hashing.
 */
export function makeUpdate(seed: number, sizeBytes = 8): Uint8Array {
  const out = new Uint8Array(sizeBytes);
  let s = seed >>> 0;
  for (let i = 0; i < sizeBytes; i++) {
    // xorshift32 — deterministic, well-distributed, no library cost.
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    out[i] = s & 0xff;
  }
  // Force the first byte to never collide with the batch-marker (0xFB).
  // Otherwise applyUpdate would mis-classify a raw update as a batch.
  if (out[0] === 0xfb) out[0] = 0x01;
  return out;
}
