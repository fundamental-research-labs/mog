Rating: 8/10

Summary judgment

This is a strong, production-aware plan. It correctly identifies `canvas/overlay/src` as the screen-space selection and handle layer, ties it to the real `OverlayDataAdapter` and spreadsheet interaction path, and focuses on the main structural problem: render and hit-test geometry are currently rebuilt through separate paths with different visibility and target semantics. The plan is much better than a local cleanup proposal because it treats overlay rendering, hit testing, adapter state, public hit contracts, and verification as one system.

The rating is not higher because several critical contracts are still described directionally rather than specified. Independent implementation agents would still need to decide exact snapshot shapes, descriptor fields, target result schemas, custom-handle provider ownership, group-handle semantics, and dirty-region coordinate contracts before their work could compose safely.

Major strengths

- The plan is grounded in the actual production path: `GridRendererImpl` creates `OverlayLayer`, wires `OverlayDataAdapter` to the drawing scene graph and hit map, registers overlay hit testing at high priority, and marks overlay dirty on floating-object and scene-graph changes.
- It identifies real current mismatches: custom-handle rendering gets parent bounds and rotation while hit testing does not, custom-handle hit results use the handle ID as `objectId`, multi-select group hit visibility ignores all-locked state, drag preview is axis-aligned, and the production adapter stubs guides, rubber band, drag preview, ink preview, and connection indicators.
- The snapshot plus descriptor direction is architecturally appropriate. A single normalized frame feeding render and hit descriptors is the right abstraction for preventing visible/hittable drift.
- The plan keeps the public/private dependency boundary explicit and avoids pulling domain-specific object logic into `canvas/overlay`.
- Verification is not limited to unit tests. It calls for adapter tests, browser-canvas coverage, spreadsheet production-path coverage, and real UI input for E2E tests.

Major gaps or risks

- The core contracts are not concrete enough. `OverlayFrameSnapshot`, `HandleDescriptor`, operation preview descriptors, dirty envelopes, skipped-object diagnostics, and hit-target results need exact TypeScript shapes and ownership rules before implementation begins.
- Several decisions are explicitly deferred inside the plan: whether to extend `OverlayDataSource` or add another source, how to represent group targets, whether group rotation is supported, and whether engine dirty hints can carry screen-space rectangles. Those are not minor details; they determine package APIs and downstream migrations.
- The plan is very broad for one workstream: overlay snapshotting, geometry replacement, public type migration, grid adapter completion, spreadsheet state plumbing, dirty-engine changes, browser tests, and E2E coverage. The parallelization notes help, but the plan needs sharper phase boundaries and acceptance criteria per phase.
- Custom-handle provider migration is underspecified. The plan says static config should become dynamic and selected-object-aware, but it does not define whether the provider lives on `OverlayDataSource`, a separate interface, or a host-layer registry, nor how it receives selection, lock/edit state, object type, and domain metadata without violating dependency direction.
- Dirty-region work is partly speculative. The plan correctly warns against mixing document-space and screen-space dirty rects, but it should make full-overlay repaint the default acceptance target and treat partial screen-space dirtying as a separate engine-contract project unless that contract is specified up front.
- The plan calls for "complete" adapter support for guides, rubber band, lasso/ink, connection points, and custom handles, but it does not audit which of those states actually exist in the current spreadsheet object interaction model versus which require new product/state-machine work.

Contract and verification assessment

The desired invariants are excellent: screen-space CSS pixels, synchronous rendering, stable chrome suppression during operations, identical render/hit visibility, no hidden hittable handles, consistent rotation math, and real UI input for E2E coverage. Those are exactly the right contracts for this folder.

However, the plan needs executable contract tests before broad refactoring. The first phase should pin the current public behavior and the intended replacement behavior for rotated handles, locked multi-select, custom-handle target identity, active operation suppression, and group target routing. Without those tests and exact types, the descriptor refactor could become a large behavior rewrite with ambiguous success criteria.

The verification gates are mostly appropriate and match package-level scripts for `canvas/overlay`. They should be tied to change scope more explicitly: overlay-only changes need overlay tests and typecheck; adapter changes need `canvas/grid-canvas`; public contract/type changes need root typecheck; spreadsheet interaction changes need spreadsheet tests plus a browser exercise. The browser-canvas and E2E requirements are important, but the plan should name the harness or scenario files to create rather than only listing behaviors.

Concrete changes that would raise the rating

- Add exact proposed TypeScript interfaces for `OverlayFrameSnapshot`, descriptor sections, `HandleDescriptor`, operation preview descriptors, custom-handle provider inputs/outputs, and overlay hit targets.
- Decide the public API shape before implementation: one `OverlayDataSource` extension versus a separate interaction/custom-handle provider, and one group-target representation that downstream cursor and operation dispatch can consume.
- Split the work into explicit phases with acceptance tests: current mismatch tests, snapshot/descriptor contract tests, overlay render/hit migration, adapter operation-preview migration, spreadsheet UI coverage, then optional screen-space partial dirtying.
- Document which overlay features already have production state sources and which require new state-machine/product work.
- Make dirty-region optimization a separately gated deliverable unless a coordinate-space-tagged engine dirty contract is defined in the same plan.
- Add line-level or module-level references for the known defects so implementation agents can verify they are fixing the complete class of each issue, not just the examples.
