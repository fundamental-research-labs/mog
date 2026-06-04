Rating: 8/10

Summary judgment

This is a strong, production-relevant hardening plan for `mog/types/objects/src`. It correctly treats the package as a canonical contract surface rather than a cosmetic type cleanup, and its findings line up with the current source: the root barrel is intentionally empty, `floating-object-types.ts` still emits a runtime `_typeCheck`, there are incompatible `DrawingObject` exports in `objects/drawing-object.ts` and `ink/types.ts`, and the gradient/effect/text-run duplicates are real. The plan also understands the contracts shim layer, the renderer/kernel projection boundary, and the importance of preserving wire and OOXML parity.

The rating is not higher because several important contract decisions are still delegated to the implementer. The biggest weak spot is the `sheetId`/`containerId` and `position`/`anchor` migration: the plan states the desired end state but does not provide a precise compatibility contract, staged migration matrix, or source-of-truth rules for existing production readers. The consolidation phase also identifies the duplicate type families but leaves too much ambiguity around final canonical shapes, unit normalization, naming, and deprecation behavior.

Major strengths

- Accurate source inventory and package-boundary framing. The plan names the actual package, subpaths, dependency ceiling, empty root barrel, and contract-shim relationship.
- The core problem selection is correct. The two `DrawingObject` meanings are incompatible, and the repeated `GradientStop`, `GradientFill`, `LineDash`, `TextRun`, and effect types are exactly the kind of contract drift that should be solved once.
- The plan is production-path aware. It explicitly preserves `FloatingObjectSnapshot = FloatingObject`, renderer projection semantics, Rust-owned anchor math, `ISceneGraphReader` boundaries, and generated-wire parity.
- Sequencing is mostly sound. Resolving the `DrawingObject` collision before broader type consolidation reduces rename confusion, and leaving barrel/docs cleanup until after final names are known is the right dependency order.
- Verification goes beyond "it typechecks." The proposed gates include contracts rollup, downstream consumers, type-level assertions, no-cycle enforcement, duplicate-name enforcement, runtime-emit inspection, wire parity, and app/api smoke coverage.
- Cross-folder coordination is called out instead of hidden. The plan correctly requires matching changes in `mog/contracts/src/*` shims when public subpaths or exported names move.

Major gaps or risks

- The alias migration is underspecified for the actual production graph. Current source has live production reads and writes of `sheetId`, `containerId`, `position`, and `anchor` across kernel projection, object managers, diagram bridge code, and canvas-object manager code. A plan that targets removal needs an explicit migration contract: which field is authoritative at creation, persistence, bridge mapping, projection indexing, grouping, duplication, clipboard, and old-document load time.
- Public compatibility is treated too casually. Even though `@mog/types-objects` is private, `@mog-sdk/contracts/drawing` re-exports the resolved drawing object surface. The "prefer a clean rename since all consumers are in-repo" guidance is risky unless the plan proves no published SDK surface or examples depend on `DrawingObject`. A deprecated alias window should be the default for contracts shims unless a separate public-API audit proves otherwise.
- The canonical structural-type plan is not concrete enough. "Pick the superset" is not a contract. The plan should specify the final canonical type names, fields, units, and mapping rules, especially for `offset` versus `position`, 0-1 versus 0-100 gradients, `longDash` versus `lgDash`, the `'path'` gradient variant, and effect fields that differ between diagram and text-effects domains.
- The duplicate-export guard is directionally good but not integrated. The plan does not say where the script lives, how it discovers exported declarations under package subpaths, which duplicate names are allowed as intentional aliases, or which package/CI command owns the gate.
- The layering guard is also underspecified. "eslint import/no-cycle or dependency-cruiser or CI grep" gives implementers too much latitude for a contract invariant. The plan should choose the enforcement mechanism that fits existing repo tooling and define the exact forbidden edges.
- Phase 6 risks becoming cross-repo/cross-layer churn. Making `ImportObjectStatus` canonical here may be right, but the plan does not establish whether `file-io/xlsx/bridge` is allowed to depend directly on this package or should depend through contracts. It should state the dependency direction explicitly before asking file-io to import from this source.
- Some verification gates are named as areas rather than commands. "Downstream typecheck the direct consumers" and "app-eval / api-eval smoke" should become exact filters or scenario names so completion is mechanically checkable.

Contract and verification assessment

The contract assessment is the best part of the plan. It identifies the important invariants: `FloatingObjectKind` assignability to `CanvasObjectType`, full-union snapshots, opaque renderer payloads, no new dependencies beyond core/viewport, cycle-free subtype layering, and preservation of Rust/wire/OOXML structural compatibility. Those are the right contracts to protect.

However, the plan should distinguish three different compatibility classes more sharply:

- Private internal type cleanup inside `@mog/types-objects`.
- Public re-export compatibility through `@mog-sdk/contracts/*`.
- Persisted or generated wire compatibility across kernel and file-io boundaries.

Those classes should not all use the same rename policy. A private collision can be removed aggressively; a contracts export probably needs an alias and deprecation note; a persisted/wire shape needs adapter tests and old-fixture coverage.

The verification suite is broad and mostly appropriate, but it needs to become more executable. The package gate should name the exact command, likely the package script or `pnpm --filter @mog/types-objects typecheck`. The contracts rollup gate is good. Downstream checks should name concrete filters for the packages that import the renamed exports. Type-level assertions are essential, but the plan should say whether this repo already uses `tsd`, `expect-type`, or plain `*.test-d.ts` compiled by `tsc`. The no-runtime-emit and duplicate-name gates are valuable only if wired into a repeatable package script or CI path, not left as one-off inspection.

Concrete changes that would raise the rating

- Add a canonical-type matrix for every duplicated name: old module/export, final canonical module/export, final field shape and units, allowed alias or variant name, migration action, and verification assertion.
- Make the `DrawingObject` rename policy explicit for public contracts: keep `export type DrawingObject = ResolvedDrawing` in the contracts-facing shim for a defined deprecation window unless a public-import audit proves it is safe to remove immediately.
- Replace Phase 3's broad "grep and decide" language with a concrete staged migration plan for `sheetId`/`containerId` and `position`/`anchor`, including old-document load behavior and exact kernel files that must switch before the aliases can be removed.
- Choose one layering enforcement mechanism and one duplicate-export enforcement mechanism, including script paths, command names, and intentional allowlist behavior.
- Turn verification areas into exact commands and scenario names, including package typecheck, contracts rollup, downstream package filters, and specific app/api evals for floating objects, resolved drawings, diagrams, ink, and equations.
- State the dependency direction for `ImportObjectStatus` consolidation before recommending imports from file-io or generated bridge-adjacent code.
