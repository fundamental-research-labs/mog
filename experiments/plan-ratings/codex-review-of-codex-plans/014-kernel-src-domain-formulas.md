Rating: 8/10

Summary judgment

This is a strong plan with the right architectural direction: make `kernel/src/domain/formulas` a thin typed facade over Rust compute-core, remove TypeScript as a second source of truth, and verify named-range plus structured-reference behavior through production bridge paths. The diagnosis matches the current code: `named-ranges.ts` still does local `any`-based wire mapping, scan-based reads, `setNamedRange` creation, comment follow-up writes, fire-and-forget import, and scoped deletion through name-only removal; `structured-ref-updater.ts` is a no-op facade while table callers still depend on its return values or issue unawaited bridge writes.

The main reason this is not a 9 or 10 is that several central contracts are still framed as "decide" or "align" instead of being specified as final endpoint schemas, result shapes, codegen changes, and acceptance criteria. For a repo where specification quality is the bottleneck, the plan is excellent discovery plus a credible implementation outline, but not yet a fully executable contract.

Major strengths

- The plan correctly identifies the production boundary: workbook/worksheet name APIs, table mutation APIs, XLSX/import/export named-range paths, compute bridge methods, and Rust compute-core storage/mutation paths.
- It preserves the right source-of-truth direction. Named ranges remain identity-backed for local references, A1 display is derived through Rust, and formula/name/table rewrites stay out of TypeScript scans.
- It catches the most important current hazards: duplicated identity conversion, missing `RectRange` handling in the create path, direct bridge queries not being used, `setNamedRange` bypassing defined-name validation, comment persistence requiring a second mutation, `importNames` returning before writes complete, and name-only scoped deletion.
- The structured-reference portion is production-path relevant. Current table code has no-op count/logging behavior and some `void ctx.computeBridge...` writes even though Rust table mutations already own table rename, column rename, column delete, table delete, and convert-to-range rewrites.
- The test matrix is broad and mostly aimed at contracts rather than mocks: identity-ref variants, scope precedence, same-name workbook/sheet deletion, create-from-selection edge coverage, Rust named-range mutation behavior, and Rust structured-reference integration through engine mutations.
- The risks and non-goals are well scoped. The plan explicitly avoids formula-function accuracy, parser replacement, TS formula scans, and UI redesign.

Major gaps or risks

- The canonical named-range write shape is not actually specified. The plan says to inventory string-based `DefinedName`/`DefinedNameInput` versus identity-backed `DefinedNameWire`/`NamedRangeDef` and decide whether to extend existing commands or add identity-backed commands. That decision is the core contract and should be made in the plan, including exact TypeScript/Rust field names, optional metadata, raw expression semantics, and return payload.
- Direct read migration is underspecified because generated bridge methods currently mix shapes: `getAllNamedRangesWire()` returns `DefinedNameWire[]`, while direct query methods such as `getNamedRangeByName`, `getNamedRangesByScope`, and `resolveNamedRange` return string-based `DefinedName`. The plan says not to mix shapes at the facade boundary, but does not state whether direct queries must be regenerated to return identity wire data or whether the facade should accept string-defined names and round-trip through a separate identity query.
- Code generation and transport impacts are mostly implicit. Changes to bridge commands likely require updates across Rust command definitions, generated `compute-bridge.gen.ts`, generated `compute-types.gen.ts`, `manifest.gen.ts`, NAPI/WASM normalization behavior, and possibly external type maps. The plan names packages, but it should spell out the generated-file and source-of-truth workflow.
- Metadata preservation is listed as an invariant but not specified field-by-field for create, update, import, and export. The existing domain types include `rawRefersTo`, macro flags, `order`, and linked range IDs; the plan should define which endpoint owns each field and how unsupported/external references remain lossless.
- Structured-reference count metadata is requested but not designed. The plan says Rust table mutations should include updater counts in `MutationResult.data`; it should define a typed payload per operation and how existing table-domain return values should change or remain compatible.
- `createFromSelection` remains too open. The plan asks to decide workbook versus sheet scope and validation behavior, but those are observable API contracts. The review target would be stronger if it chose the scope semantics and failure policy up front.
- The sequencing is broad enough to be an epic. It has good parallelization notes, but the integration order should include explicit blockers: bridge schema/codegen first, Rust mutation behavior second, TS facade reads/writes third, public API behavior fourth, then table migration and event payloads.

Contract and verification assessment

The contract section is the strongest part of the plan. It states important invariants around identity storage, scope precedence, case-insensitive duplicates, atomic rename rewrites, metadata preservation, sheet deletion, awaited bulk import, and Rust-owned structured-reference rewrites. Those are the right observable contracts for this folder.

The verification gates are directionally correct and include both TypeScript facade/API tests and Rust compute-core tests. They are also appropriately production-focused: structured-reference tests should go through engine table mutations, and any UI-facing Name Manager/table workflow requires real browser exercise.

The weakness is that several tests are described by behavior category but lack exact fixture shape or acceptance assertions. The plan should specify a few concrete examples, such as workbook and sheet-local names with identical text, external-name raw text export, `RectRange` conversion input/output, missing `namedRanges` map import behavior, and a formula string literal containing table-looking text that must not be rewritten.

Concrete changes that would raise the rating

- Replace the "decide canonical bridge mutation input" step with the exact final bridge API schema for create, update, import, remove-by-scope, and direct reads, including generated TS/Rust type names and `MutationResult.data` payloads.
- State whether direct named-range reads will return `DefinedNameWire` or string `DefinedName`, then make every facade boundary mapping explicit.
- Add a codegen checklist covering the authoritative Rust command/type source, generated bridge files, manifest changes, and NAPI/WASM parity.
- Define metadata preservation tables for create/update/import/export, including `comment`, `visible`, macro flags, `order`, `rawRefersTo`/`raw_expression`, external references, constants, and linked range IDs.
- Specify the structured-reference mutation result payload and how table-domain methods preserve or change their current return values.
- Choose and document `createFromSelection` scope and validation semantics instead of leaving them as an implementation decision.
- Convert the test plan from categories into contract fixtures with expected before/after state for the highest-risk cases.
