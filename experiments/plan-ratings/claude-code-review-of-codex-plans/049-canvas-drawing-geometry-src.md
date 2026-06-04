Rating: 8/10

# Review of Plan 049 — Canvas Drawing Geometry Src

## Summary judgment

This is a strong, evidence-grounded plan for `@mog/geometry`. I verified its central factual claims against the live source and every one held up: the SVG parser does downgrade `A/a` arcs to `lineTo` (`path.ts:408-433`), the OOXML guide formula evaluator is genuinely duplicated between `connection-points.ts` (`evaluateFormula`, line 135) and `shapes/src/custom-geometry.ts` (`evaluateGuides`, line 57, same `*/`/`at2`/etc. ops), and `BoundedCache` has exactly the two latent bugs described — `get` gates on `value !== undefined` so cached `undefined` is never a hit (`bounded-cache.ts:20`), and eviction gates on `firstKey !== undefined` so `undefined` keys can't be evicted (line 37), plus `maxSize` validation only checks `< 1` rather than finite/integer (line 13). The dependency invariant (`@mog-sdk/contracts` only), the three public exports (`.`, `./connection-points`, `./connector-routing`), and the test/typecheck scripts all match `package.json`. The named consumer files all exist. This is not a hallucinated plan; it reflects real reading of the package and its dependents.

The plan also correctly characterizes the package's role as a contract boundary (path generation, hit-testing, connector behavior, chart picking, text-on-path) rather than a loose helper bag, and it preserves the right architectural rule throughout: dependency direction stays consumer → geometry.

The principal weakness is scope. This is effectively six interlocking plans (numeric core, SVG parser+arc, metrics engine, OOXML guides, connector/connection-site API, diagnostics+cache+exports+consumer migration) bundled as one. That is acknowledged in the parallelization section, but it inflates risk and makes the verification surface very large.

## Major strengths

- **Accurate diagnosis with file-level specificity.** Each concrete defect (arc downgrade, guide duplication, cache `undefined` handling, scattered `1e-10`/`1e-12`/`1e-8` tolerances, global `isFinite`) is real and independently checkable. This is the difference between a plan and a wish list.
- **Explicit invariant section.** Lines 73-88 enumerate dependency, purity, coordinate, bbox, matrix, path, SVG-parser, arc, metric, hit-test, guide, connector, cache, and public-API invariants. The matrix layout and "B applied first" multiplication semantics are pinned down, and inclusive zero-area `pointInRect` behavior is explicitly preserved because tests assert it — a sign the author checked existing behavior rather than redesigning blindly.
- **Correct separation of OOXML visual-angle arcs from SVG endpoint arcs** (invariant + risk note). Conflating these two angle conventions is the classic mistake here; the plan flags it twice and limits sharing to the low-level cubic subdivision helper.
- **Strong risk awareness.** It anticipates that tightening parser/guide diagnostics will surface previously-hidden malformed data and explicitly rejects re-introducing silent fallbacks, and it flags adaptive-metric CPU cost and rect-semantics changes to broad-phase hit-testing.
- **Sequencing is sound.** Numeric core first (everyone depends on it), then parallel SVG/metrics/guides, then connector routing after connection-point resolver, then consumer migration, then cross-package verification.

## Major gaps or risks

- **Over-bundling.** Nine implementation sections + seven consumer migrations is a program, not a unit of work. It would be safer as a sequence of independently-landable plans (numeric+cache first; SVG/arc; metrics; guides+shape migration; connector API+consumers). The current shape makes the verification gate all-or-nothing.
- **Under-specified connection-site data contract.** Section 5 and risk #7 add `resolveConnectionPointByIndex` and angle/orientation metadata, then admit "spreadsheet floating objects may not currently expose" the needed data and defer the `@mog-sdk/contracts` type to "if the implementation requires." This is the least concrete part and the one most likely to expand into a contracts change — it should name the proposed shape (e.g. a `connectionSites: ConnectionPointDef[]` field) and acceptance criteria, not leave it to the implementer.
- **Parser failure-mode rollout is a behavioral break, not just a fix.** Switching the production `parseSvgPath` from "substitute 0 / downgrade arc" to "fail clearly" changes behavior on real imported files. The dual strict/diagnostic API partially mitigates, but the plan does not enumerate which production call paths feed the parser untrusted file data, nor a telemetry/migration step to confirm the new hard failures don't regress live documents. For a contract boundary this matters.
- **Existing snapshots not addressed.** `__tests__/__snapshots__` exists; a parser/metrics rewrite will churn snapshots, and the plan's test list doesn't mention reconciling or intentionally regenerating them.
- **No performance gate.** Adaptive flattening touches `spatial-query` broad-phase and text-on-path hot loops. The plan says "cache where safe" and "reusable metric tables" but defines no benchmark or regression threshold — the one place a "gate" is named (typecheck/test) won't catch a 2× CPU regression.
- **Soft acceptance language.** Several items hedge ("if production consumers need", "only if", "where useful", "eventually use it"), which weakens contract clarity and invites scope drift. Each "if" should resolve to a checked yes/no against current consumers before implementation.

## Contract and verification assessment

Contract clarity is above average: invariants are explicit, the OOXML op list is concrete and matches the duplicated code, and `PathSegment` output is correctly constrained to `M/L/C/Q/Z` (no arc segment in contracts). The weak contracts are the connection-site-by-index data shape and the strict-parser default behavior, both of which need pinned-down inputs/outputs.

Verification gates are concrete and use real workspace filters (`@mog/geometry`, `@mog/drawing-engine`, `@mog/shape-engine`, `@mog/text-effects-engine`, `@mog/diagram-engine`) plus a thorough per-area test enumeration and sensible e2e guidance (drive real UI input, not state mutation). Gaps: no per-slice acceptance criteria tying specific tests to specific behavior changes, no snapshot strategy, no performance benchmark, and the OOXML migration gate ("match current shape custom-geometry fixtures after migration") is the right idea but should be called out as the primary safety net for the guide-evaluator unification.

## Concrete changes that would raise the rating

1. **Split into landable phases** with their own gates — at minimum separate the breaking parser change and the connection-site contract from the low-risk cache/numeric refactor, so the latter can ship immediately.
2. **Specify the connection-site data contract**: proposed `@mog-sdk/contracts` type (or confirmation none is needed), the exact `resolveConnectionPointByIndex` signature, and the `0..3` → top/right/bottom/left fallback as a hard spec rather than prose.
3. **Define the parser rollout**: enumerate production call sites that parse untrusted/imported SVG, keep the lenient path available behind the diagnostic API during migration, and add a telemetry/counting step (or a corpus pass) confirming hard-failure paths don't regress real files.
4. **Add a performance gate**: a benchmark on `spatial-query` broad-phase and text-on-path glyph layout with an explicit no-regression threshold, since adaptive flattening is the highest-CPU-risk change.
5. **State the snapshot strategy** for `__tests__/__snapshots__` (intentional regeneration vs. preservation) for parser/metrics/serialization changes.
6. **Resolve the "if needed" hedges** in §1, §5, §8 against the actual current consumers before implementation, so each becomes a definite include/exclude.
