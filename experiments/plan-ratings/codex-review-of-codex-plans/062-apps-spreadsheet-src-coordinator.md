Rating: 8/10

Summary judgment

This is a strong, source-aware plan for a legitimately central and overgrown coordinator folder. It correctly identifies that `sheet-coordinator.ts` is no longer just a composition root, that floating-object EventBus projection and receipt projection are duplicated production paths, that lifecycle disposal is only partially guarded, and that actor access, host globals, sparkline cache hydration, and shell coordination all have implicit contracts that should be made explicit.

The rating is not higher because the plan is broader than its contract detail. It names the right architectural direction, but several workstreams need exact API shapes, phase boundaries, and acceptance criteria before implementation agents can compose safely. The shell ownership item is still a decision point rather than a resolved specification, and the plan does not explicitly pull the inline object mutation callbacks in `SheetCoordinator` into the same "composition root only" cleanup contract.

Major strengths

- The plan is grounded in the actual production path. The current coordinator is more than 1,100 lines, contains cross-system wiring, async floating-object hydration, renderer patching, toolbar sync, sheet-switch coordination, and devtools reporting; the plan targets those real paths rather than a test-only abstraction.
- The floating-object work is the strongest part: unifying EventBus push events and dispatcher receipt pull results through one projection reducer/service is the right architectural move, and the listed cases cover create, update, bounds-only update, remove, duplicate delivery, renderer absence, and disposal races.
- The plan preserves the key ownership boundary: Rust Workbook/Worksheet APIs remain durable state, while coordinator caches remain session-local projections and invalidation machinery.
- Verification is serious and production-relevant. It calls for package tests, typecheck, focused coordinator tests, and UI/eval coverage through real interaction paths for cross-sheet editing, drawings, sparklines, and object deletion/duplication.
- The plan notices stale existing tests: the current receipt propagation tests simulate dispatcher logic instead of calling `dispatch(...)`, while `dispatcher.ts` already processes receipts for sync and async action results.
- It correctly identifies ambient-host dependencies in this folder, including `Date.now()`, `queueMicrotask`, `requestAnimationFrame`, and devtools globals, and ties their removal to deterministic tests and platform dependency inventory cleanup.

Major gaps or risks

- Scope is very large for one folder plan: floating-object projection, lifecycle registry, host threading, actor-access migration, mutation helper normalization, sparkline hardening, shell relocation, docs, platform inventory, and E2E coverage are all included. The parallelization notes help, but the plan needs explicit phase boundaries and merge order so agents do not edit the same contracts in incompatible ways.
- `CoordinatorHost` is described by capability names but not specified as an exact interface, default browser implementation, test implementation, or construction path through `createSheetCoordinator`, `CoordinatorProvider`, dispatcher/action dependencies, and existing tests.
- The shared floating-object reducer contract needs more precision: normalized event shape, equality/idempotence rules, structural-sharing expectations, delete-vs-update precedence, bounds-only semantics, and how changed fields affect renderer patches should be written as acceptance criteria.
- The plan says to keep `SheetCoordinator` as a narrow composition root, but it does not explicitly address the inline object mutation callbacks passed into `ObjectSystem` from the coordinator constructor. Those are production mutation behavior and should be extracted or contracted along with the wiring modules.
- The shell coordinator item remains undecided: "move it" or "retain it" gives implementers latitude that can produce divergent architecture. A plan at this rating level should choose the owner or define a decision gate with required evidence.
- Actor-access tightening is correct but underspecified. It should name the consumers to migrate, the final exported type, and whether broad merged access remains available only internally or disappears entirely.
- Sparkline hardening is well motivated, but cache rollback/error semantics are not specified. Current methods update local cache before awaiting Worksheet API writes; the plan should state whether failed writes roll back, rehydrate, or emit an explicit error path.

Contract and verification assessment

The contract coverage is good but uneven. The plan has clear invariants for durable state ownership, receipt processing, sheet switching, selection exclusivity, editor focus, pending format replay, toolbar sync, connector rerouting, sparkline reads, read-only enforcement, and dependency direction. These are the right things to preserve.

The verification gates are mostly appropriate: `pnpm --filter @mog/app-spreadsheet test -- src/coordinator`, targeted dispatcher receipt tests, and `pnpm --filter @mog/app-spreadsheet typecheck` are the right package-level gates, and the UI/eval list is production-path oriented. The plan would be stronger if each major extracted contract had a named test file or fixture strategy, especially for scheduler/disposal determinism and projection idempotence.

The biggest verification gap is acceptance specificity. "Equivalent patches" and "idempotent where possible" are not crisp enough for parallel agents. The plan should define observable outputs for each normalized projection case and require tests to assert cache contents, object reference preservation, renderer patch order, and no late side effects after disposal.

Concrete changes that would raise the rating

- Add a Phase 0 contract appendix with exact TypeScript interfaces for `CoordinatorHost`, `FloatingObjectProjectionService`, normalized projection events, reducer output, `CoordinatorWiringRegistry`, and the typed actor-access aggregate.
- Split the implementation into numbered phases with independent exit gates: receipt/dispatcher tests, floating-object reducer/service, lifecycle registry, host threading, actor-access migration, mutation helpers, sparkline, shell ownership, docs/evals.
- Resolve the shell ownership decision in the plan, or define a short decision gate with required dependency-direction evidence and the exact output path.
- Explicitly include the inline `ObjectSystem` mutation callbacks currently created in `SheetCoordinator` in the extraction/normalization scope.
- Replace vague idempotence language with concrete reducer rules for duplicate create/update, delete-after-update, update-after-delete, bounds-only updates, missing bounds, missing renderer, and cross-sheet object id collisions.
- Define rollback or rehydration behavior for sparkline cache updates when Worksheet API writes reject.
- Name the real dispatcher tests to add and require them to call `dispatch(...)` for both sync and async handlers instead of copying the dispatcher receipt snippet.
