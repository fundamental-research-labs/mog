Rating: 8/10

Summary judgment

This is a strong plan. It correctly identifies `mog/shell/src/host` as a high-blast-radius production boundary and bases the work on real code paths: `AppSlot` owns launch state and capability fallback, `ErrorBoundary` is currently console-only, `createManagedTables` can return empty bindings on missing APIs, `useAppDocument` can overwrite the current handle, and `ensureAppTables` remains exported despite being deprecated. The plan also does better than most by naming invariants, sequencing the work into coherent phases, and proposing behavior tests rather than only type gates.

The rating is not higher because several of the riskiest changes are still specified as intentions rather than contracts. In particular, document eviction/deletion, setup rollback, fail-closed capability policy, callback firing semantics, and table-placement sizing need tighter API-level definitions before an implementation agent can safely execute them without inventing policy mid-stream.

Major strengths

- The production-path diagnosis is accurate. The current `AppSlot` writes launch state after async `launchApp`, falls back to `createUngatedAdapter` when capability context or manifest capabilities are absent, logs during render/launch, and wraps apps in a profiler unconditionally. The plan targets those exact paths rather than test harnesses or mocks.
- The invariant list is valuable. I1-I9 gives implementation and review agents a concrete behavioral frame for isolation, stale async writes, capability gating, setup atomicity, document-handle conservation, unload flushing, registry truth, and loading continuity.
- The plan has good architectural fit. It keeps capability-system internals, app launcher, kernel `DocumentFactory`, and app implementations out of scope while hardening the host call sites that actually own policy decisions.
- The test plan is meaningfully tied to behavior: stale launch resolution, permission denied, missing capability context, boundary retry remount, hook callbacks, document disposal, lifecycle flushing, and managed-table setup are all verifiable outcomes.
- Sequencing is mostly reasonable. Race safety, observability, fail-closed policy, setup atomicity, document cleanup, logging, and public-surface retirement are separated enough that parallel agents could work on independent slices, with the coupled setup phases called out.

Major gaps or risks

- The fail-closed capability policy needs a sharper contract. `allowUngatedFallback?: boolean` is a useful control, but the plan does not define whether the permission is host-wide, per app, per manifest, or limited to a trusted first-party list. It also conflates two cases that may need different treatment: no `CapabilityProvider` context, and a manifest without declared capabilities. Before implementation, this should specify the exact allowed legacy apps, exact embedding sites to update, and the terminal error shape.
- Host hooks need exact semantics. The plan lists `onAppLaunch`, `onAppReady`, `onPermissionDenied`, `onAppError`, and `onAppCrash`, but does not say whether callbacks fire once per launch generation, once per state transition, after setup or before setup, on retry, or how callback exceptions are handled. Without that, an implementation could accidentally fire `onAppReady` repeatedly due to effect churn or let telemetry failures break app launch.
- Race safety is under-scoped. The plan covers `doLaunch` and the binding-editor table list, but `useAppInstanceSetup` also has async `resolveBindings`, `createTablesInFreshDocument`, and `completeBinding` paths that call `setState` after awaits. The same generation/cancellation contract should be applied there, especially because `appId`, `manifest`, and `kernel` can change while setup is in flight.
- Setup rollback is not implementable from the plan alone. "Tear down partially created sheet/tables" or "discard the whole fresh document" is directionally right, but the plan does not name the available sheet/table/document deletion APIs, what happens if rollback itself fails, or what invariant should hold in IndexedDB after a partial failure. This is one of the highest-risk changes and needs a concrete cleanup strategy.
- Document retention is left as a product decision while still being part of the implementation phase. The plan correctly calls out that auto-deleting superseded "Start Fresh" documents can be destructive, but an implementation plan should not require product sign-off in the middle of a hardening task. It should either specify a non-destructive bounded retention contract or split persistent deletion into a separate decision.
- Table placement is underspecified. Replacing `DEFAULT_DATA_ROWS = 10` with "derive from schema" is good in principle, but current table schemas may not include row counts. If the solution needs a manifest row hint, this becomes a contracts change and must define the type, defaults, declaration rollup, and migration of existing manifests.
- Public API removal needs a complete export/import contract. The plan says to remove `ensureAppTables` from `host/index.ts`, but it is also re-exported from `shell/src/index.ts`. The implementation checklist should explicitly include all public re-export surfaces and downstream importers in sibling repos if public packages consume it.

Contract and verification assessment

The plan's contract language is much better than average. The invariants are concrete enough to review against, and most proposed tests map directly to those invariants. I especially like the explicit preservation of the unload-flush contract and the continuous `loadingFallback` contract, because those are easy to break while refactoring.

The weakest contract areas are the new behavior surfaces: capability fallback policy, host-hook ordering/idempotency, retry/remount behavior, setup rollback, and document retention. These should be specified in terms of observable states and exported types, not only implementation techniques.

The verification gates are good but should be made executable. `pnpm --filter @mog/shell typecheck`, scoped host tests, and app-eval smoke are appropriate. The plan should also name the exact package test command for the host tests and include a browser/dev-server exercise if UI behavior changes are made, per repo guidance. For public type changes or `ensureAppTables` removal, it should require checking downstream public exports and any declaration/package readiness gate used by `@mog/shell`.

Concrete changes that would raise the rating

- Define `UngatedFallbackPolicy` precisely: host-wide vs per-app, default, allowed app IDs, error state shape, audit/hook event payload, and exact embeddings/tests that must opt in.
- Add callback contracts: fire points, order, stale-generation suppression, retry behavior, and whether callback exceptions are caught and routed to dev logging.
- Extend the generation/cancellation plan to `useAppInstanceSetup` and `useAppDocument`, not only `AppSlot`.
- Replace setup rollback placeholders with named cleanup APIs and a failure contract for partially created sheets/tables/documents.
- Decide document retention before implementation: non-destructive handle disposal only, bounded LRU, explicit delete API, or a separate product plan for persistent document deletion.
- Specify the managed-table row sizing contract, including whether it requires a contracts package change and manifest migration.
- Expand the public-surface removal checklist to include `shell/src/index.ts`, package exports, sibling repo import searches, and the exact type/package verification gate.
