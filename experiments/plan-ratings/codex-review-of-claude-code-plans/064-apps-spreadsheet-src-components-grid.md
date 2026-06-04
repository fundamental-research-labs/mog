Rating: 8/10

Summary judgment

This is a strong, source-grounded plan with unusually good coverage of the grid component tree's real production responsibilities: React-to-renderer orchestration, DOM overlays, hot-path render isolation, and editor behavior. The diagnosis matches the inspected code well, including the duplicated outline math, async render-context getter unions, out-of-band `updateContext` effects, module-level editor state, stale documentation pointers, split-view console stubs, hardcoded metadata-cache bounds, and the rich-text plaintext fallback.

The rating is not higher because the plan bundles several architectural efforts that cross folder ownership boundaries while still presenting the work as mostly scoped to `components/grid`. The refactor objectives are generally right, but O2/O3/O7 need sharper contracts with renderer context, cache hooks, print pagination, and rich-text segment APIs before an implementer can execute without making local guesses.

Major strengths

- The plan is evidence-based. It names real files and real hotspots rather than generic cleanup themes, and the cited source issues are present in the current tree.
- The production-path framing is correct. It treats the grid as a canvas renderer host with DOM overlays, and it correctly prioritizes render isolation over React-state convenience.
- The contracts section is valuable. C2, C3, C4, C5, C6, and C7 capture the behavior most likely to regress during this kind of refactor.
- The sequencing is mostly sensible: characterize first, extract pure logic, tighten getter contracts, then consolidate wiring and isolate behavior-changing rich-text work.
- The plan identifies cross-folder dependencies instead of silently pretending all work can be done in the folder.
- It rejects test-only shortcuts and asks for real UI/app-eval coverage for overlay behavior, which fits the repository's E2E rules.

Major gaps or risks

- Scope is too broad for one plan. Pure extraction, renderer-context capability changes, async cache migration, editor state scoping, split-view cleanup, documentation hygiene, and rich-text segment editing are independently meaningful workstreams. Combining all of them raises integration risk and makes "done" harder to verify.
- O2 is under-specified. "Add the data-source capability to `setContextConfig`" is the central architectural dependency, but the plan does not define the new renderer API shape, ownership boundary, lifecycle semantics, or compatibility path for existing context updates.
- O3 needs a more precise readiness model. Making all paint-path getters synchronous is directionally right, but the plan does not define per-getter stale/empty semantics, cache invalidation triggers, or how expensive page-break calculation moves out of the getter without blocking the preview toggle path.
- O7 is a large product feature hiding inside a grid cleanup plan. Lossless rich-text editing requires a specific segment model, toolbar selection contract, command routing, commit payload format, and migration behavior. The plan only sketches these.
- The "byte-for-byte rendered output unchanged" contract is too strong without a concrete golden-image or render-state snapshot mechanism. Unit tests for extracted math help, but they do not prove canvas parity for C1.
- Phase 0 says to characterize logic "through its present location where possible", but much of the logic currently lives inside component callbacks. The plan should say whether to extract behind tests first, export internal helpers, or use component harnesses.
- Paper-size completion is ambiguous. "Remaining OOXML codes Mog supports" needs an explicit supported-code table and expected mapping source, otherwise implementers can disagree while all tests still pass locally.

Contract and verification assessment

The contract language is one of the plan's best parts. It preserves the important production invariants: no hot-path React rerenders, no async frame reads, no editor focus regression, no forked DOM/canvas text positioning, no lifecycle reordering, and no test-id churn. These are the right constraints for this folder.

The verification gates are good but incomplete for the highest-risk claims. Unit tests for outline levels, print options, floating previews, editor sizing, and sync adapters are appropriate. The plan should also require a small renderer-context integration test that proves the new `setContextConfig` capability updates the actual production render path, plus a browser-driven smoke test for inline editing, page-break preview, filter buttons, and remote/trace overlay refresh after the context consolidation.

The plan correctly avoids running verification in this planning task and delegates implementation gates to the future implementer. For an implementation plan, it should name the exact package-level commands once the affected package scripts are confirmed.

Concrete changes that would raise the rating

- Split O7 into a separate rich-text editing plan, or make it an explicit dependent plan with its own segment/selection/commit contract.
- Specify the renderer-context API change for O2: method signature, callback ownership, update lifecycle, cleanup behavior, invalidation semantics, and affected files outside `components/grid`.
- Define synchronous getter behavior per getter for O3, including initial empty value, stale value, cache refresh trigger, and renderer invalidation reason.
- Replace "byte-for-byte rendered output" with a verifiable parity mechanism: render-state snapshots for extracted data plus one or more browser/canvas screenshot checks for the page-break, grouping, floating-object, trace-arrow, and remote-cursor overlays.
- Make the paper-size table explicit in the plan with source-of-truth references and expected mappings.
- Clarify Phase 0 mechanics for testing logic currently trapped inside component closures.
- List concrete app-eval scenarios or new scenario names that cover the real UI input paths after the refactor.
