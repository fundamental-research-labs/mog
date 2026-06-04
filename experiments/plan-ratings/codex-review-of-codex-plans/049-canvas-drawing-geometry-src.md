Rating: 8/10

Summary judgment

This is a strong, production-relevant plan. It correctly treats `@mog/geometry` as a contract boundary for drawing, text effects, chart picking, connector routing, PDF/print typing, and diagnostics rather than as a grab bag of helpers. The plan is grounded in real source issues: `parseSvgPath` currently downgrades arcs to lines and silently supplies missing numbers, OOXML guide evaluation is duplicated and falls back to zero, Bezier/path queries use inconsistent approximations, connector routing is mostly bounding-box based, and `BoundedCache` mishandles `undefined` keys/values.

The rating is not higher because the plan is still more of a comprehensive technical direction than an executable implementation contract. It needs exact public API shapes, numeric acceptance criteria, corpus gates, and phased completion rules before multiple agents could implement it without drifting or landing half-migrated shared abstractions.

Major strengths

- The scope is accurate and tied to the actual package surface: root exports, `connection-points`, `connector-routing`, package scripts, and module-level tests are all accounted for.
- The architectural fit is excellent. The plan preserves geometry purity, keeps dependencies downward on contracts only, and moves shared OOXML/path math into the package that should own it.
- It focuses on production paths and named consumers instead of test-only utilities or generated output.
- It uses systematic category coverage rather than one-off fixes: parser semantics, arc conversion, guide formulas, path metrics, hit testing, diagnostics, connector sites, cache behavior, and exports are all covered.
- The verification section is broad and mostly appropriate, including geometry package gates, consumer gates, type gates, and real UI checks for connector behavior.
- The sequencing and parallelization notes are useful: numeric/diagnostic foundations first, then SVG/path metrics and OOXML guide work in parallel, followed by connector and consumer migrations.

Major gaps or risks

- Several new contracts are described by intent rather than concrete API. The plan should specify signatures and result types for `parseSvgPathWithDiagnostics`, strict guide evaluation, metric table construction, route metadata, indexed connection-site resolution, and diagnostic issue codes.
- Error semantics are under-specified. Tightening the SVG parser and guide evaluator is correct, but the plan needs to say which APIs throw, which return diagnostics, and which remain tolerant for import/read paths.
- Numeric acceptance criteria are missing. Named tolerances are proposed, but there are no target values or pass/fail rules for arc cubic deviation, adaptive flattening error, nearest-point error, singular matrix epsilon, or hit-test tolerance.
- The scope crosses many packages. That is architecturally reasonable, but each phase needs a non-negotiable "done" boundary so the repo does not end up with a shared numeric core landed while shapes, spreadsheet connectors, charts, or text effects still use old assumptions.
- The plan flags that connector site resolution may require shape data that floating objects do not expose, but it does not define the data contract from preset shape definition through saved object state and rerouting.
- The fallback-removal strategy is too high level. Existing preset/custom geometry, imported SVG paths, and XLSX-derived shapes should be inventoried before silent zero fallbacks become hard failures or diagnostics.
- Export changes need a stricter compatibility gate: package `exports`, declaration output, root namespace shape, and a no-deep-import scan should be explicit.
- Performance risk is acknowledged but not quantified. Adaptive metrics and repeated hit testing need CPU/memory budgets, cache invalidation rules, and representative production scenarios.

Contract and verification assessment

The plan has the right contract themes: finite numbers, normalized boxes, matrix multiplication order, SVG arcs converted to cubics, distinct SVG and OOXML arc conventions, shared metric tables, exact guide resolution, intentional exports, and geometry package independence. Those are the right invariants for this folder.

The verification gates are strong but need sharper binding to the contracts. Geometry `pnpm test` and `pnpm typecheck` are appropriate because the package has those scripts. The listed consumer tests are also appropriate if those consumers are touched. To be fully verifiable, the plan should require golden/reference fixtures for SVG arcs and OOXML guide formulas, corpus validation against existing preset data, declaration/export checks after API changes, and a production UI exercise using real mouse-driven connector creation/rerouting rather than only synthetic route calls.

Concrete changes that would raise the rating

1. Add exact TypeScript interfaces for the new parser, diagnostics, guide, metric, arc, and connector APIs before implementation starts.
2. Define strict vs tolerant behavior for every import-facing API, including whether malformed SVG/OOXML data throws, returns diagnostics, or produces a degraded path.
3. Add numeric pass/fail thresholds for arc conversion accuracy, flattening tolerance, nearest-point accuracy, matrix singularity, and route/hit-test tolerances.
4. Split the work into landing phases with required tests and consumer migrations per phase, not just a dependency order.
5. Add an existing-corpus audit gate for preset shapes, custom geometry, imported SVG paths, and connector site data before removing silent fallbacks.
6. Specify the connector-site data flow from preset `cxnLst` to shape objects to spreadsheet/diagram rerouting APIs.
7. Add export and dependency verification: package `exports`, generated declarations, no deep source imports, and no new dependency from geometry to consumers.
8. Add representative performance gates for text-on-path metrics and repeated hit testing so adaptive geometry improves correctness without regressing production interaction speed.
