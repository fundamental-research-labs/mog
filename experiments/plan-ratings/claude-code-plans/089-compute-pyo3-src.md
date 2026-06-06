# 089 — Improve `mog/compute/pyo3/src` (Python compute binding & packaging surface)

## Source folder and scope

- **Folder:** `mog/compute/pyo3/src`
- **Contents (the entire folder):** a single file, `lib.rs` (117 lines). It is the
  crate root of `compute-core-pyo3` (`Cargo.toml` `name = "compute-core-pyo3"`,
  `[lib] name = "_native"`, `crate-type = ["cdylib"]`, `publish = false`,
  `version = "0.8.0"`). The cdylib is built by `maturin` (`pyproject.toml`
  `module-name = "mog._native"`, `features = ["extension-module"]`) into the
  `mog-sdk` wheel; the import name is `mog`.
- **What `lib.rs` does (and the only things it does):**
  - Re-exports `compute_api` for downstream Rust consumers (`lib.rs:10`).
  - Brings a large set of types into module scope behind glob imports +
    `#[allow(unused_imports)]` (`lib.rs:22-56`) so that **bare identifiers in the
    generated descriptor expansions resolve** (the descriptors emit unqualified
    type names; `use super::*;` in the generated modules pulls these in).
  - Invokes `bridge_pyo3::generate_class!(...)` over 22 `ComputeService`
    descriptor families (`lib.rs:64-87`) to emit the `#[pyclass] ComputeEngine`
    plus all stateful instance methods.
  - Invokes `bridge_pyo3::generate!(...)` over 8 stateless bridge descriptors —
    `PivotBridge`, `TableBridge`, `ChartBridge`, `FormatBridge`, `SchemaBridge`,
    `CfBridge`, `ClockBridge`, `XlsxParser` (`lib.rs:93-102`) — to emit free
    `#[pyfunction]`s.
  - Declares `#[pymodule] fn _native` (`lib.rs:108-116`) which registers **only**
    `ComputeEngine` and the single free function `pivot_detect_fields`.
- **In scope (edit target):** `mog/compute/pyo3/src/lib.rs` only.
- **Out of scope (named for coupling, not edited here):**
  - `mog/infra/rust-bridge/bridge-pyo3/{src/lib.rs, macros/src/expand/free.rs,
    macros/src/expand/generate_class.rs}` — the `generate!` / `generate_class!`
    macros. `free.rs::emit_pure_function` (`free.rs:27-63`) is what names the free
    functions `<fn_prefix>_<method>` and emits no registration helper. The
    central fix below needs a *new* macro-emitted registration hook; that edit
    lands in this crate, not here, but is a hard dependency.
  - `mog/compute/pyo3/python/mog/**` — the Python wrapper (`_bridge.py`,
    `workbook.py`, `worksheet.py`, `sub_apis/*.py`, `_tools/verify_surface.py`,
    `_tools/audit_stubs.py`, `_generated/api_surface.json`,
    `api_dispositions.json`). The binding's exported surface is the contract this
    layer consumes; it is the parity oracle, not an edit target here.
  - `mog/compute/pyo3/scripts/generate_python_surface.py` — generates the typed
    surface and `.pyi` stubs; consumes the disposition manifest.
  - `mog/compute/core` (`compute-core`, `bridge_pure.rs`) and `mog/compute/api`
    (`compute-api`, `ComputeService`) — the descriptor sources. Their
    `#[bridge::api]` / `#[bridge::pure]` annotations define the method set this
    crate re-projects into Python.
  - `mog/file-io/xlsx-api` — owns the `XlsxParser` bridge type whose pure
    functions are generated but unregistered (see Evidence).

## Current role of this folder in Mog

This crate is **the FFI seam between the Rust compute engine and the Python
`mog-sdk` package**. It owns no logic of its own: every Python-callable symbol is
auto-generated from `#[bridge::api]` (stateful `ComputeService` methods → the
`ComputeEngine` pyclass) and `#[bridge::pure]` (stateless bridge types → free
functions) descriptors. The Python layer (`_bridge.py::Bridge`) wraps a single
`mog._native.ComputeEngine` instance and dispatches every workbook/worksheet
operation through it via JSON-serialized `call`/`call_json` (`_bridge.py:52-66`).
XLSX import/export, formatting, tables, charts, pivots, conditional formats,
security ops — all route through `ComputeEngine` instance methods today
(e.g. `workbook.py:151` calls `compute_import_from_xlsx_bytes`).

`lib.rs` is therefore the **definition of the Python SDK's native surface**: what
appears here as registered is what Python can call; what is generated but not
registered is dead weight in the cdylib and invisible at the boundary. Because
the package's stated health gate is "native-backed wrapper… source-only imports
are only a smoke path and do not prove SDK behavior" (`README.md:5-8`) and the
API-parity policy claims "every generated TypeScript SDK path has a checked
Python disposition" (`README.md:47-57`), the correctness of *which symbols this
module exports* is a first-class contract, not an implementation detail.

## Evidence (observed in the current tree)

- **The module exports a small fraction of what it generates; the rest is dead
  cdylib surface.** `generate!` (`lib.rs:93-102`) expands 8 stateless descriptors
  into free `#[pyfunction]`s (`free.rs:16-21` emits one per non-`pyo3`-skipped
  method across `PivotBridge`, `TableBridge`, `ChartBridge`, `FormatBridge`,
  `SchemaBridge`, `CfBridge`, `ClockBridge`, `XlsxParser`). But
  `#[pymodule] fn _native` (`lib.rs:108-116`) calls `wrap_pyfunction!` exactly
  once — for `pivot_detect_fields`. The other families compile into the dylib as
  `pub fn`s but are **never added to the module**, so they are unreachable from
  Python. The in-file comment admits this is unfinished: *"Pure (stateless)
  functions will be registered once bridge-pyo3 generates the registration
  helpers. For now the class-based ComputeEngine is the primary API surface."*
  (`lib.rs:112-114`).
- **The Python layer confirms only two native symbols are consumed.** A search of
  `python/mog/**.py` for `_native` references finds exactly: `from mog._native
  import ComputeEngine` (`_bridge.py:20`) and `getattr(_native,
  "pivot_detect_fields", None)` (`sub_apis/pivots.py:251`). Everything else goes
  through the engine instance. The generated `*_table`, `*_chart`, `*_format`,
  `*_schema`, `*_cf`, `*_clock`, `xlsx_*` free functions have **zero Python
  callers** and zero registration — pure waste in both directions.
- **`pivot_detect_fields` is reached through a `getattr(..., None)` fallback,
  masking the gap.** `sub_apis/pivots.py:249-258` looks the function up
  defensively and, when present, JSON-round-trips through it; otherwise it falls
  back to a **pure-Python reimplementation** (`_fallback_detect_fields_from_values`).
  So even the one registered free function is "optional" at the call site — the
  binding can silently regress to a divergent Python path without any test
  noticing, because the fallback always succeeds.
- **The single registration is hand-coupled to a macro-derived name.**
  `wrap_pyfunction!(pivot_detect_fields, m)` (`lib.rs:111`) hard-codes the
  identifier `pivot_detect_fields`. That name is produced by
  `emit_pure_function` as `format_ident!("{}_{}", fn_prefix, method)`
  (`free.rs:32-36`) from the `PivotBridge` descriptor's prefix and the
  `detect_fields` method. If the descriptor's `fn_prefix` or method name changes,
  this symbol silently disappears (compile error at best, `getattr → None`
  fallback at worst). There is no compile-time guarantee the wrapped name matches
  any generated function.
- **Module assembly is manual and unverified against the intended surface.**
  There is no enumeration tying "functions registered in `_native`" to "supported
  Python dispositions." `verify_surface`/`audit_stubs` (`README.md:53-57`) check
  the Python-side disposition manifest, but nothing asserts the *native exports*
  equal the intended set. The 22-entry `generate_class!` list and the 8-entry
  `generate!` list are maintained by hand (`lib.rs:64-102`); adding or removing a
  descriptor family is an unguarded manual edit.
- **Bare-name type resolution forces a fragile, broad import surface.** `lib.rs`
  carries ~10 glob/explicit `use` blocks each gated by
  `#[allow(unused_imports)]` (`lib.rs:22-56`) whose sole purpose is to keep the
  exact set of types referenced *by bare identifier* inside the generated
  descriptor expansions in scope (the file says so at `lib.rs:19-21,36-38`). When
  a descriptor starts referencing a new type by bare name, this crate fails to
  compile with an error pointing at generated tokens, not at the descriptor —
  poor locality. The blanket `#[allow(unused_imports)]` also suppresses genuine
  drift (imports that became unused after a descriptor changed are never
  flagged).
- **Version is duplicated and the module exposes no metadata.** `Cargo.toml`
  (`version = "0.8.0"`) and `pyproject.toml` (`version = "0.8.0"`) must be kept in
  lock-step by hand, and `_native` exports no `__version__`/build identifier, so
  the wheel cannot assert at import time that the loaded `.so` matches the Python
  package version. (`workbook.py`/`__init__.py` have no native version check.)
- **All engine calls hold the GIL.** The generated `ComputeEngine` pyclass uses a
  plain `#[pyo3::pyclass]` (`generate_class.rs:47`, no `unsendable`, no
  `py.allow_threads`), so long-running compute (recalc, XLSX parse/export) blocks
  every other Python thread. This is a performance characteristic, not a defect;
  noted as a non-goal/future item below.
- **Otherwise minimal and correct.** The crate has no hand-written logic to be
  buggy: zero `TODO`/`FIXME`, abi3 (`abi3-py39`) for a single forward-compatible
  wheel, `extension-module` correctly feature-gated. The improvements are about
  **closing the generated-vs-registered surface gap, making module assembly
  declarative and verified, and removing the hand-maintained name/type
  coupling** — not redesign.

## Improvement objectives

1. **Make the native module's exported surface exactly equal the intended Python
   SDK surface — in both directions.** Every generated free function is either
   registered (because a supported Python disposition needs a stateless native
   entry point) or not generated (because nothing consumes it). No symbol is
   compiled-but-unreachable; no intended stateless path is missing.
2. **Replace the single hand-written `wrap_pyfunction!` with declarative,
   macro-driven registration** so module assembly cannot drift from generation
   and is not coupled to a hand-typed function name.
3. **Add a verification gate that asserts `_native`'s exports match the intended
   set**, so future descriptor changes that add/remove a binding fail loudly
   instead of silently leaving dead or missing symbols.
4. **Reduce the fragile bare-name import coupling** (objective for the descriptor
   layer; tracked here because `lib.rs` is the symptom site) and remove blanket
   `#[allow(unused_imports)]` so import drift is visible.
5. **Expose native build/version metadata** so the wheel can assert the loaded
   `.so` matches the package version at import.

## Production-path contracts and invariants to preserve or strengthen

- **The public Python surface is `mog._native.ComputeEngine` + the registered
  free functions.** `ComputeEngine`'s class name, constructor shape, and the
  JSON-string in / JSON-string out method calling convention consumed by
  `_bridge.py::call`/`call_json` (`_bridge.py:52-90`) MUST NOT change. Renaming
  the class or altering method signatures breaks the entire wrapper.
- **`pivot_detect_fields` must remain callable with its current name and
  JSON-string contract** (`sub_apis/pivots.py:251-254` passes
  `json.dumps(values)` and expects a JSON string or list back) — until/unless the
  Python side is updated in lockstep. Strengthen this from a `getattr` fallback
  into a guaranteed-present export (objective 1/3).
- **API-parity policy:** every supported Python disposition in
  `api_dispositions.json` that is backed by production state must resolve to a
  real native symbol; unsupported paths raise `UnsupportedApiError`
  (`README.md:60-68`). The native surface must not silently under- or
  over-provide relative to the disposition manifest.
- **abi3 / `extension-module` build contract:** the wheel ships one
  `abi3-py39` `.so` (`Cargo.toml` features, `pyproject.toml` `module-name`).
  Keep abi3 stability — do not introduce version-specific PyO3 API that breaks
  the single-wheel matrix (`README.md:71-76`).
- **`compute_api` re-export** (`lib.rs:10`) is a downstream Rust consumer
  contract; preserve it.
- **No behavioral logic in this crate.** All semantics stay in
  `compute-core`/`compute-api`/bridge types; `lib.rs` only projects them. Do not
  add transformation logic here.

## Concrete implementation plan

The work is staged so the surface gap is closed first (highest value), then the
assembly is made declarative, then verified.

### Stage 0 — Establish the intended stateless surface (investigation)

For each of the 8 stateless descriptor families in the `generate!` block
(`lib.rs:93-102`), determine from `api_dispositions.json` and the Python
`sub_apis/*` whether any **supported** disposition requires a *stateless* native
entry point (one with no `ComputeEngine` instance), or whether the operation is
already (or should be) served by a `ComputeEngine` instance method:

- `PivotBridge::detect_fields` → already needed (pivots.py). **Register.**
- `XlsxParser` → import/export currently routes through the engine
  (`compute_import_from_xlsx_bytes`, `workbook.py:151`). Decide whether a
  stateless parser entry point is part of the intended surface or redundant.
- `ChartBridge`, `FormatBridge`, `SchemaBridge`, `CfBridge`, `TableBridge`,
  `ClockBridge` → cross-check each generated `<prefix>_<method>` against the
  disposition manifest and sub_api call sites.

Output: a list partitioning every generated free function into **REGISTER** or
**DROP-FROM-GENERATION**. This list is the spec for Stage 1–2 and the fixture for
Stage 3's gate.

### Stage 1 — Declarative, macro-driven registration (dep: bridge-pyo3 macros)

In `mog/infra/rust-bridge/bridge-pyo3` (out-of-folder dependency, separate edit):
extend the `generate!` macro so each descriptor expansion also emits a
**registration helper** — e.g. a generated `fn register_<TypeSnake>(m:
&Bound<PyModule>) -> PyResult<()>` that `wrap_pyfunction!`s every function it
emitted, or a generated `const`/slice of `wrap_pyfunction!`-able items. The
helper name is derived from the same identifiers the functions are, so it can
never drift from them (`free.rs` already owns `fn_prefix`/`method` naming).

Then in `lib.rs`, replace the hand-written body of `#[pymodule] fn _native` so it
calls the generated `register_*` helper(s) for exactly the families chosen
REGISTER in Stage 0:

```rust
#[pymodule]
fn _native(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<ComputeEngine>()?;
    // Generated registration helpers — names derive from the same descriptor
    // identifiers as the functions, so this cannot drift from `generate!`.
    register_PivotBridge(m)?;
    // …each REGISTER family from Stage 0…
    m.add("__native_version__", env!("CARGO_PKG_VERSION"))?;
    Ok(())
}
```

This deletes the brittle `wrap_pyfunction!(pivot_detect_fields, m)` literal
(`lib.rs:111`) and its name coupling.

### Stage 2 — Stop generating unreachable functions

For families partitioned DROP in Stage 0, **remove them from the `generate!`
list** (`lib.rs:93-102`) and drop the now-unused `use` lines that only existed to
satisfy those descriptors' bare names. This eliminates dead cdylib surface and
shrinks the binary. (If a family is partially needed, the descriptor's per-method
`skip_targets` `"pyo3"` mechanism — already honored at `free.rs:17-19` — is the
production-correct way to suppress individual methods; prefer that over deleting
a whole family when only some methods are unwanted. Coordinate that change with
the descriptor owner, not in `lib.rs`.)

### Stage 3 — Tighten imports

Once Stages 1–2 settle the descriptor set, audit `lib.rs:22-56`: remove `use`
blocks no longer referenced by any remaining descriptor, and **remove the blanket
`#[allow(unused_imports)]`** from blocks that are now precisely used, so future
drift surfaces as a warning. Where the broad glob (`use cell_types::*;` etc.)
remains necessary for bare-name resolution, leave a single explanatory comment
and keep the `#[allow]` only on the genuinely glob-by-necessity blocks. The
durable fix (descriptors emitting fully-qualified paths so this crate needs no
type imports at all) is a descriptor-layer objective recorded under
Parallelization; `lib.rs` cannot fix it alone.

### Stage 4 — Native version metadata

Expose `__native_version__` (added in Stage 1) and have the Python `__init__`
assert it equals the package version at import (Python-side edit, out of folder),
so a stale `.so` fails fast. Keeps `Cargo.toml`/`pyproject.toml` versions
honest.

## Tests and verification gates

> Per task constraints this plan does not run any build/test commands; this
> section specifies the gates the implementer must add and run.

1. **Native-export parity gate (new).** Extend `python/mog/_tools/verify_surface.py`
   (or add a sibling check) to import `mog._native`, enumerate its module
   attributes (`ComputeEngine` + free functions), and assert the set **exactly
   equals** the Stage-0 intended set derived from `api_dispositions.json`. Fail on
   any extra (dead) or missing symbol. This is the regression lock for objectives
   1–3 and must run in `pnpm check:python-sdk` (`README.md:11-14`).
2. **Function-presence assertion, not fallback.** Add a test that asserts
   `hasattr(mog._native, "pivot_detect_fields")` and that the pivot path uses the
   native function (e.g. by asserting it is invoked / by removing the silent
   `getattr(..., None)` default once registration is guaranteed). Confirms
   objective 2.
3. **Round-trip smoke for every newly-registered free function.** For each
   REGISTER family, a minimal call with representative JSON input asserting a
   well-formed JSON result (parity oracle: the corresponding TS SDK path).
4. **Native version check** (`__native_version__ == importlib.metadata.version
   ("mog-sdk")`).
5. **Existing gates must stay green:** `tests/test_native_package_contract.py`,
   `tests/test_source_import_smoke.py`, `tests/test_security*.py`,
   `generate_python_surface.py --check`, `verify_surface --strict --json`,
   `audit_stubs --strict` (`README.md:53-57`). Stub regeneration may be required
   if the registered free-function set changes.
6. **Wheel-content check:** confirm the wheel still bundles the native `.so`,
   `py.typed`, `.pyi`, `_generated/api_surface.json`, and the disposition manifest
   (`pyproject.toml:27-34`, `README.md:71-76`).
7. **Compile gate (manual, by implementer):** the cdylib must build under
   `extension-module` and abi3; removing imports/families must not break
   bare-name resolution in remaining descriptors.

## Risks, edge cases, and non-goals

- **Risk — dropping a family that is actually intended.** Stage 0 must be
  evidence-driven (disposition manifest + sub_api call sites). If unsure, prefer
  REGISTER over DROP: an exported-but-unused function is cheaper to keep than a
  removed-then-needed one. The parity gate (Stage 3 test 1) will flag a registered
  function with no disposition, forcing the disposition to be added or the
  function dropped — either resolution is explicit.
- **Risk — macro change is out of this folder.** Stage 1's registration helper
  lives in `bridge-pyo3` macros. If that change is deferred, an interim
  acceptable form is an explicit (still declarative) list of `wrap_pyfunction!`
  calls in `lib.rs` enumerating the REGISTER set — better than today's single
  literal, but it reintroduces a hand-maintained name list, so the gate in test 1
  is essential to keep it honest. The macro helper is the durable target.
- **Edge case — name collisions across families.** `<prefix>_<method>` could
  collide between descriptors (e.g. two families with the same prefix+method).
  Registration must surface a duplicate as a hard error, not silently shadow.
- **Edge case — abi3 forward compat.** New PyO3 module APIs used for registration
  must be available in the `abi3-py39` floor.
- **Non-goal — GIL release / `allow_threads`.** Letting long compute calls release
  the GIL is a real throughput win but requires `ComputeService` to be `Send` +
  audited reentrancy; track separately, do not bundle.
- **Non-goal — submodule namespacing** (`mog._native.pivot.detect_fields`). A
  flat namespace is fine at current size; revisit only if the free-function count
  grows large.
- **Non-goal — changing the JSON calling convention** or moving any logic into
  this crate. `lib.rs` stays a thin generated projection.
- **Non-goal — reduced-scope/test-only patch.** Registering only what tests touch,
  or papering over the gap with more `getattr` fallbacks, is explicitly rejected:
  the production fix is to make exports equal the intended surface and verify it.

## Parallelization notes and dependencies on other folders

- **Hard dependency: `mog/infra/rust-bridge/bridge-pyo3` (macros).** Stage 1's
  registration helper is emitted there (`macros/src/expand/free.rs`, the
  `generate!` macro in `src/lib.rs`). This must be designed jointly; the `lib.rs`
  edit consumes whatever helper shape the macro provides. Recommend a single
  workstream owns both.
- **Coordination: descriptor owners** in `mog/compute/api` (`ComputeService`),
  `mog/compute/core` (`bridge_pure.rs`), and `mog/file-io/xlsx-api`
  (`XlsxParser`). Stage 0's REGISTER/DROP decision and any per-method
  `skip_targets` change belong to them. The longer-term "descriptors emit
  fully-qualified paths" fix (objective 4) is theirs and would let `lib.rs` shed
  its glob imports entirely.
- **Coordination: Python SDK layer** `mog/compute/pyo3/python/mog` — owns the
  parity gate (`_tools/verify_surface.py`), the version assertion (`__init__`),
  the pivot call-site cleanup (`sub_apis/pivots.py`), and stub regeneration
  (`scripts/generate_python_surface.py`). These land in lockstep with the
  `lib.rs` registration change.
- **Independent of:** the WASM/Tauri bridge targets and other compute crates —
  this crate is a leaf binding. Other folder-89-style binding reviews (e.g. the
  WASM binding) can proceed in parallel; only the shared `bridge-pyo3` macro touch
  must be serialized.
- **Sequencing within this plan:** Stage 0 (investigate) → Stage 1 (macro helper +
  registration) and Stage 2 (drop dead families) can proceed together once the
  partition is known → Stage 3 (imports) after the descriptor set is final →
  Stage 4 (version) any time → all gated by the Stage-3/Tests parity check.
```
