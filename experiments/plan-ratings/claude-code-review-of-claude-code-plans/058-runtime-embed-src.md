Rating: 9/10

# Review of Plan 058 — Harden and complete `mog/runtime/embed/src`

## Summary judgment

This is an exceptionally strong, evidence-grounded plan. It treats `@mog-sdk/embed` as what it actually is — Mog's public exposure boundary — and organizes the work around that charter rather than around a feature wishlist. I independently verified the most load-bearing claims against the live source and every one held up exactly, including line-precise citations:

- iframe `child-host.ts` `_dispatch` has empty no-op `case`s for `sheetSelect`/`rangeSelect`/`scrollTo`/`focusRequest` (lines 178–186) and `_handleSourceRequest` `await`s `onSourceRequest(ref)` and discards the result (lines 256–259). Confirmed.
- `MogIframeClient.connect()` installs both `_startListening()` and a separate `onMessage` window listener; the 30s timeout path (lines 82–84) rejects without `removeEventListener`/`_stopListening()`. Confirmed.
- `config.ts` `FORBIDDEN_CONFIG_KEYS` is built by string concatenation (`'provider' + 'Config'`, lines 155–163) — an obfuscated denylist, not an allowlist. Confirmed.
- `renderer/index.ts navigateToRange` matches only `/^([A-Z]+)(\d+)/i`, scrolls to a single anchor, no `:`-range, no column overflow guard (lines 145–153). Confirmed.
- `client/index.ts` `InternalWorkbook` shadow interface (lines 26–38) is a hand-maintained kernel cast. Confirmed.
- `publish/mount.ts` transitions to `ready` via `queueMicrotask`, `setSheet` is a no-op, `getSheetNames` returns `[]`, renders no content. Confirmed.
- `package.json exports` is exactly `{ ., ./config, ./internal/views-host, ./react, ./web-component }`; `./iframe`/`./publish` are absent. Confirmed.
- `MogIframeHost`/`createIframeChildHost` are referenced only by the iframe barrel, the host-adapter, their tests, and `EXPOSURE.md` — never by `mog-sheet-element.ts` or `react/index.tsx`. Confirmed.

The fidelity between the plan's diagnosis and the actual code is the single best signal here: this plan was written from the source, not from a summary.

## Major strengths

- **Charter-first framing.** The plan correctly elevates the security invariants (opaque `source.ref`, `MessageEvent.origin` over payload-claimed origin, never `postMessage('*')`, effective-state-is-trusted, resolution monotonicity) into an explicit "invariants to preserve or strengthen" section, each tied to the test that guards it. This is the right altitude for a public boundary package.
- **Honest contract diagnosis.** The strongest finding (modes/capabilities/save/export are an "API-complete shell with no functional behavior") names the real problem on a public surface: advertised behavior the runtime cannot enforce. The plan refuses to paper over it and forces a decision (D1 implement vs D2 narrow-the-contract).
- **Correct dependency sequencing.** Phase B (kernel decoupling) explicitly unblocks C and E; C unblocks E and H; A and F are independent and land first; D and G are decision-gated and parallelizable. The DAG is real, not decorative.
- **Drift-by-construction reasoning.** It identifies that the dirty/`markClean` divergence (finding 4) is a *symptom* of duplicated boot orchestration (finding 10) and fixes the cause (one shared `embed-session` controller) rather than patching the symptom in two places.
- **Test mapping.** Each existing suite is named with how it extends, and new behavioral tests are concrete and falsifiable ("timeout leaves no listener", "double-`ready` idempotence", "WC vs React dirty parity", `navigateToRange("B2:D10")` selects the range).

## Major gaps or risks

- **Scope is an epic, not a plan.** Eleven phase items span small correctness fixes (focus, navigateToRange, randomUUID), two large refactors (kernel decoupling, session unification), and two greenfield product implementations (real iframe child composition, real publish rendering + redaction enforcement). The sequencing mitigates this, but D1 ("kernel-backed mutation gate plus renderer edit-input path") and G-implement ("redacted-artifact renderer enforcing `PublishSecurityPolicy`") are each multi-week efforts sketched in a sentence. The plan would be stronger split into a shippable "honesty + correctness" plan (A, B, C, F, H, D2, G-fail-closed) and a separate "new vehicles" plan (D1, E, G-implement).
- **Underspecified cross-folder contracts.** Phase E asserts `TrustedDocumentHostContext` must be built via the types-host "branded-construction path," and Phase C/E rely on `@mog-sdk/sheet-view` exposing `focus`, range-select, and `scrollTo`. The plan flags these as coordination items but does not confirm those APIs exist today — if `sheet-view` has no focus target or range-select entry, Phases C5/C6/E are blocked and the plan has no fallback. This is the largest unvalidated assumption.
- **D1's kernel enforcement is hand-waved.** "A kernel-backed mutation gate keyed off `effectiveState.mode`/`capabilities`" is the hardest and most security-sensitive item in the whole plan, and it is one bullet. If D1 is chosen, it needs its own contract: what the gate intercepts, where (kernel vs renderer), and how capability denial is surfaced. As written it cannot be implemented from the spec.
- **No explicit migration/compat test for the event-stream byte-compatibility claim.** The plan rightly says the Phase-C unification must keep `mog-*` CustomEvent and `on*` payload shapes/ordering identical and "treat as breaking-change review," but there is no proposed golden/snapshot test that pins the current event stream before the refactor. That is the one place a reference test should exist *before* the controller extraction, not alongside it.

## Contract and verification assessment

Contract clarity is the plan's best dimension. Public-surface leak, opaque-source, origin/`postMessage`, effective-state-is-trusted, save/export gating, publish read-only, and resolution monotonicity are each stated as a named invariant with the guarding test and the rule for any new boundary (define its `defaultMaxMode` ceiling; add a subpath only with a same-PR boundary-test update + security sign-off). This is precisely how a public-boundary package should be specified.

Verification gates are appropriate and honest about what this planning step cannot run: package-boundary suite stays green, existing suites extended in intent, new behavioral tests enumerated, and build/type/test gates delegated to the implementer with a tracked quality metric (reduce `as unknown as` cast count). The app-eval gate through `@mog/views-host` for Phase H is a thoughtful regression guard for the friend surface.

The one verification weakness, noted above, is the absence of a pre-refactor event-stream snapshot to anchor the byte-compatibility guarantee, and the deferral of the D1 enforcement-gate test surface (which can't be written because the gate isn't specified).

## Concrete changes that would raise the rating

1. **Split the plan.** Carve out a Plan 058a (transport correctness, kernel decoupling, session unification, validation allowlist, views-host, D2 contract-narrowing, G fail-closed) that is shippable end-to-end, and a Plan 058b for the ambitious vehicles (D1 editing, E iframe composition, G real publish). 058a would be a clean 10.
2. **Validate the `sheet-view` and types-host preconditions now.** Add a short "preflight" confirming `EmbedRenderOrchestrator`'s `_view` (`@mog-sdk/sheet-view`) actually exposes focus, range-select, and scroll APIs, and that types-host offers a branded `TrustedDocumentHostContext` constructor. If absent, list the dependency-folder work as a hard prerequisite rather than a coordination note.
3. **Specify the D1 enforcement gate as its own contract** (interception point, denied-capability surfacing, kernel vs renderer responsibility) before treating it as implementable, or explicitly recommend D2 as the default and make D1 a follow-on.
4. **Add a pre-refactor event-stream golden test** to Phase C step 0: snapshot the current `mog-*`/`on*` emissions for a fixed config, then assert byte-compatibility after the controller extraction. Anchor the compatibility claim instead of asserting it.
5. **State the publish decision's default.** The plan says fail-closed is "production-correct until the Rust pipeline lands" — make that the explicit default for G so the plan is actionable without waiting on the product owner, with the implement branch as the gated upgrade.
