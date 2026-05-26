# Synthetic-trap WASM fixture

A 115-byte WebAssembly module with three exported functions that each trap
on call. Used by trap-recovery tests that need a real
`WebAssembly.RuntimeError` (with the actual V8-emitted message string), not
a hand-rolled mock.

## Files

| File                      | Purpose                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `synthetic-trap.wat`      | Human-readable source. Three trap functions + a 1-page memory export.              |
| `synthetic-trap.wasm`     | Vendored binary used at test time. Regenerated from the .wat or `regenerate.mjs`.  |
| `regenerate.mjs`          | Hand-encoder that produces the .wasm without needing wat2wasm. Bit-identical.      |
| `loader.ts`               | `loadSyntheticTrapModule()` — reads the .wasm via `fs.readFileSync` and exposes the exports as a typed interface. |

## Exports

| Function           | Signature   | V8 RuntimeError message       |
| ------------------ | ----------- | ----------------------------- |
| `trap_unreachable` | `() -> ()`  | `"unreachable"`               |
| `trap_oob_read`    | `() -> i32` | `"memory access out of bounds"` |
| `trap_div_zero`    | `() -> i32` | `"divide by zero"`            |
| `memory`           | `Memory`    | (1-page linear memory)        |

The exact message strings are pinned by `src/__tests__/synthetic-trap.test.ts`
— that test is the source of truth for the `TRAP_MESSAGES` set in
`src/wasm-transport.ts`'s trap classifier. If V8 ever changes a string, the
test will fail and force the classifier set to be updated in the same change.

## Why vendor the .wasm?

The transport package has no build step that runs WebAssembly tooling, and
adding `wabt` (or another binaryen wrapper) as a dev dependency just to
produce 115 bytes of vendored test data is more weight than the result
warrants. The `.wasm` is small, readable in `xxd`, and reproducible from
either `wat2wasm synthetic-trap.wat` (if you have wabt) or
`node regenerate.mjs` (zero deps).

## Regenerating

With wabt installed (`brew install wabt`):

```sh
wat2wasm synthetic-trap.wat -o synthetic-trap.wasm
```

Or, with no toolchain at all:

```sh
node regenerate.mjs
```

Then verify the trap messages still match what the tests expect by running:

```sh
pnpm --filter @mog/transport test synthetic-trap
```

If the assertion in `synthetic-trap.test.ts` over the message strings ever
fails on a CI runner, that means the host runtime emits different trap
messages than the macOS/Linux V8 we developed against — propagate the new
strings back into `TRAP_MESSAGES` in the wasm-transport classifier before
suppressing the test.
