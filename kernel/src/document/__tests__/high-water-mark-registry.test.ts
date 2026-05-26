import { WriteGate } from '../write-gate';
import { HighWaterMarkProofRegistry } from '../high-water-mark-registry';
import { HostOperationGate } from '../host-operation-gate';

describe('HighWaterMarkProofRegistry', () => {
  let gate: WriteGate;
  let registry: HighWaterMarkProofRegistry;

  beforeEach(() => {
    gate = new WriteGate();
    registry = new HighWaterMarkProofRegistry(gate);
  });

  it('issues a proof with the current watermark snapshot', async () => {
    gate.recordMutation();
    gate.recordMutation();

    const proof = await registry.issueProof({ sessionId: 'sess-1' });

    expect(proof.proofId).toBeTruthy();
    expect(proof.sessionId).toBe('sess-1');
    expect(proof.snapshot.mutationWatermark).toBe(2);
    expect(proof.snapshot.inboundBarrierActive).toBe(false);
    expect(proof.payloadHash).toBeTruthy();
    expect(new Date(proof.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('validates a valid proof', async () => {
    const proof = await registry.issueProof({ sessionId: 'sess-1' });
    const result = registry.validateProof(proof.proofId, 'sess-1');
    expect(result.valid).toBe(true);
  });

  it('rejects an unknown proofId', () => {
    const result = registry.validateProof('nonexistent', 'sess-1');
    expect(result.valid).toBe(false);
    expect(result.error!.code).toBe('PROOF_NOT_FOUND');
  });

  it('rejects a session mismatch', async () => {
    const proof = await registry.issueProof({ sessionId: 'sess-1' });
    const result = registry.validateProof(proof.proofId, 'sess-other');
    expect(result.valid).toBe(false);
    expect(result.error!.code).toBe('PROOF_SESSION_MISMATCH');
  });

  it('rejects an expired proof', async () => {
    const proof = await registry.issueProof({ sessionId: 'sess-1', expiryMs: 1 });
    await new Promise((r) => setTimeout(r, 10));
    const result = registry.validateProof(proof.proofId, 'sess-1');
    expect(result.valid).toBe(false);
    expect(result.error!.code).toBe('PROOF_EXPIRED');
  });

  it('consumeProof marks the proof as consumed (single-use)', async () => {
    const proof = await registry.issueProof({ sessionId: 'sess-1' });

    const first = registry.consumeProof(proof.proofId, 'sess-1');
    expect(first.valid).toBe(true);

    const second = registry.consumeProof(proof.proofId, 'sess-1');
    expect(second.valid).toBe(false);
    expect(second.error!.code).toBe('PROOF_ALREADY_CONSUMED');
  });

  it('revokeProof removes the proof from the registry', async () => {
    const proof = await registry.issueProof({ sessionId: 'sess-1' });
    expect(registry.size).toBe(1);

    registry.revokeProof(proof.proofId);
    expect(registry.size).toBe(0);

    const result = registry.validateProof(proof.proofId, 'sess-1');
    expect(result.valid).toBe(false);
    expect(result.error!.code).toBe('PROOF_NOT_FOUND');
  });

  it('pruneExpired removes only expired proofs', async () => {
    await registry.issueProof({ sessionId: 'sess-1', expiryMs: 1 });
    await registry.issueProof({ sessionId: 'sess-2', expiryMs: 60_000 });
    await new Promise((r) => setTimeout(r, 10));

    const pruned = registry.pruneExpired();
    expect(pruned).toBe(1);
    expect(registry.size).toBe(1);
  });

  it('rejects when inboundBarrier is active at validation time', async () => {
    const proof = await registry.issueProof({ sessionId: 'sess-1' });
    gate.setInboundBarrier(true);

    const currentSnapshot = gate.captureHighWaterMark();
    const result = registry.validateProof(proof.proofId, 'sess-1', currentSnapshot);
    expect(result.valid).toBe(false);
    expect(result.error!.code).toBe('PROOF_SNAPSHOT_MISMATCH');
  });

  it('rejects when mutation watermark has advanced since proof issuance', async () => {
    const proof = await registry.issueProof({ sessionId: 'sess-1' });
    gate.recordMutation();

    const currentSnapshot = gate.captureHighWaterMark();
    const result = registry.validateProof(proof.proofId, 'sess-1', currentSnapshot);
    expect(result.valid).toBe(false);
    expect(result.error!.code).toBe('PROOF_SNAPSHOT_MISMATCH');
  });
});

describe('HostOperationGate', () => {
  let writeGate: WriteGate;
  let registry: HighWaterMarkProofRegistry;
  let hostGate: HostOperationGate;

  beforeEach(() => {
    writeGate = new WriteGate();
    registry = new HighWaterMarkProofRegistry(writeGate);
    hostGate = new HostOperationGate(registry, writeGate);
  });

  it('authorizes export with a valid proof', async () => {
    const proof = await registry.issueProof({ sessionId: 'sess-1' });
    const result = hostGate.authorizeExport({ proofId: proof.proofId, sessionId: 'sess-1' });
    expect(result.authorized).toBe(true);
  });

  it('blocks export with no proofId', () => {
    const result = hostGate.authorizeExport({ proofId: '', sessionId: 'sess-1' });
    expect(result.authorized).toBe(false);
    expect(result.error!.code).toBe('EXPORT_BLOCKED_NO_PROOF');
  });

  it('blocks export after proof is consumed', async () => {
    const proof = await registry.issueProof({ sessionId: 'sess-1' });
    hostGate.authorizeExport({ proofId: proof.proofId, sessionId: 'sess-1' });
    const result = hostGate.authorizeExport({ proofId: proof.proofId, sessionId: 'sess-1' });
    expect(result.authorized).toBe(false);
    expect(result.error!.code).toBe('PROOF_ALREADY_CONSUMED');
  });

  it('authorizeExportImmediate issues and consumes in one call', async () => {
    const result = await hostGate.authorizeExportImmediate('sess-1');
    expect(result.authorized).toBe(true);
    expect(registry.size).toBe(1);
  });
});

describe('WriteGate', () => {
  it('tracks mutation watermark', () => {
    const gate = new WriteGate();
    expect(gate.currentWatermark).toBe(0);
    gate.recordMutation();
    gate.recordMutation();
    expect(gate.currentWatermark).toBe(2);
  });

  it('tracks inbound barrier state', () => {
    const gate = new WriteGate();
    expect(gate.inboundBarrierActive).toBe(false);
    gate.setInboundBarrier(true);
    expect(gate.inboundBarrierActive).toBe(true);
  });

  it('captureHighWaterMark returns a snapshot', () => {
    const gate = new WriteGate();
    gate.recordMutation();
    const snap = gate.captureHighWaterMark({ idb: 5 }, 2);
    expect(snap.mutationWatermark).toBe(1);
    expect(snap.providerOriginWatermarks).toEqual({ idb: 5 });
    expect(snap.pendingAssetCount).toBe(2);
    expect(snap.inboundBarrierActive).toBe(false);
  });
});
