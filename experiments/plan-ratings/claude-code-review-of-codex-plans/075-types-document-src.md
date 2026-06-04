Rating: 8/10

# Review of 075-types-document-src.md

## Summary judgment

This is a strong, evidence-grounded plan for the `@mog-sdk/types-document` source shard. Its central insight is correct and well-argued: this private package is the de-facto source of truth for a large number of cross-package and cross-language (TS↔Rust) contracts, yet several of those contracts have drifted from their downstream consumers or are enforced via hardcoded copies in the kernel. The plan does not theorize — nearly every factual claim I spot-checked against the actual source holds up:

- The root barrel (`index.ts`) is deliberately `export {}` with documented collision rationale (`Unsubscribe`, `AppId`), exactly as the plan states.
- `provider-kinds.ts` exists in `src/` but has no `./storage/provider-kinds` subpath in `package.json` — the "indirect-only" claim is accurate.
- `kernel/src/document/providers/composition-validator.ts` does hardcode a `KIND_TRAITS: Record<StorageProviderKind, KindTraits>` matrix, duplicating knowledge that belongs in the type shard.
- `kernel/src/document/host-storage-preflight.ts` does carry a raw `StorageProviderConfig` with `kind: string` / `role: string`, separate from the typed union.
- The Rust `compute_security` divergences are real: `PolicyMetadata` (created_by/created_at_millis/template_id) has **no** `description` field while TS `AccessPolicyMetadata` does; and Rust `AccessExplanation` carries `effective_tags`, `sorted_policies`, `ambiguity`, `clamp_fired`, and a `reason: ExplainReason` enum, whereas the TS `AccessExplanation` (which comments claim "Matches the Rust serde shape") only has `reason: string`, `candidatePolicies`, and `warnings: string[]`. Rust also already has an `AccessPolicyPatch` the TS surface lacks.

That level of accuracy is the plan's main strength: the recommendations are anchored to verifiable drift, not aspiration. The dominant weakness is scope — this is really a multi-workstream program compressed into one plan, with no phasing into independently shippable increments and no effort sizing.

## Major strengths

1. **Production-path relevance is excellent.** The plan consistently ties type changes to real consumers (kernel composition validator, host preflight, high-water-mark registry, `wb.security.*` bridge, `DocumentFactory`/`MogDocumentFactory`, `check-contract-identity.mjs`, API Extractor output, external fixtures). It explicitly forbids proving contracts by mutating private state in tests, and demands behavior verification through production entry points. This is exactly right for a contracts shard.

2. **Contract clarity is high and specific.** Rather than "improve types," it names concrete shapes: `satisfies Record<StorageProviderKind, ...>` registries, `CompositionViolationCode`, `StorageReadyPhase`/`StorageTerminalPhase`, `ProviderSequence` wire brand, `HostStorageProviderWireConfig` vs `ValidatedStorageProviderConfig` two-stage handoff. The "adding a capability must break all capability tables" invariant is a genuinely good compile-time-safety design.

3. **The TS↔Rust parity workstream is the most valuable part** and is correctly scoped: resolve the contract at the source (either match Rust after camelCase normalization or split persisted vs UI-only metadata), backed by bidirectional serde fixtures, rather than papering over API Extractor output. It correctly refuses to keep the false "matches Rust serde shape" comment.

4. **Fail-closed security framing is consistent and correct.** Host handoff, proof validation, inbound update authority binding, and capability/method conformance all default to denial on unrecognized input. The plan treats high-water marks and inbound envelopes as security contracts, not diagnostics.

5. **Risk and edge-case sections are unusually thorough and realistic** (clock skew on proof expiry, `bigint` over JSON, owner-lockout clamp, snapshot-only with/without read-only fallback, drivers advertising unimplemented methods). The "duplicate the matrix exactly, add conformance tests, then change semantics" sequencing for the kernel migration is the safe order.

6. **Dependency direction is explicitly guarded** (types-document → @mog/types-core only; no mog→mog-internal; Rust never imports TS, parity flows through fixtures).

## Major gaps or risks

1. **Scope is a program, not a plan.** Eleven implementation sections span six largely independent domains (export surface, document options, storage composition, security parity, filesystem/platform/shell, table drivers). The plan acknowledges this with six suggested workstreams, but there is no decomposition into individually mergeable PRs, no per-section acceptance criteria beyond "tests pass," and no effort sizing. As written, a single executor cannot land this; even the parallel workers lack a definition of "done" per slice. This is the principal reason it is not a 9–10.

2. **Behavior change is bundled into a "types" plan.** Moving the composition matrix out of the kernel and rewriting host preflight are real behavior-adjacent refactors crossing package boundaries. The plan flags this and prescribes the safe order, but the verification gates (focused kernel tests) are described categorically ("document provider registry, host storage preflight, ...") rather than naming specific existing test files or asserting they currently pass — so there is no captured baseline to regress against.

3. **Several gates are unverified-by-name.** It assumes `tools/check-contract-identity.mjs`, `runtime/sdk/etc/node.api.md`, and external positive/negative fixtures behave as described. The first three I could confirm exist conceptually from the plan's own inspection list, but the plan asserts specific current states (e.g. "node.api.md reports a forgotten-export warning for `TargetMatcher`") that it presents as observed without showing the evidence inline. If those observations are stale, parts of section 1/10 become no-ops.

4. **`DocumentImportWarning` expansion is under-specified vs. its own ambition.** The current union is 5 strings (`cell_limit`, `format_loss`, `formula_error`, `import_error`, `unsupported_feature`). The plan wants a much broader code union "without lossy casts in SDK adapters" but does not enumerate the target codes or map them to the Rust import warning source, leaving the most consumer-visible change vaguest.

5. **Timestamp/sequence normalization risk is real and partially hand-waved.** "Use epoch ms unless explicitly ISO" and "introduce `ProviderSequence` decimal-string brand" touch generated SDK and bridge payloads. The plan notes the risk but doesn't identify which existing fields are currently `bigint`/ISO, so the blast radius is unquantified.

## Contract and verification assessment

The contract design is the strongest dimension. The invariants are stated as enforceable mechanisms (`satisfies` records, exhaustive unions that break tables on extension, branded constructors, two-stage trusted/untrusted config) rather than prose guidance, and they correctly distinguish wire-safe vs runtime-only representations. The three-layer security framing (capabilities / data policies / protection) is preserved and the plan explicitly refuses to collapse them — matching the source comment in `security/types.ts`.

Verification gates are well-chosen and production-anchored: package typechecks, focused kernel/shell/runtime-test-host suites, Rust `compute-security`/`compute-core` security tests, bidirectional serde fixtures, export-surface↔package.json↔declaration cross-checks, and `check:publish-readiness:fast` after facade changes. The insistence on conformance tests generated from the trait/durability/profile matrices is the right way to keep the new registries honest.

The gap is not in gate *selection* but in gate *grounding*: no baseline is captured, no specific test files are named as the regression anchors, and the export-surface gate depends on a not-yet-existing `export-surface.ts` manifest whose format/authority (generator vs checker) is left as an open "drive or verify" choice rather than decided.

## Concrete changes that would raise the rating

1. **Phase it.** Split into explicitly ordered, independently mergeable milestones with per-milestone acceptance criteria — e.g. (a) export-surface manifest + gate (no behavior change), (b) security TS/Rust parity (highest-value, self-contained), (c) storage composition registry extraction with copy-exact + conformance tests, (d) host preflight two-stage, (e) filesystem/platform/shell, (f) table-driver. Mark which can run in parallel after (a).

2. **Capture a baseline.** Name the specific existing kernel/shell test files that currently pass and must continue to (composition validator, host preflight, high-water-mark registry, security API), so the "duplicate-then-change" migration has a concrete regression anchor.

3. **Decide the export-surface manifest's authority** (generated source-of-truth that emits `package.json` exports, vs. a checker that diffs an independently-maintained manifest). The plan currently allows both; pick one, since it changes whether section 10's gate can fail closed.

4. **Enumerate the target `DocumentImportWarning` code union** and map each code to its Rust/XLSX/CSV origin, so the most consumer-visible contract change is specified rather than gestured at.

5. **Quantify the timestamp/sequence blast radius**: list the current fields that are `bigint` or ISO across `high-water-mark.ts`, `inbound-updates.ts`, `lifecycle.ts`, and tie each to whether a bridge/SDK wire payload serializes it, before prescribing the brand split.

6. **Resolve the two named parity decisions inline as the plan's recommendation, not options:** (a) `AccessPolicyMetadata.description` → recommend "split into UI-only metadata outside persisted `AccessPolicyMetadata`" (since Rust persists none) and state the migration consequence; (b) `AccessExplanation` → recommend either full Rust parity or an explicit `RustAccessExplanationWire` + adapter, and pick one. The plan has the evidence to commit; leaving both as forks pushes the hardest decisions to the executor.
