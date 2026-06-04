Rating: 7/10

Summary judgment

This is a well-researched plan with a strong diagnosis of the current PyO3 binding surface. It correctly identifies that `compute/pyo3/src/lib.rs` generates many pure functions but registers only `ComputeEngine` and `pivot_detect_fields`, and it frames that as a production native-surface contract rather than a cosmetic cleanup. The proposed direction, especially adding macro-generated registration helpers in `bridge-pyo3` and verifying native exports, is architecturally appropriate.

The main reason it is not higher is that the central contract is still left as an investigation. The plan says Stage 0 must partition every generated pure function into REGISTER or DROP, but does not provide the actual generated function inventory or the final partition. For this repo's specification bar, that is the core spec, not a preliminary task. The plan also leans on `api_dispositions.json` as the parity oracle even though that manifest describes high-level Python `wb`/`ws` wrapper paths, not native `_native` exports. Without an explicit native-export manifest or mapping rule, an implementer still has to infer the most important boundary.

Major strengths

- The evidence is grounded in the actual production path: `lib.rs`, `bridge-pyo3` macro expansion, the Python `_bridge.py` wrapper, the pivot fallback, `verify_surface`, packaging metadata, and README gates.
- It preserves the right invariants: `ComputeEngine` name and JSON calling convention, `pivot_detect_fields` compatibility, abi3/extension-module packaging, the `compute_api` re-export, and the rule that semantics stay in compute crates rather than in the PyO3 shim.
- The durable macro-registration direction fits the architecture better than hand-listing `wrap_pyfunction!` calls forever.
- It recognizes cross-folder dependencies instead of pretending `lib.rs` alone can solve macro emission, Python verification, stub generation, and version checks.
- The verification intent is production-path relevant: import the actual native extension, assert exported symbols, exercise registered functions, and keep existing Python SDK gates green.

Major gaps or risks

- The intended stateless native surface is not specified. The plan must enumerate the current generated functions and mark each as REGISTER, DROP, or SKIP-TARGET with rationale. Saying "determine from `api_dispositions.json` and sub_api call sites" leaves the key contract undefined.
- `api_dispositions.json` is not a native-export manifest. Many dispositions are wrapper-level, Python-only, unsupported, renamed, or engine-method-backed. The plan needs a separate native surface manifest or an explicit field in the generated surface that maps Python paths to native `_native` functions or `ComputeEngine` methods.
- Scope is internally inconsistent. The plan says the edit target is `mog/compute/pyo3/src/lib.rs` only, but the actual durable fix requires edits in `infra/rust-bridge/bridge-pyo3`, `compute/pyo3/python/mog`, scripts, tests, and possibly descriptor crates. That may be the right architecture, but the implementation scope should be widened explicitly.
- Stage 2's "drop unreachable functions" could remove useful cross-target bridge coverage unless coordinated with WASM/Tauri/NAPI descriptor expectations. The plan notes descriptor owners, but it needs exact criteria for when a pure descriptor remains generated for other targets but is skipped for PyO3.
- The registration helper API is underspecified. It should define exact helper names, visibility, Rust naming style, duplicate handling, PyO3 version compatibility, and whether helpers register all generated functions or only functions selected for PyO3.
- The import cleanup objective is partly a symptom of descriptor design. Removing `#[allow(unused_imports)]` may be brittle until descriptors emit fully qualified type paths; the plan should treat that as a separate descriptor-layer deliverable or limit `lib.rs` cleanup to proven-unused imports after compile.
- Version metadata is useful, but the plan does not specify how source-tree smoke imports behave when the package is not installed, nor whether version equality is enforced at build time, import time, or both.

Contract and verification assessment

The plan's contract language is strong around what must not change, but weak around what must be exported. "Native exports equal intended Python SDK surface" is too broad because the public Python SDK surface is not the same object as the `_native` module surface. The contract should instead name three sets: native module exports, `ComputeEngine` methods consumed by wrappers, and public Python `wb`/`ws` dispositions. Then verification can assert the intended relationships between those sets.

The verification gates are directionally good but need exact runnable commands and fixture definitions. A strong version would name the Rust gates for both `bridge-pyo3` and `compute-core-pyo3`, the Python SDK command that builds/installs the native module, the strict surface check, and the specific tests added for pivot/native free functions and wheel contents. The native export check should filter dunder/module metadata deliberately and should compare against a checked-in expected native surface, not a dynamically inferred set that can drift with implementation mistakes.

Concrete changes that would raise the rating

- Add the complete generated pure-function inventory for `PivotBridge`, `TableBridge`, `ChartBridge`, `FormatBridge`, `SchemaBridge`, `CfBridge`, `ClockBridge`, and `XlsxParser`, with a final REGISTER/DROP/SKIP-TARGET decision for every method.
- Define a first-class native surface manifest, or extend the generated API surface with explicit native backing metadata, instead of deriving native exports indirectly from high-level dispositions.
- Widen the plan scope explicitly to include `bridge-pyo3`, Python wrapper/tools/tests, and descriptor crates, or split those into prerequisite plans with clear integration contracts.
- Specify the generated registration helper shape precisely, using snake_case helper names, deterministic duplicate detection, and compile-time tests for emitted registration.
- Replace vague verification bullets with exact gates such as the relevant `cargo test`/`cargo clippy` packages, `pnpm check:python-sdk`, strict surface/stub audits, and an installed-wheel import check.
- Clarify version enforcement for installed wheels versus source-only smoke imports, and add a build-time version consistency check if import-time enforcement is expected.
