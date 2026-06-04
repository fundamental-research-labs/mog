# 060 - Runtime Spreadsheet App Source Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/runtime/spreadsheet-app/src`

This plan covers the packaged spreadsheet app runtime source for `@mog-sdk/spreadsheet-app`: the public entrypoint, public type contract, runtime/workbook session controller, runtime-owned UI attachment bridge, workbook facade capability enforcement, dirty/save/event classification, shell document loading, decoration handles, feature/command policy mapping, and the package-local source tests under `src/__tests__`.

Adjacent package scripts such as `runtime/spreadsheet-app/scripts/build-types.mjs`, `scripts/check-boundary.mjs`, and `scripts/generate-workbook-facade-matrix.mjs` are verification and generation dependencies for this source folder, but the improvement target remains the `src` production path.

## Current role of this folder in Mog

`runtime/spreadsheet-app/src` is the public full-app browser embed facade for trusted same-origin hosts. It intentionally composes private app, shell, and kernel implementation packages behind a shipped public package boundary. External hosts enter through `createSpreadsheetRuntime()`, `MogSpreadsheetApp`, `mountSpreadsheetApp()`, and the types exported from `src/public-types.ts`.

The folder currently owns these production responsibilities:

- Creating a shell-backed spreadsheet runtime with host asset policy, persistence policy, callbacks, and event dispatch.
- Opening runtime-owned workbook sessions that remain usable while headless and can be disposed independently from UI attachments.
- Attaching exactly one full spreadsheet UI to a workbook session at a time, detaching UI without disposing the workbook, preserving view state for reattachment, and routing shell/app bridge events to public callbacks.
- Exposing a capability-routed workbook facade over the public Workbook API while denying raw lifecycle, event bus, security bypass, persistence, and code execution paths.
- Translating workbook mutation events into dirty/save state, save requests, export bytes, hashes, lifecycle errors, and public event streams.
- Building a public declaration surface that does not leak private `@mog/app-spreadsheet`, `@mog/shell`, or `@mog-sdk/kernel` types.

## Improvement objectives

1. Make lifecycle and save-state behavior explicit, local, and exhaustively tested instead of spreading state transitions across the large runtime controller.
2. Make public contracts self-checking: exported types, generated declarations, facade capabilities, dirty event classification, package exports, and CSS entrypoints should all have direct gates.
3. Strengthen host authority and actor policy enforcement so `SpreadsheetHostAuthority`, `SpreadsheetActorSession`, `MogSpreadsheetAppProps.editModel`, command ownership, approval-required decisions, and view commands all compose through one policy path.
4. Replace manually curated event and capability classifications with generated or contract-backed registries wherever possible.
5. Expand production-path UI verification for runtime-owned attachment behavior using real React mounting and real user input paths for command bar, edit, save/export, detach/reattach, focus, and slot behavior.
6. Keep `@mog-sdk/spreadsheet-app` a deliberate bundle-composition facade: private packages may be implementation inputs, but public declarations, package deps, and host-facing examples must remain private-type-free.

## Production-path contracts and invariants to preserve or strengthen

- Public package exports remain exactly `.`, `./styles.css`, and `./mog-embed.css`; root exports remain `createSpreadsheetRuntime`, `MogSpreadsheetApp`, `mountSpreadsheetApp`, and public types only.
- Public declarations remain derived from `src/public-types.ts` and must not mention private shell/app/kernel types, document handles, app kernels, feature-gate internals, raw event buses, or registered app bridge internals.
- The host owns authentication, authorization policy, storage, page chrome, and high-level lifecycle decisions. Mog owns runtime workbook sessions and the spreadsheet UI while attached.
- This package remains a trusted same-origin embed, not an iframe sandbox or isolation boundary for hostile workbook content or untrusted same-process code.
- `SpreadsheetRuntime` owns shell services and many `SpreadsheetWorkbookSession` instances; a workbook session remains usable while `headless`.
- `SpreadsheetAppAttachmentHandle.detach()` unmounts UI only. It must not dispose the workbook, document, shell, or runtime.
- Only one full-app UI attachment may be active for a single `SpreadsheetWorkbookSession`; concurrent attachment attempts must fail with `AlreadyAttached`.
- `workbookId` is semantic and may be shared; `workbookSessionId` is the exact open-session key. Ambiguous semantic lookups return `null`.
- Epochs invalidate stale workbook handles, actor sessions, pending save acknowledgements, and facade calls.
- `requestSave()` must export current bytes, hash the bytes, create a pending save, and mark clean only when `epoch`, `dirtyEpoch`, `changeSequence`, `saveRequestId`, and `bytesHash` match.
- Read-only operations, screenshot capture, export, formula/dependency inspection, active sheet reads, and render/selection events must not mark a workbook dirty.
- Every mutation emitted by production workbook/kernel/app paths must mark dirty exactly once per mutation sequence.
- Actor policy preserves the trusted-host default for omitted actors, rejects explicit privileged actor kinds without a host authority adapter, and routes agent/automation/system work through authority and approval when configured.
- The workbook facade must require an explicit capability decision for every public Workbook and sub-API method in the generated SDK API spec.
- `MogSpreadsheetAppProps` chrome, command, theme, workspace, portal, slot, and edit-model policies must affect only the intended UI/runtime surface and must not mutate workbook data by themselves.

## Concrete implementation plan

1. Establish a contract inventory for the source folder.
   - Add a package-local contract test fixture that enumerates public exports, lifecycle states, attachment states, save states, event types, capabilities, command owners, slot names, and stylesheet entrypoints from `src/public-types.ts`.
   - Convert regex-only assertions in the boundary check into AST-backed assertions where practical, especially for public exports and private type leakage.
   - Keep the checked-in API snapshot synchronized with the generated declaration output and fail when source public types drift without an intentional snapshot update.

2. Refactor `runtime.ts` into explicit production-path modules without changing the public API.
   - Keep `runtime.ts` as the public adapter and move internal logic into modules such as `runtime/session-registry.ts`, `runtime/lifecycle.ts`, `runtime/save-state.ts`, `runtime/authorization.ts`, `runtime/events.ts`, and `runtime/attachment-controller.ts`.
   - Represent runtime, workbook record, attachment, and save lifecycles as discriminated transition functions with exhaustive tests.
   - Preserve identity fields as immutable record data: `runtimeId`, `sessionId`, `workbookSessionId`, `workbookId`, `documentId`, and `epoch`.
   - Centralize record disposal so event subscriptions, app bridge subscriptions, attachment listeners, pending saves, shell document disposal, and public disposed events have one ordered teardown path.
   - Add open/dispose race coverage: dispose during open, duplicate open by session id, reopen after dispose with a fresh epoch, ambiguous semantic lookup, and runtime disposal with in-flight open failures.

3. Harden save/export and dirty-state contracts.
   - Move save request creation, pending-save storage, explicit save-result application, stale acknowledgement handling, and dirty/save listener emission into a pure state transition module around production workbook export.
   - Add tests for parallel saves, failed saves with newer edits, stale save acknowledgements, missing `onSaveRequest`, command-triggered save fallback, host command denial, and dispose while a save is pending.
   - Ensure export and screenshot paths are side-effect-free and do not reuse mutable caller byte buffers.
   - Preserve `versionId` and `baseVersionId` semantics across imported xlsx bytes, dirty transitions, successful saves, and failed saves.

4. Replace hand-maintained dirty event classification with a contract-backed registry.
   - Add mutation/read/event metadata to the contracts event source if it does not already exist, then generate the spreadsheet-app dirty classifier from that metadata.
   - Keep a small package-local allowlist only for runtime-specific synthetic events that are not part of the shared event taxonomy.
   - Add a coverage test that every event type exported by `@mog-sdk/contracts/events` is classified as mutation, clean/read/lifecycle, or explicitly ignored.
   - Verify representative production writes from cells, formulas, sheets, tables, pivots, charts, comments, conditional formatting, filters, drawings, slicers, sparklines, print settings, and workbook settings all dirty through the runtime event bus.

5. Strengthen host authority, actor sessions, and edit-model enforcement.
   - Route all authorization decisions through one runtime policy service that accepts actor input, capability, operation, resource, attachment state, and workbook epoch.
   - Include every `SpreadsheetCapability`, including `workbook:policy-admin`, in `getEffectivePolicySnapshot()`.
   - Apply `MogSpreadsheetAppProps.editModel` to both UI feature gates and runtime command/view/facade policy decisions, not only to ribbon edit affordances.
   - Make view commands (`select`, `setActiveSheet`, `startEdit`, `commitEdit`, `cancelEdit`, `canExecute`) honor actor authorization and command ownership consistently.
   - Add tests for no-authority trusted host defaults, ordinary user actors, explicit privileged actor rejection without authority, allowed/denied/approval-required authority results, stale actor sessions, and decoration access.

6. Make facade capability coverage complete and auditable.
   - Extend `workbook-facade-capability-matrix` generation so each entry records method kind, capability, returned interfaces, resource context where known, and deny reason for unsafe raw APIs.
   - Add tests that every Workbook/sub-API method in `runtime/sdk/src/generated/api-spec.json` has exactly one matrix decision and that no runtime method falls through to an implicit allow.
   - Add behavior tests for property getters, async returns, arrays of child handles, nested returned objects, denied methods, missing matrix entries, policy-admin methods, and code execution denial.
   - Preserve facade identity metadata (`workbookId`, `epoch`) and stale/disposed rejection for all proxied child handles.

7. Improve runtime-owned attachment behavior through real UI paths.
   - Add React integration tests for `MogSpreadsheetApp` and `mountSpreadsheetApp()` that mount the actual component with a runtime-owned workbook session.
   - Exercise attach, ready resolution, onReady without relying on optional refs, detach, reattach, double-attach rejection, unmount cleanup, focus/blur, resize, error rendering, and detach failure reporting.
   - Drive edit, selection, command bar save/export, and clipboard paths through real keyboard/mouse/clipboard events in browser E2E tests; do not mutate runtime state directly to set up UI assertions.
   - Verify all declared slot names, especially `below-command-bar` and `above-grid`, render in the expected production surfaces and update when the host changes slot content.
   - Verify theme attributes, scoped `mog-embed.css`, portal container strategy, settings visibility, file explorer/app switcher flags, and command bar tab/group/command hiding.

8. Tighten package-local test scripts and gates so source tests actually run.
   - Update the package test script to run the node tests under `src/__tests__` in addition to the facade matrix and boundary checks.
   - Add a package-local React/browser test command for the attachment UI path, then include it in the package verification workflow or publish-readiness fast gate.
   - Keep matrix generation in check mode for normal tests and update mode only for intentional API-spec changes.
   - Ensure declaration generation, API snapshot checks, and boundary checks run against built `dist` artifacts before publish.

9. Keep docs and public examples in lockstep after behavior changes.
   - Update the public full-app embed guide only after source behavior and tests land.
   - Document exact host authority, save acknowledgement, detach/dispose, workbook id/session id, command owner, and CSS import contracts.
   - Do not expose private package names as host setup paths except when explaining that they are forbidden implementation details.

## Tests and verification gates

Minimum package gates for TypeScript/source changes:

- `pnpm --filter @mog-sdk/spreadsheet-app test`
- `pnpm --filter @mog-sdk/spreadsheet-app typecheck`
- `pnpm --filter @mog-sdk/spreadsheet-app build`
- `pnpm check:api-snapshots`
- `pnpm check:publish-readiness:fast`

Additional behavior gates for the improved source:

- Node tests under `runtime/spreadsheet-app/src/__tests__` for lifecycle, save state, dirty events, policy, facade matrix behavior, and chart/export roundtrip.
- Browser/React tests for `MogSpreadsheetApp` and `mountSpreadsheetApp()` attachment behavior.
- End-to-end tests that drive the real spreadsheet UI through keyboard, mouse, and clipboard input for edit, save/export command routing, detach/reattach, selection, and focus.
- Boundary checks against source and built `dist`: no private type leakage, no private runtime dependency leakage, scoped `mog-embed.css`, unscoped `styles.css`, public package exports unchanged, generated declarations self-contained.
- API snapshot check after declaration build to detect public surface drift.

## Risks, edge cases, and non-goals

- Refactoring `runtime.ts` can accidentally change lifecycle ordering. Mitigation: land transition modules with golden lifecycle event tests before moving behavior.
- Tightening actor/edit policy can break trusted-host flows that currently rely on omitted actors. Mitigation: preserve the omitted-actor trusted host default and test it explicitly.
- Event classifier generation may over-dirty read/lifecycle events or under-dirty new mutation events. Mitigation: require explicit metadata for every shared event type and add representative production mutation coverage.
- Facade wrapping can miss nested handles returned through promises or arrays. Mitigation: behavior-test async returns, arrays, getters, and nested child APIs.
- UI tests can become brittle if they assert implementation markup. Mitigation: assert public behavior, ARIA/user-visible controls, public callbacks, attachment state, and workbook state.
- Bundle changes can leak private packages or lose wasm/font/CSS assets. Mitigation: run boundary checks against built `dist` and publish-readiness gates.
- Non-goal: turning the same-origin full app embed into a sandbox, iframe isolation boundary, plugin marketplace surface, or hostile-code security boundary.
- Non-goal: exposing `@mog/app-spreadsheet`, `@mog/shell`, `@mog-sdk/kernel`, document handles, app kernels, raw event buses, or bridge internals as public host APIs.
- Non-goal: optimizing benchmark-only paths or adding test-only state mutation shortcuts.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable if contracts are assigned up front:

- Agent A: public API and declaration boundary inventory for `runtime/spreadsheet-app/src/public-types.ts`, `src/index.tsx`, built declarations, package exports, and API snapshots.
- Agent B: runtime lifecycle/save-state module extraction from `src/runtime.ts`, with unit tests for session registry, disposal, open races, dirty/save transitions, and pending saves.
- Agent C: authority/edit-model/facade capability work across `src/workbook-facade.ts`, `src/workbook-facade-capability-matrix.ts`, `src/feature-gates.ts`, and the matrix generator.
- Agent D: attachment UI and React/browser coverage for `src/app-attachment.tsx`, slots, theme, command routing, focus, detach, reattach, and mount/unmount behavior.
- Agent E: dirty event classifier generation with the contracts event taxonomy and representative production mutation tests.
- Agent F: verification integration: package test script, build/declaration/API-snapshot gates, publish-readiness gate, and public guide updates after behavior is proven.

Dependencies:

- `runtime/sdk/src/generated/api-spec.json` is the source of truth for workbook facade method coverage.
- `contracts/src/events` and the underlying `@mog/types-events` taxonomy should own event mutation/read metadata for dirty classification.
- `apps/spreadsheet/src` and `@mog/app-spreadsheet/embed-runtime` own the actual UI bridge and slot rendering surfaces used by attachments.
- `@mog/shell` and `@mog-sdk/kernel` remain private implementation dependencies that this package bundles internally but must not leak through public declarations or runtime package dependencies.
- `tools/api-snapshots` and publish-readiness tooling provide the public package drift checks.
