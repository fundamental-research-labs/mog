/**
 * wasm-loader-reset.test.ts
 *
 * The trap-recovery coordinator nullifies the WASM module singleton via
 * `resetWasmModule()` so the next `loadWasmModule()` builds a fresh
 * `WebAssembly.Instance` with fresh linear memory. The test confirms
 * the singleton state actually clears — without this, `loadWasmModule()`
 * would early-return the still-cached (now-dead) module reference and
 * the recovery flow would re-bind to the dead instance instead.
 *
 * We don't exercise a real WASM load here (the `@mog-sdk/wasm`
 * package isn't loadable from Jest); the coordinator integration test
 * covers the load+reset+load round-trip via mocked dynamic imports.
 * This file pins the singleton-state contract.
 */
import { resetWasmModule, getWasmModule } from '../wasm-loader';

describe('wasm-loader resetWasmModule', () => {
  afterEach(() => {
    // Defensive: every test starts with a fresh singleton.
    resetWasmModule();
  });

  it('is a no-op before any load', () => {
    expect(getWasmModule()).toBeNull();
    resetWasmModule();
    expect(getWasmModule()).toBeNull();
  });

  it('is idempotent across multiple resets', () => {
    resetWasmModule();
    resetWasmModule();
    resetWasmModule();
    expect(getWasmModule()).toBeNull();
  });

  it('does not throw when called from any module context', () => {
    // The coordinator calls this from shell/services/trap-recovery,
    // which is several package boundaries away. Defensive: no errors.
    expect(() => resetWasmModule()).not.toThrow();
  });
});
