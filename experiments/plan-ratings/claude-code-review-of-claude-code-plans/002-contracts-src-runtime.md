Rating: 9/10

# Review — Plan 002: Strengthen `mog/contracts/src/runtime`


## Summary judgment

This is a strong, evidence-grounded plan that correctly diagnoses a real and unusual problem: an entire contract subtree (`contracts/src/runtime`) that is shipped in the source tree but is not part of its package's supported surface, and that silently duplicates a sibling package's types while dropping their security documentation. Every load-bearing factual claim in the plan was independently verified against the source and holds up exactly. The plan is appropriately scoped (type/contract files and manifests only), preserves the documented "type-only, not a shipped server" posture, sequences correctly against the dependent `runtime-services` folder, and proposes verification gates that are concrete and matched to the actual failure modes (wire drift, surface removal, re-divergence). The deductions are for one genuine posture stretch (introducing executable validator code into a 100%-type-only folder) and for leaving the single largest decision — the canonical-home fork — open to a downstream investigation rather than resolving it from evidence the plan already has in hand.

## Major strengths

- **Claims are verifiable and verified.** I confirmed each:
  - `@mog-sdk/contracts/package.json` `exports` (132 keys) has **no** `./runtime` entry.
  - `contracts/src/index.ts` re-exports only core/cells/document barrels — **no** `runtime` / `service-config` / `asset-manifest`.
  - `src/runtime/error-envelope.ts` and `audit-event.ts` are comment-stripped; the `runtime-services/src` counterparts carry the explicit `SECURITY:` invariants on `details` and `redactedMetadata`.
  - `DeploymentProfile` is declared in **both** `src/runtime/service-config.ts:1` and `runtime-services/src/deployment.ts:2`, and is exported from both package barrels.
  - `RuntimeErrorEnvelope` / `RuntimeAuditEvent` are structurally identical across the two packages.
  This is the difference between a plan written from inspection and one written from assumption; this is the former.
- **Correct preservation set.** The plan singles out the right invariants to freeze: serialized JSON shape of the envelope/audit types (they cross process boundaries), the `version: '0.1'` discriminant, and the discriminated unions (`SecretRef.source`, `ObjectStoreConfig.provider`, etc.). It explicitly forbids collapsing unions into "wide optional bags," which is exactly the regression that would otherwise creep in.
- **Single-source-of-truth strategy is sound.** Choosing the documented `runtime-services` copy as canonical and converting the other site to `export type { ... } from` re-exports is the right move, and the type-identity `.test-d.ts` gate to prevent future re-divergence is the correct guard for a problem that is fundamentally "two hand-maintained copies drift."
- **Cross-folder sequencing is explicit and right.** The plan names the hard coordination dependency on queue item 004 (`runtime-services`), assigns canonicalization ownership to 002, and warns against running de-dup edits on both folders concurrently ("they will race on which copy is canonical"). It also flags the declaration-rollup ordering — canonical declaration lands first, re-export second — to avoid a transient dangling import. This matches the known constraint that `@mog-sdk/contracts` consumers depend on emitted `dist/*.d.ts`.
- **Supply-chain framing of asset integrity is legitimate.** `integrity` is indeed optional on every asset entry today; making it required or an explicit named opt-out (`{ integrity: null; unverifiedReason: string }`) turns silent unverified loading into a deliberate, auditable choice.

## Major gaps or risks

- **The validator (Step 4.2) is the most debatable item and is under-defended.** The folder is currently *entirely* `export type` — no runtime values. Introducing `validateMogSelfHostConfig(config): RuntimeErrorEnvelope[]` adds an executable function and a value export. The plan's justification ("consistent with the package already shipping pure helpers like `toCellId`") is true at the *package* level but not at the *folder* level — `src/runtime` itself ships zero runtime code, and `DATA-FLOW-AND-EGRESS.md` is cited specifically about these contracts being type-only. This may be fine, but the plan should treat it as a posture decision to be explicitly ratified, not a foregone conclusion, and should consider placing the validator in a clearly value-bearing module/subpath rather than alongside the type declarations.
- **`RuntimeErrorEnvelope` is an awkward return type for config validation.** It requires `retryable: boolean` and an HTTP-flavored `status?`, `requestId?`, `traceId?`. Returning an array of these for static config-shape violations is a semantic mismatch (what is `retryable` for "TLS enabled without certPath"?). A dedicated `ConfigValidationIssue` type would model the domain better; reusing the envelope buys wire-consistency it doesn't need here.
- **The plan's biggest decision is deferred.** Phase 1 forks into Option A (delete `src/runtime`, move uniques into `runtime-services`) vs Option B (export `./runtime`, re-export shared types). Yet the plan's own evidence already points hard at Option A: there are **no** relative importers inside `contracts/src`, no `./runtime` export, and git history is a single squashed import commit — i.e., plausibly zero in-tree consumers. The plan could commit to Option A as the default and treat Option B as the fallback only if Step 1.1 surfaces real SDK-consumer intent, rather than presenting them as co-equal. Leaving it fully open means much of Phases 2–5 reads as conditional.
- **Cascading conditionality in the test section.** The negative-type test for "asset entry without integrity" is gated on 5.2's either/or choice, and the export-surface test's target path depends on the Phase 1 fork. This is honest but means the verification gates can't be fully specified until two upstream decisions resolve; a reviewer cannot fully assess test adequacy from the plan alone.
- **Discriminated-union narrowing is a breaking change for config authors, not merely "additive in spirit."** Converting `AuthConfig` from `{ adapter; oidc?; saml?; ... }` to a discriminated union rejects existing well-typed-but-loose configs. The plan does gate this behind a `0.1 → 0.2` bump and a `migrateConfig` signature, which is the right mitigation — but the phrase "additive in spirit but type-narrowing" slightly undersells that any consumer constructing these objects in TS will get new compile errors. Worth stating plainly.

## Contract and verification assessment

The contract reasoning is the plan's strongest dimension. It distinguishes wire-crossing types (envelope/audit — freeze the JSON shape, additive-only) from operator-config types (`MogSelfHostConfig` — narrowable under a version bump), and it keeps all discriminated unions discriminated. The de-duplication-to-re-export pattern is the correct fix for hand-maintained twins, and the documentation-restoration step is automatically satisfied for the envelope/audit types once the stripped copies cease to be declarations (the plan notes this and asks only to verify nothing is lost in the move — correct).

Verification gates are well-matched to risk:
- type-identity `.test-d.ts` → guards re-divergence (the root cause);
- `@ts-expect-error` negative tests → guard the new union narrowings;
- validator unit tests with passing/failing fixtures asserting `category`/`code` → guard the cross-field rules;
- export-surface test extending the existing `contracts-runtime-inventory` fixture → guards accidental surface removal (good reuse rather than a parallel mechanism);
- build/typecheck gates including the **declaration rollup** before downstream typecheck → matches the real `dist/*.d.ts` dependency chain.

The one weakness, noted above, is that the envelope is a poor fit as the validator's return type, and a couple of gates can't be finalized until the Phase 1/5.2 forks resolve.

## Concrete changes that would raise the rating

1. **Commit to Option A as the default** based on the already-gathered evidence (no in-tree importers, no `./runtime` export, squashed history), and reframe Option B as the contingency triggered only if Step 1.1 finds genuine external/SDK-consumer reliance. This removes the conditionality hanging over Phases 2–5.
2. **Replace `RuntimeErrorEnvelope[]` with a purpose-built `ConfigValidationIssue[]`** (path, code, message, severity) for `validateMogSelfHostConfig`, so the return type models config validation rather than HTTP error transport.
3. **Explicitly ratify the type-only-posture exception** for the validator: state that `src/runtime` will now ship one executable module, justify it against `DATA-FLOW-AND-EGRESS.md`, and isolate it in its own value-bearing subpath/export distinct from the type declarations.
4. **Reword the Step 4.1 risk** from "additive in spirit but type-narrowing" to a plain statement that union narrowing is source-breaking for config authors, tying it firmly to the `0.1 → 0.2` bump and `migrateConfig`.
5. **Pin the final export-surface and integrity test paths** once the forks are resolved (per item 1 and a committed 5.2 choice), so the verification section is fully specified rather than conditional.
6. **Add a one-line statement of expected consumer count** from Step 1.1 (likely zero) so reviewers can confirm the low-risk premise that makes deletion safe.

---
*Verification note: all source-level claims in the plan were checked against `mog/contracts/src/runtime/{index,error-envelope,audit-event,asset-manifest,service-config}.ts`, `mog/contracts/package.json` exports, `mog/contracts/src/index.ts`, and `mog/contracts/runtime-services/src/{error-envelope,deployment,index}.ts`. No production, test, fixture, or config files were modified.*
