Rating: 9/10

# Review — 076 `mog/types/host/src`


## Summary judgment

This is a strong, evidence-grounded plan. Every load-bearing factual claim I spot-checked against the tree is correct: the `undefined`/`null` collision and non-JSON fall-through in `canonicalJsonStringify` (`fingerprints.ts:6,22`), the hardcoded `sha256` prefix despite a `sha256 | blake3` type/regex (`fingerprints.ts:1,3,151`), the false `'jcs-rfc8785'` label on a non-conforming canonicalizer (`fingerprints.ts:158`), the proof-builders living only in `__tests__/fingerprint-helpers.ts`, the `as unknown as TrustedDocumentHostContext` escape as the *only* constructor (`deterministic-test-host.ts:260`), the `excel-external-path` literal in a public folder (`kernel.ts:465`), the degraded `principal: { readonly tags }` (`kernel.ts:473`), the repeated provider-ref/storage-scope shapes and `CapabilityResourceContext`/`HostDocumentResourceContext` twins, the `unknown` holes (`kernel.ts:544,546`, `bindings.ts:53,135`), and zero external consumers (no `@mog-sdk/types-host` import anywhere outside the package). The plan correctly reframes "improve the production path" for a not-yet-wired contract shard as "make the contract correct and cheap to adopt now," and it sequences additive work before breaking renames with a sound justification (breaking changes are cheapest pre-adoption). It also explicitly enumerates the invariants to *preserve* (literal-`false` guards, single-use handles, Rust-gated workbook access), which keeps the hardening from accidentally weakening the security model.

## Major strengths

- **Diagnosis is specific and correct, not generic.** The canonicalization findings are framed as security-proof correctness issues (digest collisions on absent-vs-null optional fields across a surface saturated with optionals), which is exactly the right altitude for a trust-boundary contract.
- **Honesty objective.** Insisting the `canonicalization` label either meet RFC 8785 or be renamed to what it actually computes is the correct fix; a falsely-labeled spec on a proof is a real liability.
- **Single-source-of-truth for proofs.** Step 2's "derive `coveredFields` and the canonical payload from one declaration" directly attacks the silent issuer/verifier drift risk, and the proposed `coveredFields ≡ keys(canonicalPayload)` test is the right invariant.
- **Sequencing and parallelization are realistic** (Step 2 depends on Step 1; Steps 4/5 both edit `kernel.ts`/`bindings.ts` so coordinate to avoid churn), and cross-folder ripple (trusted-adapter factory, kernel validation gate) is named as coupling, not edit target — matching the actual tree where those consumers are absent.
- **Verification gates are concrete**: named test categories (collision/negative, multi-vector SHA-256 parity, regex positive/negative, type-level `tsd`/`expect-error` for branded ids and `as`-cast rejection) plus the real `pnpm --filter` typecheck/test commands.

## Major gaps or risks

- **Step 1 ↔ Step 2 invariant tension is unaddressed.** Step 1 proposes JCS-style *dropping* of object properties whose value is `undefined`, while Step 2 asserts `coveredFields ≡ Object.keys(canonicalPayload)`. If a covered field is `undefined` at issue time, JCS-dropping removes it from the canonical payload's keys and the asserted equality breaks — yet the proof would still claim to cover it. The plan should specify how optional covered fields are reconciled (e.g. covered fields are computed from the *schema*, not the runtime payload; or undefined-valued covered fields must throw). This is the one substantive logical seam left open.
- **"Make the brand real" is partly aspirational and the plan half-admits it.** A `unique symbol` brand cannot prevent an `as` cast at the type level; the only real enforcement is a runtime factory that lives cross-folder. What actually lands *in this folder* (Step 3) is a factory *signature* plus a doc convention and a fixture rerouted through a brand-application function. That is an improvement but does not deliver an enforceable brand on its own — the wording ("remove the `as unknown` escape hatch as the sole path") slightly oversells what is achievable here.
- **blake3 resolution is correctly raised but under-decided.** "Implement or narrow to sha256" is the right binary, but the plan leaves the choice open; given no provider exists, the low-risk default (narrow now, widen when a provider lands) could have been stated as the recommendation to reduce implementer ambiguity.
- **No mention of the `dist`-vs-`src` export duality.** `package.json` exports both a `development` (`./src/*.ts`) and built `types`/`import` (`./dist/*`) condition per subpath. New modules (`./proofs`, `./ids`) must be added to *both* arms; the plan says "mirror into the export map" but does not flag the dual-condition shape, a likely tripping point.

## Contract and verification assessment

The contract analysis is accurate and the strengthen-don't-weaken framing is right. Verification gates are good but should add: (1) an explicit test resolving the covered-field/undefined-drop reconciliation above; (2) a `package.json` resolution check that any new subpath resolves under both the `development` and `dist` conditions (currently only the transitive `types-document` resolution is mentioned). The proposed type-level tests are appropriate but note that they verify *intent*, not runtime brand enforcement — the review should not over-credit them as closing the brand gap.

## Concrete changes that would raise the rating

1. Resolve the Step 1/Step 2 seam: state that `coveredFields` derive from a static field schema (not the runtime payload), and that an `undefined` value on a declared covered field must throw rather than be silently dropped — so collision-safety and the `coveredFields ≡ keys` invariant can both hold.
2. Reword Step 3 to scope honestly: what lands here is a factory *signature* + doc convention + fixture reroute; true enforcement is the cross-folder factory. Avoid implying the `as`-cast hole closes within this folder.
3. Make the blake3 call: recommend narrowing the type/regex to `sha256` now, behind the same provider seam, and defer blake3 until a provider exists.
4. Add the dual-condition `package.json` export note for new `./proofs` and `./ids` subpaths, plus a resolution gate.
