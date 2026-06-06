Rating: 9/10

# Review of Plan 078 — `mog/domain-types/src/domain/workbook`


## Summary judgment

This is a strong, evidence-grounded plan. Nearly every factual claim it
makes about the source was verifiable against the actual files, down to the
specific footguns it targets. It correctly frames the folder as a pure-type
hub feeding three pipelines (import → OOXML → domain, domain ⇄ Yrs/JSON, domain
→ OOXML → export) and derives its objectives from that framing rather than from
cosmetic code smells. The objectives are real production-path contract gaps,
not test scaffolding, and each is tied to a concrete verification gate. The
scope discipline (in-folder change vs. enumerated ripple follow-ups), the
wire-compat risk analysis, and the explicit "this may be intentional —
confirm before merging" caveats are exactly what a domain-type plan should
contain.

The deductions are for ambition/softness in a few objectives and a minor path
hygiene issue, not for correctness.

## Verification of claims (spot-checked against source)

- `web_publishing.rs:23` embeds `Option<ooxml_types::web_publish::TargetScreenSize>`
  directly — **confirmed**. The leak contradicts the `protection.rs:6`
  re-export convention, also **confirmed**.
- `view.rs:48` is `#[serde(default, skip)]` while every other optional uses
  `skip_serializing_if` — **confirmed**, and `ooxml.rs:122,292` do carry
  `ext_lst_raw` across the OOXML `From` impls, so the JSON/Yrs drop really is
  silent and asymmetric.
- `identity.rs:91` exposes `ooxml_types::workbook::SheetState` directly —
  **confirmed**.
- The identity divergence (objective 3) is **real**: domain `WorkbookLineage`
  = `{ duplicated_from, copied_from }` (`identity.rs:20-25`); the runtime
  `compute-document` `WorkbookLineage` = `{ origin_workbook_id, duplicated_from,
  duplicated_at }` plus `WorkbookCreationMetadata { created_by, imported_from }`
  and a numeric `WorkbookId` (`from_uuid_str`). The shapes genuinely cannot
  round-trip without an explicit mapping.
- No workbook type derives `DescribeSchema`; pivot/chart/conditional_format/
  drawings do (`bridge_types::DescribeSchema` imports confirmed). `bridge-types`
  is already a `Cargo.toml` dependency (`mog/domain-types/Cargo.toml:25`).
- `WorkbookSheetPackageInfo::default().kind == Invalid` vs
  `WorkbookSheetKind::default() == Worksheet` — **confirmed** (`identity.rs:124`
  vs `:56`).
- The calc sidecar booleans `has_explicit_iterate_count/_delta`
  (`calculation.rs:59-60`) and the `workbook_web_publishing_optional_fields_omitted`
  / `defaults_match_ooxml_spec` test anchors all exist as cited.

This level of corroboration is the plan's biggest strength: an implementer can
trust the diagnosis.

## Major strengths

- **Diagnosis precision.** Line-level citations that hold up under inspection.
  The objectives are framed as invariant gaps ("every OOXML field round-trips",
  "one encapsulation rule", "one identity model") rather than vague cleanups.
- **Correct three-way round-trip framing.** It distinguishes the OOXML
  in-memory round-trip (which `tests.rs` proves) from the JSON/Yrs round-trip
  (which it does not), and pins objective 2 to that exact blind spot — noting
  the current `serde_roundtrip_workbook_view_all_fields` sets `ext_lst_raw =
  None` and so could never catch the bug.
- **Scope and ripple discipline.** Clear in-folder vs. out-of-folder split,
  recommended sequencing with blast-radius ordering, and "land in-folder +
  tests first, parser/yrs adopt second" is the right order.
- **Honest non-bug treatment.** It does not assume `skip` is a bug; it asks
  whether the drop was intentional (size/PII) and prescribes a documented
  transient marker if so. Same for objectives 3/4/7 — each carries a
  "may be intentional; confirm with owners" gate rather than a forced change.
- **Verification gates map 1:1 to objectives**, and the wire-compat risk
  section correctly identifies `skip → skip_serializing_if` as a strict widening
  safe for existing readers.

## Major gaps or risks

- **Objective 2's framing slightly overstates the persistence loss.** It
  asserts "any workbook that round-trips through persistence silently loses
  bookView extension data," but later (parallelization notes) admits there may
  be **no Yrs mapping for workbook view at all** (only `sheet_view`). If there
  is no view Yrs path, the loss is confined to JSON serialization, and the
  fix's value is narrower than the headline implies. The plan should resolve
  this question up front rather than carrying the tension between a strong
  claim and a later hedge.
- **Mixed deliverable types.** Objectives 1/2/3-doc/6 are concrete code;
  objectives 4/7 are "investigate, then add-or-document," and objective 5's
  `validate()` lands here but is only meaningfully wired at an out-of-scope
  parse boundary. This is defensible given the type-only scope, but it means
  the plan's "done" state is partly soft (a doc comment and a deferred follow-up
  rather than a behavioral guarantee). The plan would be tighter if it labeled
  each objective explicitly as code vs. decision-record.
- **Path hygiene.** Out-of-scope references drop the repo's `mog/` prefix
  (e.g. `compute/core/crates/compute-document/...`, `file-io/xlsx/parser/...`,
  `infra/rust-bridge/...`); the real paths are `mog/compute/...`,
  `mog/file-io/...`, `mog/infra/...`. In-scope paths keep the prefix. Minor, but
  it cost verification time and could mislead an implementer running `rg`.
- **Objective 5 migration story is thin.** It adds `validate()` and version
  gating but stops at "supported value" without saying what the supported set
  is or what happens on a future v2 (reject? migrate? warn?). The "permissive
  Deserialize + explicit validate" split is the right shape; the version policy
  it gates on is underspecified.
- **Objective 7 is correctly flagged as cross-folder** (`ooxml_types::CalcPr`),
  but the in-folder fallback ("document the booleans are load-bearing + a test
  asserting flags survive independently of values") is the only thing that can
  actually land here. That's fine, but the objective reads as bigger than its
  in-scope deliverable.

## Contract and verification assessment

The contract section is the plan's core competence. It correctly elevates the
crate-wide wire conventions (`rename_all = "camelCase"`,
`skip_serializing_if = "Option::is_none"`, OOXML-accurate non-derive defaults)
to invariants, names the guarding tests (`defaults_match_ooxml_spec`,
`workbook_web_publishing_optional_fields_omitted`), and instructs that those
tests must continue to pass unchanged — treating any edit to them as a
wire-compat regression. The new-test list is specific and each test proves a
named objective, including the deliberately-populated `ext_lst_raw` case that
exposes the current test's blind spot. The "additive + `#[serde(default)]`
only, no renames" constraint for identity stability is the right backward-compat
discipline for durable persistence. The only verification weakness is the
identity-mapping test (objective 4-impl / objective 3): it asks to "assert no
field is silently lost or assert the documented intentional drop," but since
the canonical mapping is itself undecided pending owner sign-off, the test
can't be authored until that decision lands — so this gate is genuinely blocked
on an external dependency the plan acknowledges but cannot close.

## Concrete changes that would raise the rating

1. **Resolve the WorkbookView Yrs question up front** and restate objective 2's
   loss scope accordingly (JSON-only vs. JSON+Yrs). If no view Yrs mapping
   exists, say so and reframe the fix's value honestly.
2. **Fix the `mog/` path prefix** on all out-of-scope references so an
   implementer's `rg`/`sed` commands resolve.
3. **Label each objective as code / decision-record / deferred-follow-up** so
   the plan's completion criterion is unambiguous (e.g. objective 4 = "add
   derive OR add one-line module doc," both acceptable terminal states).
4. **Specify the identity version policy** for objective 5: the supported
   version set, and the prescribed behavior on an unsupported/future version
   (typed error now, migration hook later).
5. **Sequence the identity-mapping gate explicitly behind owner sign-off** —
   mark the objective-3 test as blocked-until-decision so it isn't mistaken for
   a same-PR deliverable.
6. (Minor) For objective 1, **commit to one encapsulation form now**
   (domain-side mirror enum vs. re-export) by checking which the crate already
   prefers, rather than leaving "pick the form" to the implementer — the
   `HashAlgorithm`/`SheetState` re-export precedent already answers this.
