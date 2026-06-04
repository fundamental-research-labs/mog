Rating: 8/10

# Review of Plan 079 — domain-types/src/domain/drawings


## Summary judgment

This is a strong, evidence-grounded plan that correctly identifies the central
production defect in the folder it scopes — `DrawingData.ooxml` is never
persisted through the Yrs storage path — and surrounds it with a coherent set of
contract-hardening objectives (serde/default discipline, converter parity,
typed-vs-opaque preservation, bridge drift, XLSX round-trip fixtures). The
factual claims I spot-checked all hold up against the source, which is the
single most important quality signal for a plan like this. The main weaknesses
are breadth and sequencing: it bundles roughly eight substantial workstreams
spanning five crates into one plan, treats the genuine bug and a long-tail
refactor program as peers, and leaves the riskiest item (serde renames on
already-stored Yrs data) without a concrete migration strategy.

## Major strengths

- **Accurate, verifiable diagnosis.** I confirmed the headline claim directly in
  `yrs_schema/floating_object/types/drawing.rs`: `append_drawing_entries`
  writes only strokes/toolState/recognitions/backgroundColor, and *both*
  return paths in `read_drawing_or_legacy` hardcode `ooxml: None` (lines 76, 86).
  I also confirmed `types/fields.rs:179-182` lists `data` for `"drawing"` but
  not `"ooxml"`, while `oleObject` and `formControl` (lines 192, 196) do list
  `ooxml`. The asymmetry the plan describes is real, so the Yrs fix in §2 is a
  legitimate, well-scoped bug fix rather than speculative work.
- **Serde-contract claims check out.** `group_shape.rs` has no
  `#[serde(rename_all = "camelCase")]` and `GroupShapeData`'s `children`,
  `grp_sp_pr`, `nv_grp_sp_pr` carry no skip attributes; `ole_object.rs` /
  `vml_shape.rs` use camelCase but serialize default bools unconditionally.
  This matches the plan's "default values still serialize required/default
  fields" observation, so §3 targets a real inconsistency with the module-level
  doc contract in `mod.rs:8-14`.
- **Clear invariants section.** The "production-path contracts and invariants"
  list converts vague intent ("lossless") into checkable statements (sidecars
  survive storage+bridge round trips; projections are named and one-way; raw XML
  only as writer-preservation payloads, never `serde_json::Value` bags). This is
  the strongest part of the document and is what makes the test plan auditable.
- **Dependency direction is explicit and correct.** §8 objective and the
  parallelization notes correctly state `ooxml-types` → `domain-types` →
  `xlsx-parser`/kernel, and that `ooxml-types` should be widened *before*
  `domain-types` invents parallel structures (effect DAG, custom geometry).
- **Good test taxonomy.** The split into inventory test, Yrs round-trip,
  converter parity matrix (enums × tokens, structs × every optional field,
  collection ordering, numeric units), and real XLSX fixtures is the right shape
  and explicitly rejects "choice-shape-only" tests for lossless converters.

## Major gaps or risks

- **Scope is a program, not a plan.** Sections 1–8 each constitute multi-day
  work; §4 (effect container/custom-geometry typing) and §7 (bridge drift
  check + kernel mapper migration) reach well outside the nominal source folder
  and depend on `ooxml-types` changes that don't exist yet. There is no stated
  MVP or "land this first" ordering. The actual bug (§2) is the one item with
  clear user-visible fidelity impact and should be called out as the priority
  deliverable; instead it sits as item 2 of 8 with equal weight.
- **Migration strategy for the highest risk is hand-waved.** The plan flags that
  adding rename/default attributes "can change existing JSON/Yrs wire names" and
  "may require migrations," but gives no concrete approach — no decision on
  whether existing fields are renamed vs. added, no read-compatibility shim
  design, no statement of what stored data exists in the wild today. For a
  collaborative Yrs store this is the difference between a safe change and silent
  data loss; it deserves its own design step, not a one-line risk bullet.
- **Verification gates name commands that don't exist in the plan.** §"Tests"
  step 8 says "regenerate bridge TypeScript artifacts through the repo's
  established bridge generation command" without naming it, and step 11 ("run
  the spreadsheet dev server and exercise imported drawing objects") is a manual
  step with no pass/fail definition. Acceptance is largely "add tests X/Y/Z"
  rather than measurable thresholds (e.g. "N corpus files that previously lost
  graphic-frame data now round-trip").
- **Inventory test (§1) risks becoming maintenance overhead.** A source-owned
  table recording "required serde casing, default expectation, converter
  expectation, bridge exposure, owner" for every type is valuable but can rot or
  become a tautology if it just restates the structs. The plan doesn't say how
  the inventory is mechanically tied to behavior (e.g. asserting serialized
  output) vs. being a documentation fixture.
- **"Byte-relevant round trip" is asserted but undefined.** Several opaque-tier
  goals (§4: `OpaqueEffectDag`, custom geometry) promise "byte-relevant round
  trip" without defining the equivalence (exact bytes? canonicalized XML?
  relationship-closure-equal?). XML re-serialization rarely reproduces input
  bytes, so this acceptance criterion needs precision or it cannot pass.

## Contract and verification assessment

The contract section is the plan's best feature: it is specific about which
fields are persistence-bearing (`DrawingData.ooxml`, `ShapeOoxmlProps.group_shape`,
`OleObjectOoxmlProps.object_pr`, `FormControlOoxmlProps.vml_shape`) and which are
UI projections, and it ties the camelCase/default-skip rules to a concrete,
already-violated module doc. I verified those four fields exist in
`domain/floating_object/{objects.rs,ooxml.rs,drawing.rs}`, so the contract
targets are real surfaces. The verification gates are ordered sensibly
(domain-types → xlsx-parser → compute-core → bridge regen → kernel → typecheck),
and the "no visual-only proof" / "no test-only fidelity path" non-goals are good
guardrails. What's missing is quantification: no baseline of how many converters
currently fail parity, no corpus-file evidence of fidelity loss today, and no
explicit gate that the Yrs change preserves *existing* stored documents (only
that newly-constructed objects round-trip). For a change touching a CRDT store,
a backward-read test against legacy `data`-shaped maps should be a named,
mandatory gate, not folded into "legacy migration tests."

## Concrete changes that would raise the rating

1. **Lead with the bug.** Promote §2 (Yrs `ooxml` persistence) to an explicit
   Phase 0 with its own acceptance test, and mark §§4,6,7 as follow-on phases
   gated behind it. State clearly that the rest is optional hardening.
2. **Add a real migration design** for serde field renames: enumerate which
   stored shapes exist today, decide add-vs-rename per field, specify
   read-compatibility (serde aliases / dual-read), and add a mandatory test that
   loads a pre-change `drawing` map (with legacy `data`) and asserts no loss of a
   separately-present `ooxml` field — the plan even names this hazard but doesn't
   test it.
3. **Define "round-trip equality" precisely** for opaque/raw tiers (byte-exact
   vs. canonicalized XML vs. relationship-closure-equal) so §4 acceptance is
   testable.
4. **Name the commands.** Replace "the repo's established bridge generation
   command" and the manual dev-server step with the actual command(s) and a
   concrete observable pass/fail for the bridge drift check.
5. **Make the inventory executable.** Specify that the §1 inventory drives
   assertions on serialized JSON (casing, empty-default emission) rather than
   restating type definitions, so it cannot silently drift from behavior.
6. **Quantify the baseline.** Cite how many converters currently lack full-field
   parity and, if possible, name corpus files that lose content-part /
   graphic-frame / group fidelity today, to anchor success in measurable terms.
