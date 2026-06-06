Rating: 8/10

Summary judgment

This is a strong, evidence-based plan for `apps/spreadsheet/src/app`. It correctly identifies the folder's split personality: `SpreadsheetCoordinatorProvider` and `SpreadsheetIndicators` are on the production path, while `Shell`, `ViewSwitcher`, `RecordDetailSidebar`, and `PaneNavigationProvider` are largely scaffolded or unmounted relative to the live `index.tsx` composition. The plan is architecturally aligned with Mog's "composition boundary plus explicit contracts" direction and is unusually good at pinning production-path invariants before proposing extraction.

The rating is not higher because the plan is still too decision-heavy for an implementation contract. The biggest unresolved item is whether the multi-view shell is product-live or should be removed/moved. That decision changes ownership, tests, and sequencing materially, yet the plan defers it to implementation. The plan also bundles several high-risk refactors into one workstream without defining the smallest contract-preserving checkpoints.

Major strengths

- The production-path diagnosis is accurate. `index.tsx` currently owns toolbar, formula bar, grid, panel/overlay/dialog layers, status bar, sheet tabs, and passes inert export props into `SpreadsheetIndicators`, while `src/app/Shell.tsx` is not mounted by the production entrypoint.
- The coordinator-provider inventory is high quality. The plan sees the real risks in the 800+ line provider: keyboard capture, dependency injection, editor commit dependencies, validation/formula/circular-reference dialogs, clipboard UI bridges, pane navigation, undo/range setup, and collab presence.
- The keyboard section is contract-oriented rather than stylistic. It preserves IME, editable/dialog targets, body-focus fallback, formula editor state, autocomplete/picker pass-through, keytips, and sheet navigation from chrome.
- Verification is production-relevant. The plan requires package tests, typecheck, browser exercise, and E2E through real keyboard/mouse/clipboard input rather than direct state mutation.
- Parallelization notes are credible and mostly independent: layout, keyboard routing, bridge extraction, shell resolution, indicators, and verification can be split across agents after the ownership decisions are pinned.

Major gaps or risks

- The multi-view shell decision must be made up front. "If product-live, implement real instances; if not, remove/move scaffolding" is the right fork, but leaving it as a mid-plan choice makes the plan less executable. It should specify the chosen path or define a prerequisite decision artifact with acceptance criteria.
- The plan is broad enough to create integration churn. Extracting the live layout, splitting the provider, introducing host capability injection, resolving shell scaffolding, wiring pane navigation, and connecting indicators are all meaningful changes. The plan needs explicit checkpoints where production behavior is unchanged and gates can pass before the next slice.
- Host/browser capability injection is under-specified. The plan names `document`, active element lookup, dialog query, confirm, scheduler, console/error reporting, and devtools exposure, but does not define the interface shape, ownership, default implementation location, or how portal/dialog DOM queries are kept accurate.
- Effect ordering is recognized as a risk but not specified as a contract. The provider currently nests keyboard capture outside undo/range/pane/collab bridges. If ordering matters, the plan should state the required order and what observable tests prove it.
- The "source-level contract test" against unused shell scaffolding could become brittle. A better contract would assert public exports, production mount paths, and ownership docs rather than fail on broad "scaffolding remains" heuristics.
- Indicator work needs a clearer source of truth. The plan says connect export lifecycle state "from the same export handler used by toolbar/host commands", but does not specify whether export state is app-local, host-command state, UI store state, or a dedicated export service.

Contract and verification assessment

The contracts section is the plan's strongest part. It covers coordinator lifecycle, durable state ownership, read-only barriers, listener attach/remove, keyboard routing, pane registration cleanup, dialog callback behavior, collab cleanup, and public/private dependency boundaries. These are the right invariants for this folder.

The verification gates are also strong, especially the insistence on real UI input for E2E coverage. The package commands are plausible for the app package, and the focused test list maps well to the major contracts. The main missing verification detail is sequencing: the plan should assign each gate to the slice that must pass it, instead of listing all gates as eventual implementation checks. For example, keyboard pure-function extraction should have a unit/integration gate before layout movement begins; layout extraction should have snapshot/DOM composition gates before pane navigation registration changes.

Concrete changes that would raise the rating

- Choose the shell ownership path before implementation: either remove/move `Shell`, `ViewSwitcher`, and `RecordDetailSidebar` from production app composition scope, or define real view-instance persistence and adapter contracts.
- Split the plan into ordered, behavior-preserving milestones with explicit acceptance gates for each milestone.
- Define the app host capability interface in the plan, including default browser implementation, test fake implementation, and devtools cleanup semantics.
- Specify the required bridge/effect ordering and add tests that observe the ordering through listener registration, dependency readiness, and cleanup behavior.
- Replace the brittle source-level scaffold test with concrete public-export and production-mount contract tests.
- Define the export/status state owner for `SpreadsheetIndicators` and its interaction with toolbar export, host commands, errors, dismissal, and ARIA live behavior.
