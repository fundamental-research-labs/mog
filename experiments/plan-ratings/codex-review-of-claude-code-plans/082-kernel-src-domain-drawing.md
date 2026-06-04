Rating: 8/10

Summary judgment

This is a strong, production-relevant plan. It correctly identifies the drawing domain's actual responsibilities and consumers, and most of the named problems are real: the module-global spatial cache is keyed only by drawing id, drawing creation and mutation embed `Date.now()`/`Math.random()`, placeholder anchors can be persisted, `recognizeText` can touch `window` in non-DOM contexts, serialization is duplicated, recognition thresholds are split, stroke ordering is not total, and lasso containment only checks points. The plan is much better than a bug-list because it states invariants, preserves public contracts, and proposes behavior gates.

The rating is not higher because several proposed contracts are still too loose for implementation without rediscovery. In particular, the plan assumes a transaction timestamp/id source that is not visible in the current worksheet operation path, suggests cache versions that are not robust enough for same-size/same-time edits, and does not fully specify document-scoped cache ownership, typed error additions, recognition-port injection, or exact verification commands.

Major strengths

- The source inventory and consumer mapping are accurate and useful. It keeps internal planning in `mog-internal` while treating `mog/kernel/src/domain/drawing` as public source.
- The plan focuses on production defects and architecture boundaries rather than test-only scaffolding.
- The contract section is unusually concrete: it calls out Map-vs-Record storage, schema field preservation, `IInkRecognitionBridge`, `ISpatialIndex`, stable query signatures, read-only purity, and app-agnostic domain expectations.
- The test list is behavior-oriented and covers the highest-risk regressions: stale spatial indexes, deterministic creation/mutation, placeholder-anchor failure, serialization round-trip, non-DOM recognition, threshold tuning, ordering, lasso, and oversized bounds.
- The sequencing mostly separates independent tracks and identifies adjacent folders that must change in lockstep, especially worksheet drawing operations, floating-object deletion, contracts, the mapper, and the ink engine.

Major gaps or risks

- Step 1 needs a real deterministic source contract. The plan says the worksheet operations layer already runs inside a kernel transaction with a timestamp, but the visible `DocumentContext` and drawing operation functions do not expose such a timestamp. The plan should name the exact source or introduce one, such as a `DrawingMutationContext` with `{ now, idGenerator }`, and state whether it is required on the production path.
- Keeping optional defaults for `Date.now()`/random IDs risks preserving the same non-deterministic production path if any caller is missed. Defaults are fine for compatibility, but the plan should require the worksheet path to pass deterministic values and add a guard/test proving production callers do so.
- Step 2's suggested version signal, `updatedAt` plus stroke count, is not strong enough. Same-millisecond edits, same-size replacements, remote updates that preserve `updatedAt`, or operations like move/transform that currently rebuild strokes without updating `updatedAt` can still serve stale cache entries. The plan should require an explicit stroke/content revision or a clearly defined version from storage/mutation results.
- The spatial cache should be document-scoped, not just keyed by `sheetId:id`. A module-global cache plus `clearSpatialIndexCache()` on document close can either leak across open documents or accidentally flush other documents' indices. The stronger architecture is a cache owned by `DocumentContext`/manager lifecycle or keyed by document id plus sheet id plus drawing id.
- The typed anchor error is under-specified. There is a `drawingNotFound` error and an error-code union, but no `drawingAnchorUnresolved` code. The plan should name the exact new error code, factory, exported path, and expected API error behavior.
- Step 5 correctly identifies the DOM dependency, but the recognition-port wiring is not concrete enough. `createDocumentContext` currently constructs `createInkRecognitionBridge()` internally, so the plan should specify how the app/shell provides the port, whether the port type lives in contracts, and how DOM types stay out of the kernel domain.
- Step 8 slightly overstates the spatial-index export ambiguity: the factories are named differently (`createSpatialIndex` and `createInkSpatialIndex`). Consolidation may still be worthwhile, but the plan should require comparing interfaces, data models, and performance before deleting the kernel grid index.
- The recognition improvements are valid but broad. They may change many snapshots and user-visible recognitions, so the plan should require representative fixtures for false positives as well as true positives, not only "rotated rectangle works."

Contract and verification assessment

The contract assessment is good at the conceptual level, especially around Map/Record storage and preserving public bridge interfaces. To be implementation-ready, it needs exact changed signatures and types: the new drawing mutation context or clock/id arguments, the storage return type for `serializeDrawingObject`, the typed anchor error code, the recognition port interface, and the cache owner/key/version API.

The verification plan is directionally right but not executable enough. "Typecheck the kernel package and contracts consumers" should become exact commands with package filters. If contracts types change, the plan should explicitly include the contracts build/declaration step before kernel typecheck. The listed unit tests are relevant, but the plan should also require direct tests for the drawing-domain cache and geometry functions if no current domain-local test file exists. For API/eval gates, it should name concrete drawing/ink scenarios or explicitly require adding them if none exist.

Concrete changes that would raise the rating

- Define a `DrawingMutationContext` contract with `now`, `idGenerator`, and possibly `strokeRevision`, and require the worksheet production path to pass it.
- Replace `updatedAt + size` cache versions with an explicit content revision or a deterministic content fingerprint that covers stroke IDs and per-stroke mutation state.
- Make the spatial-index cache document-scoped, with deletion and document teardown wired through one owner, and test two open documents with colliding sheet/drawing IDs.
- Specify the new anchor error code/factory/export and the exact caller behavior when creation lacks a resolvable anchor.
- Specify the `HandwritingRecognitionPort` interface and injection path from app/shell into kernel context, with non-DOM fallback as a required behavior, not an optional minimum.
- Define a typed storage shape for `serializeDrawingObject` and connect it to both `DRAWING_OBJECT_SCHEMA` and `toDrawingObject` with compile-time and round-trip tests.
- Replace vague verification gates with exact commands and exact test files/scenarios to add or update.
- Refine sequencing so Step 1, Step 2, and Step 4 are not treated as fully independent when they touch the same caller and persistence contract.
