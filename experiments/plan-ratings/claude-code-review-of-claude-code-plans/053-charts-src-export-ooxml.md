Rating: 8/10

# Review of 053 — `mog/charts/src/export/ooxml` (chart OOXML export fidelity)

## Summary judgment

This is a strong, evidence-driven plan. It correctly frames the folder as a pure, side-effect-free DrawingML serializer whose quality bar is round-trip/visual fidelity, and it grounds every improvement in a specific, verifiable defect. I spot-checked the most load-bearing evidence items against the live tree and they hold:

- Unescaped `formatCode` attribute at `axis-xml.ts:126` (`<c:numFmt formatCode="${format}" .../>`), with `escapeXml` defined at `style-xml.ts:19` and never applied there; date axis safely hardcodes `m/d/yyyy` at `:174`. **Confirmed.**
- `<c:numCache>` hardcodes `<c:formatCode>General</c:formatCode>` (`shared-xml.ts:83`). **Confirmed.**
- Categories always forced through `<c:strRef>`/`escapeXml(String(cat))` (`shared-xml.ts:70-78`); `generateDateAxisXML` exists (`axis-xml.ts:152`) but no cartesian generator calls it. **Confirmed.**
- Fabricated `<c:f>` ranges hardcode column `A` + `columnLetter(index+1)` from rows `2..N` (`shared-xml.ts:53-61`); no shared contract. **Confirmed.**
- `extractSeriesData` always assigns `getDefaultColor(index)` (`data-util.ts:66,83`) and never consults the color scale; pie does read it via `colorRangeForEncoding` (`pie-chart-xml.ts:430`). **Confirmed.**
- `wrapChartXMLFromSpec` (`chart-xml.ts:98`) is exported only via the barrel (`ooxml/index.ts:58`) and is never invoked by `toOOXML` (`export/index.ts:82-186`), which routes through each generator's own wrap — so the dual-axis branch is genuinely unreachable. **Confirmed.**
- `generateBoxWhiskerChartXML` exists (`bar-chart-xml.ts:233`) while `boxplot` is already routed to `ImageFallbackError` (`export/index.ts:161-166`), making it dead and `c:`-namespace-invalid. **Confirmed.**
- `valueForExport` preserves blanks as `null` and `shared-xml.ts:87` omits null points, vs. `Number(x) || 0` collapsing elsewhere. **Confirmed.**

The accuracy of the evidence is the plan's biggest asset: this is not speculative. The objectives, contracts section, and phased sequencing follow cleanly from the findings.

## Major strengths

- **Evidence quality.** Nearly every claim carries an exact `file:line` and is true. This is rare and makes the plan trustworthy and directly actionable.
- **Correct prioritization.** Validity hardening (XML escaping, color normalization, blank unification) is sequenced first as "no visual change, pure safety," ahead of fidelity features and consolidation. This is the right risk ordering — the escaping bug is a genuine Excel-repair-class defect.
- **Honest surface accounting.** It distinguishes in-folder edits from cross-file additive dependencies (`ooxml-types.ts`, `export/index.ts`), and explicitly names the dead/invalid paths it intends to remove or implement rather than leaving them ambiguous.
- **Contracts/invariants section is real.** Purity, cache+reference duality, fallback boundary, axis-ID uniqueness, and the to-be-introduced data-layout contract are stated as invariants to preserve/strengthen, not vague aspirations.
- **Parallelization analysis.** Phases 1/3/5 flagged as independent, with the genuine sequential dependencies (Phase 2 → Phase 4 item 8 → item 9; dual-axis last) called out.

## Major gaps or risks

- **The dominant cross-folder dependency is under-specified.** The plan repeatedly (and rightly) names the XLSX/workbook writer that must materialize data in the exact layout these `<c:f>` ranges assume — but it never locates that file, never confirms the *current* layout the writer emits, and never checks whether the assumed `A`/`columnLetter(index+1)` shape already matches it. Phase 4 therefore rests on an unverified premise. "Land the contract module and the writer change together" is the right instinct, but the plan should at least pin down where the writer lives and what it writes today before declaring the contract. This is the single biggest weakness.
- **Category-union alignment (item 9) assumes the data isn't already aligned upstream.** The compiler/`group-by` path may already produce aligned rows; the plan asserts the misalignment bug from the serializer's perspective but doesn't verify the shape of `DataRow[]` as actually delivered to `extractSeriesData` in production. If the compiler pre-aligns, item 9 is partly redundant; if not, the fix is correct. The plan should confirm which.
- **Verification tooling is named only generically.** "validated against the OOXML schema or a strict reader" and the "round-trip / golden gate" lean on infrastructure that isn't identified. The folder ships only two thin `__tests__`. The well-formedness gate (parse-with-an-XML-parser) is concrete and high-value; the schema/round-trip gate needs a named tool or corpus to be credible rather than aspirational.
- **Scope breadth.** 14 items over 5 phases touching nearly every file. The sequencing mitigates this, but item 12 (real secondary-axis support) is a meaningfully larger, cross-folder feature than the rest and could be split out; the plan's "prefer (a), fall back to (b) delete" hedge is sensible but leaves the change-set size indeterminate.
- **Number-format sourcing is slightly hand-wavy.** Item 4 sources `valueFormatCode` from `encoding.y.format` / `theta` / `size`, "falling back to `compileResult` axis format when present." Whether those channel `.format` fields are reliably populated post-compile vs. only on `compileResult` is exactly the kind of thing that determines whether the fix works; the plan defers this to runtime rather than confirming the resolved source of truth.

## Contract and verification assessment

The contract framing is the plan's strongest design contribution: introducing a single `data-layout.ts` as the named, documented owner of the `<c:f>` range mapping (replacing arithmetic re-derived in five files) is the correct architectural move and directly addresses the highest-fidelity-risk coupling. The "cross-folder test pins the layout and is referenced by the workbook-writer tests" idea is the right way to prevent silent drift — provided the writer side actually exists and is editable in the same change set, which the plan flags but does not de-risk.

Verification gates are well-chosen in kind (adversarial well-formedness, number-format fidelity, category-type fidelity, color parity with pie, multi-series alignment, legend parity, layout-contract pin, round-trip). The weakness is specificity: the cheap, deterministic gates (XML-parse, attribute equality) are clearly implementable; the expensive ones (schema validation, repair-free reopen, re-import reproduction) name no concrete tool. Given the stated failure modes (invalid XML → repair; silent visual drift), the parse gate plus per-attribute assertions already catch most regressions, so the plan is not blocked — but it overstates confidence in the round-trip gate.

## Concrete changes that would raise the rating

1. **Locate and characterize the workbook writer** before Phase 4: name the file, quote the layout it emits today, and state whether the current `A`/`columnLetter(index+1)`/stride assumptions already match. Turn the data-layout contract from an assertion into a verified shared invariant.
2. **Confirm the data shape into `extractSeriesData`** (pre-aligned by the compiler or not) so item 9's union-projection is justified rather than assumed; note the answer in the plan.
3. **Name the schema/round-trip tooling** (which validator, which eval corpus, which command is being relied on) or downgrade that gate to "manual reopen check" so the verification story is honest. Keep the XML-parse adversarial gate as the primary automated gate.
4. **Pin the resolved number-format source.** State definitively whether channel `.format` is populated post-compile or whether `compileResult` is the authoritative source, so item 4 doesn't ship a fallback that silently always hits `General`.
5. **Split item 12 (real dual-axis) into its own follow-up** unless the cross-folder series-grouping prerequisite is confirmed available; default the main change-set to option (b) (delete the unreachable branch) to keep this plan's surface bounded and shippable.

The plan is already well above average for this corpus; closing the cross-folder verification gap (items 1–3 above) is what separates an 8 from a 9.
