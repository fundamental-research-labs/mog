Rating: 8/10

# Review of Plan 004 — `mog/contracts/runtime-services/src`


## Summary judgment

This is a strong, evidence-grounded plan. Nearly every factual claim it makes
about the source folder is verifiable against the code, down to byte-level
detail: the six in-scope files and their exact exports match `index.ts`; the
duplication with `mog/contracts/src/runtime` is real (`error-envelope.ts`,
`audit-event.ts`, and `service-config.ts:1`'s `DeploymentProfile`); the security
prose it quotes is present verbatim in `audit-event.ts` (`redactedMetadata`),
`error-envelope.ts` (`details`), and `deployment.ts` (`ServiceDiagnostics.config`);
the `private: true` + `@mog-sdk/*` + publish-shaped `exports` map ambiguity is
exactly as described in `package.json`; there is no test directory; and the
folder is in `mog/tsconfig.json` references but has no in-repo importer. I also
confirmed the most discriminating claim — that the `contracts/src/runtime` copies
were *stripped of the security comments* — by reading
`contracts/src/runtime/error-envelope.ts`, which carries none of the SECURITY
prose. The `DATA-FLOW-AND-EGRESS.md` "type-only contracts, not a shipped server"
quote is present and is correctly treated as a hard, preserve-not-regress
invariant. Cross-referenced Plans 002 and 005 exist. The plan understands the
package's role, respects its charter, sequences the one cross-package dependency
honestly, and proposes verification gates that target the specific drift/safety
failure modes it identified rather than generic "add tests."

The reasons it is not a 9–10 are not factual errors but design-judgment
tensions the plan under-resolves: it invests heavily in compile-time machinery
(branded IDs, `Redacted<T>`, discriminated error unions, drift-guard `tsd`
suites) for a package with **zero in-repo consumers and out-of-repo,
unseeable real consumers**, and it overstates how much "teeth" a type-level
redaction brand can actually have.

## Major strengths

- **Evidence-first and accurate.** Findings 1–10 are each tied to a concrete
  file/field, and spot-checking them against source produced no false claims.
  This is the rare review-target plan where the diagnosis can be trusted without
  re-deriving it.
- **Charter discipline.** The type-only / not-a-server posture is elevated to a
  preserve invariant and reinforced by gate 7 (grep the diff for any added
  runtime/route/IO). The redaction proposal is explicitly *signature-only,
  implementation-elsewhere*, which keeps it inside the charter.
- **The duplication finding is the highest-value item and is handled well.** It
  correctly identifies that the two copies are already non-equivalent *as
  contracts* (comments stripped) even while structurally identical, picks a
  canonical home (here), delegates the cross-package edit to Plan 002, and flags
  the build-cycle risk with a concrete mitigation (keep `runtime-services` a
  dependency-free leaf).
- **Backward-compat reasoning is sound.** It distinguishes brands (erase to
  `string`, safe) from union narrowing (needs superset + `(string & {})` escape
  hatch or a major bump), and ties that to the otherwise-soft versioning item.
- **Verification gates map to the findings.** Branded-ID non-assignability,
  principal-unification assignability, category→retryable matrix, redaction
  rejection of raw records, barrel completeness, and a cross-package drift guard
  are each a direct test of a specific finding.

## Major gaps or risks

- **Value-vs-cost is asserted, not justified, for a zero-consumer package.** The
  plan acknowledges "no compile-time pressure keeping it honest," then proposes
  the maximal compile-time-enforcement program. For a private type-only package
  with no in-repo consumer and out-of-repo consumers it cannot see, much of the
  branding/union safety protects code that doesn't exist in this repo and can't
  be type-checked here. The plan would be stronger if it tiered the work:
  do the high-leverage, low-risk items first (de-dup/single-source-of-truth,
  principal unification, `README`/publish decision, barrel + drift `tsd` tests),
  and treat branded IDs / `Redacted<T>` / discriminated error unions as a
  second, explicitly-optional tranche gated on a real consumer materializing.
- **The redaction "teeth" are weaker than claimed.** A `Redacted<T>` brand only
  proves a value passed through *a function with the right signature* — not that
  the function actually redacted anything, and it is trivially defeated by a
  cast at an out-of-repo boundary (which is exactly where untrusted producers
  live). The plan half-admits this under "Brand ergonomics" but still describes
  the change as giving the invariant "teeth." It should state plainly that this
  raises the cost of *accidental* leakage, not *determined* or careless-cast
  leakage, and that the real enforcement remains the (out-of-scope) redactor
  implementation.
- **Self-verifiability of the headline objective is limited.** "Single source of
  truth" cannot be demonstrated within this plan's edit scope — it depends on
  Plan 002 landing the re-export side, and gate 3 (cross-package drift guard)
  lives partly in `contracts`. The plan flags the coordination but does not
  define what "done" looks like for *this* plan if Plan 002 slips: does 004 land
  the canonical comments + brands alone and leave the duplication temporarily
  intact? An explicit "004 can land independently; de-dup completes when 002
  lands" statement would remove ambiguity.
- **Decision-ref consolidation may erase real distinctions.** Collapsing five
  differently-named refs into one `DecisionRef` brand (even with optional
  sub-brands) risks losing the by-name documentation value unless the sub-brands
  are mandatory at each site. The plan leaves sub-branding "optional," which
  could regress the clarity it is trying to add.
- **`ServiceSession.scopes` / capability-scope boundary is documented, not
  resolved.** Finding 8 is real, but the remedy (JSDoc cross-links + close
  `RoomGrant.scopes` only) leaves `ServiceSession.scopes: string[]` open and the
  two scope models adjacent-but-unreconciled. That is a defensible non-goal, but
  the residual conflation risk should be called out as accepted, not merely
  deferred.

## Contract and verification assessment

- **Contract clarity: high.** The plan names exact types, exact fields, and the
  exact widenings it intends, and it correctly separates "document the invariant"
  from "type-encode the invariant" (notably the error-envelope option a vs. b,
  with a sensible per-arm fallback). The `(string & {})` escape-hatch convention
  is the right tool for the open/closed tension on discriminants.
- **Verification gates: good but partly external and unrunnable here.** Gates 1–2
  (type-level + barrel completeness) are self-contained and well-targeted. Gate 3
  (cross-package drift) and gate 5 (acyclic workspace build) depend on Plan 002 /
  `contracts` wiring and so cannot be fully green from this package alone — the
  plan should mark which gates are local vs. cross-plan. Gate 7 (security-doc
  consistency via diff grep) is a genuinely good, cheap guard for the charter.
  The plan is explicit that the *planning* task runs no commands and the gates
  are for the *implementing* change, which is the correct framing.
- **Completeness: thorough.** Risks, edge cases, and non-goals are concrete and
  honest (out-of-repo breakage, discriminated-union over-constraint, re-export
  direction, brand ergonomics). Sequencing with Plans 002/005/001 is stated as
  hard vs. soft dependencies with a defined order (agree direction → land
  canonical here → land re-export in 002).

## Concrete changes that would raise the rating

1. **Tier the work and gate the speculative half.** Split into Tranche A
   (de-dup/single-source-of-truth, principal unification, `README` + publish
   decision, barrel + cross-package drift `tsd` tests — all high-value, low-risk,
   independently landable) and Tranche B (branded IDs, `Redacted<T>`,
   discriminated error union), with Tranche B explicitly justified by or gated on
   a concrete consumer. This directly answers the "zero compile-time pressure"
   problem the plan itself raises.
2. **Restate the redaction claim accurately.** Replace "gives the invariant
   teeth" with a precise statement: the brand prevents *accidental* assignment of
   an un-sanitized record in in-repo type-checked code, is defeatable by cast,
   and does not substitute for the redactor implementation. Keep the brand; right-
   size the claim.
3. **Define 004's independent done-state.** Add one sentence: 004 lands canonical
   shapes + comments (+ Tranche A) without waiting on 002; de-duplication
   "completes" only when 002 re-exports. Specify whether the drift guard lives
   here or in `contracts`.
4. **Make decision-ref sub-brands mandatory at each site** (or justify keeping
   them optional), so consolidation does not regress the per-name documentation
   value.
5. **Mark each verification gate local vs. cross-plan**, so an implementer knows
   which gates can be green from this package alone.
6. **Explicitly accept the residual `ServiceSession.scopes` conflation** as a
   known non-goal rather than an open question.
