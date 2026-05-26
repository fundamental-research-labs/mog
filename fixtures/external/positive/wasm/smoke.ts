// @mog-sdk/wasm is a binary-wrapper package. The primary contract is:
// 1. The "." entry resolves to a JS file that exports WASM init functions.
// 2. The "./wasm" entry resolves to the raw .wasm binary.

import type * as WasmExports from '@mog-sdk/wasm';

// Verify the type declarations exist and are importable.
// The actual WASM initialization requires a browser or worker with
// WebAssembly.instantiate support. This fixture proves:
// - The declaration file resolves
// - No workspace-internal types leak
// - The package.json exports map is correct
type _InitCheck = typeof WasmExports;

console.log('PASS: wasm fixture (type declarations resolve)');
