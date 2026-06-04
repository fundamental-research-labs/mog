# Plan 039 — Harden the browser WASM binding boundary (`compute/wasm/src`)

## Source folder and scope

- **Folder:** `mog/compute/wasm/src`
- **Contents today:** a single file, `lib.rs` (124 lines).
- **Public source folder (read-only reference):** `/Users/guangyuyang/Code/mog-all/mog/compute/wasm/src`

Scope of this plan is the WASM binding crate's *source* surface: the
`wasm_start` module-init function and the two `bridge_wasm::generate!`
descriptor lists that produce the ~675 exported `#[wasm_bindgen]` functions in
`compute_core_wasm.js` / `.d.ts`. The adjacent build pipeline
(`compute/wasm/build.sh`), the generated `npm/` artifacts, the code generator
(`infra/rust-bridge/bridge-wasm`), and the engine itself (`compute/core`,
`compute/api`) are **out of scope as edit targets** but are load-bearing
context and appear in the dependency notes.

## Current role of this folder in Mog

`compute/wasm/src/lib.rs` is the entire hand-written surface of the
browser-side compute binding. It does three things:

1. **Module init (`#[wasm_bindgen(start)] wasm_start`)** — installs
   `console_error_panic_hook` and a `tracing-web` console subscriber. The
   subscriber deliberately disables timestamps because
   `SystemTime::now()` traps on `wasm32-unknown-unknown`.
2. **Brings descriptor input types into scope** via a wall of
   `#[allow(unused_imports)] use ...::*;` so the generated code (which uses
   `use super::*;`) can name them.
3. **Invokes `bridge_wasm::generate!(...)`** over an explicit list of ~40
   bridge descriptor macros (29 `ComputeService_*` groups + 8 stateless
   bridge types + the XLSX parser). The macro expands each descriptor into
   `#[wasm_bindgen]` functions, thread-local service registries,
   `__with_read_*`/`__with_write_*` helpers, and `*_destroy` cleanup.

This crate is compiled to `compute-core-wasm` (`crate-type = ["cdylib"]`),
post-processed by `build.sh` (wasm-opt `-Oz` + Brotli q11 for release), and
consumed in the browser through `infra/transport/src/wasm-transport.ts` /
`wasm-loader.ts`. It is the **only** path by which the spreadsheet app talks
to the Rust compute core in a non-Tauri web environment. Its sibling
`compute/napi/src/lib.rs` is the byte-for-byte analogous binding for Node/SSR.

### Key evidence gathered

- `lib.rs:80-123` and `compute/napi/src/lib.rs:64-110` carry **two
  independent, hand-maintained copies of the same descriptor list.** The only
  two consumers of `__bridge_descriptor_ComputeService_*` in the whole repo are
  these two files (`rg` confirmed). There is **no test or compile-time check**
  that the lists agree.
- `lib.rs:108-113` documents a real production incident in its own comment:
  the `screenshot` and `security_ops` descriptors were present in the NAPI
  list but **missing from the WASM list** until 2026-04-27, causing
  `compute_wb_security_drain_events` to surface as `Unknown WASM function` on
  every relay tick and masquerade as a module load failure (app-eval
  "real-files" round, FIX-004 cluster). This is the canonical proof that the
  duplicated-list design has already cost a debugging fire drill.
- `wasm_start` calls `tracing_subscriber::registry().with(fmt_layer).init()`
  with **no level filter at all** (`rg EnvFilter|LevelFilter|with_max_level`
  → no matches). Every `tracing` event at every level — including hot-path
  `debug!`/`trace!` from the engine — is formatted and written to the browser
  console on the main thread. `.init()` (not `.try_init()`) also *panics* if
  the global default is ever set twice.
- The browser does **not** lack genuine engine capability: yrs sync
  (`compute_apply_sync_update`, `compute_sync_full_state`,
  `compute_init_from_yrs_state`) is present in the generated `.d.ts`. The
  NAPI-only handwritten modules `chart_render.rs` (server-side rasterization)
  and `coordinator.rs` (authoritative `SyncCoordinator` handle table) are
  intentional platform differences — the browser rasterizes charts via canvas
  (`apps/spreadsheet/src/infra/services/chart-image-exporter.ts`) and is a
  collab *participant*, not the authoritative coordinator. **These are
  non-goals**, documented here so the plan does not chase false parity.

## Improvement objectives

1. **Eliminate the descriptor-list drift hazard** between the WASM and NAPI
   bindings so a new engine method group cannot ship to one runtime and not
   the other. This is the highest-value, production-path change: it directly
   removes the class of bug that caused FIX-004.
2. **Make WASM module init robust and quiet in production**: add a level
   filter so console isn't flooded on the main thread, make init idempotent
   (`try_init`), and make the runtime log level controllable.
3. **Strengthen the panic/trap → recovery signal** so a Rust panic in WASM
   produces a structured, machine-detectable marker for the JS trap-recovery
   coordinator, not just a free-text `console.error`.
4. **Reduce the unsafe-by-omission import surface** (`use ...::*;` globs) that
   silently masks whether a descriptor's input types are actually wired.

Objectives 2–4 are independent and individually shippable; objective 1 is the
anchor.

## Production-path contracts and invariants to preserve or strengthen

- **Binding-surface parity (strengthen):** for every engine method group and
  bridge type that the engine exposes via `#[bridge::api]`, the WASM and NAPI
  bindings must export the corresponding functions. Today this is a verbal
  convention enforced by code review; it must become a checked invariant.
- **WASM symbol-name stability (preserve):** the generated function names
  (`compute_*`, `*_destroy`, the bridge free functions) are the wire contract
  consumed by `wasm-transport.ts` and the `@rust-bridge/client`. Any
  refactor must produce a *byte-identical* exported symbol set. The generated
  `compute_core_wasm.d.ts` is the diffable witness of this.
- **No `SystemTime`/`Instant` on the wasm32 path (preserve):** the timestamp
  ban in `wasm_start` is load-bearing — any added subscriber layer or filter
  must not reach a clock source. `chrono` is configured with the `wasmbind`
  feature precisely so `Utc::now()` routes to `js_sys::Date`; nothing in init
  may bypass that.
- **Single global subscriber per instance (strengthen):** init must be safe to
  call more than once (the trap-recovery coordinator re-instantiates the
  module; today each fresh instance gets a fresh global, but `.try_init()`
  makes the guarantee explicit rather than incidental).
- **Trap = dead instance (preserve):** a wasm trap permanently kills the
  `WebAssembly.Instance`; the binding must not attempt to swallow or "recover"
  in Rust. Its only job on panic is to emit a clean, classifiable signal and
  let the JS coordinator re-instantiate (`wasm-transport.ts` trap classifier).

## Concrete implementation plan

### Phase 1 — Single source of truth for the descriptor list (anchor)

The descriptor *group* names are generated by
`infra/rust-bridge/bridge-core/src/emit.rs` as
`__bridge_descriptor_{Type}_{group}` macros from the `#[bridge::api]`
annotations on `ComputeService` (in `compute/api`) and the stateless bridge
types (in `compute/core`). The enumeration of *which* groups exist already
lives next to those annotations — but it is re-typed by hand in each binding.

1. **Emit a roll-up manifest macro alongside the per-group macros.** In
   `compute/api` (for `ComputeService`) and `compute/core` (for the stateless
   bridges), have the bridge derive/codegen additionally emit a single macro,
   e.g. `compute_api::for_each_compute_service_descriptor!` and
   `compute_core::for_each_bridge_descriptor!`, that expands to the full,
   authoritative list of `__bridge_descriptor_*` paths. Because it is produced
   by the same codegen pass that produces the groups, adding a new
   `#[bridge::api(group = "...")]` automatically extends the manifest — no
   binding edit required. (If extending the generator is judged too invasive
   for one change, fall back to a hand-written `macro_rules!` manifest checked
   in next to the annotations in `compute/api`, with a test per Phase 4 that
   asserts it is complete.)
2. **Rewrite `compute/wasm/src/lib.rs`** to invoke
   `bridge_wasm::generate!` over the manifest macro instead of the literal
   40-line list. Mirror the change in `compute/napi/src/lib.rs`
   (`generate_class!` + `generate!`). After this, the two bindings cannot
   diverge: they consume the identical manifest.
3. **Preserve the in-source incident note** (the FIX-004 comment) by relocating
   it to the manifest definition so the institutional memory survives the
   refactor.

> Note: editing `compute/api`, `compute/core`, `compute/napi`, and the bridge
> generator is *outside this folder*. Per the plan-format rules this is
> recorded as a cross-folder dependency; the actual edits land in those
> folders' own plans. Within `compute/wasm/src`, the deliverable is the
> rewritten `generate!` invocation that consumes the manifest.

### Phase 2 — Production-grade module init

Rewrite `wasm_start`:

1. **Add a level filter.** Wrap `fmt_layer` with a `tracing_subscriber`
   `LevelFilter` (or `Targets`) defaulting to `WARN`, so hot-path
   `debug!`/`trace!` events never reach the main-thread console formatter.
   Do **not** use the env-backed `EnvFilter` (no env on wasm32); use a static
   default plus an override read once from a JS-supplied source.
2. **Make the level runtime-configurable** via a small exported setter, e.g.
   `#[wasm_bindgen] pub fn set_log_level(level: &str)`, backed by a
   `reload::Handle`, so devtools/app can raise verbosity for a debugging
   session without a rebuild. Reading a URL query param (`?mog_log=debug`) in
   the loader and calling the setter is the intended wiring (loader change is
   a `infra/transport` dependency, noted below).
3. **Use `.try_init()`** instead of `.init()` so a double init is a no-op
   rather than a panic.
4. Keep `console_error_panic_hook::set_once()` and the no-timestamp
   guarantee exactly as-is.

### Phase 3 — Structured panic/trap signal

1. Replace the bare `console_error_panic_hook` with a thin custom hook that
   *first* emits a structured, greppable marker (e.g.
   `console.error("[mog-wasm-panic] " + payload)` plus the panic location),
   *then* delegates to `console_error_panic_hook` for the full backtrace.
2. Document the marker string as a stable contract and have the JS
   trap-recovery classifier (`wasm-transport.ts`) recognize it as a
   definitive "instance is dead, re-instantiate" signal — today the classifier
   matches only `WebAssembly.RuntimeError` trap strings; an explicit panic
   marker closes the gap where a Rust `panic!` unwinds to an abort without a
   recognized trap message. (JS side is an `infra/transport` dependency.)

### Phase 4 — Tighten the import surface

1. Replace the broad `use cell_types::*;` / `use formula_types::*;` /
   `use value_types::*;` / `use snapshot_types::*;` /
   `use compute_core::engine_types::*;` globs with the explicit type lists the
   descriptors actually reference (the same discipline already applied to
   `compute_table::types::{...}`). This converts "a descriptor referenced a
   type that is silently in scope via a glob" into a compile error that names
   the missing type — useful precisely when the manifest grows.
2. Keep `#[allow(unused_imports)]` only where a type is referenced by some but
   not all targets, and add a one-line note per kept allow.

## Tests and verification gates

> Per task constraints this plan does not itself run any build/test commands;
> the following are the gates the implementing change must add and pass.

1. **Surface-parity test (new, the keystone gate).** A Rust integration test
   (or a small build-script assertion) that materializes the set of exported
   binding symbols for WASM and for NAPI from the shared manifest and asserts
   they are identical modulo the known, *explicitly enumerated* platform-only
   exceptions (`render_chart_marks_image`, `yrs_state_to_snapshot_json`, the
   `SyncCoordinator` handle-table functions). This test must fail if a future
   group is added to one binding's path and not the other — i.e. it would have
   caught FIX-004.
2. **Generated-`.d.ts` snapshot diff.** A CI check that regenerates
   `compute_core_wasm.d.ts` and asserts the exported-function set is unchanged
   by a pure refactor (Phase 1/4). Any intended addition shows up as a
   reviewable diff; an accidental drop fails the gate.
3. **Init idempotency unit coverage.** A wasm-targeted test (`wasm-pack test`
   path) asserting `wasm_start()` called twice does not panic and that
   `set_log_level` toggles emitted events (capture via a test console writer).
4. **No-clock guard.** A `wasm32-unknown-unknown` build/test that exercises an
   init + a log emission at the configured level and confirms no
   `SystemTime`/`Instant` symbol is reachable (a `deny`/grep gate on the
   init module, or a smoke test that the module instantiates without trapping).
5. **app-eval load smoke.** Run the existing app-eval "loads without Unknown
   WASM function" scenario against a fresh build (this is the regression
   harness that historically exposed FIX-004); the parity test is the
   *preventive* gate, this is the *end-to-end* gate.
6. **Panic-marker contract test.** A wasm test that triggers a controlled
   `panic!` and asserts the `[mog-wasm-panic]` marker is emitted, plus a JS
   unit test that the trap classifier maps it to "dead instance".

## Risks, edge cases, and non-goals

**Risks / edge cases**

- *Manifest completeness regression.* If the manifest is hand-written
  (Phase 1 fallback) it becomes the new single point of drift; the Phase 4
  parity test is what keeps it honest — that test is mandatory, not optional.
- *Symbol-set churn.* The refactor must be provably symbol-neutral; the
  `.d.ts` snapshot gate (test 2) is the safety net. Macro-expansion ordering
  must not change generated names.
- *Log-filter over-suppression.* Defaulting to `WARN` could hide an
  `info!`-level diagnostic someone relied on in the browser console; the
  runtime `set_log_level` + URL-param override mitigates this, and the default
  should be reviewed against current console-debugging workflows.
- *Double-init semantics.* `.try_init()` silently succeeding on a second call
  is correct for re-instantiation but could mask an unintended double-init in
  a future embedding; pair it with a `debug!` on the no-op path.
- *`reload::Handle` cost.* The reloadable filter adds a small indirection on
  every event; negligible at `WARN` default but should be confirmed not to
  regress the engine hot path.

**Non-goals (explicitly out of scope)**

- Porting `chart_render.rs` or `coordinator.rs` to WASM — these are
  intentional native/server-only capabilities (evidence above). Do **not**
  add them to chase superficial parity.
- WASM binary size reduction, wasm-opt/Brotli tuning, code-splitting — those
  live in `build.sh` / `compute/core`, not in this source folder.
- Changing the bridge wire/serialization format or the `@rust-bridge/client`
  protocol.
- Any reduced-scope or test-only shim: the parity invariant must be enforced
  on the real production binding path, not faked in a test double.

## Parallelization notes and dependencies on other folders

- **Hard dependency (Phase 1):** the manifest macro must be emitted by
  `compute/api` (and `compute/core`) — ideally via the bridge generator in
  `infra/rust-bridge/bridge-core` / `bridge-derive`. The `compute/wasm/src`
  edit (consuming the manifest) and the `compute/napi/src` edit are
  *downstream* of that and should land in the same change-set to keep the
  parity test green.
- **Soft dependency (Phases 2–3):** the loader wiring for `set_log_level`
  (URL param → setter) and the trap classifier recognizing the panic marker
  live in `infra/transport/src/wasm-loader.ts` and `wasm-transport.ts`. The
  Rust side can ship first (additive exports); the JS side consumes them
  next.
- **Parallelizable:** Phase 2 (init/logging), Phase 3 (panic marker), and
  Phase 4 (import tightening) are mutually independent and can proceed
  concurrently once Phase 1 lands. Phase 4 is lowest-risk and can go first as
  a warm-up.
- **Coordination:** because the descriptor list is shared with NAPI, sequence
  Phase 1 with whoever owns `compute/napi` to avoid a merge race on both
  `lib.rs` files.

## Status

Not blocked. The folder exists and contains sufficient evidence (`lib.rs`, the
parallel NAPI binding, the generated `.d.ts`, the bridge generator, and the
in-source FIX-004 incident note) to act on this plan without further
investigation. The anchor change (Phase 1) is the highest-leverage,
production-path improvement and directly retires a class of bug that has
already shipped once.
