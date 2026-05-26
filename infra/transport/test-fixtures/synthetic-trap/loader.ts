/**
 * Loader for the synthetic-trap WebAssembly module.
 *
 * Reads the vendored `synthetic-trap.wasm` next to this file, instantiates
 * it, and exposes the three trap-on-call exports. Used by trap-recovery
 * tests that need a real `WebAssembly.RuntimeError` (with the actual V8/JIT
 * message string) — for cases where the mock transport's hand-written
 * message would risk the classifier matching a string V8 doesn't actually
 * emit.
 *
 * Node-only — uses `fs.readFileSync` + `import.meta.url`. The transport
 * package's tests run under Node (jest preset = `default-esm`), so this
 * works without a bundler. If a browser-side test ever needs this fixture,
 * the same .wasm bytes can be `fetch()`'d from a public/ path and passed
 * through `WebAssembly.instantiate` directly.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export interface SyntheticTrapModule {
  /** Calls the `unreachable` instruction; throws WebAssembly.RuntimeError("unreachable"). */
  trap_unreachable(): void;
  /** Loads from out-of-bounds memory; throws WebAssembly.RuntimeError("memory access out of bounds"). */
  trap_oob_read(): number;
  /** Performs `1 / 0`; throws WebAssembly.RuntimeError("divide by zero"). */
  trap_div_zero(): number;
  /** The instance's linear memory (1 page). Exposed for completeness; tests rarely need it. */
  memory: WebAssembly.Memory;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = join(__dirname, 'synthetic-trap.wasm');

/** Lazily load and instantiate the synthetic-trap WASM module. */
export async function loadSyntheticTrapModule(): Promise<SyntheticTrapModule> {
  const bytes = readFileSync(WASM_PATH);
  // Copy into a fresh Uint8Array — avoids any chance of the underlying
  // buffer being shared/aliased with caller-side state across runs.
  const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { instance } = await WebAssembly.instantiate(view);
  return instance.exports as unknown as SyntheticTrapModule;
}

/** Path to the vendored .wasm file. Useful for tests that want the raw bytes. */
export const SYNTHETIC_TRAP_WASM_PATH: string = WASM_PATH;
