Rating: 8/10

# Review of Plan 068 — Harden the sheet-view substrate and capability surface (`mog/views/sheet-view/src`)

## Summary judgment

This is a strong, evidence-grounded hardening plan for a mature SDK boundary package. It correctly frames itself as "hardening and finishing, not redesign," and every phase is anchored to a verified defect or invariant in the real source. I spot-checked the plan's central claims against the code and they hold:

- `capabilities/skin.ts:429` hardcodes `validationErrors: []`, and `_status` only ever becomes `'idle'` (407, 453) or `'ready'` (414) — never `'error'`. The dead-surface argument is real.
- `api-extractor.json` has `apiReport.enabled: false` with `dtsRollup.enabled: true` — the "surface can drift silently" claim is accurate.
- `dispose()` (sheet-view.ts:836) disposes `_overlaysImpl`/`_canvasLayersImpl`/`_decorationsImpl`/`_skinImpl` *before* `_renderer.dispose()` — the ordering hazard is genuine.
- The constructor starts at line 398 and `dispose()` at 836; the `@internal` fields, the per-sheet vs stable lifetime comments, the `onScrollPositionReset`-skips-`switchSheet` note, and the bare `catch {}` in `_getActiveViewportReader()` (line 1530) all exist as described.

That level of accuracy is the plan's defining strength and the main reason for a high score. It loses points because its two most open-ended phases (the Phase 3/4 audits and Phase 6) are scoped as discovery rather than pinned-down edits, and a couple of mechanisms (the dev-mode index brand, the skin validation rule set) are under-specified relative to the precision of the rest.

## Major strengths

- **Verifiable evidence base.** Claims carry file:line citations that check out. This is the difference between a plan an implementer can trust and one they must re-derive. The closing evidence paragraph is honest about what was inspected.
- **Clean scope discipline.** In-scope/out-of-scope is explicit, the type-ownership invariant is named as the package's core contract, and the plan refuses to push view types into `@mog-sdk/contracts` (Phase 6 keeps conversions in the local mappers). This respects the package's reason for existing.
- **Contracts-to-preserve section is excellent.** Listing the `SheetViewHandle` shape, open discriminated unions, attach-ordering, and per-sheet vs stable lifetime as "must not regress" gives the implementer a regression checklist before touching anything. The "add variants, never rename/remove" framing for the unions is exactly right for an SDK.
- **Honest product fork.** Phase 1 names skin validation as a genuine A/B decision with different version-bump consequences and explicitly forbids shipping a half-state. That is mature plan-writing.
- **Sequencing is justified, not arbitrary.** Phase 5 (API report) first as a baseline so all later diffs are reviewed; Phases 3+4 serialized because they touch the same file; Phase 6 last because it needs consumer migration. The parallelization notes are concrete and correct about file contention.
- **Verification gates map to real homes.** Tests are routed to the existing `__tests__/` suite by filename (`skin.test.ts`, `sheet-view-data-sources.test.ts`), and the downstream gate (spreadsheet + embed typecheck/eval) is named as the ultimate consumer check.

## Major gaps or risks

- **Phase 3 and Phase 4 are partly audits, not edits.** "Audit every public method" for post-dispose policy and "audit the four disposable impls for renderer access during teardown" are discovery tasks whose outcomes aren't enumerated. The plan states the *policy* (lifecycle methods throw, idempotent internals no-op) but doesn't list which current methods are mis-classified, so the actual diff size is unknown. A reviewer can't tell if this is a 5-line fix or a 30-method sweep.
- **Phase 6 is the weakest phase.** "Confirm coverage and point the app at it," "enumerate the gaps and add owned-type methods," and "if the app registers providers, define a capability" are conditional and exploratory. It correctly depends on Phase 5 and consumer coordination, but it reads as a research spike rather than a buildable spec. Marking it lowest-priority/last is the right call, but it should probably be split out as its own follow-up plan rather than presented as a phase of equal standing.
- **Dev-mode index guard mechanism is under-specified and slightly risky.** Branding handed-out indices via a `WeakMap`/`Symbol` to warn on stale reads is a reasonable idea, but the plan flags (in Risks) that it "must not change index identity semantics" without describing how the brand avoids that. If the brand is attached to the index object itself, it touches identity; if via an external `WeakMap`, the getter has to look up on every read. The plan should commit to the external-WeakMap approach explicitly.
- **Skin validation rules (Phase 1A) aren't enumerated against the resolver.** "Malformed color strings, out-of-range opacities/widths, unknown `kind` discriminants" is a category list, not a spec. The resolver currently checks token membership against `CHROME_TOKEN_KEYS` and falls back; the plan should list the exact fields the validator inspects so the new error channel's contract is testable and stable (it becomes public surface the API report will lock).
- **`switchSheet()` "restore signal" is left as a maybe.** Phase 2 says "consider returning (or emitting) a `scroll-position-reset`-style signal." For a phase whose stated non-goal is "no reduced-scope just-document-it outcomes," leaving the most consumer-visible affordance as "consider" is in tension with the plan's own stance. Decide: emit a defined event, or document the call-ordering contract — not both-as-optional.

## Contract and verification assessment

The contract analysis is the best part of the plan. The type-ownership invariant is correctly identified as load-bearing, and Phase 5 wires it into a mechanical gate (API report must contain no `@mog/*`/`@mog-sdk/contracts` identifiers) — that is the right enforcement, not just prose. The "additive only" rule for `SheetViewHandle` and the discriminated unions gives a clear safety envelope.

Verification gates are concrete and phase-mapped, including the crucial "validation must never break rendering — always resolve with fallbacks" assertion for Phase 1A. The downstream consumer gate is named explicitly. Two soft spots: (1) the API-report gate's first commit is a baseline, which the plan acknowledges, but it doesn't say who reviews that baseline for surface that *shouldn't* be public (it explicitly defers that, which is defensible but worth flagging); (2) the Phase 4 "no leak on partial construction" test needs a fault-injection seam in `_buildCapabilities()` that the plan implies but doesn't call out as a testability requirement — extracting construction is what *enables* that test, so it should be stated as a dual-purpose change.

## Concrete changes that would raise the rating

1. **Enumerate Phase 3/4 audit outcomes.** Replace "audit every public method" with the actual list of methods whose post-dispose behavior changes (or state explicitly which currently throw vs no-op and which move). Same for the four disposable impls — name which ones touch the renderer during teardown so the reorder is a known diff, not a discovery.
2. **Pin the skin validation contract (1A).** List the exact fields validated and the `SheetViewSkinValidationError` shapes produced, since the API report will lock them. This turns a category list into a testable spec.
3. **Resolve the Phase 2 scroll-restore affordance to a single decision.** Commit to either a defined `events`-channel signal or interface JSDoc — consistent with the plan's own "enforce, don't just document" non-goal.
4. **Commit the index-guard to an external `WeakMap`** (index → owning sheet id) in the getter, and state the per-read lookup cost is dev-mode-only, to discharge the "must not change identity semantics" risk concretely.
5. **Demote Phase 6 to a named follow-up plan** (or convert it to a discovery deliverable that produces the capability spec), so this plan's "buildable now" phases (1–5) aren't diluted by an exploratory one that hinges on consumer migration.
6. **State the `_buildCapabilities()` extraction as a testability seam**, not only a transactional-construction refactor, so the Phase 4 fault-injection test has a defined hook.
