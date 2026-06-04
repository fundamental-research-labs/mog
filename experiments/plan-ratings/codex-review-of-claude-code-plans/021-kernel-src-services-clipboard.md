Rating: 8/10

Summary judgment

This is a strong plan. It correctly identifies that `kernel/src/services/clipboard` advertises an authoritative cross-app clipboard with a paste lifecycle, while production callers mostly use it as a copy/cut mirror. The plan is grounded in the real files, names the right collaborators, distinguishes type/contract cleanup from behavioral paste wiring, and gives meaningful invariants instead of vague implementation wishes.

The main reason it is not a 9 or 10 is that the highest-risk part, Track B, is still under-specified at the exact production seam. A search of the current tree shows `AppClipboardAPI.getPayload()` is exposed, but there is no obvious spreadsheet consumer of that app API payload path. The plan says to "confirm the cross-app paste entry point" and then drive `startPaste`/`completePaste`, but the contract for who owns paste completion remains unresolved. For a plan about completing the paste lifecycle, that seam needs to be specified as an API contract, not left as discovery work.

Major strengths

- The plan's diagnosis is accurate: the kernel machine has `PASTE_START`/`PASTE_COMPLETE`/`PASTE_ERROR`, `pasting`, and cut-clear-on-complete behavior, while production references are dominated by `copy`, `cut`, `clear`, `markStale`, and `markFresh`.
- It correctly calls out the three-way clipboard type duplication across contracts, kernel-local service types, and spreadsheet-domain clipboard types, including the nullable `ClipboardOperation` drift.
- The split into Track A and Track B is architecturally sensible. Type unification, conformance checks, notification hygiene, timestamp handling, and action de-duplication can land separately from paste behavior.
- The invariants are useful and testable, especially single-use cut consumption, single source of type truth, static conformance to `IClipboardService`, and no write-only state.
- The plan keeps the work on production paths and rejects a test-only fix. It also recognizes capability boundaries and warns against casually exposing paste lifecycle methods through the scoped app API.
- Verification coverage is broad: machine-state tests, conformance/type gates, API snapshot review, and a cross-app app-eval acceptance test.

Major gaps or risks

- Track B does not define the actual cross-app paste contract. `IAppClipboardAPI` exposes `copy`, `cut`, `getSnapshot`, `getPayload`, `clear`, and `subscribe`, but not `startPaste`, `completePaste`, or an atomic consume/commit method. If a second app calls `getPayload()` through the scoped API, it currently has no way to signal successful consumption. The plan should choose between a host-owned paste flow, a scoped lifecycle API, or a higher-level `consumePaste`/`withPastePayload` contract.
- The plan claims the paste lifecycle should be wired, but it does not say whether current intra-spreadsheet cut-paste should call `completePaste()` or keep using `clear()`. The app clipboard machine currently clears the kernel service after successful cut-paste, which produces the right final snapshot but bypasses the kernel lifecycle state. The plan needs exact transition actions and failure behavior for `PASTE`, `PASTE_COMPLETE`, `PASTE_ERROR`, and external/system paste.
- Notification minimality is underspecified and potentially wrong. A shallow comparison of the projected snapshot would suppress a second `COPY` if the snapshot omits payload and timestamp, even when the payload changed. If `timestamp` is exposed, repeated copy will usually emit because the timestamp changes, contradicting the proposed "identical re-COPY does not notify" test. The plan should define whether subscribers observe state only, data version changes, or both.
- The "exactly one declaration" objective is stronger than the implementation steps. Track A rewrites kernel-local types, but the spreadsheet-domain `ClipboardPayload` and many imports in view adapters/coordinator code remain a separate declaration. The plan should either explicitly migrate those app-domain types to aliases/refinements or downgrade the invariant to "one public service contract plus app-local adapter aliases."
- Type dependency guidance needs tightening. The contracts service export is consumed through `@mog-sdk/contracts/services`, which is a shim over `@mog/types-api/services`. Moving strong types upward via `@mog-sdk/contracts/core` or `@mog-sdk/contracts/views` from `types/api` would likely create a bad dependency shape. The safer plan is to keep `types/api` structural or import lower-level type packages directly where allowed.
- The verification section is directionally good but should name concrete commands and packages. This work likely needs focused checks for `@mog/types-api`, `@mog-sdk/contracts`, `@mog-sdk/kernel`, and `@mog/app-spreadsheet`, plus the specific app-eval scenario. "Typecheck across the graph" is less actionable than the repo's usual per-package gates.

Contract and verification assessment

The contract assessment is mostly strong. The plan preserves the existing kernel service member set, `Subscribable` semantics, singleton service lifecycle, payload invariants, and capability separation. It also adds the right compile-time conformance pressure by making the implementation assignable to the canonical contracts interface.

The weakest contract point is paste consumption. A single-use cut cannot be enforced reliably if the only public consumer operation is `getPayload()`. The plan should make payload read and paste completion a single explicit contract or specify which trusted host component coordinates the lifecycle. Otherwise implementers may add lifecycle calls to whichever paste path is easiest and still leave true cross-app consumers able to leak a stale cut payload.

Verification is comprehensive in spirit, but it needs sharper gates. The machine tests should include copy payload replacement while the snapshot state remains `hasCopy`, because that is the edge case most affected by notification suppression. The integration gate should assert both same-app and cross-app cut behavior, and the app-eval should drive real UI/input or app API paths rather than directly mutating the service actor.

Concrete changes that would raise the rating

1. Define the paste-consumption API contract precisely: for example, add a host-only `performPasteFromClipboard` flow or an app-facing `consumePaste` method that brackets payload access with `startPaste` and completion/error handling.
2. Specify exact Track B edit points and transitions in `clipboard-machine.ts`, `ShellCoordinator.paste`, and/or `AppClipboardAPIImpl`, including how success, failure, cancellation, and external paste interact with the kernel service.
3. Resolve notification semantics with a `version`/`timestamp` decision. If payload replacement must notify subscribers, expose a scalar version/timestamp and compare it; if only state changes notify, state that explicitly and add tests for payload replacement behavior.
4. Make type unification complete by listing the spreadsheet-domain aliases/import migrations, or explicitly documenting why app-domain `ClipboardPayload` remains a refinement layer rather than a duplicate source of truth.
5. Replace the loose verification wording with concrete commands, such as package-scoped typechecks/tests for `@mog/types-api`, `@mog-sdk/contracts`, `@mog-sdk/kernel`, and `@mog/app-spreadsheet`, plus the named app-eval cross-app cut-paste scenario and API snapshot regeneration/review.
