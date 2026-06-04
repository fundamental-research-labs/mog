Rating: 8/10

Summary judgment

This is a strong plan for hardening `@mog/types-objects`. It correctly treats the package as a public contract surface despite the package itself being private, and it identifies the real architectural problem: the object stack is shared across TypeScript contracts, Rust domain/wire data, kernel projections, canvas renderers, XLSX import/export, and generated SDK surfaces. The plan also lands on the right high-level themes: exhaustive object variant alignment, discriminated anchors, serialized-versus-runtime model boundaries, canonical vocabularies, and production-path verification.

The main reason it is not a 9 or 10 is that it still defers several decisions that are central to the contract. "Build the matrix", "decide the root export policy", "if a slicer marker is needed", "least invasive branded or documented type strategy", and "generate or add exhaustive fixtures" are directionally right, but they are not yet concrete enough to be handed to multiple implementation agents without producing divergent contracts. The plan is more of a high-quality architecture program than a fully executable spec.

Major strengths

- It is grounded in the actual package shape: subpath exports carry the real surface, the root export is intentionally empty, `@mog-sdk/contracts` re-exports the subpaths, and runtime values such as `CANVAS_OBJECT_TYPES` and `SPREADSHEET_OBJECT_TYPES` are tracked through the contracts runtime inventory.
- The production path is correctly scoped. The plan does not stop at type edits; it includes Rust `domain-types`, compute/file-io hydration, kernel mappers, object managers, scene graph/projection readers, canvas renderers, spreadsheet UI, XLSX round trips, and SDK generation.
- The plan identifies real current contract weaknesses: optional `ObjectPosition` fields allow invalid anchor shapes; `ChartObject.chartConfig` is an opaque `Record<string, unknown>`; drawing and diagram runtime models use `Map` where serialized/public payloads need JSON-safe records or arrays; `SceneObjectSnapshot.data` is opaque; and unsupported `camera`/`slicer` wire objects can currently fall back to shapes in the TypeScript mapper.
- It respects important ownership boundaries. In particular, it keeps slicer canonical state at workbook level, avoids pulling chart/slicer implementation packages into `types-objects`, keeps equation storage OMML-first, and warns against moving renderer/parser/importer logic into the type package.
- The verification section has the right categories: type-level fixtures, contract declaration/runtime inventory checks, Rust tests and clippy for touched crates, kernel/canvas behavior tests, XLSX round trips, UI E2E through real input paths, and manual browser verification.

Major gaps or risks

- The plan is too broad without hard phase boundaries. It touches every object domain at once: floating objects, anchors, charts, slicers, OLE/form controls, ink, diagrams, SmartArt OOXML, text effects, 3D drawing, equations, SDK generation, UI, and import/export. The parallelization notes help, but the plan should define a small number of phase gates with exact input/output artifacts before agents start modifying dependent packages.
- Several core decisions are left open. The root export policy, slicer floating-object representation, public equation type-guard ownership, chart config shell owner, unit branding strategy, and generated-versus-fixture source of truth are all spec decisions, not implementation details. Leaving them as "decide" items lowers contract clarity.
- The proposed floating object matrix is essential, but the plan does not include the matrix. A reviewable plan should list the 12 current Rust variants (`shape`, `connector`, `picture`, `textbox`, `chart`, `camera`, `equation`, `diagram`, `drawing`, `oleObject`, `formControl`, `slicer`) with current TypeScript contract, desired TypeScript contract, mapper behavior, renderer behavior, editability, import status policy, and test fixture for each.
- Public migration handling is under-specified. The plan says to preserve SDK contracts and update generated artifacts, but it does not define compatibility rules for existing public declarations, deprecation timing for `position`/`anchor` and `sheetId`/`containerId` aliases, or how API spec owner-package drift is accepted or rejected.
- Unit semantics are recognized but not specified enough. "Branded or documented type strategy" is ambiguous. If units are part of the public contract, the plan should choose the representation, state whether aliases are nominal or documentation-only, and define conversion ownership at every boundary.
- The verification list is comprehensive but not operational. It needs exact package/script names for contract generation, API report refresh, runtime inventory checks, focused type fixtures, and final UI/import/export suites. As written, implementers could run very different gates and all claim compliance.
- Canonical value table ownership remains risky. The plan asks to consolidate OOXML and renderer vocabularies, but it does not say whether `types-objects`, Rust `domain-types`, or `file-io/ooxml-types` is the generation source. Without a declared source of truth, the work can recreate the drift it is trying to remove.

Contract and verification assessment

The contract direction is excellent. The plan emphasizes discriminated unions, exhaustive switches, typed patches instead of `Partial<FloatingObject>`, JSON-safe serialized forms, explicit import degradation metadata, synchronous read projections, async mutation APIs, and separation between raw OOXML, persisted domain data, public API models, and resolved render primitives. Those are the right invariants for this folder.

The missing piece is acceptance specificity. For contract work, "add a type" is not enough; each changed contract needs a corresponding exhaustiveness fixture, public declaration/API report expectation, mapper fixture, and production consumer behavior. The plan says that broadly, but it should name the artifacts and expected outcomes. For example, camera should have a TypeScript interface, Rust mapper case, placeholder render policy, import status semantics, API visibility, and XLSX round-trip expectation all in one row of the variant matrix.

Verification is production-path relevant, but it should be sequenced. Early phases should require export inventory and type-level fixtures before touching consumers. Mapper phases should require Rust-to-TypeScript hydration fixtures and kernel projection tests. Renderer/UI phases should require canvas and real-input E2E tests. Final completion should require SDK generation/report checks and XLSX round-trip fixtures. That sequencing would make the verification gates enforceable rather than aspirational.

Concrete changes that would raise the rating

- Add an appendix with the current exported subpaths and symbol inventory, classified as raw OOXML, persisted domain, public API, resolved render, manager/projection, or bridge helper. Include the fixture path that will fail on unexpected surface drift.
- Include the full floating object variant matrix in the plan, with one row per Rust `FloatingObjectData` variant and columns for TypeScript interface, mapper behavior, render/projection behavior, create/update support, import status, editability, and verification fixture.
- Resolve the major design choices before implementation: root export policy, slicer marker contract, camera contract, chart config shell owner, equation runtime guard ownership, and unit branding strategy.
- Split the work into explicit phases with phase-local acceptance criteria and dependency order. The current parallelization notes are useful, but they need contract handoff artifacts so agents can work independently without inventing incompatible shapes.
- Specify the source of truth for canonical vocabularies and whether values are generated from Rust, OOXML parser types, or checked with `satisfies` fixtures.
- Replace broad verification bullets with concrete commands and fixture names for contract generation, runtime inventory, declaration/API report checks, mapper fixtures, Rust crates, XLSX round trips, canvas tests, UI E2E, and manual browser verification.
- Add a public migration section covering SDK declaration compatibility, alias/deprecation policy, generated API spec owner-package changes, and external consumer fixtures.
