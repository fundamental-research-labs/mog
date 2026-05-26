/**
 * Ambient module declaration for the @mog-sdk/wasm package.
 *
 * This is a Rust/wasm-pack generated WASM module that is only available at build time.
 * The actual types are defined locally in each bridge file (WasmModule, PivotWasmModule)
 * and the dynamic import is cast to those interfaces. We only need to tell TypeScript
 * that the module specifier is valid.
 *
 * Parser-local copy (previously referenced transport's via tsconfig include; now that
 * transport is a composite package, cross-package ambient includes are not allowed).
 */
declare module '@mog-sdk/wasm' {
  /** wasm-pack default export — call to initialize the WASM binary */
  const init: () => Promise<void>;
  export default init;
  // All other exports (compute_*, pivot_*, table_*) are declared locally
  // in each bridge file via typed interface casts (WasmModule, PivotWasmModule, etc.).
}
