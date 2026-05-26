/**
 * Write gate enforcement tests — Watermark admission of the storage provider lifecycle plan.
 *
 * Verifies WriteGate mode transitions, watermarks, bypass scopes,
 * and admission control logic.
 */

import { WriteGate } from '../write-gate';

// ---------------------------------------------------------------------------
// WriteGate unit tests
// ---------------------------------------------------------------------------

describe('WriteGate', () => {
  it('starts in open mode with watermark 0', () => {
    const gate = new WriteGate();
    expect(gate.mode).toBe('open');
    expect(gate.watermark).toBe(0);
    expect(gate.allowsPublicMutation()).toBe(true);
  });

  it('advanceWatermark increments monotonically', () => {
    const gate = new WriteGate();
    expect(gate.advanceWatermark()).toBe(1);
    expect(gate.advanceWatermark()).toBe(2);
    expect(gate.advanceWatermark()).toBe(3);
    expect(gate.watermark).toBe(3);
  });

  it('checkpointing mode blocks public mutations', () => {
    const gate = new WriteGate();
    gate.advanceWatermark();
    gate.advanceWatermark();
    const hwm = gate.enterCheckpointing();
    expect(hwm).toBe(2);
    expect(gate.mode).toBe('checkpointing');
    expect(gate.allowsPublicMutation()).toBe(false);
  });

  it('checkpointing mode allows bypass mutations', () => {
    const gate = new WriteGate();
    gate.enterCheckpointing();
    expect(gate.allowsPublicMutation()).toBe(false);
    gate.enterBypass();
    expect(gate.allowsPublicMutation()).toBe(true);
    expect(gate.allowsBypassMutation()).toBe(true);
    gate.leaveBypass();
    expect(gate.allowsPublicMutation()).toBe(false);
  });

  it('leaveCheckpointing restores previous mode', () => {
    const gate = new WriteGate();
    expect(gate.mode).toBe('open');
    gate.enterCheckpointing();
    expect(gate.mode).toBe('checkpointing');
    gate.leaveCheckpointing();
    expect(gate.mode).toBe('open');
  });

  it('closing mode rejects public mutations', () => {
    const gate = new WriteGate();
    gate.enterClosing();
    expect(gate.mode).toBe('closing');
    expect(gate.allowsPublicMutation()).toBe(false);
  });

  it('closing mode allows bypass mutations', () => {
    const gate = new WriteGate();
    gate.enterClosing();
    gate.enterBypass();
    expect(gate.allowsBypassMutation()).toBe(true);
    gate.leaveBypass();
  });

  it('closed mode rejects everything including bypass', () => {
    const gate = new WriteGate();
    gate.enterClosed();
    expect(gate.mode).toBe('closed');
    expect(gate.allowsPublicMutation()).toBe(false);
    gate.enterBypass();
    expect(gate.allowsBypassMutation()).toBe(false);
    expect(gate.allowsPublicMutation()).toBe(false);
  });

  it('bypass scope nesting works correctly', () => {
    const gate = new WriteGate();
    gate.enterCheckpointing();
    expect(gate.bypassDepth).toBe(0);
    gate.enterBypass();
    expect(gate.bypassDepth).toBe(1);
    gate.enterBypass();
    expect(gate.bypassDepth).toBe(2);
    gate.leaveBypass();
    expect(gate.bypassDepth).toBe(1);
    expect(gate.allowsPublicMutation()).toBe(true);
    gate.leaveBypass();
    expect(gate.bypassDepth).toBe(0);
    expect(gate.allowsPublicMutation()).toBe(false);
  });

  it('withBypass runs fn inside a bypass scope', async () => {
    const gate = new WriteGate();
    gate.enterCheckpointing();
    let insideBypass = false;
    await gate.withBypass(async () => {
      insideBypass = gate.allowsBypassMutation();
    });
    expect(insideBypass).toBe(true);
    expect(gate.bypassDepth).toBe(0);
  });

  it('withBypass leaves scope on error', async () => {
    const gate = new WriteGate();
    gate.enterCheckpointing();
    await expect(
      gate.withBypass(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(gate.bypassDepth).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Bypass scope (pure WriteGate, no RustDocument)
// ---------------------------------------------------------------------------

describe('WriteGate bypass scope', () => {
  it('bypass scope allows system operations during closing', async () => {
    const gate = new WriteGate();
    gate.enterClosing();
    expect(gate.allowsPublicMutation()).toBe(false);

    let allowedDuringBypass = false;
    await gate.withBypass(async () => {
      allowedDuringBypass = gate.allowsBypassMutation();
    });
    expect(allowedDuringBypass).toBe(true);
    expect(gate.allowsPublicMutation()).toBe(false);
  });
});
