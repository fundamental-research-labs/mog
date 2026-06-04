Rating: 8/10

Summary judgment

This is a strong, source-aware plan that correctly identifies the main architectural problem in `runtime/embed/src`: the React and custom-element paths carry parallel lifecycle, renderer, sheet, dirty/save, effective-state, and event logic that should be unified behind a production same-page session controller. It also does unusually well at treating package artifacts, declaration rollups, external-consumer fixtures, and browser execution as first-class contracts instead of afterthoughts.

The rating is not higher because the plan is still more of a comprehensive improvement map than a fully executable contract. It names the right modules and gates, but several crucial public semantics are left to implementation-time interpretation: exact lifecycle ordering, exact DOM event names/details, async method behavior before ready/after disposal, unknown config-key policy, range grammar, and whether blocked methods return, throw, or emit only. Those choices need to be pinned before multiple agents can safely implement against the same target.

Major strengths

- The core diagnosis matches the production source. React and the web component both construct hosts/renderers, wire readiness/errors, update sheet tabs, gate save/export, track dirty/effective state, and dispose resources independently. A shared session controller is the right structural fix.
- The plan protects the existing architecture boundary: `@mog-sdk/embed` remains a facade over kernel and `@mog-sdk/sheet-view`, not a spreadsheet app/shell package and not an isolation boundary for hostile same-page content.
- It correctly treats `MogEmbedHostPolicy` as the sole same-page source materialization and effective-authority hook, and it consistently rejects public raw source URL/path/byte/provider/token/callback authority.
- It catches real exposure drift. `EXPOSURE.md` and `package.json` classify iframe/publish as reserved or unexported, while source comments in `src/iframe/index.ts`, `src/publish/index.ts`, and `src/client/index.ts` still use public-experimental language.
- Verification is production-path oriented. The plan includes package-local tests, public artifact builds, declaration rollups, API snapshots, external fixtures, publish-readiness checks, and browser rendering through public package entrypoints.
- The public declaration/artifact section is especially valuable. Current declaration rollup tooling covers root and React only, while `./web-component` and `./config` are public subpaths. The plan makes those subpaths part of the contract.
- The parallelization notes are practical and mostly align with natural ownership slices: session controller, React adapter, web component adapter, artifacts, reserved iframe classification/hardening, browser fixture, and docs.

Major gaps or risks

- The shared session controller contract is underspecified for a parallel implementation. The plan should define the exact `SamePageEmbedSessionOptions`, `SamePageEmbedSessionHandle`, event stream type, status type, method return behavior, and disposal semantics rather than describing them conceptually.
- Sequencing should put contract finalization before adapter refactors. Step 1 introduces the controller and step 2 refactors wrappers, but step 3 formalizes lifecycle/event contracts afterward. That ordering risks agents encoding different assumptions before the public contract is frozen.
- Event parity is directionally correct but not exact enough. The plan says to use a consistent `mog-*` naming scheme while preserving existing public-experimental events, but it does not enumerate the final DOM event table or specify whether details are primitives or objects. Current web component events mix shapes such as `mog-dirty-change` with `{ dirty }` while `MogEmbedEventMap.dirtyChange` is `boolean`.
- Error behavior needs more precision. The plan says errors should surface through the same error contract, but it should specify for each public method whether it throws, returns a sentinel, emits `error`, emits `capabilityDenied`, or some combination.
- Config validation needs an explicit unknown-key policy. The plan asks for a schema-style validator and also mentions that stricter validation may reject currently tolerated host metadata. It should state whether all unknown keys are rejected, only known authority-like keys are rejected deeply, or unknown metadata is allowed in a named extension field.
- Range navigation is correctly called out, but the target grammar is not finalized. The plan lists cells, rectangles, absolute refs, lowercase refs, whitespace, and optional sheet-qualified refs, then says sheet-qualified refs may be rejected. The implementation needs a single accepted grammar and error contract.
- Reserved iframe hardening may distract from the same-page production path if not scoped carefully. Since iframe is not publicly exported or shipped, classification cleanup and boundary tests are essential now; protocol hardening should be clearly separated unless a future iframe promotion is actively in scope.
- The browser fixture section is strong but should name the intended fixture location and harness convention. Without that, agents may create another isolated fixture path that does not integrate with existing package-readiness tooling.

Contract and verification assessment

The plan is very good on verification breadth. The listed gates match the kind of work being planned: `pnpm --filter @mog-sdk/embed test`, typecheck, build, public artifact assembly, declaration rollups, API snapshots, external fixtures, publish-readiness, package validation, private-leak checks, platform dependency checks, and browser exercise of React and custom-element paths. It also correctly insists that source-level unit tests and typecheck alone are insufficient for a public browser package.

The weakest part is not the gate list but the contract those gates should enforce. The plan should convert its prose invariants into exact tables before implementation:

- public entrypoint export table for `.`, `./react`, `./web-component`, and `./config`;
- DOM event name/detail table and matching React callback detail table;
- lifecycle state transition table, including failed boot and disposal during async boot;
- public method behavior table for not-ready, ready, saving, error, and disposed states;
- config/effective-state validation schemas, including unknown-key policy and forbidden-key recursion;
- package artifact expectation table, including which dist files may exist but not be exported, and which files must be stripped from public packs.

With those tables, the proposed tests become clear and agents can work independently without turning the implementation into contract discovery.

Concrete changes that would raise the rating

1. Move lifecycle/event/handle contract formalization ahead of the React and web-component refactors, and include exact TypeScript interfaces in the plan.
2. Add a final DOM event matrix, including names like `mog-lifecycle-change`, `mog-effective-state-change`, `mog-sheet-change`, `mog-selection-change`, `mog-dirty-change`, `mog-save-state-change`, `mog-capability-denied`, and `mog-error`, with exact detail payloads.
3. Add a method semantics table for `getStatus`, `setSheet`, `isDirty`, `markClean`, `requestSave`, `requestExport`, `getEffectiveState`, `navigateToRange`, `resize`, `focus`, and `dispose` across pre-ready, ready, error, and disposed states.
4. Define the schema policy for unknown config keys and host-returned effective-state values, including whether effective arrays are cloned only or also frozen before exposure.
5. Split reserved iframe work into two tracks: immediate exposure/classification cleanup plus boundary tests, and optional protocol hardening only if iframe promotion work is explicitly started.
6. Name the external fixture/browser fixture location and harness expected to enforce public imports, public artifact stripping, and real browser rendering.
7. Add an implementation dependency graph showing which agents must wait for the shared session contract and which can proceed independently on artifact tests or reserved exposure cleanup.
