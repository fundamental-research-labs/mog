Rating: 8/10

Summary judgment

This is a strong, evidence-heavy plan with a good read on the coordinator folder's real risks: `sheet-coordinator.ts` has grown beyond a composition root, floating-object projection is split across divergent push/pull paths, stale/dead mutation modules distort the surface, and several cross-system features silently depend on optional wiring. The plan is architecturally sympathetic to the existing system boundaries and does a notably good job naming invariants that must survive the refactor.

It falls short of a 9 or 10 because a few priorities are overstated as production-path work. `ShellCoordinator` appears to be uninstantiated in the current app path, and the untyped coordinator overload of `createActorAccessLayer` is exported but current app callers still use the `ActorBundle` path. Those may be valid cleanup targets, but the plan should classify them as latent/dead-surface work before treating them as production-critical. Several new contracts are also described directionally rather than specified.

Major strengths

- The evidence is concrete and mostly checks out against the tree: the false `~250-line` header, duplicated projection/patch logic, orphaned `equation.ts` and `diagram.ts`, stale doc references, optional dependency gates, and `ShellCoordinator` TODO/no-op wiring are real.
- The floating-object section preserves the right subtle invariants: subscribe-before-populate, generation guards after awaits, created-vs-updated classification, bounds backfill, structural sharing, and sheet-switch resync.
- The dependency direction is appropriate. The plan keeps `coordinator` as an app composition layer and avoids pulling `views/` or public contracts in the wrong direction.
- Sequencing is sensible: delete dead modules first, extract the largest projection block before smaller cross-system wiring modules, then handle typing/config/doc cleanup.
- Verification thinking is broad enough for the blast radius: unit tests for extracted helpers plus app-eval coverage for formula return, pending formats, sheet switching, toolbar state, connector reroute, and floating-object repaint.

Major gaps or risks

- `ShellCoordinator` should be inventoried before being fixed. Current source suggests `app/Shell.tsx` still has a TODO to use it, `use-shell-coordinator.ts` is `any`-typed context plumbing, and no `new ShellCoordinator`/`switchView` production instantiation appears. That makes step 6 less production-path-relevant than the plan claims.
- The actor-access risk is real but likely misprioritized. Existing app callers found in `use-action-dependencies.ts` pass an `ActorBundle`; the untyped coordinator merge overload is not obviously the live path. The plan should decide whether to delete, deprecate, or migrate to that overload instead of only retyping it.
- `FloatingObjectProjection` is underspecified as an API. The plan needs exact lifecycle and ordering contracts for `start`, `dispose`, receipt processing, event scheduling, pending microtasks, and renderer patch application, especially when synchronous receipts arrive while async EventBus work is pending.
- The resolved wiring config lacks a definition of "expected dependency." Minimal/no-doc/test configurations intentionally omit dependencies today; diagnostics could become noisy unless the plan defines feature modes, severity, and metric payload shape.
- Step 7 on `mutations/tables.ts` is adjacent but not tightly integrated. Some functions appear unused, while `applyCalculatedFormulasToNewRow` flows through renderer/table coordination as a `void` callback. Returning `Promise` is a contract change and should either be scoped separately or specified through those callback types and call sites.
- The verification gates are good categories but not exact commands or scenario names. A landing plan should name the `pnpm --filter @mog/app-spreadsheet ...` commands and the specific app-eval scenario files to run or create.

Contract and verification assessment

The plan's contract section is one of its best parts: it explicitly preserves `SheetCoordinator` public methods, system startup/dispose order, viewport-follow single source of truth, formula return semantics, pending-format guards, connector endpoint compatibility, DAG boundaries, and read-only flow.

The missing contracts are the new ones introduced by the plan: the `FloatingObjectProjection` public interface, the shared patch-builder inputs/outputs, the `ResolvedWiringConfig` type and diagnostic event schema, and the typed actor-access merge/collision behavior. Without those, implementation agents could produce incompatible but locally plausible refactors.

Verification is appropriately production-oriented, but should be made executable. Add exact Jest targets for existing and new coordinator tests, exact typecheck command, grep/importer gates for orphan deletion, and concrete app-eval scenarios driven through real UI input paths.

Concrete changes that would raise the rating

1. Add a pre-step that inventories `ShellCoordinator` and the coordinator-based actor-access overload as live, latent, or dead; then change the plan accordingly.
2. Specify the `FloatingObjectProjection` API and ordering semantics before implementation.
3. Define `ResolvedWiringConfig` and the `onMetric`/warning diagnostic payloads, including how intentional minimal configs opt out.
4. Tighten step 7 by tracing all table mutation call sites and explicitly updating callback return types, or split it out as a separate follow-up.
5. Replace generic verification bullets with exact package commands and named app-eval scenarios/tests.
6. Keep the two-phase projection migration explicit: pure extraction first, shared push/pull classification second, behavior tests after each phase.
