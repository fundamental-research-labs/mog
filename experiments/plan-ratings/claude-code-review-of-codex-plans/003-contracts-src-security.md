Rating: 8/10

# Review of `003-contracts-src-security.md`

Reviewed against the live source: `mog/contracts/src/security/{index,types,evaluator}.ts`, `types/document/src/security/*`, `types/api/src/api/workbook/security.ts`, `kernel/src/api/workbook/security.ts`, and the Rust `compute-security` crate (`engine.rs`, `policy.rs`, `events.rs`).

## Summary judgment

This is a strong, evidence-grounded plan. It correctly identifies that `contracts/src/security` is a thin public facade over `@mog-sdk/types-document/security` with a Rust-first enforcement path, and it targets the right contract edges. I independently verified nearly every load-bearing factual claim and they hold up. The plan's central value is that it pins a cross-language (TS ↔ Rust serde) wire contract with executable fixtures rather than hand-waving "make the types match." It is well-scoped, well-sequenced, and the verification gates are real package targets. The reasons it is not a 9–10: the single riskiest correctness question (does the bridge convert the explanation payload's snake_case to camelCase, or not?) is deliberately deferred to the implementer instead of being pinned with a pointer to the bridge serialization site, and a couple of concrete reshape details (bridge arg-order, the kernel "Rust reuses id verbatim" comment) are left unreconciled with the proposed direction.

## Major strengths

- **Claims are accurate, not assumed.** Confirmed against source:
  - `contracts/src/security/types.ts` is byte-identical to `types/document/src/security/types.ts` and is bypassed by the public `index.ts` (which redefines `ACCESS_LEVEL_ORDER` locally). The drift hazard is real. ✓
  - The TS `AccessExplanation` (`{ level, matchedPolicy, reason: string, candidatePolicies, warnings: string[] }`) is genuinely stale versus Rust `compute_security::engine::AccessExplanation`, which carries `effective_tags`, `candidate_policies`, `sorted_policies`, `matched_policy`, `level`, `ambiguity: Option<AmbiguityWarning>`, `clamp_fired`, and `reason: ExplainReason` (a `snake_case` enum: `PolicyMatch`/`DefaultOwner`/`DefaultDeny`/`NoTags`). The plan's enumerated list of missing fields matches the struct exactly. ✓
  - `AccessPolicyMetadata.description?` exists in TS but Rust `PolicyMetadata` has only `created_by`, `created_at_millis` (renamed `createdAt`), and `template_id`. The "is `description` persisted, ignored, or dropped?" concern is a true drift. ✓
  - The `PolicyId` fallback in `kernel/src/api/workbook/security.ts` is `${Date.now().toString(16)}-${Math.random()...}` — not a valid UUID. If Rust parses UUIDs this fails on runtimes without `crypto.randomUUID`. ✓
  - The async surface (`addPolicy`/`updatePolicy`/`applyTemplate`/`getEffectiveAccess`/`explainAccess`) does cross the compute bridge and is correctly held async. ✓
- **The serde-naming caution is well-judged.** I confirmed `AccessPolicy`/`PolicyMetadata` carry `#[serde(rename_all = "camelCase")]` (so `principalTag`/`createdBy` match TS), but `AccessExplanation` and `AmbiguityWarning` have **no** `rename_all` — they emit snake_case (`effective_tags`, `matched_policy`, `conflicting_policies`) with camelCase `AccessPolicy` objects nested inside. The plan's "do not guess; preserve exact serde naming" instruction is exactly the right posture for this genuinely mixed-casing payload.
- **Clean scope boundaries.** Capability registries, `types/host` trust primitives, Rust enforcement internals, and UI prompts are explicitly out of scope as dependencies-to-reference, which matches the three-layer model documented in `types.ts` itself.
- **Strong invariants section.** Pinning the `none < structure < read < write < admin` lattice to Rust discriminants `0..4`, the tagged `AccessTarget` union, wildcard-only-in-IDs rule, and the policy key set gives implementers a concrete contract to defend.
- **Verification gates are real.** The `pnpm --filter` targets and `cargo test/clippy -p compute-security` are valid, and the contracts package already has `__tests__` infrastructure plus build-time identity/inventory checks to hang fixture tests on. The end-to-end integration gate (create workbook → install principal → add policies → `explainAccess` matches fixture) is the right closing check.
- **Sensible parallel decomposition** with explicit ordering: canonical-source decision first, `AccessExplanation` TS + Rust fixtures landing together, metadata changes spanning both sides in one slice.

## Major gaps or risks

- **The biggest correctness question is deferred, not investigated.** Whether the bridge re-keys the explanation payload (snake→camel) is the linchpin of objective #3. The plan says "do not guess" — correct — but it could have pointed the implementer at the specific `ComputeBridge.wbSecurityExplainAccess` serialization path so the answer is found before any TS shape is committed. As written, the riskiest item starts as an open investigation.
- **`AccessPolicyPatch` is presented as something to "introduce," but Rust already defines it.** `policy.rs` already has `#[serde(rename_all = "camelCase")] pub struct AccessPolicyPatch` with optional fields and no-op detection (`is_noop`). The plan's instinct (replace TS `Partial<Omit<AccessPolicy,'id'>>` with an explicit patch type) is right and even stronger than stated — the canonical Rust shape already exists to mirror. The plan undersells available evidence here.
- **Unreconciled kernel detail vs. proposed direction.** The kernel comment claims "Rust generates a PolicyId... but the serde contract requires the field present — we mint one client-side and let the Rust side reuse it verbatim." The plan's option to "move ID generation entirely to Rust with a bridge payload that omits `id`" would change that bridge contract. The plan offers both options but doesn't note this existing comment or which option preserves the current verbatim-reuse behavior.
- **Bridge argument-order reshape is unmentioned.** `getEffectiveAccess(principal, target)` and `explainAccess(principal, target)` forward to the bridge as `(target, principal)`. Not a public-contract issue, but any refactor touching these forwarders should preserve the swap; the plan doesn't flag it.
- **Several decisions remain open** (canonical ownership direction; keep-or-drop `description`; null vs `{ tags: [] }` principals). Acceptable for a plan, and the plan does state a preference for the facade pattern, but a reader cannot fully predict the resulting public shape without the implementer's later choices.

## Contract and verification assessment

The contract analysis is the plan's strongest dimension and is largely correct. It treats the public surface as a wire contract with Rust as the source of enforcement truth, and it refuses to "tidy" TS names without first pinning JSON. The fixture strategy — TS fixtures importing only `@mog-sdk/contracts/security`, Rust serde fixtures sharing the same JSON samples, plus an end-to-end gate — is the appropriate way to prevent silent divergence across the language boundary, and it is realistic given the existing test/check tooling in the contracts package. The one weakness is that the most error-prone serde detail (mixed snake/camel casing in `AccessExplanation`/`AmbiguityWarning`) is the precise thing the fixtures must encode, yet the plan leaves the current bridge behavior unverified, so an implementer could encode the wrong target shape if they assume uniform camelCase. Tightening this before fixtures are written would close the gap.

## Concrete changes that would raise the rating

1. **Pin the casing question before fixtures.** Add a first step: read `ComputeBridge.wbSecurityExplainAccess` (and the napi/wasm serialization layer) and record whether the explanation payload is re-keyed to camelCase or passed through as snake_case. Make the fixture encode the verified shape, not an assumed one. This single change de-risks objective #3.
2. **Reference the existing Rust `AccessPolicyPatch`** explicitly in step 4 so the TS patch type mirrors a known canonical shape (including its no-op semantics), rather than describing it as net-new.
3. **Reconcile the PolicyId direction** with the kernel's current "Rust reuses id verbatim" comment: state which option (UUID-v4 fallback vs. omit-`id`-and-let-Rust-mint) preserves the current bridge contract, and what bridge signature change the omit-`id` option requires.
4. **Note the `(principal, target)` → `(target, principal)` bridge arg-order** so refactors don't silently transpose it.
5. **Make the two open decisions falsifiable:** for `description`, add a concrete check ("grep Rust for any read of a `description` field on policy metadata; if none, it is dropped → remove from public type"); for principals, state the intended `resolvePrincipal` nullability and tie it to `setActivePrincipal(null)` rather than listing it as undecided.

---
Verification note: the only file created by this review is `mog-internal/plans/active/experiments/plan-ratings/claude-code-review-of-codex-plans/003-contracts-src-security.md`. No production code, tests, fixtures, configs, or the reviewed plan were modified.
