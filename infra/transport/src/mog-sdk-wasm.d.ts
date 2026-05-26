/**
 * Ambient module declaration for the @mog-sdk/wasm package.
 *
 * This is a Rust/wasm-pack generated WASM module that is only available at build time.
 * The actual types are defined locally in each bridge file (WasmModule, PivotWasmModule)
 * and the dynamic import is cast to those interfaces. We only need to tell TypeScript
 * that the module specifier is valid.
 *
 * This is the single shared declaration — replaces the duplicates that were in
 * kernel/src/mog-sdk-wasm.d.ts and headless-server/src/mog-sdk-wasm.d.ts.
 */
declare module '@mog-sdk/wasm' {
  /** wasm-pack default export — call to initialize the WASM binary */
  const init: (moduleOrPath?: unknown) => Promise<void>;
  export default init;
  // All other exports (compute_*, pivot_*, table_*) are declared locally
  // in each bridge file via typed interface casts (WasmModule, PivotWasmModule, etc.).
}
