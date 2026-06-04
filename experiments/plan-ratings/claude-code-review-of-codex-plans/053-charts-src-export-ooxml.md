Rating: 8/10

# Review of Plan 053: Chart OOXML Export Fidelity


## Summary judgment

This is a strong, well-researched plan that demonstrates genuine inspection of
the target folder rather than generic boilerplate. Every diagnostic claim I
spot-checked against `mog/charts/src/export/ooxml` is accurate, the
invariant/contract section is unusually rigorous, the dependencies it names all
exist, and the verification commands point at real test files and real Cargo
packages. The plan's principal weaknesses are scope and resolution: it bundles
what is effectively a full rewrite of the export layer into a single plan with
no MVP/phasing, it defers the single most consequential architectural decision
(where generated chart source data lives), and it specifies the new public
contracts conceptually rather than as concrete type signatures.

## Major strengths

- **Diagnostics are verifiably correct.** I confirmed each headline claim in
  source:
  - The support-matrix inconsistency is real. `canExportToOOXML` returns
    `!shouldUseImageFallback(spec)`, and `shouldUseImageFallback`'s
    `UNSUPPORTED_MARK_TYPES` is only `['violin']`, so boxplot reports as
    exportable; meanwhile `toOOXML` throws `ImageFallbackError` for `boxplot`,
    and `getOOXMLChartElement` returns `'barChart'`. Three APIs disagree exactly
    as described (`export/index.ts:161`, `:228`, `:286`; `image-fallback.ts:22`).
  - `ExportOptions.compileResult` is declared (`ooxml-types.ts:61`) and
    documented (`export/index.ts:48`) but consumed nowhere — `rg` finds it only
    in the type and the doc comment, never read by an emitter.
  - `generateBoxWhiskerChartXML` is exported (`ooxml/index.ts:63`) and defined
    (`bar-chart-xml.ts:233`) but is unreachable from the `toOOXML` route.
  - Column math is hardcoded: `shared-xml.ts` always references categories to
    column `A` and values to `columnLetter(index + 1)`, with no source-range
    contract — the "private column math" the plan targets.
  - Tests are fragment-oriented (`__tests__/bar-chart-xml.test.ts`,
    `scatter-chart-xml.test.ts`).
- **Excellent invariant articulation.** The "Production-path contracts and
  invariants" section is the best part: purity/determinism, every `<c:f>`
  referencing a range that actually exists, cache invariants (`ptCount`,
  preserved `idx` on blank omission, no `NaN`/`Infinity` serialization, XML
  escaping), canonical sheet-name quoting, unique cross-referenced axis IDs, and
  API-agreement between the three support surfaces. These are testable and map
  directly to observed gaps (e.g. `sanitizeNumericValue` currently maps
  non-finite to `0`).
- **Clean scope boundaries.** Explicitly excludes Rust package-graph ownership,
  ZIP assembly, imported-chart replay, and drawing-anchor preservation in
  `file-io/xlsx/parser`, treating them as integration/verification targets.
- **Grounded verification.** The referenced test files
  (`__tests__/export/ooxml-export.test.ts`,
  `__tests__/integration/full-pipeline-export.test.ts`) already exist; the
  `xlsx-parser` Cargo package name is correct; `@mog/charts` is correct; and the
  dependency files (`core/chart-ir/fields.ts`, `core/config-to-spec/fields.ts`,
  `grammar/compiler.ts`, `spreadsheet-utils` `quoteSheetName`) all exist.
- **Sensible parallelization** keyed off two shared interfaces (support matrix +
  export model) being agreed first.

## Major gaps or risks

- **Unphased mega-scope.** Steps 1–8 amount to: a shared decision table, a typed
  `ChartOOXMLExportModel`, a `ChartDataReferencePlan`, a new XML serialization
  layer, complete re-mapping of every chart family, a new public export-result
  contract, a workbook-writer integration seam, and a ChartEx decision. There is
  no MVP, no "land this first" increment, and no risk-ordered sequencing of
  which gap to close first. As written this is multiple weeks of coupled work
  that is hard to land or review safely. A strong plan would carve a shippable
  spine (e.g. fix the support-matrix divergence + reference-plan contract +
  tests) from the long tail.
- **The central architectural decision is deferred.** The whole "every formula
  references a real cell" contract depends on *where generated chart data
  lives* and how helper/hidden sheets are named to avoid collisions. The plan
  correctly flags this as a risk but never resolves it — it is the load-bearing
  decision and should be decided in the plan, not left to implementation.
- **Contracts are conceptual, not literal.** `ChartOOXMLExportModel`,
  `ChartDataReferencePlan`, and the "new public export result contract" are
  described by enumerated field names in prose. For a contract-quality plan that
  five agents will implement in parallel, the actual TypeScript interface shapes
  (field names, types, optionality, the `catRef`/`valRef`/`xRef`/`yRef`/
  `bubbleSizeRef` carriers) should be sketched so the seam between Agents B/C/D
  is unambiguous.
- **No back-compat / consumer analysis.** `toOOXML` and the `ooxml/index.ts`
  re-exports are public surface consumed elsewhere (e.g. the engine/XLSX bridge
  that materializes chart parts). Changing `OOXMLExportResult` to carry a data
  plan is a breaking change; the plan does not enumerate current callers or a
  migration path.
- **ChartEx left unresolved.** "Either implement proper ChartEx output … or mark
  unsupported" is an open decision repeated several times. Acceptable to flag,
  but it leaves a whole family of behavior (boxplot/violin/waterfall/funnel/
  Pareto) without a committed direction.
- **Openability gate may be aspirational.** "Roundtrip/openability gates … in
  Excel/LibreOffice-compatible validators where available" does not identify
  whether such tooling exists in-repo. If it does not, this gate cannot run and
  should be downgraded or replaced with the achievable `xlsx-parser` package
  integrity validation it already names.

## Contract and verification assessment

Contract clarity is high in *intent* and medium in *precision*: the invariants
are concrete and testable, but the new types are not specified at signature
level, which is the main thing a parallel-implementation plan needs nailed down.
Verification gates are credible and largely real — the named test files and
packages exist, the `pnpm test`/`pnpm typecheck`/`cargo test -p xlsx-parser`
commands are runnable, and the test taxonomy (model units, real-parser
order/well-formedness, golden fixtures, full-pipeline E2E, package integrity) is
appropriately layered. The weak link is the openability gate's "where available"
hedge and the absence of a defined pass/fail bar for the golden-fixture
normalization (what counts as a tolerable diff). The plan also correctly keeps
internal artifacts out of `mog`.

## Concrete changes that would raise the rating

1. **Phase it.** Define a Milestone 1 that lands a shippable slice — unify the
   three support APIs against a single decision table, introduce the
   `ChartDataReferencePlan` for category/value families only, and convert the
   fragment tests to real-parser order/reference assertions — with later
   families and the XML serializer layer as follow-on milestones.
2. **Decide the helper-data-table model in the plan.** State where generated
   chart data lives, the hidden/helper sheet naming scheme, collision avoidance
   with user sheets, and how caller-provided ranges vs generated ranges are
   distinguished. This unblocks the formula-reference contract.
3. **Specify the new types as literal interfaces.** Give the field-level shape
   of `ChartOOXMLExportModel`, `ChartDataReferencePlan`, `ChartOOXMLExportContext`,
   and the extended `OOXMLExportResult`, including the ref carriers each emitter
   consumes.
4. **Add a consumer/back-compat section.** Enumerate current callers of
   `toOOXML` and the `ooxml` re-exports (engine/bridge) and state whether the
   result-contract change is additive or breaking, with a migration note.
5. **Commit to a ChartEx direction** (implement vs fallback) per family rather
   than leaving it open, or scope it explicitly out of this plan.
6. **Harden the openability gate.** Confirm the validator tooling exists; if
   not, make `xlsx-parser` package-integrity validation the binding downstream
   gate and define the golden-fixture diff tolerance.
