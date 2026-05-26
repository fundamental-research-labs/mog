/**
 * WASM trap classification.
 *
 * `wasm-transport.ts` distinguishes wasm32 traps (RuntimeError with a known
 * trap message) from ordinary errors and wraps the former in `TrapError`
 * so the kernel recovery coordinator can detect it. Plain errors and
 * unknown RuntimeError messages stay as `TransportError`.
 *
 * The transport calls `getModule()` on each `call()`, so we synthesize
 * a fake `WasmModule` whose function throws on demand and feed it
 * through `createWasmTransport`.
 */
import { TransportError, TrapError } from '../errors';
import type { WasmModule } from '../types';
import { createWasmTransport } from '../wasm-transport';

/**
 * Build a fake `WasmModule` with one exported function that throws the
 * supplied error. The transport invokes the function via positional
 * args derived from the args object's `Object.values()`.
 */
function moduleThatThrows(err: unknown): WasmModule {
  return {
    f: () => {
      throw err;
    },
  } as unknown as WasmModule;
}

describe('createWasmTransport — trap classification', () => {
  it('wraps `RuntimeError("unreachable")` as TrapError with isTrap=true', async () => {
    const trap = new WebAssembly.RuntimeError('unreachable');
    const transport = createWasmTransport(() => moduleThatThrows(trap));

    expect.assertions(5);
    try {
      await transport.call('f', {});
    } catch (e) {
      expect(e).toBeInstanceOf(TrapError);
      expect(e).toBeInstanceOf(TransportError); // subclass relationship preserved
      const trapErr = e as TrapError;
      expect(trapErr.isTrap).toBe(true);
      expect(trapErr.command).toBe('f');
      // Original trap chained as `cause` for diagnostics.
      expect((trapErr as Error & { cause?: unknown }).cause).toBe(trap);
    }
  });

  it('wraps `RuntimeError("memory access out of bounds")` as TrapError', async () => {
    const trap = new WebAssembly.RuntimeError('memory access out of bounds');
    const transport = createWasmTransport(() => moduleThatThrows(trap));

    expect.assertions(2);
    try {
      await transport.call('f', {});
    } catch (e) {
      expect(e).toBeInstanceOf(TrapError);
      expect((e as TrapError).isTrap).toBe(true);
    }
  });

  it('wraps `RuntimeError("divide by zero")` (V8/Node phrasing) as TrapError', async () => {
    const trap = new WebAssembly.RuntimeError('divide by zero');
    const transport = createWasmTransport(() => moduleThatThrows(trap));

    expect.assertions(1);
    try {
      await transport.call('f', {});
    } catch (e) {
      expect(e).toBeInstanceOf(TrapError);
    }
  });

  it('wraps `RuntimeError("integer divide by zero")` (spec phrasing) as TrapError', async () => {
    // Some non-V8 runtimes phrase divide-by-zero this way; both should
    // classify as a trap.
    const trap = new WebAssembly.RuntimeError('integer divide by zero');
    const transport = createWasmTransport(() => moduleThatThrows(trap));

    expect.assertions(1);
    try {
      await transport.call('f', {});
    } catch (e) {
      expect(e).toBeInstanceOf(TrapError);
    }
  });

  it('wraps `RuntimeError("null function or function signature mismatch")` as TrapError', async () => {
    const trap = new WebAssembly.RuntimeError('null function or function signature mismatch');
    const transport = createWasmTransport(() => moduleThatThrows(trap));

    expect.assertions(1);
    try {
      await transport.call('f', {});
    } catch (e) {
      expect(e).toBeInstanceOf(TrapError);
    }
  });

  it('does NOT wrap `RuntimeError("something else not in the trap set")` as TrapError', async () => {
    // Guard against over-classification — a runtime error with an
    // unfamiliar message must stay a plain TransportError. Triggering
    // recovery on every RuntimeError would turn benign engine errors
    // into spurious module re-instantiation cycles.
    const notTrap = new WebAssembly.RuntimeError('something else not in the trap set');
    const transport = createWasmTransport(() => moduleThatThrows(notTrap));

    expect.assertions(3);
    try {
      await transport.call('f', {});
    } catch (e) {
      expect(e).toBeInstanceOf(TransportError);
      expect(e).not.toBeInstanceOf(TrapError);
      expect((e as Error & { cause?: unknown }).cause).toBe(notTrap);
    }
  });

  it('does NOT wrap a regular `Error` as TrapError', async () => {
    const regular = new Error('whatever');
    const transport = createWasmTransport(() => moduleThatThrows(regular));

    expect.assertions(2);
    try {
      await transport.call('f', {});
    } catch (e) {
      expect(e).toBeInstanceOf(TransportError);
      expect(e).not.toBeInstanceOf(TrapError);
    }
  });

  it('preserves subclass relationship: `instanceof TransportError` catches TrapError', async () => {
    // Existing kernel/shell catch blocks rely on `instanceof TransportError`
    // — this test pins the subclass guarantee so the error hierarchy
    // change doesn't silently break upstream catch sites.
    const trap = new WebAssembly.RuntimeError('unreachable');
    const transport = createWasmTransport(() => moduleThatThrows(trap));

    let caughtAsTransportError = false;
    let isTrap = false;
    try {
      await transport.call('f', {});
    } catch (e) {
      if (e instanceof TransportError) {
        caughtAsTransportError = true;
        if (e instanceof TrapError) {
          isTrap = true;
        }
      }
    }
    expect(caughtAsTransportError).toBe(true);
    expect(isTrap).toBe(true);
  });

  it('returns the result unchanged when the function does not throw', async () => {
    // Sanity: classification only runs in the catch branch.
    const transport = createWasmTransport(() => ({ f: () => 42 }) as unknown as WasmModule);
    const result = await transport.call<number>('f', {});
    expect(result).toBe(42);
  });

  it('throws TransportError (not TrapError) when the command is unknown', async () => {
    // `Unknown WASM function` happens before the call site so it never
    // crosses the trap-detection branch.
    const transport = createWasmTransport(() => ({}) as unknown as WasmModule);
    expect.assertions(2);
    try {
      await transport.call('nope', {});
    } catch (e) {
      expect(e).toBeInstanceOf(TransportError);
      expect(e).not.toBeInstanceOf(TrapError);
    }
  });
});

describe('TrapError — shape', () => {
  it('formats the message with the command and trap reason', () => {
    const e = new TrapError('compute_recalc', 'unreachable');
    expect(e.message).toContain('compute_recalc');
    expect(e.message).toContain('unreachable');
    expect(e.name).toBe('TrapError');
  });

  it('exposes `isTrap` as a literal `true` discriminator', () => {
    const e = new TrapError('compute_recalc', 'unreachable');
    // Type-level check at runtime: literal `true`, not just truthy.
    expect(e.isTrap).toBe(true);
  });
});
