# 021 — Kernel Clipboard Service: Complete the Paste Lifecycle and Make It the Authoritative Cross-App Store

## Source folder and scope

- **Folder:** `mog/kernel/src/services/clipboard`
- **Files in scope:**
  - `clipboard-service.ts` — `clipboardServiceMachine` (XState `setup`), `getClipboardServiceSnapshot`, the `ClipboardService` class (`Subscribable<ClipboardSnapshot>` + `IClipboardService`), and the `createClipboardService` factory (≈358 lines, the substance).
  - `types.ts` — kernel-local copies of `ClipboardPayload`, `ClipboardSnapshot`, `ClipboardState`, `ClipboardOperation`, `ClipboardContext`, `ClipboardEvent`, `IClipboardService` (≈180 lines).
  - `index.ts` — public barrel.
  - No `__tests__/` exist for this folder today.
- **Adjacent production-path collaborators referenced by this plan (read-only context, edited only where explicitly called out):**
  - `mog/types/api/src/services/index.ts` — the contracts-level `IClipboardService`, `KernelClipboardSnapshot`, `ClipboardPayload`, `ClipboardOperation`, `ClipboardState` (the intended single source of truth).
  - `mog/kernel/src/context/kernel-context.ts` — constructs (`createClipboardService()`, line 326) and disposes (line 403) the singleton; injects it into `IKernelServices.clipboard`.
  - `mog/kernel/src/api/app/app-kernel-api.ts` (≈lines 1218–1303) — `AppClipboardAPI` delegates `copy`/`cut`/`getSnapshot`/`getPayload`/`clear`/`subscribe` to the service and mirrors to `navigator.clipboard`.
  - `mog/kernel/src/api/app/capability-gated/scoped-clipboard-api.ts` — capability gating (`clipboard:read` / `clipboard:write`); note it exposes only `getSnapshot`/`getPayload`/`subscribe`/`copy`/`cut`/`clear` — **not** the paste-lifecycle methods.
  - `mog/apps/spreadsheet/src/systems/grid-editing/machines/clipboard-machine.ts` — the app-level clipboard engine. It is the only production caller of the kernel service today, and only calls `copy`/`cut` (lines 550, 575, 600, 625), `clear` (686, 712), `markStale` (734), `markFresh` (743) via `convertToKernelPayload`.

**Scope boundary:** this is a *planning* document only. No code is changed by this file. The implementation it describes is centered on the clipboard service folder plus a small, named set of collaborators (contracts types, the app clipboard machine's kernel delegation, app-kernel-api).

## Current role of this folder in Mog

The kernel clipboard service is documented as "a kernel system service — the authoritative source for clipboard state" and "the cross-app clipboard that survives app switches." Concretely it is:

1. An XState machine with four states (`empty`, `hasCopy`, `hasCut`, `pasting`) holding a single `ClipboardPayload` plus `operation`, `isStale`, `timestamp`, and `error` in context.
2. Wrapped by a `ClipboardService` class that is a `Subscribable<ClipboardSnapshot>`: it subscribes to the actor and calls `emitChange()` on every actor transition; `getSnapshot()` projects the machine state down to `{ state, operation, hasData, isStale, error }`.
3. Created once per kernel and reached by apps through `IKernelServices.clipboard`, surfaced to apps via `AppClipboardAPI` and capability-gated via `scoped-clipboard-api.ts`.

**The reality, established by tracing every caller:** the app-level `clipboard-machine.ts` is the *de facto* source of truth for spreadsheet copy/cut/paste (it owns marching ants, paste preview, cut single-use clearing, system-clipboard read/write through `domain/clipboard/*`). It treats the kernel service as a **write-only mirror**: it calls `kernelService.copy/cut` when it stores data and `clear/markStale/markFresh` on focus/clear, then drives its own paste pipeline (`paste-integration.ts`, `paste-executor.ts`, `unified-paste.ts`) entirely without the kernel service. The kernel service's *purpose* — being the thing another app reads to paste data copied in a different app — is exercised only through `AppClipboardAPI.getPayload()`.

This split is the root of every defect below: the kernel service advertises a full copy/cut/**paste** lifecycle, but production only ever drives the copy/cut half, so the paste half is dead code that silently breaks the cross-app cut contract.

## Improvement objectives

1. **Complete the paste lifecycle so cross-app cut is correct.** `startPaste`/`completePaste`/`errorPaste`, the entire `pasting` state, the `PASTE_*` transitions, and the "cut is single-use, clears after paste" guard (`isCutOperation` → `clearAfterCut`) have **zero production callers** (confirmed: only `copy`/`cut`/`clear`/`markStale`/`markFresh` are called from `clipboard-machine.ts`). Consequence: when a user cuts in app A and pastes into app B, the kernel service is never told the paste happened, so its snapshot keeps reporting `hasCut`/`hasData` forever and the cut source is never invalidated through the kernel. Either wire the app's paste pipeline to drive the kernel lifecycle (so `hasCut` clears after a cross-app paste), or remove the lifecycle and make the contract honest. The production-correct choice is to **wire it**, because cross-app cut-paste is the service's reason to exist.
2. **Collapse the three-way type duplication onto contracts.** `ClipboardPayload`, `ClipboardSnapshot`/`KernelClipboardSnapshot`, `ClipboardState`, and `ClipboardOperation` are independently declared in (a) contracts `types/api/src/services/index.ts`, (b) this folder's `types.ts`, and (c) `mog/apps/spreadsheet/src/domain/clipboard/types.ts`. They have already drifted: kernel's `ClipboardOperation = 'copy' | 'cut'` (no `null`), contracts' is `'copy' | 'cut' | null`; kernel uses strong `CellValue[][]` / `Partial<CellFormat>` / `ColumnSchema[]` / `ViewType`, contracts uses `unknown[][]` / `Record<string, unknown>` / `unknown[]` / `string`. The service should *implement the contracts interface* (statically checked), keeping the strong payload typing as the kernel-internal refinement rather than a parallel definition.
3. **Make the implementation statically conform to the contracts `IClipboardService`.** The class currently `implements` the *local* `IClipboardService` from `./types`, so the contracts interface and the real implementation can drift with no compiler error (the `ClipboardOperation` `null` divergence is exactly this). Add a compile-time conformance check against `@mog/types-api` (or have `IKernelServices.clipboard` typed as the contracts interface, whichever is the established pattern in `kernel-context.ts`).
4. **Stop emitting spurious change notifications.** `actor.subscribe(() => this.emitChange())` fires on *every* actor event, including re-entrant `COPY`/`CUT` that produce an identical projected snapshot and the no-op transitions. Subscribers (`AppClipboardAPI.subscribe` → app UI) get redundant notifications. Emit only when the projected `ClipboardSnapshot` actually changes (shallow-compare against the last emitted snapshot).
5. **Resolve the dead `timestamp` field.** `timestamp: Date.now()` is written on copy/cut but never exposed in the snapshot and never read by anyone. Either expose it on the snapshot (for staleness/TTL/telemetry — the more useful direction, since the service already models `isStale`) or remove it. Pick one; do not leave write-only state.
6. **De-duplicate identical machine actions.** `clearAfterCut` and `clearAll` have byte-identical bodies; collapse to one named action to remove the false implication that they differ.
7. **Add the first unit-test suite for the machine** as a verification gate for the above (the folder has none today). Tests are a gate, not the fix — the fixes above are production-path changes.

## Production-path contracts and invariants to preserve or strengthen

**Preserve (must not regress):**

- **`IClipboardService` member set and signatures** as consumed by `app-kernel-api.ts` and `scoped-clipboard-api.ts`: `getSnapshot`, `getPayload`, `copy`, `cut`, `startPaste`, `completePaste`, `errorPaste`, `clear`, `markStale`, `markFresh`, `subscribe` (returns `CallableDisposable`), `dispose`.
- **`ClipboardSnapshot` shape consumed downstream:** `AppClipboardAPI.getSnapshot` reads `snapshot.hasData` and `snapshot.operation`; its `subscribe` forwards the same two fields. Any field changes must keep these populated and correct.
- **`Subscribable<ClipboardSnapshot>` semantics:** `subscribe()` returns a `CallableDisposable`; listeners are cleaned up on `dispose()`; `_dispose()` stops the actor before `super._dispose()`.
- **Single kernel instance lifecycle:** created at `kernel-context.ts:326`, disposed at `:403`. No change to instantiation/disposal ordering.
- **Canonical payload contract:** `cells` is ALWAYS present (universal 2-D format); `tableContext` is OPTIONAL (smart paste); `text` (TSV) and `html` are the external/system-clipboard projections. This "2N translations, not N×N" design is the service's load-bearing invariant and must be preserved verbatim.
- **Capability independence:** `clipboard:read` and `clipboard:write` remain independent (read = `getSnapshot`/`getPayload`/`subscribe`; write = `copy`/`cut`/`clear`).

**Strengthen (new/tightened invariants):**

- **INV-1 (lifecycle completeness):** for every `cut(payload)` that is followed by a paste consuming that payload, the service eventually transitions out of `hasCut` (cut is single-use) — i.e. `completePaste()` *is* called on the cross-app paste path, and after it the snapshot reports `hasData=false`, `operation=null`, `state='empty'`. No path leaves a consumed cut payload resident.
- **INV-2 (single type source):** there is exactly one declaration of `ClipboardPayload` / `ClipboardSnapshot` / `ClipboardState` / `ClipboardOperation` (in contracts). Kernel and app re-export or refine it; no third independent copy. `ClipboardOperation` has one definition (resolve the `null` discrepancy — snapshot `operation` is `'copy' | 'cut' | null`; the *event/store* operation while data is held is `'copy' | 'cut'`).
- **INV-3 (static conformance):** `ClipboardService` is assignable to the contracts `IClipboardService`, enforced at compile time (a `satisfies`/explicit-typed factory return, or `IKernelServices.clipboard: IClipboardService` from contracts).
- **INV-4 (notification minimality):** `emitChange` fires only when `getSnapshot()` differs (shallow) from the previously emitted snapshot. Re-entrant `COPY`/`CUT` of identical data and pure no-ops do not notify.
- **INV-5 (no write-only state):** every context field is either projected into the snapshot or consumed internally by a transition; `timestamp` is no longer write-only.

## Concrete implementation plan

The objectives split into two independent tracks. **Track A** (type unification + conformance + emit/dead-state hygiene) is self-contained within the folder + contracts and carries near-zero behavioral risk. **Track B** (paste-lifecycle wiring) crosses into the app clipboard machine and is the behaviorally significant change. Do A first; it de-risks B.

### Track A — Type unification, conformance, and hygiene (folder-local + contracts)

1. **Pick contracts as the canonical home.** In `types/api/src/services/index.ts`, keep `ClipboardState`, `ClipboardOperation` (`'copy' | 'cut' | null`), `KernelClipboardSnapshot`, `ClipboardPayload`, `IClipboardService` as the source of truth. If the strong payload field types (`CellValue[][]`, `Partial<CellFormat>`, `ColumnSchema[]`, `ViewType`) are desirable in the canonical type and the contracts package is allowed to depend on `@mog-sdk/contracts/core` + `/views` (verify the dependency direction first), tighten them there; otherwise keep contracts' structural types and refine to the strong types only inside the kernel via a `ClipboardPayload`-compatible local alias.
2. **Rewrite `kernel/services/clipboard/types.ts`** to re-export the canonical contracts types instead of redeclaring them: `export type { ClipboardPayload, ClipboardState, ClipboardOperation, IClipboardService } from '<contracts services>'` plus an alias `ClipboardSnapshot = KernelClipboardSnapshot`. Keep only genuinely kernel-internal types here: `ClipboardContext` and `ClipboardEvent` (the XState machine's internal shapes), which are not contract surface.
3. **Reconcile `ClipboardOperation`.** The machine's *stored* operation is non-null while data is held; the *snapshot* operation is nullable. Type the context field as `'copy' | 'cut' | null` (matching the canonical `ClipboardOperation`) so the snapshot projection is a straight pass-through with no narrowing/widening surprises, and `initialContext.operation` stays `null`.
4. **Static conformance (INV-3).** Make `createClipboardService(): IClipboardService` use the contracts interface, and either add `const _conform: IClipboardService = new ClipboardService()`-style check or have `IKernelServices.clipboard` typed from contracts (preferred — check `kernel-context.ts`'s existing `IKernelServices` typing and route through it). This makes any future drift a build error.
5. **Notification minimality (INV-4).** In the `ClipboardService` constructor, capture `this.lastSnapshot` and in the actor subscription compute `const next = this.getSnapshot()`; only `emitChange()` when `next` differs shallowly from `lastSnapshot` (compare the five/six scalar fields). Update `lastSnapshot`. Guard against emitting after `_dispose()`.
6. **`timestamp` resolution (INV-5).** Recommended: add `timestamp: number | null` to `KernelClipboardSnapshot` and project `state.context.timestamp` into it (it is cheap, already tracked, and useful for staleness/telemetry/"copied N seconds ago" UI). If product has no consumer and none is planned, instead delete the field from `ClipboardContext` and the two `storeCopy/CutData` writers. Do not keep it write-only.
7. **Action de-dup.** Replace `clearAfterCut` and `clearAll` with a single `reset` action; reference it from the `CLEAR` transitions and the cut-paste-complete branch.

### Track B — Wire the paste lifecycle so cross-app cut is correct (INV-1)

This is the production fix the queue description ("paste, import, and format transfer behavior") points at. The kernel service already *models* the correct cut-single-use semantics; the gap is that nothing drives it.

1. **Confirm the cross-app paste entry point.** `AppClipboardAPI.getPayload()` (`app-kernel-api.ts:1268`) is how a *second* app reads what a *first* app put on the kernel clipboard. Trace which app paste path calls `getPayload()` for a cross-app paste (vs. the intra-app `clipboard-machine` path that never touches the kernel). This is the seam where the lifecycle must be driven.
2. **Drive `startPaste` → `completePaste`/`errorPaste` around the real paste.** Wherever the app consumes the kernel payload to perform a paste (the cross-app path, and ideally the intra-app `paste-integration.ts`/`paste-executor.ts` path when `kernelClipboardService` is present), call `kernelService.startPaste()` before applying, `completePaste()` on success, `errorPaste(message)` on failure. Add these calls to `clipboard-machine.ts` paste actions (it already holds `kernelClipboardService`) and/or `app-kernel-api`'s paste surface. Expose `startPaste`/`completePaste`/`errorPaste` through the scoped API **only if** an external app needs to drive paste; if paste is always kernel-internal/host-driven, keep them off the capability-gated surface (they are not there today — preserve that unless a consumer needs them).
3. **Make the `pasting` state non-blocking for re-copy.** Today `pasting` only accepts `PASTE_COMPLETE`/`PASTE_ERROR`. If a copy/cut can race a paste (e.g. user copies again mid-paste), decide whether `pasting` should also accept `COPY`/`CUT`/`CLEAR`. Default to allowing `CLEAR` and a fresh `COPY`/`CUT` to pre-empt a stuck paste, so a dropped `completePaste` cannot wedge the machine in `pasting` forever.
4. **Guard against a lost `completePaste`.** Because paste is async and cross-process-ish, a dropped completion must not strand the machine. Either (a) keep `pasting` pre-emptible (step 3), or (b) have `completePaste`/`errorPaste` be tolerant when called from non-`pasting` states (currently they are simply ignored outside `pasting`, which is acceptable, but document it). Do not introduce timers in the kernel machine.
5. **Verify the intra-app machine still owns its own cut clearing.** The app `clipboard-machine` clears its *own* cut state independently; ensure driving the kernel lifecycle does not double-clear or desync the two (the kernel mirror should follow, not fight, the app machine). The acceptance test is INV-1: after a cut-then-paste, both the app machine and `kernelService.getSnapshot()` report no cut data.

### Sequencing

- Land Track A as one reviewable change (types + conformance + emit + timestamp + action de-dup). It is invariant-preserving and unblocks honest typing.
- Land Track B second, behind the now-conformant types, with the new tests as the gate. If Track B's cross-app driving turns out to require product decisions (e.g. should an external app be able to call `startPaste`?), split the capability-surface change into its own step and keep the intra-app wiring first.

## Tests and verification gates

No tests exist for this folder; add `clipboard-service.test.ts` (and reuse `contracts/__tests__/clipboard-selectors.*` patterns where relevant). Per the constraints, **I will not run** build/test/typecheck here; these are the gates the implementer must pass.

**Machine/state unit tests:**
- `empty → COPY → hasCopy`; snapshot `{ state:'hasCopy', operation:'copy', hasData:true }`. Repeated `COPY` (reenter) updates payload but, per INV-4, emits only when the projected snapshot changes.
- `empty → CUT → hasCut`; `COPY` from `hasCut` switches to `hasCopy`; `CUT` from `hasCopy` switches to `hasCut`.
- **Lifecycle (INV-1, the core regression target):** `CUT → startPaste → completePaste` ends in `empty` with `hasData=false`, `operation=null` (cut single-use). `COPY → startPaste → completePaste` returns to `hasCopy` with payload intact (copy is repeatable).
- `startPaste → errorPaste(msg)`: from a cut returns to `hasCut` with `error=msg`; from a copy returns to `hasCopy` with `error=msg`; a subsequent successful `completePaste` clears `error`.
- `pasting` pre-emption (if step B3 adopted): `COPY`/`CLEAR` during `pasting` behaves as decided; a dropped `completePaste` cannot wedge the machine.
- `CLEAR` from any data state → `empty`, full reset.
- `markStale`/`markFresh` flip `isStale` and that flips the snapshot field; verify no other field churns.
- **Notification minimality (INV-4):** instrument `subscribe` listener call count; an identical re-`COPY` of the same payload does not increment it; a real state change does.
- **`timestamp` decision:** if exposed, assert it is present after copy/cut and `null` after `clear`; if removed, assert it is absent from context/snapshot types.

**Conformance / integration gates:**
- Typecheck across the `@mog-sdk/contracts` → kernel → app graph must pass after the type unification (the conformance check (INV-3) is itself a gate).
- `scoped-clipboard-api.ts` and `app-kernel-api.ts` continue to compile and expose the same capability-gated surface.
- API snapshot: `mog/tools/api-snapshots/@mog-sdk__contracts.api.txt` will change with the type unification — regenerate and review the diff (it should show *removal* of duplicate declarations, not new public surface).
- **Cross-app cut-paste app-eval (Track B acceptance):** an app-eval scenario that cuts in one surface and pastes in another, asserting the kernel clipboard snapshot reports no residual cut data afterward (today this would fail/no-op). Do not over-fit to one view; pick the existing cross-app clipboard harness if present.

## Risks, edge cases, and non-goals

**Risks / edge cases:**
- **Behavioral change in Track B.** Wiring `completePaste` changes observable state after a cross-app cut-paste (cut data now clears). This is a *correctness* fix but any UI that (incorrectly) relied on the cut payload persisting must be checked — chiefly marching-ants/ cut-source rendering, which is driven by the *app* machine, not the kernel snapshot, so risk is contained. Verify via the app-eval gate.
- **Type-tightening fallout.** Collapsing three `ClipboardPayload` declarations may surface latent mismatches (e.g. app code that assigned `unknown[][]` into the kernel's `CellValue[][]`). These are pre-existing latent bugs; surface and fix them rather than re-widening the type.
- **Contracts dependency direction.** Tightening payload field types *inside contracts* may not be allowed if `@mog-sdk/contracts` must not depend on `core`/`views`. Verify the dependency graph before moving strong types upward; if blocked, keep strong types as a kernel-local refinement of the structural contract type.
- **`emitChange` minimality vs. existing subscribers.** If any subscriber currently (accidentally) relies on being pinged on every actor tick, INV-4 will reduce calls. Audit `AppClipboardAPI.subscribe` consumers; the forwarded payload (`hasData`, `operation`) is idempotent so fewer calls is strictly safe.
- **Pre-emptible `pasting`** could mask a genuinely stuck paste; mitigate with telemetry on `errorPaste` rather than silent recovery.

**Non-goals:**
- Reworking the app-level `clipboard-machine.ts`, `domain/clipboard/*` paste pipeline, marching ants, paste-special, TSV/HTML serialization, or system-clipboard read/write. Those live in `mog/apps/spreadsheet` and folder 092; this plan only *drives* the kernel lifecycle from them.
- Changing the capability model (`clipboard:read`/`clipboard:write` independence is preserved).
- Adding clipboard history/multi-slot, format-painter, or TTL expiry — not requested; the `timestamp` decision is scoped to "don't keep write-only state," not building a feature on it.
- Any test-only or shim "fix" that leaves the dead paste lifecycle in place — explicitly rejected; the lifecycle is either wired (preferred) or removed, never left dangling.

## Parallelization notes and dependencies on other folders

- **Track A is parallel-safe** with most other plan workers; its only cross-folder touch is `mog/types/api/src/services/index.ts` (folder 005) and the kernel `IKernelServices` typing (folder 009 `kernel/src/api` / `kernel-context`). Coordinate the contracts edit with folder **005 (types-api-src)** to avoid a merge race on `services/index.ts`, and regenerate the contracts API snapshot once.
- **Track B depends on** the app-level clipboard system, which is folder **092 (`apps/spreadsheet/src/domain/clipboard`)** and the grid-editing system (folder **063**). The kernel-side method calls (`startPaste`/`completePaste`/`errorPaste`) must be added in `clipboard-machine.ts` / `app-kernel-api.ts`; sequence Track B after any in-flight changes to those folders to avoid conflicting edits to the paste path.
- **Hard ordering:** Track A (type unification + conformance) should land before Track B so the lifecycle wiring is written against the unified, statically-conformant interface.
- No dependency on the formula/compute core; the clipboard service holds opaque payloads and does not evaluate them.
