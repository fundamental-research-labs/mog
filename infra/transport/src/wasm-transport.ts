/**
 * WASM transport — wraps direct WASM module calls.
 *
 * Used in web (non-Tauri) environments. WASM functions are synchronous
 * and take positional parameters. The transport converts the named args
 * object to positional args using Object.values().
 */
import type { BridgeTransport } from '@rust-bridge/client';
import { TransportError, TrapError } from './errors';
import type { WasmModule } from './types';

/**
 * Known WASM trap messages observed across V8 (Chrome / Node) and SpiderMonkey
 * (Firefox). These map onto the wasm32 spec's trap set; runtimes phrase them
 * with slight variation, so the canonical strings AND the V8 variants are
 * both included. Verified against Node 24.10 (V8) by triggering each opcode:
 *
 *   unreachable                                 → "unreachable"
 *   i32.div_s 1/0                               → "divide by zero"
 *   i32.div_s INT_MIN/-1                        → "divide result unrepresentable"
 *   i32.trunc_f32_s NaN                         → "float unrepresentable in integer range"
 *   memory load OOB                             → "memory access out of bounds"
 *   call_indirect (null entry / sig mismatch)   → "null function or function signature mismatch"
 *
 * Spec phrasings (`integer divide by zero`, `integer overflow`,
 * `invalid conversion to integer`, `indirect call to null`,
 * `indirect call signature mismatch`) are included so the classifier still
 * works on runtimes that follow the spec wording rather than V8's. The set
 * is intentionally narrow — over-classification turns recoverable errors
 * into spurious recovery cycles. Membership requires *both*
 * `instanceof WebAssembly.RuntimeError` and an exact message match.
 */
const TRAP_MESSAGES: ReadonlySet<string> = new Set([
  // V8 / Node-observed strings
  'unreachable',
  'memory access out of bounds',
  'divide by zero',
  'divide result unrepresentable',
  'float unrepresentable in integer range',
  'null function or function signature mismatch',
  'remainder by zero',
  'function signature mismatch',
  'table index is out of bounds',
  // Wasm spec / SpiderMonkey-style phrasings (defensive)
  'integer divide by zero',
  'integer overflow',
  'invalid conversion to integer',
  'indirect call to null',
  'indirect call signature mismatch',
  'undefined element',
]);

/**
 * Classify a thrown error as a WASM trap.
 *
 * A wasm trap leaves the WebAssembly.Instance permanently dead — every
 * subsequent call returns the same trap. This must be detected at the
 * call boundary so the recovery coordinator can short-circuit further
 * traffic and re-instantiate the module.
 */
function isWasmTrap(err: unknown): err is WebAssembly.RuntimeError {
  return err instanceof WebAssembly.RuntimeError && TRAP_MESSAGES.has(err.message);
}

/**
 * Create a BridgeTransport that dispatches to WASM module functions.
 *
 * WASM functions are synchronous and take positional parameters. The transport
 * converts the named args object to positional args using `Object.values()`.
 * This works because the generated client creates args objects with keys in
 * the same order as the Rust function parameters.
 *
 * Time injection: WASM needs `compute_set_current_time()` called before
 * recalc-triggering operations. Use `createTimeInjectingTransport()` to wrap.
 *
 * Trap classification: thrown `WebAssembly.RuntimeError`s with a known trap
 * message become `TrapError` (subclass of TransportError) so the kernel
 * recovery coordinator can detect via `instanceof TrapError` / `isTrap`.
 * Non-trap errors fall through to the generic `TransportError.fromCommand`
 * path unchanged.
 */
export function createWasmTransport(getModule: () => WasmModule): BridgeTransport {
  return {
    async call<T = unknown>(command: string, args: Record<string, unknown>): Promise<T> {
      const wasm = getModule();
      const fn = wasm[command];
      if (!fn) {
        throw new TransportError(command, `Unknown WASM function: ${command}`);
      }
      try {
        const result = fn(...Object.values(args)) as T;
        return result;
      } catch (err) {
        if (isWasmTrap(err)) {
          throw new TrapError(command, err.message, { cause: err });
        }
        throw TransportError.fromCommand(err, command);
      }
    },
  };
}
