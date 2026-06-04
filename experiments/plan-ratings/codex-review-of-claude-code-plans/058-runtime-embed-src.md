Rating: 8/10

Summary judgment

This is a strong plan for `runtime/embed/src`. It understands that this folder is a public exposure boundary, not just a rendering wrapper, and it backs most claims with concrete source evidence: package exports, opaque source handling, iframe origin validation, same-page host boot, renderer limitations, publish placeholders, and repeated `as unknown as` kernel coupling. The proposed sequencing is mostly sound: fix transport leaks first, consolidate workbook contracts, unify same-page orchestration, then compose iframe/publish on top.

The score is not higher because the plan leaves two central product decisions unresolved: whether edit/save/capability APIs should become real or be narrowed, and whether publish should be implemented or fail closed. Those decisions are correctly identified, but a plan that cannot choose the target contract is not fully executable. The verification story is also too package-unit-test heavy for a browser SDK that exposes custom element, React, iframe, and publish surfaces.

Major strengths

- The plan is evidence-backed and production-path relevant. The cited no-op iframe child handlers, discarded `onSourceRequest` bytes, `MogIframeClient.connect()` listener leak, placeholder `createPublishView`, `crypto.randomUUID()` dependency, narrow `navigateToRange`, and React/web-component dirty-state drift are all grounded in the current source.
- It treats public boundary invariants as first-class contracts: no raw source URLs/paths/bytes, no kernel/workbook/renderer internals through public barrels, trusted effective-state resolution, exact `postMessage` target origins, and package export containment.
- The architecture direction is right. A shared embed session controller would remove duplicated boot/save/dirty/effective-state logic across React and the web component. A single internal workbook adapter/contract would be much safer than three independent structural probes and casts.
- The phase ordering is practical. Transport correctness and config validation can land independently, the internal workbook contract can unblock controller work, and iframe composition naturally depends on the controller and transport cleanup.
- The plan calls out cross-package dependencies instead of pretending this folder can implement everything alone. The notes for `@mog-sdk/kernel`, `@mog-sdk/sheet-view`, `@mog-sdk/types-host`, `@mog/views-host`, and the publish redaction pipeline are important.

Major gaps or risks

- Phase D is a decision gate, not a specification. "Implement real edit/enforcement" versus "narrow the public contract to read-only reality" changes public types, renderer work, kernel mutation policy, tests, and docs. The plan should select one recommended default and define exact public API deltas for the alternative.
- Phase G has the same issue. "Implement publish" and "fail closed" are very different deliverables. Since the package description is currently "Embeddable read-only Mog spreadsheet component" and `./publish` is not exported, the safer default should probably be explicit fail-closed plus export-map containment until the redaction artifact path exists.
- The iframe composition target needs a sharper contract. It says handshake -> source resolution -> `MogClient` -> renderer, but it does not specify the bootstrap HTML/entrypoint, ownership of the child frame DOM, how the parent sends `sourceRef`, when `ready` is emitted relative to workbook render readiness, or how request/response correlation is handled for source/load errors.
- The edit/capability concern is framed accurately, but the plan risks broadening beyond `runtime/embed/src` without enough acceptance criteria. If D1 is chosen, it must define the actual capabilities, which mutations they gate, which renderer input paths are enabled, and what kernel enforcement API proves denial is not just UI hiding.
- The validation allowlist needs compatibility treatment. Rejecting unknown keys is the right security posture for this package, but the plan should spell out the exact top-level and nested allowed key sets and include expected error shapes so tests and hosts do not drift.
- The plan mentions preserving event names, payloads, and ordering, but does not enumerate them as a compatibility table. That matters because the session-controller refactor touches both DOM CustomEvents and React callbacks.

Contract and verification assessment

The contract analysis is the plan's best section. It clearly distinguishes requested state from effective trusted state, keeps raw source authority out of public props, keeps iframe origin validation tied to `MessageEvent.origin`, and preserves the package boundary tests around exported symbols and subpaths. It also correctly identifies that currently advertised edit/save/collab semantics are not enforced by the renderer or kernel path.

Verification should be stronger. The listed `pnpm --filter @mog-sdk/embed typecheck`, package build, and package test gates are necessary but not sufficient. This folder is browser-facing, so the plan should require a dev-server or browser automation pass for the custom element and React component using real DOM input paths. The iframe work should include a real parent/child frame browser test that validates origin rejection, exact target origins, handshake cleanup, workbook render readiness, and navigation messages. The publish path should have a browser-visible fail-closed or rendered-artifact assertion, not only unit-level status checks. For package publication risk, add the existing publish-readiness or packed-manifest check if that is the repo's standard gate for public SDK surfaces.

Concrete changes that would raise the rating

- Choose a default for Phase D. Prefer either "read-only contract now, reserved edit fields hidden or explicitly non-shipping" or a fully enumerated D1 edit contract with capability names, kernel gates, renderer input paths, and denial tests.
- Choose a default for Phase G. If the redacted artifact pipeline is unavailable, specify fail-closed behavior exactly: status, `ready` rejection, rendered error state, event/callback behavior, and package export status.
- Add an event compatibility table for `<mog-sheet>` CustomEvents and React callbacks before extracting the session controller.
- Define the iframe child composition contract in detail: entrypoint, DOM mount target, message sequence, source load lifecycle, ready/error timing, correlation behavior, and navigation semantics.
- Expand verification with browser-level tests for React, web component, iframe parent/child, and publish, plus a package publish-readiness/manifest gate for the public SDK boundary.
- Turn the config allowlist into an explicit schema in the plan, including nested `source`, `chrome`, `theme`, requested capability, save, and collaboration fields and expected validation errors.
