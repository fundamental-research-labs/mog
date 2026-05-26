;; Synthetic-trap WebAssembly module — used by trap-recovery tests.
;;
;; Three exported functions, each guaranteed to trap with a known V8
;; RuntimeError message (recorded in synthetic-trap.test.ts; that test
;; is the source of truth for T-2's TRAP_MESSAGES set).
;;
;; This .wat is the human-readable source. The vendored .wasm next to
;; it is the binary loaded by `loader.ts`. Regenerate the .wasm with:
;;
;;     wat2wasm synthetic-trap.wat -o synthetic-trap.wasm
;;
;; If you don't have wat2wasm installed (`brew install wabt`), you can
;; reproduce the exact bytes via the hand-encoder in `regenerate.mjs`
;; in this directory. The file is intentionally tiny (~115 bytes) so
;; checking it into git is cheap and avoids gating tests on a binaryen
;; install in CI.
;;
;; The trap messages V8 emits for each of these — captured in the
;; self-test — are the load-bearing data point for the trap-detection
;; classifier in `infra/transport/src/wasm-transport.ts`.

(module
  ;; () -> () : trap via the `unreachable` instruction.
  ;; V8 message: "unreachable"
  (func (export "trap_unreachable")
    unreachable)

  ;; () -> i32 : load from address 0xFFFFFFFE in a 1-page (64 KiB)
  ;; memory — guaranteed out of bounds.
  ;; V8 message: "memory access out of bounds"
  (func (export "trap_oob_read") (result i32)
    i32.const 0xFFFFFFFE
    i32.load)

  ;; () -> i32 : signed division by zero.
  ;; V8 message: "divide by zero"
  (func (export "trap_div_zero") (result i32)
    i32.const 1
    i32.const 0
    i32.div_s)

  (memory (export "memory") 1))
