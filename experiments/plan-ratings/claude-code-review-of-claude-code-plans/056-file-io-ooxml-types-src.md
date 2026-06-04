Rating: 9/10

# Review — 056 `ooxml-types` strict-parsing / round-trip-parity plan


## Summary judgment

This is an unusually strong, evidence-grounded plan. Nearly every quantitative
claim it makes is verifiable against the source, and the few I spot-checked all
held: 236 enums (plan says 235), 21 files using `XmlEnum`, exactly 121
`fn from_ooxml` vs 11 `fn from_ooxml_token`, 575 read-side consumer sites in the
XLSX parser, and the `XmlEnum` macro's own doc-comment literally naming the
"dedicated round will extend strictness to every OOXML enum" TODO that this plan
sets out to discharge. The diagnosis — that lenient-vs-strict parsing is split
"by accident of authorship, not by call-site safety," with token form triplicated
across `to_ooxml`/`from_ooxml`/`#[serde(rename)]` and no exhaustive guard — is
correct and well-supported. The proposed fix attacks the bug *class* (extend the
keystone macro, mechanize the invariant) rather than instances, and it correctly
identifies what must stay byte-for-byte stable (the `to_ooxml` wire tokens, the
575 lenient call sites, each `#[default]`). The phasing is sound, the non-goals
are disciplined and explicit, and the riskiest step (behavior change at call
sites) is correctly isolated to Phase 4 behind owner coordination so it does not
block the additive vocabulary-crate work.

The reason this lands at 9 and not 10 is a handful of under-specified
mechanics in the verification harness and the consumer-migration boundary, detailed
below — gaps of precision, not of direction.

## Major strengths

- **Diagnosis is empirically true.** I independently confirmed the enum count,
  the 21/121/11 split, the 575 read sites, the macro's unit-variant-only
  restriction (`xml_enum.rs` errors on non-unit fields), the `UnderlineStyle`
  `from_ooxml_token` returning `Option` with the "`doubleAccounting` must never
  silently become `none`" rationale, `ShapePreset`'s 187-value completeness claim,
  and the `#![allow(clippy::large_enum_variant)]` / "serde always on" invariants.
  This is not a hand-wavy plan.
- **The keystone is correctly located.** Generating `try_from_ooxml`/`try_from_bytes`
  as an *additive* sibling in `XmlEnum` makes strictness a one-line opt-in for
  every derived enum and leaves existing signatures untouched. That is the minimal
  change that unlocks everything downstream, and the plan recognizes it gates
  Phases 2–4.
- **Wire-contract preservation is treated as the top risk and gated three ways:**
  Phase-0 records the exact current token, Phase-3 round-trips it, and acceptance
  criterion (c) demands a before/after `to_ooxml` token-set diff. Migrating one
  module at a time bounds blast radius.
- **Honest scoping.** Non-unit choice-group enums are acknowledged as
  underivable and explicitly kept hand-written but invariant-covered, rather than
  forced into the macro. The String-alias-newtype temptation is correctly deferred.
- **Parallelization model is realistic** — Phase 2 is genuinely module-local and
  embarrassingly parallel once Phase 1 lands.

## Major gaps or risks

- **"Exhaustive over every enum" rests on a hand-maintained list.** Phase 3 admits
  Rust enums can't be reflected, so the harness drives off an
  `assert_enum_invariants!(Type, [variants…])` registry with an "add new enums here"
  anchor. That means the *completeness* guarantee is itself only as good as a
  manually curated list — exactly the drift failure mode the plan is trying to
  eliminate. The plan should specify a mechanical check that the registry is
  complete (e.g. a build-time or grep-based reconciliation that every
  `XmlEnum`-deriving type appears in the list), otherwise a newly added enum
  silently escapes the gate.
- **Variant enumeration in the harness is also manual.** Round-trip "for each
  variant `v`" requires listing every variant per enum in the macro invocation.
  For 235 enums this is large, error-prone transcription — and an omitted variant
  is an invisible coverage hole. Worth noting `strum::EnumIter` (or a derive-emitted
  `ALL`/`variants()` slice from `XmlEnum` itself) as the mechanism so the harness
  iterates variants automatically rather than from a transcribed list.
- **`to_ooxml` site count discrepancy.** The plan cites 421 write sites; I count
  460 `to_ooxml` occurrences under the parser. Minor and immaterial to the
  argument, but it's the one number that didn't reconcile, suggesting the figure
  was taken with a narrower filter than stated.
- **Phase 4's "audit by path" is the soft spot.** Deciding which of 575 sites are
  "external-import" vs "internal/domain" is the crux of the production payoff, yet
  the plan gives only the macro's informal "Yrs, palette, domain conversions"
  hint as the partition rule. No concrete path globs or a worked example of the
  classification are offered. This is correctly deferred to the owner, but the
  plan would be stronger with a starter taxonomy.
- **Serde-parity test scope is slightly fuzzy.** The invariant is "where a variant
  has both `#[serde(rename="t")]` and `to_ooxml()=="t"`." But serde rename and the
  OOXML token are *legitimately* allowed to differ (the plan even says so). The
  test as phrased only fires when they already match — it cannot catch the case
  where they *should* match but a rename was mistyped, because a mismatch reads as
  "intentionally distinct." The plan needs an explicit allowlist of intentionally-
  divergent enums so divergence is opt-in, not the escape hatch.

## Contract and verification assessment

The contract section is the plan's best part: it correctly elevates `to_ooxml`
output, the `#[default]` variant, alias union coverage, and serde-form agreement
to enforced invariants, and it distinguishes "preserve exactly" (lenient path,
write tokens) from "strengthen" (add strict path, add parity test). The four
harness assertions (round-trip, alias coverage, strict rejection, serde parity)
are the right four, and pinning "strict returns `None` while lenient returns the
real-token default" for cases like `OnOff::Off` shows genuine understanding of the
trap. The verification gates (`cargo test -p ooxml-types`, `-p xml-derive`,
clippy, `check_inventory.py`) are appropriate and the plan correctly declines to
run them per worker constraints. The two weaknesses are both about *completeness
of coverage being self-certifying*: the enum registry and the per-enum variant
lists are manual, so the harness proves the invariant for what's listed but does
not prove the list is total. Closing that loop is what separates this from a 10.

## Concrete changes that would raise the rating

1. **Make the enum registry self-checking.** Add a mechanical reconciliation
   (build script, test, or `check_inventory.py` extension) that fails if any
   `XmlEnum`-deriving type or any conversion-bearing enum is absent from the
   invariant harness's list. Without this, "100% of conversion enums" is an
   aspiration, not a gate.
2. **Iterate variants mechanically.** Have `XmlEnum` emit a `const ALL: &[Self]`
   (or use `EnumIter`) so Phase-3 round-trips every variant without a transcribed
   list, removing the omitted-variant blind spot.
3. **Invert the serde-parity test with an explicit divergence allowlist.** Default
   to "rename must equal `to_ooxml`"; require enums that intentionally differ to be
   named in a small documented set, so a typo'd rename fails the build instead of
   masquerading as intentional.
4. **Give Phase 4 a starter path taxonomy.** Even a provisional glob list (which
   `domain`/`write`/`pipeline` subpaths are internal vs the import-edge readers)
   and one worked call-site migration would de-risk the production payoff and make
   the owner handoff concrete.
5. **Reconcile the 421-vs-460 write-site figure** so all cited numbers are exact.
6. **Specify how the before/after `to_ooxml` token-set diff (criterion c) is
   produced** — a tiny generated dump test or snapshot — rather than leaving it as
   a manual diff, since it is the primary guard on the highest-stated risk.
