# Plan 089: Compute PyO3 Source Boundary Improvements

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/compute/pyo3/src`

Required source file observed:

- `compute/pyo3/src/lib.rs`

Scope this plan covers:

- The Rust PyO3 module entrypoint for the native Python extension `mog._native`.
- The generated `ComputeEngine` class surface emitted by `bridge_pyo3::generate_class!`.
- The generated stateless bridge functions emitted by `bridge_pyo3::generate!`.
- The Python package and packaging contracts adjacent to this source boundary only where they are required to make the `src/lib.rs` binding surface complete and verifiable: `compute/pyo3/Cargo.toml`, `compute/pyo3/pyproject.toml`, `compute/pyo3/python/mog/*`, `compute/pyo3/scripts/generate_python_surface.py`, `compute/pyo3/scripts/check_python_sdk.sh`, `compute/pyo3/tests/*`, and `infra/rust-bridge/bridge-pyo3`.
- Cross-target descriptor parity with `compute/wasm/src/lib.rs`, `compute/napi/src/lib.rs`, `compute/api/src/bridge_service.rs`, `compute/core/src/bridge_pure.rs`, and `file-io/xlsx-api/src/bridge.rs` where needed to define the intended Python disposition.

Out of scope for this folder-specific plan:

- Rewriting compute-core spreadsheet algorithms.
- Hand-writing Python compatibility shims around missing native exports.
- Treating source-only Python imports as proof of SDK behavior.
- Publishing or release operations themselves. The plan covers build, wheel, and package integrity gates, not release execution.
- Adding private/internal dependencies to the public `mog` repo.

## Current role of this folder in Mog

`compute/pyo3/src/lib.rs` is the entire Rust source entrypoint for the public-experimental Python compute SDK. It does not implement spreadsheet behavior directly. It assembles PyO3 bindings around `compute-api`, `compute-core`, stateless pure bridge types, and the XLSX parser so Python callers can use the same Rust compute engine as the browser and Node bindings.

Observed responsibilities in `src/lib.rs`:

- Re-export `compute_api` for downstream Rust consumers.
- Import `ComputeService`, stateless bridge host types (`PivotBridge`, `TableBridge`, `ChartBridge`, `FormatBridge`, `SchemaBridge`, `CfBridge`, `ClockBridge`), `XlsxParser`, and many descriptor-visible domain types.
- Generate a `ComputeEngine` Python class from `ComputeService` lifecycle and engine descriptor groups.
- Generate stateless `#[pyfunction]` functions for pivot, table, chart, format, schema, conditional-format presets, clock, and XLSX parser descriptors.
- Register the PyO3 module as `mog._native`.

Important observed gaps:

- The module initializer currently registers `ComputeEngine` and `pivot_detect_fields` only. Other generated pure functions exist at Rust expansion time but are not added to the Python module because `bridge-pyo3` has no registration helper yet.
- The PyO3 descriptor list is shorter than the WASM and N-API lists. PyO3 omits groups that WASM/N-API consume, including `core_cells`, `core_sync`, `core_theme`, `objects_floating`, `objects_groups`, `objects_hyperlinks`, `objects_z_order`, and `screenshot`. These omissions may be valid only if they have explicit Python dispositions; today they are easy to confuse with accidental drift.
- Bare type imports are manually maintained in `src/lib.rs`, while `compute_core::bridge_types::*` already exists as a single prelude for descriptor-visible types. The current file imports many crates directly just to satisfy generated code expansion.
- The Python package wraps native methods through `mog._bridge.Bridge`, manually JSON-serializes selected parameters, deserializes string returns, and contains fallback branches for missing native methods such as `compute_set_cell_value_parsed`.
- The generated Python API surface reports 1054 dispositions: 86 implemented, 174 renamed, 285 unsupported, 379 omitted, 129 Python-only, and 1 out-of-scope. That is useful metadata, but it is not yet mechanically tied to the actual native `_native` module exports and `ComputeEngine` methods.
- Existing health gates already build and install the native extension, run pytest, verify generated surface metadata, audit stubs, run pyright verifytypes, and smoke a built wheel. The missing gates are native ABI/export inventory, descriptor parity/disposition checks, full generated pure-function registration, and generated Python FFI metadata.

## Improvement objectives

1. Make the PyO3 native ABI a generated, snapshotted contract.
   Python package behavior must be checked against the real built `mog._native` module: module exports, `ComputeEngine` constructor/factory methods, instance methods, free functions, parameter modes, return encodings, lifecycle result behavior, and error shapes.

2. Close descriptor drift through explicit target dispositions.
   Every `ComputeService`, stateless pure bridge, clock, and XLSX descriptor group should be either exposed in PyO3 or recorded as deliberately unsupported/omitted with a blocker, owner, and verification status. Accidental omissions should fail before they reach Python runtime.

3. Register all generated PyO3 free functions.
   The pure bridge functions generated by `bridge_pyo3::generate!` should be added to `mog._native` through generated registration helpers, not one function at a time by hand.

4. Replace hand-maintained binding imports with a shared prelude.
   `compute/pyo3/src/lib.rs` should use `compute_core::bridge_types::*` plus narrow target-specific imports so adding a descriptor-visible type is solved once for all binding crates.

5. Generate Python FFI metadata from Rust bridge descriptors.
   Python should know which native parameters are `[serde]`, `[str]`, `[prim]`, `[bytes]`, `[parse]`, or tagged-enum from generated metadata, not from ad hoc wrapper code or method-specific comments.

6. Remove fake-success and fallback behavior systematically.
   If a Python-visible API is implemented, it must call the production native path. If it is not implemented, it must raise `UnsupportedApiError` with generated disposition metadata. Python fallback rewrites should not mask missing native exports.

7. Strengthen lifecycle, session, and error contracts.
   `ComputeEngine` creation from snapshots and Yrs state should expose a one-shot lifecycle result consistently. Session principal state and security methods should stay instance-local. Native errors should cross PyO3 as structured Mog errors where the Rust side already has bridge error metadata.

8. Treat wheels as the production Python path.
   A source-tree import smoke is useful but insufficient. Wheel contents, native extension loading, `py.typed`, `.pyi` files, generated surface metadata, and absence of private/internal leakage must all be verified against an installed package.

## Production-path contracts and invariants to preserve or strengthen

- `ComputeService` remains the single stateful FFI surface for Python compute. `compute/pyo3/src/lib.rs` should not bind directly to `YrsComputeEngine` for normal engine operations.
- The Python package name remains `mog-sdk`; the import name remains `mog`; the native extension remains `mog._native`.
- `compute-core-pyo3` remains a public repo crate with no dependency on `mog-internal`.
- Python remains synchronous and native-backed. Source-only imports may prove package import hygiene, but they do not prove workbook behavior.
- `ComputeEngine(snapshot_json)` must return an engine whose initial `RecalcResult` is retrievable exactly once through `take_lifecycle_result`.
- `ComputeEngine.init_from_yrs_state(state)` must have the same lifecycle result contract as snapshot construction if it is exposed to Python.
- Descriptor parameter tags define the FFI boundary:
  - `[serde]` params cross as JSON strings until a richer generated Python object layer is explicitly introduced.
  - `[str]`, `[prim]`, `[bytes]`, `[parse]`, and tagged-enum params keep their generated PyO3 conversion semantics.
  - Python wrappers must not guess serialization based on Python values or method names.
- Complex returns can continue crossing as JSON strings at the low-level native boundary, but Python wrappers and stubs must document and decode them from generated return metadata.
- `(Vec<u8>, T)` returns must cross as `(bytes, metadata_json)` and be decoded by Python from generated return metadata.
- Native byte exports, especially XLSX bytes, must be real ZIP/XLSX output or an explicit unsupported disposition. Placeholder bytes are not allowed.
- Unsupported Python API paths must raise `UnsupportedApiError` with `api_path`, `python_path`, `reason_code`, and `owner_package`.
- No implemented Python API should swallow native failures and return `None`, `{}`, `[]`, or success-like values.
- Session principal state remains per `ComputeEngine`/`ComputeService` instance and must not move to process-global Python state.
- Clock/current-time behavior must be explicit. If Python exposes `ClockBridge` or recalc time injection, it must run on the production evaluation path and not depend on a caller-thread side effect that the engine thread cannot observe.
- `pyproject.toml` wheel contents must include the native extension, `py.typed`, generated `.pyi` stubs, generated API surface metadata, and disposition manifests.
- Local generated artifacts such as virtual environments, caches, built native extensions, and wheels should not become committed source-of-truth files.

## Concrete implementation plan

1. Add a native ABI inventory test for `mog._native`.
   Build a Python test that imports the built extension and records:
   - sorted module exports,
   - `dir(mog._native.ComputeEngine)`,
   - `dir(ComputeEngine(...))`,
   - constructor and static factory presence,
   - free-function exports,
   - low-level return category for representative commands.

   Compare the inventory to a generated expectation derived from bridge descriptors plus explicit Python dispositions. Classify each export as lifecycle, engine method, pure bridge function, clock, XLSX parser, internal helper, or unsupported/omitted.

2. Create a descriptor parity and disposition manifest.
   Generate a compact manifest listing every descriptor group consumed by WASM, N-API, and PyO3. For PyO3, every group gets one of:
   - `exposed`: generated and registered in `mog._native`,
   - `unsupported`: blocked by a named PyO3 converter, Python API decision, or platform limitation,
   - `omitted`: not part of the Python product surface, with owner and reason.

   The manifest should fail on current accidental drift, especially the missing PyO3 groups: `core_cells`, `core_sync`, `core_theme`, `objects_floating`, `objects_groups`, `objects_hyperlinks`, `objects_z_order`, and `screenshot`.

3. Decide and encode the PyO3 descriptor group set.
   For each missing group, implement the full group if the existing PyO3 converters support its payloads. If a converter gap blocks a full group, add the converter support in `bridge-pyo3` rather than omitting individual methods. Only keep a group unsupported when the Python product surface truly should not expose it, and record that in the generated disposition manifest.

4. Replace manual bare-type imports in `src/lib.rs`.
   Update the PyO3 entrypoint to import `compute_core::bridge_types::*` for descriptor-visible names. Keep only target-specific direct imports for `ComputeService`, stateless bridge host types, `XlsxParser`, and any modules not intentionally covered by the prelude. Add or extend a compile-time coverage test so descriptor-visible bare names resolve through the shared prelude for WASM, N-API, and PyO3.

5. Add generated module registration helpers to `bridge-pyo3`.
   Extend `bridge_pyo3::generate!` or add a paired macro such as `bridge_pyo3::register!(m, ...)` that emits `m.add_function(wrap_pyfunction!(...))?` for every generated free function not skipped for PyO3. The registration contract should be generated from the same descriptor expansion that emits the functions, so a new pure bridge method cannot be generated but unregistered.

6. Register all pure bridge functions in `_native`.
   Use the generated registration helper in `compute/pyo3/src/lib.rs` for pivot, table, chart, format, schema, conditional-format presets, clock, and XLSX parser descriptors. Remove the one-off `pivot_detect_fields` registration once the generated helper covers it. Add a native ABI test proving every expected free function is present.

7. Generate Python FFI command metadata.
   Extend the bridge metadata generation used by the Python surface script to include native command name, Python method path, parameter order, parameter tag, return encoding, lifecycle flag, and owner descriptor group. Emit checked-in generated metadata under `compute/pyo3/python/mog/_generated/`. This metadata should drive `Bridge.call`, `Bridge.call_json`, bytes tuple decoding, and unsupported-path checks.

8. Replace manual Python serialization decisions with metadata-driven calls.
   Refactor `mog._bridge.Bridge` so wrappers pass Python values through a generated conversion layer. The layer should JSON-encode `[serde]` and tagged-enum params, pass bytes as bytes, preserve primitives, and decode returns according to generated return metadata. Remove method-specific JSON comments and fallback serialization branches as the metadata covers each category.

9. Remove missing-native fallbacks category by category.
   Inventory every `hasattr(self._engine, ...)`, workaround, placeholder, fake-success, broad swallowed exception, and "repair by rewriting" path in the Python package. For each category:
   - expose the correct native method/group through PyO3,
   - or record an explicit unsupported disposition and raise `UnsupportedApiError`.

   Do not keep Python fallbacks that pretend an unsupported native operation succeeded. Formula repair and other state-correctness workarounds should move to the compute engine production path or become explicit tracked engine bugs.

10. Normalize lifecycle creation paths.
    Ensure snapshot construction and `init_from_yrs_state` expose the same one-shot lifecycle result shape. Add `Bridge.create_from_yrs_state` only if Python collaboration or Yrs-state boot is a supported product path; otherwise record the factory as intentionally unsupported/omitted. The ABI test should verify `take_lifecycle_result` returns data once and `None` thereafter.

11. Upgrade native error conversion.
    Teach `bridge-pyo3` to preserve `BridgeStructuredError` information when Rust errors already have bridge-formatted metadata. Update `mog.errors._wrap_native_error` to parse structured native error payloads before falling back to message heuristics. Add Python tests for compute errors, security denied errors, invalid serde payloads, invalid parse payloads, sheet-not-found, engine shutdown, and unsupported API errors.

12. Strengthen session security through the Python boundary.
    Keep principal inputs as `Optional[List[str]]` unless the Python API contract is intentionally expanded. Add native ABI and Python tests for `set_active_principal`, `active_principal` if exposed, `make_principal`, `security_active`, policy add/remove, anonymous denial, owner bootstrap, and tag canonicalization. The tests should prove session state is per workbook and does not leak between two engines in one Python process.

13. Make clock/current-time semantics explicit for Python.
    If `compute_set_current_time` is exported to Python, document and test exactly how it affects `TODAY()`/`NOW()` on `ComputeEngine` recalc. If the existing `ClockBridge` thread-local path is not valid for the PyO3 engine dispatch thread, move Python time injection onto an instance/session path through `ComputeService` and mark the stateless Python clock setter unsupported until that is true.

14. Complete XLSX native bridge coverage.
    Register the generated `XlsxParser` PyO3 functions and tie `mog.open_workbook`, `Workbook.from_xlsx`, `Workbook.to_buffer`, and `Workbook.to_xlsx` dispositions to real native XLSX import/export behavior. Add round-trip tests for path import, byte import if exposed, byte export, formula recalc after import, comments/tables/formats preservation smoke, invalid XLSX bytes, and unsupported parser options.

15. Generate Python stubs from the same surface contract.
    Keep `.pyi` files and `py.typed`, but derive callable signatures, unsupported status, renamed paths, doc fragments, and return categories from generated surface metadata. The stub audit should fail if runtime public attributes and stubs drift, or if stubs expose methods that the native ABI/disposition manifest does not classify.

16. Add package provenance and artifact hygiene checks.
    Extend wheel smoke to assert:
    - `mog._native` loads from the installed wheel, not the source tree,
    - `_generated/api_surface.json` and API disposition manifests are present,
    - no private/internal paths appear in package metadata, errors, or generated docs,
    - source-tree artifacts such as `.venv`, `.pytest_cache`, `_native.abi3.so`, and `dist/wheels` are ignored or absent from committed package contents,
    - the wheel works from a clean temporary environment with no repo `PYTHONPATH`.

17. Release the GIL around blocking engine work where safe.
    Audit generated PyO3 methods for calls that block on `Dispatch` or perform CPU-heavy native work. Where the Rust method and argument ownership allow it, use `Python::allow_threads` in generated wrappers so long-running recalc, XLSX import/export, chart/screenshot work, and large mutations do not freeze unrelated Python threads. Add concurrency tests with two workbooks to prove no cross-engine state leakage or data races.

18. Document the low-level and high-level Python contracts from generated metadata.
    Update Python SDK docs after implementation so they state:
    - `mog._native` is the low-level generated module,
    - `mog.Workbook`/`mog.Worksheet` are the supported high-level wrappers,
    - source-only imports are smoke-only,
    - unsupported paths are generated dispositions,
    - wheel install is the production path,
    - PyO3 descriptor parity is checked against the same bridge source as WASM and N-API.

## Tests and verification gates

Required Rust and bridge gates for implementation work:

- `cargo test -p bridge-pyo3`
- `cargo clippy -p bridge-pyo3`
- `cargo test -p bridge-pyo3-macros`
- `cargo clippy -p bridge-pyo3-macros`
- `cargo test -p compute-core-pyo3`
- `cargo clippy -p compute-core-pyo3`
- `cargo test -p compute-api` when `ComputeService` descriptors, lifecycle, errors, security, or clock/session behavior change.
- Focused `cargo test -p compute-core` or narrower compute-core crate tests when native behavior rather than binding code is touched.
- `cargo test -p xlsx-api` when XLSX parser bridge behavior changes.

Required Python package gates:

- `python3 -m venv compute/pyo3/.venv`
- `compute/pyo3/.venv/bin/python -m pip install --upgrade pip`
- `compute/pyo3/.venv/bin/python -m pip install maturin pytest pyright`
- `compute/pyo3/.venv/bin/python -m maturin develop --manifest-path compute/pyo3/Cargo.toml`
- `compute/pyo3/.venv/bin/python -m pytest compute/pyo3/tests -q`
- `compute/pyo3/.venv/bin/python -m mog._tools.smoke --json`
- `compute/pyo3/.venv/bin/python compute/pyo3/scripts/generate_python_surface.py --check`
- `compute/pyo3/.venv/bin/python -m mog._tools.verify_surface --strict --json`
- `compute/pyo3/.venv/bin/python -m mog._tools.audit_stubs --strict`
- `PYTHONPATH=/Users/guangyuyang/Code/mog-all/mog/compute/pyo3/python compute/pyo3/.venv/bin/python -m pyright --verifytypes mog`
- `compute/pyo3/.venv/bin/python -m maturin build --manifest-path compute/pyo3/Cargo.toml --out compute/pyo3/dist/wheels`
- Clean temporary-environment wheel install smoke against the built wheel.

Repository-level convenience gate after the individual pieces are implemented:

- `pnpm check:python-sdk`

Contract tests to add or strengthen:

- Native ABI snapshot test for module exports and `ComputeEngine` methods.
- Descriptor parity/disposition test comparing PyO3, WASM, N-API, and generated Python surface metadata.
- Free-function registration test for all pure bridge, clock, and XLSX parser functions.
- Parameter metadata test covering every bridge param tag and representative tagged enums.
- Return metadata test covering primitive, string, JSON object, nullable, array, bytes, bytes tuple, and void returns.
- Lifecycle test for snapshot init, optional Yrs-state init, one-shot lifecycle result, dispose/shutdown, and command-after-dispose.
- Structured error test for serde parse failures, bridge parse failures, compute errors, security denied, invalid sheet/range, and engine shutdown.
- Unsupported-path test proving every unsupported disposition raises `UnsupportedApiError` with matching metadata.
- No-fallback audit test for new fake-success or broad-swallow patterns.
- XLSX round-trip and invalid-input native tests through the installed Python package.
- Wheel content and clean-install tests.

## Risks, edge cases, and non-goals

Risks and edge cases:

- Exposing all missing descriptor groups may reveal PyO3 converter gaps. The correct fix is converter support or explicit dispositions, not partial hand registration.
- Registering all generated pure functions can add native exports before high-level Python wrappers exist. The ABI/disposition manifest should classify low-level exports separately from supported high-level Python API paths.
- Python API names are mostly snake_case while bridge/native names are Rust-style command names. Generated metadata must keep these layers distinct.
- `Bridge.call_json` currently handles strings and tuples generically. Replacing it with return metadata can change behavior for callers that accidentally depended on loose decoding. Tests should pin the intended return category per command.
- Releasing the GIL must be done only around operations whose arguments and captured references are fully owned or otherwise safe for PyO3. Do not introduce unsound borrowing to improve concurrency.
- Clock injection may require changes outside `compute/pyo3/src` if the current stateless thread-local clock does not affect the compute dispatch thread.
- Wheel smoke must not accidentally import from the repo source tree through `PYTHONPATH` or current working directory.
- Python 3.9 ABI3 compatibility must be preserved while testing newer Python versions locally.
- Generated surface counts will change as omitted groups become exposed or explicitly unsupported. The important invariant is intentional classification, not preserving current counts.

Non-goals:

- Do not add Python-only spreadsheet semantics that bypass native compute.
- Do not optimize test-only or source-only import paths instead of the built native extension and installed wheel.
- Do not keep compatibility fallbacks as the primary way to support missing native methods.
- Do not introduce a separate Python bridge source of truth independent of Rust descriptors.
- Do not make `compute/pyo3` depend on `mog-internal`.
- Do not weaken unsupported behavior into silent no-ops or placeholder results.
- Do not require every low-level `_native` export to become a documented high-level Python API immediately; low-level exports and high-level supported paths can have separate generated classifications.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable once the descriptor/disposition contract is defined:

- Agent A: Build descriptor parity and PyO3 disposition manifest. Owns comparison across `compute/pyo3/src/lib.rs`, `compute/wasm/src/lib.rs`, `compute/napi/src/lib.rs`, `compute/api/src/bridge_service.rs`, `compute/core/src/bridge_pure.rs`, and `file-io/xlsx-api/src/bridge.rs`.
- Agent B: Extend `bridge-pyo3` for generated free-function registration, ABI metadata, return metadata, structured errors, and optional GIL release.
- Agent C: Update `compute/pyo3/src/lib.rs` to consume the shared descriptor manifest, shared binding prelude, and generated registration helpers.
- Agent D: Generate Python FFI command metadata and refactor `mog._bridge` plus high-level wrappers away from manual serialization and missing-native fallbacks.
- Agent E: Reconcile Python API dispositions, `.pyi` stubs, unsupported behavior, and docs from the generated surface.
- Agent F: Add native package tests, wheel smoke, artifact hygiene checks, XLSX round-trip coverage, and security/session regression tests.

Dependencies:

- `mog/compute/api/src` owns `ComputeService` lifecycle, descriptor re-emission, session principal state, and bridge error shape.
- `mog/compute/core/src` and compute-core crates own engine descriptors, stateless bridge descriptors, bridge-visible types, formula/time behavior, mutation results, and export semantics.
- `mog/file-io/xlsx-api/src` owns XLSX parser descriptors merged into the Python native module.
- `mog/infra/rust-bridge/bridge-pyo3` owns PyO3 descriptor parsing, parameter conversion, return conversion, class generation, and generated free functions.
- `mog/compute/wasm/src` and `mog/compute/napi/src` are the closest parity targets for descriptor group coverage.
- `mog/compute/pyo3/python/mog` owns the high-level Python SDK, generated API surface, unsupported errors, stubs, and package tools.
- `mog/docs/guides/python-sdk.md` and public architecture docs should be regenerated or updated after the binding contract changes.

Integration order:

1. Land the descriptor parity/disposition manifest and native ABI inventory first.
2. Add `bridge-pyo3` registration and metadata support.
3. Update `src/lib.rs` to consume the shared prelude, intended descriptor set, and generated registration helper.
4. Refactor Python wrappers to generated metadata and remove fallback categories.
5. Reconcile stubs, docs, package hygiene, and wheel smoke.
6. Run the full Python SDK health gate and targeted Rust/bridge gates before declaring the folder improved.
