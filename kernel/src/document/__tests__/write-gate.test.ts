import { KernelError } from '../../errors';
import { WriteGate, type GateMode, PHASE_TO_GATE_MODE } from '../write-gate';

function expectWriteRejected(fn: () => void, mode: GateMode, operation: string): void {
  expect(fn).toThrow(KernelError);
  try {
    fn();
    fail('expected write rejection');
  } catch (err) {
    expect(err).toBeInstanceOf(KernelError);
    const rejection = err as KernelError;
    expect(rejection.code).toBe('SCENARIO_ACTIVE_STATE_READ_ONLY');
    expect(rejection.context).toMatchObject({
      mode,
      operation,
    });
  }
}

describe('WriteGate mode enforcement', () => {
  it('starts open and admits public writes', () => {
    const gate = new WriteGate();

    expect(gate.mode).toBe('open');
    expect(gate.allowsPublicMutation()).toBe(true);
    expect(() => gate.assertWritable('setCellValue')).not.toThrow();
  });

  it('checkpointing rejects public writes and reports operation context', () => {
    const gate = new WriteGate();
    const capturedWatermark = gate.enterCheckpointing();

    expect(capturedWatermark).toBe(0);
    expect(gate.mode).toBe('checkpointing');
    expect(gate.allowsPublicMutation()).toBe(false);
    expectWriteRejected(() => gate.assertWritable('setCellValue'), 'checkpointing', 'setCellValue');
  });

  it('closing rejects public writes and reports operation context', () => {
    const gate = new WriteGate();
    gate.enterClosing();

    expect(gate.mode).toBe('closing');
    expect(gate.allowsPublicMutation()).toBe(false);
    expectWriteRejected(() => gate.assertWritable('structureChange'), 'closing', 'structureChange');
  });

  it('closed rejects public writes and bypass writes', () => {
    const gate = new WriteGate();
    gate.enterClosed();

    expect(gate.mode).toBe('closed');
    expect(gate.allowsPublicMutation()).toBe(false);
    gate.enterBypass();
    expect(gate.bypassDepth).toBe(1);
    expect(gate.allowsBypassMutation()).toBe(false);
    expect(gate.allowsPublicMutation()).toBe(false);
    expectWriteRejected(() => gate.assertWritable('syncApply'), 'closed', 'syncApply');
  });
});

describe('WriteGate bypass scopes', () => {
  it('sync bypass admits system writes in checkpointing and restores depth', () => {
    const gate = new WriteGate();
    gate.enterCheckpointing();

    const result = gate.withBypassSync(() => {
      expect(gate.bypassDepth).toBe(1);
      expect(gate.allowsBypassMutation()).toBe(true);
      expect(() => gate.assertWritable('providerReplay')).not.toThrow();
      return 42;
    });

    expect(result).toBe(42);
    expect(gate.bypassDepth).toBe(0);
    expectWriteRejected(() => gate.assertWritable('setCellValue'), 'checkpointing', 'setCellValue');
  });

  it('async bypass admits system writes in closing and restores depth', async () => {
    const gate = new WriteGate();
    gate.enterClosing();

    const result = await gate.withBypass(async () => {
      expect(gate.bypassDepth).toBe(1);
      expect(gate.allowsBypassMutation()).toBe(true);
      expect(() => gate.assertWritable('flushProvider')).not.toThrow();
      return 'done';
    });

    expect(result).toBe('done');
    expect(gate.bypassDepth).toBe(0);
    expectWriteRejected(() => gate.assertWritable('setCellValue'), 'closing', 'setCellValue');
  });

  it('nested bypass scopes maintain depth and restore after exceptions', () => {
    const gate = new WriteGate();
    gate.enterCheckpointing();

    expect(() =>
      gate.withBypassSync(() => {
        expect(gate.bypassDepth).toBe(1);
        gate.withBypassSync(() => {
          expect(gate.bypassDepth).toBe(2);
        });
        expect(gate.bypassDepth).toBe(1);
        throw new Error('boom');
      }),
    ).toThrow('boom');

    expect(gate.bypassDepth).toBe(0);
    expect(gate.allowsPublicMutation()).toBe(false);
  });
});

describe('WriteGate high-water marks', () => {
  it('tracks mutation watermarks monotonically', () => {
    const gate = new WriteGate();

    expect(gate.currentWatermark).toBe(0);
    expect(gate.recordMutation()).toBeUndefined();
    expect(gate.advanceWatermark()).toBe(2);
    expect(gate.watermark).toBe(2);
    expect(gate.currentWatermark).toBe(2);
  });

  it('captures high-water mark snapshots with provider origins and barriers', () => {
    const gate = new WriteGate();
    gate.recordMutation();
    gate.setInboundBarrier(true);

    const snapshot = gate.captureHighWaterMark({ indexedDb: 7 }, 3);

    expect(snapshot).toEqual({
      mutationWatermark: 1,
      providerOriginWatermarks: { indexedDb: 7 },
      inboundBarrierActive: true,
      pendingAssetCount: 3,
    });
  });
});

describe('WriteGate mode transitions', () => {
  it('leaveCheckpointing restores the previous mode', () => {
    const gate = new WriteGate();

    gate.enterClosing();
    gate.enterCheckpointing();
    expect(gate.mode).toBe('checkpointing');

    gate.leaveCheckpointing();
    expect(gate.mode).toBe('closing');
  });

  it('enterClosed is terminal for bypass depth', () => {
    const gate = new WriteGate();
    gate.enterCheckpointing();
    gate.enterBypass();

    gate.enterClosed();

    expect(gate.mode).toBe('closed');
    expect(gate.bypassDepth).toBe(0);
    expect(gate.allowsBypassMutation()).toBe(false);
  });

  it('phase mapping only emits current gate modes', () => {
    expect(PHASE_TO_GATE_MODE).toMatchObject({
      idle: 'closed',
      creating: 'open',
      ready: 'open',
      disposing: 'closing',
      disposed: 'closed',
      error: 'closed',
    });
  });
});
