Rating: 8/10

Summary judgment

This is a strong plan with unusually good grounding in the actual PyO3 source boundary. Its core diagnosis matches the code: `compute/pyo3/src/lib.rs` generates more free functions than it registers, PyO3 omits descriptor groups that WASM and N-API include, the Python wrapper layer still makes manual JSON/return-shape decisions, and existing Python gates verify the package surface more than the native ABI contract. The plan also correctly treats the installed wheel as the production Python path rather than relying on source imports.

The main reason this is not a 9 or 10 is that it is closer to a large program charter than an implementation-ready plan. It identifies the right destination, but several generated contracts need exact schemas, file paths, ownership, and failure conditions before multiple workers can safely implement it without interpretation drift. It also proposes several public native-surface expansions and behavior changes without a crisp phase boundary between "classify and snapshot current state" and "change the public Python/native ABI."

Major strengths

- The plan is evidence-based. It calls out the actual PyO3 module registration gap: only `ComputeEngine` and `pivot_detect_fields` are registered while `bridge_pyo3::generate!` emits additional pure functions.
- It frames descriptor parity correctly as a generated disposition problem, not a hand-maintained checklist. That fits the architecture of bridge descriptors shared across WASM, N-API, PyO3, and Python metadata.
- It keeps the production path in view. Wheel install, `mog._native` loading, `py.typed`, stubs, generated metadata, and clean temporary-environment smoke tests are the right verification surface for a Python SDK.
- It explicitly rejects Python fake-success behavior and source-only fallback semantics. That is the right contract direction for a native-backed compute package.
- The verification list is broad and relevant: Rust bridge crates, `compute-core-pyo3`, Python tests, generated surface checks, strict stub audits, pyright verifytypes, maturin develop, maturin build, and wheel smoke.
- The plan recognizes important cross-boundary details that are easy to miss: `(Vec<u8>, T)` return encoding, one-shot lifecycle results, per-engine principal state, structured bridge errors, clock/thread-local semantics, GIL release safety, and private/internal leakage checks.

Major gaps or risks

- The plan needs an explicit "snapshot current ABI before changing ABI" phase. Right now it blends current-state inventory, generated registration, new exports, Python wrapper refactors, error conversion, XLSX coverage, clock behavior, and GIL release into one long sequence.
- The generated contracts are underspecified. The plan should name the expected manifest files, schemas, fields, generation command, check command, and review policy for ABI inventory, descriptor dispositions, Python FFI metadata, return metadata, and stub metadata.
- Public low-level export expansion is risky without a policy. Registering all pure bridge functions may be correct, but the plan should define whether `_native` exports are considered public, experimental, or internal, and how compatibility is handled when generated names change.
- The descriptor disposition model needs sharper acceptance criteria. "owner and reason" is good, but each disposition should require stable descriptor id, target group, method count, target status, reason enum, blocker issue or TODO owner, high-level Python path mapping when any exists, and expiration/review expectations for `unsupported` and `omitted`.
- The prelude objective is directionally right but incomplete as written. `compute_core::bridge_types::*` does not currently cover every direct import used by PyO3 and adjacent pure descriptors, so the plan should spell out that this is a prelude expansion plus cross-target compile coverage, not only a local import replacement.
- The Python fallback-removal step is too broad for a single late phase. There are many `hasattr`, broad exception, and fallback patterns across `workbook.py`, `worksheet.py`, and sub-APIs. The plan should split them by category and define which are correctness fallbacks, UX conveniences, explicit unsupported paths, and harmless parsing helpers.
- GIL release is valuable but not a prerequisite for ABI correctness. It should be a later phase with its own safety audit, because it changes concurrency behavior and requires careful ownership proof in generated PyO3 wrappers.
- The plan mentions docs updates, but not doc generation ownership or where the low-level/high-level contract should live. That matters because `_native` should not accidentally become the primary documented Python API.

Contract and verification assessment

The contract direction is excellent: Rust descriptors should be the source of truth; PyO3 descriptor inclusion should be intentional; native exports should be snapshotted; Python wrappers should use generated parameter and return metadata; unsupported APIs should raise `UnsupportedApiError` with structured metadata; and wheel installs should be tested as the production path.

The verification gates are also mostly correct and production-relevant. The existing `check_python_sdk.sh` already runs `cargo test -p compute-core-pyo3`, `cargo clippy -p compute-core-pyo3`, `maturin develop`, pytest, generated surface checks, strict stub audit, pyright verifytypes, maturin build, and clean wheel smoke. The plan appropriately adds missing gates for native ABI inventory, descriptor parity, pure-function registration, metadata-driven parameter/return behavior, and package provenance.

The missing piece is precision. A worker should be able to tell exactly what file changes make a new descriptor pass or fail. For example, the plan should define whether the ABI snapshot is generated from Rust descriptors, from introspecting an installed wheel, or from both; whether snapshots are checked into `compute/pyo3/python/mog/_generated/` or test fixtures; and which command is authoritative for regenerating versus checking. Without that, independent agents may create parallel but incompatible metadata files.

Concrete changes that would raise the rating

1. Add a Phase 0 that only inventories current state: descriptor groups by target, installed-wheel `_native` exports, `ComputeEngine` methods, current Python dispositions, fallback locations, and wheel contents. This phase should not change the ABI.
2. Define exact generated artifact names and schemas for ABI inventory, descriptor disposition manifest, FFI command metadata, return metadata, and stub/runtime surface mapping.
3. Split the implementation into explicit gates: descriptor parity contract, PyO3 registration helper, PyO3 `src/lib.rs` update, Python metadata-driven bridge, fallback removal, lifecycle/error/security tests, XLSX coverage, packaging provenance, then optional GIL release.
4. Add compatibility policy for `_native`: internal generated module versus public low-level API, snapshot stability expectations, and how renamed or removed native commands are handled.
5. Require every `unsupported` or `omitted` disposition to include a stable reason enum, owner package, owner team/person or issue key, blocker category, and a test proving the Python-visible path raises the generated `UnsupportedApiError` when applicable.
6. Make prelude migration concrete by expanding `compute_core::bridge_types::*` coverage first, then adding a compile-time cross-target test that WASM, N-API, and PyO3 resolve descriptor-visible bare names through the same prelude.
7. Turn fallback removal into a categorized audit with acceptance criteria, rather than one broad sweep. Separate missing-native `hasattr` fallbacks, broad swallowed exceptions, source-tree import fallbacks, user-input parsing helpers, and explicit unsupported proxies.
8. Move GIL release to a separate final phase with a generated-wrapper ownership checklist and concurrency tests, so it does not block the core ABI/disposition correctness work.
