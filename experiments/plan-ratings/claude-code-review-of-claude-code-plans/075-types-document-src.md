Rating: 9/10

# Review of Plan 075 — Harden `@mog-sdk/types-document` contracts

## Summary judgment

This is a top-tier plan. It is grounded in the actual source to an unusual degree: every specific defect it cites was verifiable in the tree, and the diagnosis ("the contract describes invariants in prose that nothing enforces, and several have drifted into duplicate divergent representations") is exactly right for this package. It correctly frames the work as a *contracts* exercise where verification is primarily type-level, sequences the work in dependency order, insists on additive-first migration across a large consumer fan-out, identifies the single highest-risk step and gates it behind the runtime owners, and explicitly lists non-goals. The phases are shippable and largely parallelizable. The main reservations are (a) a real, underplayed tension between "additive-first keeps the build green" and the Phase 3 *branding* work, which is inherently a breaking change at assignment sites, and (b) a softness in the Phase 6 conformance gate. Neither is disqualifying.

## Verification of the plan's factual claims (spot-checked against source)

Confirmed accurate in `mog/types/document/src`:
- Root `index.ts` is a deliberate `export {}` with the collision rationale documented in the header — matches the plan verbatim.
- `app/types.ts:27` ships a runtime `export function appId(id: string): AppId` — the "contracts-only invariant breach" is real.
- `storage/inbound-updates.ts:54` declares `readonly sequence?: bigint` — the JSON-unsafe wire field is real.
- Duplicate column vocab is real: `storage/table-driver.ts:64` `ColumnType` vs `app/types.ts:417` `TableColumnType = ...| 'json'` (adds `json`, lacks `array`/`unknown`), with parallel `TableSchema`/`TableSchemaDefinition`.
- `filesystem/permissions.ts:33` `AccessLevel = 'read'|'write'|'read-write'` genuinely collides by name with `security/types.ts:87` `AccessLevel = 'none'|'structure'|'read'|'write'|'admin'`; `ACCESS_LEVEL_ORDER` exists at `security/types.ts:93`.
- `document-provider.ts` re-exports `StorageProviderKind`/`StorageProviderRole` from `provider-kinds.ts` (sole declaration site) — the dual import-path observation holds.
- `CreateDocumentOptions` carries `@deprecated providers`, `@internal initialSnapshot?: Record<string, unknown>`, `yrsState?: Uint8Array`, `internal?: boolean` — Phase 4's target is real.
- `comments.ts:135` has an empty `// Type Guards` trailer (nothing follows); `commentType: 'note'|'threadedComment'` and a separate `CellNote` both exist — Phase 5.13 is real.
- `security/evaluator.ts:18-20` `AccessExplanation` is annotated "matches the Rust `compute_security::engine::AccessExplanation` serde shape"; `document.ts:185` `CsvImportOptions` annotated "mirror the Rust `csv_parser::CsvImportOptions` struct exactly", `evaluateFormulas?: boolean` default-false — Phase 6 targets are real.
- `package.json` confirms `private: true`, `0.1.0`, sole dep `@mog/types-core: workspace:*`, and a large `exports` subpath map (every group + per-file subpaths) — the "subpaths are the public API, renaming is breaking" constraint is correct.

The only numeric overstatement: the plan repeatedly cites "133 import sites across kernel + shell." I count ~103 `from '@mog-sdk/types-document...'` statements across the whole `mog` tree (~30 files in kernel+shell alone). The figure is in the right order of magnitude and doesn't change the argument, but it is not precise and is stated with false confidence.

## Major strengths

- **Evidence-first specification.** Defects are named at concrete type/file granularity, not gestured at. An implementer could start Phase 1 without re-discovery.
- **Correct verification model for a leaf type package.** It leans on `tsc -b` per phase, whole-graph typecheck of consumers, compile-time exhaustiveness assertions (`as const` tuple `[number]` ≡ prior union; `ACCESS_LEVEL_ORDER` keys ≡ `AccessLevel`), and export-map integrity via `git diff` — the right gates when there is little runtime to test.
- **Tier-1 leaf purity preserved as a hard invariant.** It repeatedly forbids kernel/shell/Tauri imports and requires new constants to be zero-dependency and tree-shakable, and explicitly chooses an opaque brand over a dependency violation for `WorkbookSnapshot` (leaf purity wins over precise typing) — a mature trade-off.
- **Risk triage is genuine.** Phase 3.7 (sequence `bigint`→branded string on hashed/signed proof payloads) is named as highest-risk, with the sharp insight that a `bigint` cannot have survived `JSON.stringify` today, so the change likely *fixes a latent bug* — but it still gates behind the Rust/kernel canonicalization owners. The `AccessLevel` collision is explicitly called intentional ("disambiguate, do not merge").
- **Discriminated-union discipline is enumerated and protected**, with a requirement that any consolidation keep the discriminant literal and total — exactly the property the kernel registry switch depends on.

## Major gaps or risks

- **Branding (Phase 3.8/3.9) contradicts the "additive-first → build stays green" promise.** Adding a brand to existing `string`/`bigint` fields (`ContractVersion`, `PathHandle`, `CredentialRef`, sequence) is *not* additive: every existing construction site that assigns a plain string/number to those fields will fail typecheck until it adopts a brand constructor. The plan asserts additive-first keeps the 133/103 consumers green, but Phases 3–4 are precisely the ones that won't. It correctly sequences/gates 3 and 4 behind runtime owners, yet never reconciles "branding hardens at compile time" (which works *by* breaking assignments) with the stated no-break invariant. This deserves an explicit migration story (brand constructors shipped first; consumers migrated in their own queue items before the field types tighten; or a transitional `string | Brand` widening).
- **Phase 6 conformance gate is soft.** The durable goal (golden round-trip fixtures that fail on Rust/TS drift) is explicitly punted to "another queue item," with the in-scope minimum being "a checked-in note linking the two declarations." A note does not make objective 7 ("make serde-match claims checkable") durable; it re-states the prose that already exists. The plan acknowledges this but still counts objective 7 as addressed.
- **`appId()` resolution (Phase 5.11) is cross-package and breaking.** Moving the constructor to the kernel and repointing `app/types` consumers is the right call for the stated convention, but it is a breaking change to a published subpath behavior and depends on a kernel queue item; the plan notes the repoint but does not flag it among the gated/sequenced items as clearly as Phases 3–4.
- **Ambition vs. independent shippability.** Six phases / fourteen steps over ~4,573 LOC and ~100 consumer imports is a lot. The "each step independently shippable" claim is plausible for Phases 1/2/5 but weaker once branding and the option-split land, because those force coordinated consumer migration.

## Contract and verification assessment

The contract analysis is the plan's strongest dimension. It correctly identifies the package's role as the product-neutral type vocabulary, enumerates the load-bearing invariants (linear `AccessLevel` scale + total order map; credentials-never-in-config storing handles/refs; cell-identity-based `SearchResult`/`Comment`; CSV-injection default; proof/authority wire-shape stability), and demands they be preserved or strengthened rather than reshaped. The "union ← `as const` tuple, derive the type, keep the name" pattern is the right mechanism to make unions the source of truth without breaking imports, and pairing it with a build-failing exhaustiveness assertion is exactly how to keep `ACCESS_LEVEL_ORDER` honest.

Verification gates are appropriate and mostly objective: per-package `tsc -b`, consumer fan-out typecheck, compile-time `satisfies`/equality assertions, provider-config `switch` totality, export-map `git diff`, and a no-runtime-emit check (constants + chosen brand constructors only). The weak gate is Phase 6 (conformance reduced to a note as the floor). The plan is honest that it is not running these (per task constraints), which is correct framing.

## Concrete changes that would raise the rating (toward 10)

1. **Reconcile branding with additive-first.** Add an explicit sub-plan for Phases 3.8/3.9: ship brand constructors and `string`-compatible widenings first, enumerate which construction sites tighten and in which queue items, and state that the field-type narrowing lands only after consumers migrate. Acknowledge that branding is a breaking change, not an additive one.
2. **Make Phase 6 a real gate or descope objective 7.** Either commit a minimal golden-fixture round-trip in the boundary package as part of this work (even one representative `AccessExplanation`/`CsvImportOptions` payload), or downgrade objective 7 from "checkable" to "documented cross-reference" so the claim matches what ships.
3. **Fix the import-site count.** Replace "133 import sites" with the measured figure (or label it approximate); precision here is cheap and the plan otherwise earns its confidence.
4. **Promote the `appId()` move into the gated/cross-package list** alongside Phases 3–4, with the specific kernel queue item that must accept the constructor and the `app/types` re-export shim that keeps the subpath resolving during migration.
5. **Pick the canonical polarity now for the column/schema and watermark reconciliations** (Phase 1.1/1.3 currently leave "pick one … or document why" open). Naming the winner removes the largest remaining ambiguity from the highest-correctness-value phase.
