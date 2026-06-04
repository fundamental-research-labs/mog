Rating: 8/10

Summary judgment

This is a strong, source-aware hardening plan for a security- and data-loss-sensitive package. It correctly treats `runtime/spreadsheet-app/src` as the trusted embed runtime, prioritizes the dirty/save classifier and workbook facade authorization boundary, and defines useful preserve/strengthen invariants. The rating is held below 9 because several findings are overstated or slightly inaccurate, and the hardest contracts are not specified tightly enough for safe implementation: mutating event ownership and object-return wrapping need exact, verifiable schemas.

Major strengths

- The plan is production-path relevant. It focuses on the public embed API, host authority boundary, facade matrix, dirty/save state, and attach lifecycle rather than cosmetic cleanup.
- The dirty-event drift risk is well grounded. The runtime currently depends on a local string `Set`, the package test script checks facade generation/boundary, and the dirty tests are spot checks rather than an exhaustive event-vocabulary guard.
- The facade return-wrapping risk is real and high value. Method lookup fails closed, but returned objects can still pass through structural detection and the `expected.length === 0` fallback, which is exactly the kind of security boundary weakness this package should eliminate.
- The plan does a good job stating contracts to preserve: exported API shape, fail-closed method gate, stale epoch semantics, headless lifecycle, read-only operations staying clean, save/dirty semantics, and chart export round trip.
- Verification gates are concrete and mostly behavioral: existing node tests, new dirty completeness tests, facade totality tests, lifecycle races, attachment attach/detach behavior, a11y checks, generator validity, package typecheck, build, and boundary checks.
- Sequencing is mostly sensible: dirty and facade hardening first, generator changes before matrix-driven wrapping, runtime lifecycle before the attachment state-machine rewrite.

Major gaps or risks

- The concurrent-open finding is overstated. `openingWorkbooks` is already set before ordinary callers can interleave a second `openWorkbook` call, so `Promise.all` with the same `workbookSessionId` should share the in-flight promise rather than create two records. The real race is narrower: disposal can happen after the post-load state check and before or during `createRecord`, which can allow a record to be inserted after disposal has swept existing records.
- The detach re-entrancy claim in `runtime.ts` is also overstated. The closure `detached` flag is set synchronously before any await, and `app-attachment.tsx` already has a `detachPromiseRef` guard. Cleanup ownership is still worth improving, but the plan should avoid presenting double unregister as demonstrated.
- `ACTIVE_WORKBOOK_ATTACHMENTS` is not simply "never cleared"; the release callback deletes it when the current attachment id matches. `WORKBOOK_VIEW_STATE` retention may be intentional for same-session remount restoration. The plan should define the desired lifetime instead of requiring unconditional clearing on detach.
- Return-wrapping totality is under-specified. Many facade methods legitimately return plain data objects, arrays, ranges, cells, binary data, or DTOs. "Deny or wrap-as-opaque" is not a sufficient contract unless the plan also defines safe return categories and generated metadata that distinguishes DTOs from sub-API handles.
- Dirty-event canonicalization needs an exact ownership model. `types/events/src` contains mutation, UI, recalc, import/export, validation, security, selection, and collaboration events; the plan should require a mutability tag or exported `MUTATING_SPREADSHEET_EVENT_TYPES`, not leave implementers to infer mutability from names in a second location.
- The generator critique partly overstates the current state. The generated matrix already imports `SpreadsheetCapability`, uses `satisfies`, and has a generated header. The sharper issue is that the node `--check` gate does not validate capability membership without TypeScript, and the header does not explicitly say not to hand-edit.
- Cross-package work is described as "requests", but the dirty-event and api-spec metadata changes are architectural dependencies. They should be named as required parallel workstreams with acceptance blockers, not optional coordination notes.

Contract and verification assessment

The contract section is one of the plan's best parts, but it needs tighter acceptance criteria for the two boundary-changing items. Facade returns should have an explicit generated contract for primitives, promises, arrays, immutable DTOs, binary data, and declared sub-API handles, with everything else denied and tested. Dirty events should be sourced from a public event package export or per-event metadata, with explicit non-dirty allowlist categories.

The verification plan is strong for dirty/facade/lifecycle work, but should add direct tests for authority exception observability and unified save-result handling, since those are stated objectives. For UI changes, the attachment state-machine work should be exercised through a real browser/app-eval path, including rapid prop swaps, focus behavior, and ARIA live regions. The package typecheck should remain a required gate, especially because generated capability validity currently relies partly on TypeScript.

Concrete changes that would raise the rating

- Narrow the concurrency section to the actual dispose-during-open race and remove unsupported claims about duplicate records from ordinary simultaneous opens.
- Define the canonical event metadata/export shape, the owning package, the exact non-dirty categories, and the package-level check that consumes it.
- Define facade return categories and require a generated report or fixture covering every object-returning method as DTO, binary, primitive container, or declared sub-API.
- Clarify attachment state lifetime: when active claims are released, whether view state survives same-session remounts, and when it must be cleared by session disposal or epoch change.
- Promote the `types/events` and `runtime/sdk` changes from coordination notes to required parallel workstreams with owners, touched files, and blocking acceptance criteria.
- Add explicit tests for authority exceptions versus policy denial, and for all save completion paths flowing through one state transition function.
