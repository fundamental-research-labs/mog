Rating: 7/10

# Review: 056 - File IO OOXML Types Source


## Summary judgment

This is a strong, evidence-grounded plan that demonstrates genuine familiarity
with the `ooxml-types` crate rather than generic boilerplate. Nearly every
concrete claim I spot-checked is accurate: the crate is ~43K lines with ~762
public structs/enums (plan says ~780), serde is an unconditional derive with a
no-op `serde` feature kept for downstream compat, the only deps are `serde` and
local `xml-derive`, `ExtensionList` is a `raw_xml: Option<String>` preservation
helper with the exact "not a blanket edit-safe guarantee" caveat the plan
echoes, `ChartGroup` carries the `raw_chart_type_attr` / `raw_chart_element_name`
/ `raw_chart_group_xml` fields the plan flags as coupled/high-risk, and the
bridge generator at `infra/rust-bridge/bridge-ts/tests/generate_ooxml_types.rs`
really does use hardcoded source-file lists plus manual maps for the
macro-generated `St*` newtypes that are invisible to the syn parser. The
`docs/ooxml-coverage/{manifest.json,check_inventory.py}` pair exists and behaves
as described (validates manifest shape and owner paths, skips schema inventory
when ECMA XSDs are absent).

The architectural posture is excellent: it firmly keeps `ooxml-types` a
vocabulary/preservation crate, forbids dependency inversions
(no mog-internal/compute/parser-internal deps), preserves public module paths and
serde semantics, and keeps package-graph/relationship/MCE/security/edit-authority
logic in the parser. The token-policy taxonomy (strict / default-on-absent /
preserve-other / recovery-only) and the preservation-policy registry are the
right conceptual tools for this codebase.

The reason it lands at 7 rather than higher: it reads as a multi-quarter program
charter, not a single executable plan. The new contract abstractions are *named*
but not *specified*, the scope is effectively unbounded ("complete categories"
across 7 cross-crate workstreams), and the highest-risk item (serialized
domain/compute storage-shape migration) gets one sentence.

## Major strengths

- **Accurate codebase grounding.** File references are mog-relative and correct;
  the observed strengths/weaknesses match reality (inconsistent enum token
  policy across 59 `XmlEnum` derives plus hand-rolled `from_ooxml`/`to_ooxml`,
  coarse manifest disconnected from the type set, manual bridge maps).
- **Architectural discipline.** Layering invariants, public-path stability,
  serde-shape preservation, and the "vocabulary crate, not parser" boundary are
  stated as hard constraints, not aspirations.
- **Security/preservation maturity.** Correctly treats `extLst`/raw payloads as
  owner-scoped replay (not semantic support), keeps ActiveX/credentials/VBA/
  external-refresh as parser security concerns, and ties raw payloads to dirty
  invalidation and relationship closure.
- **Concrete, sequenced verification gates.** Named cargo gates (`-p ooxml-types`,
  bridge `generate_ooxml_types`, `xlsx-parser`, `domain-types`, compute-core
  roundtrip), smallest-first, broadening to `pnpm typecheck` only when TS shape
  changes. The honest note that gates weren't run (queue constraints) is correct.
- **Realistic parallelization.** Slices A–G map cleanly to module families with
  an explicit "define inventory schema / token policy / error shape first"
  dependency order — the right critical path.

## Major gaps or risks

- **Scope is unbounded for one plan.** This is genuinely 7+ workstreams spanning
  `ooxml-types`, `xlsx-parser`, `domain-types`, `compute-core`, `bridge-ts`, and
  TS consumers. There is no phasing into shippable increments, no
  definition-of-done, and no statement of which slice delivers value first if the
  program is cut short. "Complete categories" is repeated as an aspiration but
  never bounded.
- **Contract clarity is thin.** `OoxmlToken`, `OoxmlValidate`, and
  `OoxmlTypeError` are introduced by intent only — no trait signatures, no error
  enum shape, no single before/after example of one migrated enum or one
  validated struct. A reviewer cannot tell what the macro/trait API will look
  like, so the most important deliverable (the contract itself) is unspecified.
- **No characterization baseline for behavior preservation.** The plan rightly
  warns that centralizing enum behavior can change malformed-input recovery, and
  says "preserve current behavior until classified" — but classifying the current
  strict/default/preserve behavior of dozens of enums is itself a large
  reverse-engineering task. There is no step to capture current behavior as
  characterization tests *before* migration, which is how you'd actually make the
  "no behavior change" guarantee enforceable.
- **The highest-risk item is under-developed.** Changing serialized shape stored
  by domain-types/compute risks breaking persisted documents. This gets a single
  "coordinate any shape change with those consumers" sentence with no migration
  strategy, versioning approach, or fixture/regression plan. For a crate whose
  payloads are persisted, this deserves its own section.
- **The new inventory checker's pass criteria aren't pinned.** Section 1 and the
  gates list a "new declaration inventory checker," but its failure conditions
  (does it fail CI on a missing row? on an undocumented raw field?) and its
  source-of-truth relationship to `manifest.json` vs. generated rows are left
  vague. Without a hard gate definition, "auditable/honest/machine-checkable"
  stays aspirational.

## Contract and verification assessment

Verification gates are above average: named, ordered smallest-first, tied to real
test targets that exist, and honest about not having run them. The bridge
"compiles through real consuming TS packages, not just emitted text" requirement
is a good quality bar.

Contract *clarity*, however, is the plan's weakest axis. The plan describes the
*shape of the solution* (one token table per enum, type-local validation,
owner-scoped policy IDs, source-driven bridge generation) very well, but never
commits to an actual interface. Examples that would close the gap: the
`OoxmlToken` trait method set and how `XmlEnum` is extended or replaced; the
`OoxmlTypeError` variant list and whether validation returns `Result` or
collects diagnostics; one fully-worked enum (e.g. a chart-type or boolean-alias
enum) showing the metadata table and generated `from_ooxml`/`to_ooxml`/`from_bytes`;
and the concrete row schema (field names/types) for the declaration inventory.
As written, the contracts are a design brief, not a spec an implementer could
build to without re-deriving the design.

## Concrete changes that would raise the rating

1. **Add a phasing/DoD section.** Break the 7 slices into shippable increments
   with acceptance criteria and a value ordering (e.g. Phase 0: inventory +
   checker as a CI gate; Phase 1: token contract on one module family with
   characterization tests; etc.). State what "done" means per phase.
2. **Specify the contracts concretely.** Give actual signatures for `OoxmlToken`,
   `OoxmlValidate`, and the `OoxmlTypeError` enum, plus one fully-worked
   before/after enum migration and one validated struct. Pin the inventory row
   schema (field names and allowed values).
3. **Add a behavior-baseline step.** Before any enum migration, capture current
   strict/default/preserve behavior (including malformed-input recovery) as
   characterization tests so the "no production behavior change" guarantee is
   enforceable rather than promised.
4. **Elevate the storage-shape migration to its own section.** Define the
   strategy for any change to domain-types/compute serialized shape: detection,
   versioning, fixture coverage of previously-persisted documents, and the
   rollback story. This is the single most dangerous change in the plan.
5. **Pin the inventory checker's gate semantics.** State exactly which conditions
   make it fail (missing public type row, undocumented raw field, bridge-visible
   type absent from generation) and its source-of-truth relationship to the
   manifest, so it becomes a hard gate rather than a report.
