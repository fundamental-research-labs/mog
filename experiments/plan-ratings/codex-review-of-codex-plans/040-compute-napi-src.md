Rating: 8/10

Summary judgment

This is a strong, evidence-backed plan for `compute/napi/src`. It correctly treats the N-API layer as a production ABI boundary rather than a thin implementation detail, and it connects the Rust addon, generated bridge metadata, Node transport, SDK collaboration path, chart export path, and platform binary wrappers into one verifiable contract. The plan's best quality is that it does not stop at the visible Rust files: it follows the production consumers that make those exports meaningful.

The rating is not higher because the plan reads more like a multi-epic architecture roadmap than a sharply bounded implementation plan. It identifies the right classes of defects, but several target contracts are still described at the level of intent rather than exact artifacts, migration rules, and acceptance criteria. A worker could implement compatible-looking changes while still making different choices about export names, object shapes, error codes, ABI snapshot format, and phased SDK compatibility.

Major strengths

- The plan's diagnosis matches the current source. `lib.rs` has a generated `ComputeEngine` surface but a hand-maintained import prelude and descriptor list; `coordinator.rs` uses reusable numeric handles, JSON string payloads, and some `unwrap()` serialization paths; `chart_render.rs` returns a typed result but accepts an untyped JSON request string.
- It correctly expands scope to adjacent production-path contracts. The observed drift between `compute_take_init_result` and `takeLifecycleResult`, the `DEFAULT_NAPI_SERDE_PARAMS` manual override map layered on top of `NAPI_SERDE_PARAM_INDICES`, and the public platform package loader are all real production concerns outside the three Rust files.
- The core architectural direction is sound: generated ABI inventory, descriptor parity, serde metadata from Rust bridge parameter tags, lifecycle unification, session-scoped clock injection on the engine execution path, owned coordinator objects or generation-stamped handles, and binary-wrapper self-tests.
- The verification section is unusually strong. It includes Rust crate gates, native addon behavior gates, transport and SDK gates, package-boundary gates, and behavior-specific gates for ABI freshness, lifecycle parity, clock isolation, stale handles, and chart raster sanity.
- The parallelization notes are realistic and respect package boundaries. The proposed slices have clear ownership across bridge codegen, transport metadata, lifecycle/clock, coordinator, chart raster, and packaging.

Major gaps or risks

- The plan needs a clearer first deliverable. It says "out of scope for the first implementation slice" but then proposes fifteen large steps spanning codegen, compute-api, compute-core clock plumbing, transport, SDK, packaging, chart render, and coordinator redesign. It should name the minimal first merged contract and define what remains intentionally failing or deferred.
- ABI compatibility and migration are under-specified. Replacing coordinator `u32` handles with an object class and unifying lifecycle accessors can break existing internal SDK callers and tests. The plan should state whether old exports remain temporarily, are classified as internal/deprecated in the snapshot, or are removed in the same change.
- The ABI snapshot contract is not concrete enough. It calls for export classification, owner descriptor group, return encoding, and public SDK reachability, but does not specify the snapshot file location, schema, generated-vs-handwritten merge rule, update command, or how napi-rs camelCase/snake_case naming is normalized.
- The exact serde metadata fix is right, but the plan does not pin the bridge IR field or parser contract that distinguishes `[serde]`, `[str]`, `[parse]`, `[prim]`, and `[bytes]`. Without that, an implementer could keep inferring from TS shapes in a different place.
- The clock fix is architecturally important but needs a sharper design contract. "Move onto the engine execution path" should identify the intended hook in `ComputeService` or dispatch, how per-session time is stored, and how concurrent N-API engines avoid shared process/thread-local contamination.
- The coordinator object redesign needs exact JS/Rust shapes. It should specify class name, constructor/factory behavior, `dispose()` semantics, finalizer behavior, double-dispose behavior, and whether SDK wrappers can share one coordinator instance safely across engines.
- Chart raster work partially overlaps existing versioned request serialization tests. The plan should distinguish what is missing at the native boundary from what already exists in SDK serializer tests and state the shared schema owner.
- Some listed gates are broad and may be expensive or platform-limited. That is acceptable for final integration, but the sequencing should separate per-slice gates from release gates so workers know what must pass before each PR.

Contract and verification assessment

The contract posture is the plan's strongest area. It explicitly treats the addon export surface, descriptor group parity, N-API serde parameter modes, lifecycle one-shot result, byte-tuple return framing, coordinator ownership, chart request validation, and platform wrapper package contents as contracts that should be generated or snapshotted. That is the right framing for this folder.

Verification is also production-path oriented. The plan avoids relying only on mocks and smoke tests, and it calls for tests against the built `.node` binary plus the public wrapper package path. The gaps are mostly precision gaps: the plan should define the ABI inventory schema, the return-encoding metadata schema, stable error-code/tag conventions, malformed-buffer expected errors, and exact lifecycle accessor name before implementation begins.

Concrete changes that would raise the rating

- Add a "first merge target" section with exact files/artifacts, acceptance criteria, and deferred work. For example: ABI inventory plus lifecycle accessor unification plus serde metadata generation, before coordinator/chart rewrites.
- Include a current-vs-target export table for `ComputeEngine`, free functions, coordinator exports, chart exports, and XLSX exports, with dispositions: public SDK reachable, internal, deprecated transitional, or removed.
- Specify the ABI snapshot JSON shape and generation command, including how generated descriptor exports and hand-written exports are merged and how naming conventions are normalized.
- Define the lifecycle contract exactly: final JS method name, one-shot null/undefined behavior, shape of the returned `RecalcResult`, constructor path behavior, `initFromYrsState` behavior, and required SDK/transport mock updates.
- Define the coordinator replacement contract exactly: class name, method signatures, typed N-API object structs, error codes, disposal/finalizer semantics, and transitional compatibility policy for numeric handles.
- Add a concrete clock design note naming the compute dispatch hook and the per-engine/session time source, plus the two-engine regression expected values.
- Split verification into per-slice required gates and final release gates, while keeping the broader package and matrix checks as final integration requirements.
