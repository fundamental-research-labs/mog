Rating: 8/10

Summary judgment

This is a strong, production-relevant plan for `kernel/src/domain/cells`. It correctly identifies the folder as a contract boundary between public worksheet/kernel APIs and Rust compute-core, and its main direction is architecturally right: make `cell-reads.ts` canonical, remove TypeScript-side spreadsheet semantics, stop manufacturing fake `CellId`s, await mutation paths, and push range/projection/property behavior through Rust-backed contracts.

The plan loses points because several critical contract decisions are still left open where an implementer needs exact public shapes and migration rules. It also sometimes frames existing bridge capabilities as new work, which could make sequencing and ownership noisier than necessary. Overall it is much better than a task list, but it should become a sharper spec before execution.

Major strengths

- The source diagnosis matches the code. `index.ts` still exports reads from `cell-values.ts`, while `api/namespaces/cells.ts`, records, charts, and worksheet operations already lean on `cell-reads.ts`. `cell-values.ts` has simpler read semantics and fire-and-forget writes; `cell-reads.ts` handles richer region/projection/materialized readback.
- The architectural direction fits Mog: Rust compute-core remains the source of truth, TypeScript becomes a thin adapter, mutation result handling stays centralized, and public/package boundaries stay explicit.
- The plan identifies the important semantic categories instead of one-off bugs: stable identity, identity-less materialized/projection cells, region null vs undefined, dynamic-array vs CSE/data-table formula-bar behavior, external formula readback, metadata, formats, hyperlinks, and range operations.
- It calls out real production risks in the current implementation: `toCellId('')` sentinel usage, query-then-clear range mutation, local current-region scans, metadata passed through `CellFormat`, local text-to-columns preview splitting, and snake_case/camelCase result drift.
- The verification section is broad and mostly appropriate: characterization tests first, kernel package tests/typecheck, Rust tests when wire contracts change, public API/declaration checks, and UI exercises through real input paths.
- The parallelization notes are useful and map to natural contract boundaries: read consolidation, Rust bridge changes, mutation cleanup, properties/metadata, data operations, bulk reads, and UI verification.

Major gaps or risks

- The identity-less cell contract is not decided. The plan says to make `StoreCellData.id` optional, or add `cellId?: CellId`, or introduce a `VirtualCellId`/`ReadCellIdentity` union. That is the highest-risk public contract decision in the plan and should not be deferred to implementation.
- It does not provide a full ingress/egress contract table. For each API path (`domain/cells` barrel, namespace cells, `WorksheetInternal.getCellStoreData`, `Worksheet.cells.get`, range/query callers, chart/records/table accessors), the plan should specify exact return shapes for empty cells, formula cells with null computed values, format-only cells, materialized cells, spill members, CSE/data-table members, hyperlinks, errors, and external formulas.
- Some requested Rust-backed paths already exist at the bridge level, including `getCurrentRegion`, `getDataBoundsForRange`, `getRawCellData`, and `getValueForEditing`. The plan should split “switch the domain layer to an existing endpoint” from “add or extend a new Rust wire contract.”
- The bridge/type work is underspecified. `StoreCellData.region` already exists in public types, while generated `RangeCellData` currently lacks `region`. The plan should name the exact generated type changes, serialization source, and API snapshot/declaration update path.
- Mutation awaitability is a breaking API/signature change across several helpers currently returning synchronous `CellAddress`, `void`, or `CellAddress[]`. The plan names the goal but does not list every exported function whose return type changes or the public callers that must become async.
- The metadata section is directionally correct but not contract-complete. It says to add dedicated metadata/property updates and reads, but does not define the bridge method names, payload shape, clear semantics, or whether public `CellProperties` is direct-only, effective-only, or both.
- The data-operations section notices drift, but it should specify the canonical result shape after transport normalization. Today different paths read snake_case and camelCase fields differently; the plan should choose one wire/public mapping and list all affected entrypoints.
- Verification misses some required precision. Rust work should include `cargo clippy -p <crate>` where applicable, bridge generation should have an exact command, and UI behavior gates should name the dev-server/e2e or manual evidence expected rather than only saying to exercise the app.

Contract and verification assessment

The invariant list is the best part of the plan. It states the core contracts clearly enough to prevent the wrong class of fixes: stable `CellId`s are not positions, identity-less reads are not real cells, formula raw/computed values are distinct, region metadata has `null` vs `undefined` meaning, and Rust owns spreadsheet semantics.

The weak point is that several invariants are not converted into mechanically checkable contracts. The plan should define exact TypeScript interfaces or before/after API snapshots for identity-less reads, `RangeCellData.region`, metadata/property APIs, and async mutation return types. Without those, parallel workers could make individually reasonable but incompatible choices.

The proposed tests are appropriate in scope and mostly production-path focused. The plan correctly asks for characterization tests before changing call sites and includes package, Rust, public contract, and UI gates. To be execution-ready, it should add exact commands for bridge regeneration/API snapshots, include clippy for Rust changes, and identify which tests must fail before the fix versus which are regression coverage after the contract lands.

Concrete changes that would raise the rating

- Choose one identity contract now. For example: `StoreCellData.id` exists only for real identities, identity-less read results use a separate `ReadCellData` shape or a branded union, and public high-level APIs project identity-less cells to identity-free records.
- Add a matrix of all read ingress points and exact outputs for empty, literal, formula-null, error, rich text, hyperlink, hidden formula, spill anchor/member, CSE/data-table anchor/member, materialized, region-only, format-only, and external-formula cells.
- Rewrite the bridge section as an endpoint inventory: existing endpoints to adopt, existing endpoints to extend, genuinely new endpoints, generated type changes, and exact binding/API snapshot commands.
- List every domain helper whose signature changes when mutations become awaitable, plus the worksheet/API call sites that must await it and the invalidation/filter behavior that must remain unchanged.
- Define first-class metadata/property bridge contracts with method names, payloads, direct vs effective read semantics, and clear behavior.
- Specify the canonical remove-duplicates/text-to-columns public result shapes after transport normalization and require tests at both domain and worksheet-operation entrypoints.
- Add the missing verification gates: relevant Rust clippy, bridge generation check, API snapshot/declaration check commands, and a concrete UI/e2e checklist for formula bar, spill selection, clear modes, hyperlinks, styles, text-to-columns, and remove-duplicates.
