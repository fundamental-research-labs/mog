Rating: 8/10

Summary judgment

This is a strong plan with unusually good production-path evidence. It correctly identifies the hand-written N-API coordinator as the highest-risk surface in `mog/compute/napi/src`, and its key findings line up with the current code: the global coordinator table lock is held through `f(&mut coord)`, bare `u32` slot handles are reused, `coordinator_create_from_state` uses a different allocation policy, JSON serialization unwraps exist on FFI paths, invalid touched sheet IDs are silently filtered out, and consumers currently parse JSON strings through `any` casts.

The plan is not yet a 9 or 10 because several proposed fixes need sharper API contracts before implementation. In particular, the async migration, typed-object migration, handle representation, and dispose behavior are still presented with alternatives rather than one verifiable target contract. The plan also overstates the immediate concurrency payoff of dropping the global mutex while the exported functions remain synchronous on the Node event loop; that change is still worthwhile, but it mainly enables multi-threaded/async execution and reduces lock poisoning blast radius until async variants exist.

Major strengths

- The plan focuses on the real production binding path rather than test-only scaffolding. It names the Node/server addon, the runtime SDK wrapper, chart exporter, kernel collab tests, api-eval, and xlsx-corpus harness as consumers.
- The evidence is concrete and mostly precise. The lock lifetime, stale-handle aliasing, inconsistent allocation path, `.unwrap()` calls, and `filter_map` sheet-ID bug are all real defects or credible risks in `coordinator.rs`.
- The dependency boundaries are generally sound. It does not try to move CRDT, lock-table, chart-layout, or bridge macro semantics into this folder.
- The plan treats exported symbol names and byte fidelity as contracts, which is exactly the right posture for an N-API boundary.
- The sequencing is directionally good: fix handle/table safety first, then migrate protocol shape, then move blocking work off-thread.

Major gaps or risks

- The handle contract is under-specified. A monotonic `u64` Rust key does not automatically "keep the JS type number" safely. The plan should choose an exact JS-visible type and range strategy: keep `number` with a checked safe-integer/generation encoding, use `BigInt`, or use an opaque string. It should also specify overflow behavior.
- The typed protocol phase is not concrete enough. `PushResult` is described as "or model it as a tagged union the way napi best supports", and error channels are mixed between thrown errors and discriminated result objects. Unknown participant and sync errors currently throw; lock violation currently returns `{ ok: false }`. The plan needs one exact contract for each outcome.
- The async phase is too ambiguous. "Keep existing synchronous names as thin shims (or behind the same name with an async signature)" is a breaking-design fork. Promise-returning N-API exports should be additive unless every consumer migration lands atomically. The plan should name the new exports, return types, and deprecation path.
- Phase 1's concurrency benefit needs qualification. With synchronous N-API calls from one Node event loop, independent document operations are serialized before they reach Rust. Dropping the global lock is still correct, but the plan should state that full parallelism arrives only with Node worker threads or the planned async tasks.
- The scope boundary is somewhat inconsistent. The plan initially scopes edits to the three Rust source files, but later requires runtime SDK, chart exporter, smoke-test, generated declarations, and possibly package/test wiring. That is acceptable for a real fix, but it should be split into explicit per-repo/per-package deliverables.
- The plan does not systematically cover all stringly coordinator surfaces. It calls out join, push, lock scope, and active locks, but awareness APIs and `yrs_state_to_snapshot_json` need explicit treatment: either keep them string JSON because the payload itself is JSON, or type them with clear object/buffer contracts.
- Dispose semantics are left open. "Return whether it existed, or keep `()`" is not a contract. Existing consumers treat dispose as `void`; stale-handle behavior, double-dispose, dispose-during-async, and post-dispose in-flight task completion need one specified behavior.

Contract and verification assessment

The contract assessment is the strongest part of the plan, but the contract definitions are not fully implementable yet. The plan correctly protects exported names, binary byte fidelity, coordinator authoritativeness, lock semantics, `ComputeEngine` drop cleanup, and chart-render semantics. It should turn the proposed typed objects into exact `#[napi(object)]` structs with field casing, optionality, error strings, and Buffer ownership spelled out.

The verification gates are good but incomplete. `cargo test -p compute-core-napi`, a smoke test, byte-fidelity checks, exported-symbol checks, api-eval, xlsx-corpus, and collab e2e are all relevant. The plan should also require `cargo clippy -p compute-core-napi` for the Rust changes and the relevant `pnpm test` plus `pnpm typecheck` for TypeScript consumer migrations. If generated `index.d.ts` is the source of truth for N-API type shape, the plan should specify how it is generated, compared, and gated without relying on a gitignored artifact as an informal manual check.

Concrete changes that would raise the rating

- Specify the exact handle type and lifetime contract, including JS representation, safe-integer/BigInt/string choice, overflow behavior, stale handle error text, double-dispose behavior, and dispose-during-async behavior.
- Replace protocol sketches with exact N-API object definitions for join, push, locks, active locks, and any awareness methods that are in scope. Explicitly decide which failures throw and which return discriminated objects.
- Make async exports additive and named, for example `coordinator_push_async` and `render_chart_marks_image_async`, unless the plan commits to a single atomic breaking migration. Include ordering guarantees and libuv threadpool saturation considerations.
- Split implementation deliverables into local Rust binding changes, runtime SDK consumer changes, kernel collab test updates, and package/smoke-test gating changes so ownership and sequencing are verifiable.
- Add `cargo clippy -p compute-core-napi`, relevant package `pnpm test`, and `pnpm typecheck` to the required verification gates for any implementation that touches Rust plus TypeScript consumers.
- Clarify that dropping the global table lock is still required, but full multi-document CPU parallelism depends on async/worker-thread execution, not only the table refactor.
