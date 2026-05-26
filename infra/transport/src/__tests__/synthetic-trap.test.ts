/**
 * Self-test for the synthetic-trap fixtures.
 *
 * This test pins the V8 trap-message strings used by the trap-detection
 * classifier in `wasm-transport.ts`. If any of these
 * assertions fails on a CI runner, the host runtime emits different trap
 * messages than what the classifier expects — that's the bug, not the test.
 *
 * The two fixtures exercised here:
 *
 * (a) `createSyntheticTrapTransport(...)` — JS-side mock. Throws a real
 *     `WebAssembly.RuntimeError` instance with a configurable message on
 *     a configurable call. Cheap; the message is whatever you tell it
 *     to be, so it's only useful when the test author already knows what
 *     V8 emits.
 *
 * (b) `loadSyntheticTrapModule()` — vendored 115-byte .wasm with three
 *     trap-on-call exports. The thrown error's `.message` here is what
 *     V8 ACTUALLY emits — that's the data point we're pinning. The
 *     `TRAP_MESSAGES` constant must match these exact strings.
 */
import {
  createSyntheticTrapTransport,
  type SyntheticTrapTransport,
} from './synthetic-trap-transport';
import { loadSyntheticTrapModule } from '../../test-fixtures/synthetic-trap/loader';

// Recorded V8 trap messages. If any of these change, update both this
// constant and the TRAP_MESSAGES set in `wasm-transport.ts`.
const V8_TRAP_MESSAGES = {
  unreachable: 'unreachable',
  oobRead: 'memory access out of bounds',
  divZero: 'divide by zero',
} as const;

describe('synthetic-trap WASM fixture — real V8 trap messages', () => {
  // Cache the module across tests in this block so we instantiate once.
  let mod: Awaited<ReturnType<typeof loadSyntheticTrapModule>>;

  beforeAll(async () => {
    mod = await loadSyntheticTrapModule();
  });

  it('exposes the expected exports', () => {
    expect(typeof mod.trap_unreachable).toBe('function');
    expect(typeof mod.trap_oob_read).toBe('function');
    expect(typeof mod.trap_div_zero).toBe('function');
    expect(mod.memory).toBeInstanceOf(WebAssembly.Memory);
  });

  it('trap_unreachable throws WebAssembly.RuntimeError("unreachable")', () => {
    let caught: unknown;
    try {
      mod.trap_unreachable();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WebAssembly.RuntimeError);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as WebAssembly.RuntimeError).message).toBe(V8_TRAP_MESSAGES.unreachable);
  });

  it('trap_oob_read throws WebAssembly.RuntimeError("memory access out of bounds")', () => {
    let caught: unknown;
    try {
      mod.trap_oob_read();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WebAssembly.RuntimeError);
    expect((caught as WebAssembly.RuntimeError).message).toBe(V8_TRAP_MESSAGES.oobRead);
  });

  it('trap_div_zero throws WebAssembly.RuntimeError("divide by zero")', () => {
    let caught: unknown;
    try {
      mod.trap_div_zero();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WebAssembly.RuntimeError);
    expect((caught as WebAssembly.RuntimeError).message).toBe(V8_TRAP_MESSAGES.divZero);
  });

  it('the .name field is "RuntimeError" on every trap variant', () => {
    // Some classifiers prefer matching `err.name` over `instanceof` (avoids
    // realm issues across iframes). Pin that field too.
    for (const fn of ['trap_unreachable', 'trap_oob_read', 'trap_div_zero'] as const) {
      let caught: unknown;
      try {
        mod[fn]();
      } catch (err) {
        caught = err;
      }
      expect((caught as Error).name).toBe('RuntimeError');
    }
  });
});

describe('createSyntheticTrapTransport — JS mock', () => {
  let transport: SyntheticTrapTransport;

  beforeEach(() => {
    transport = createSyntheticTrapTransport({ defaultResult: 'ok' });
  });

  it('throws a real WebAssembly.RuntimeError on the first call by default', async () => {
    await expect(transport.call('compute_recalc', {})).rejects.toBeInstanceOf(
      WebAssembly.RuntimeError,
    );
  });

  it('the thrown error has the default message "unreachable"', async () => {
    let caught: unknown;
    try {
      await transport.call('compute_recalc', {});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WebAssembly.RuntimeError);
    expect((caught as WebAssembly.RuntimeError).message).toBe('unreachable');
  });

  it('respects trapAfter — passes through earlier calls', async () => {
    transport = createSyntheticTrapTransport({ trapAfter: 3, defaultResult: 42 });
    expect(await transport.call('compute_x', {})).toBe(42); // 1
    expect(await transport.call('compute_x', {})).toBe(42); // 2
    await expect(transport.call('compute_x', {})).rejects.toBeInstanceOf(
      // 3 — traps
      WebAssembly.RuntimeError,
    );
    expect(transport.callCount).toBe(3);
    expect(transport.matchingCount).toBe(3);
  });

  it('respects trapOnCommand — non-matching commands never trap', async () => {
    transport = createSyntheticTrapTransport({
      trapAfter: 1,
      trapOnCommand: 'compute_recalc',
      defaultResult: null,
    });
    expect(await transport.call('compute_init', {})).toBeNull();
    expect(await transport.call('compute_set_cell', {})).toBeNull();
    expect(await transport.call('compute_init', {})).toBeNull();
    // Three non-matching calls — counter for matching commands is 0; no trap.
    expect(transport.callCount).toBe(3);
    expect(transport.matchingCount).toBe(0);
    // First matching call traps.
    await expect(transport.call('compute_recalc', {})).rejects.toBeInstanceOf(
      WebAssembly.RuntimeError,
    );
    expect(transport.matchingCount).toBe(1);
  });

  it('supports a custom trap message — useful for OOB and div-by-zero classification tests', async () => {
    transport = createSyntheticTrapTransport({ trapMessage: 'memory access out of bounds' });
    let caught: unknown;
    try {
      await transport.call('compute_recalc', {});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WebAssembly.RuntimeError);
    expect((caught as WebAssembly.RuntimeError).message).toBe('memory access out of bounds');
  });

  it('reset() restores the counters', async () => {
    transport = createSyntheticTrapTransport({ trapAfter: 2, defaultResult: 'ok' });
    expect(await transport.call('compute_x', {})).toBe('ok');
    await expect(transport.call('compute_x', {})).rejects.toBeDefined();
    expect(transport.matchingCount).toBe(2);
    transport.reset();
    expect(transport.callCount).toBe(0);
    expect(transport.matchingCount).toBe(0);
    // After reset the next call should NOT trap (matchingCount=1, trapAfter=2).
    expect(await transport.call('compute_x', {})).toBe('ok');
  });
});

describe('parity check — mock and real-WASM messages match', () => {
  // The whole point of providing both fixtures is that the mock CAN'T be
  // wrong about what V8 emits, because the real WASM module is the
  // source of truth. This test pins the parity so a future drift in
  // either side fails loudly.
  it('mock unreachable message === real WASM unreachable message', async () => {
    const mod = await loadSyntheticTrapModule();
    let realMsg = '';
    try {
      mod.trap_unreachable();
    } catch (err) {
      realMsg = (err as Error).message;
    }
    const mock = createSyntheticTrapTransport({ trapMessage: realMsg });
    let mockMsg = '';
    try {
      await mock.call('any', {});
    } catch (err) {
      mockMsg = (err as Error).message;
    }
    expect(mockMsg).toBe(realMsg);
    expect(mockMsg).toBe('unreachable');
  });
});
