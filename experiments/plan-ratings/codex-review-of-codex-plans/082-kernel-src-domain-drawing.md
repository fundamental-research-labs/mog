Rating: 8/10

Summary judgment

This is a strong plan. It correctly identifies the drawing domain as kernel behavior, not rendering, and it follows the real production path through worksheet drawing APIs, compute persistence, mapper hydration, app ink coordination, and recognition. The plan is especially good at turning scattered implementation issues into contracts: Map-versus-Record serialization, placeholder anchor removal, spatial cache freshness, mutation no-op semantics, deterministic ordering, and host-safe recognition.

The rating is not higher because several proposed contracts remain underspecified at the exact point where implementers need precision. The largest issue is anchoring: the plan says absolute drawings can be allowed without a cell anchor, but the current `ObjectPosition` contract requires `from` for all anchor types. The plan also needs sharper migration behavior for malformed or legacy drawing records, a formal mutation result type, and clearer phase boundaries for a cross-package change touching kernel, compute mapper, app ink actions, and shared spatial packages.

Major strengths

- The plan is grounded in the actual source. The current placeholder anchor fallback in `drawing-manager.ts`, worksheet creation passing `resolver: null`, app ink actions creating one-cell drawings with only `x`/`y`, permissive `floating-object-mapper.ts` casts, drawing-ID-only spatial cache, point-only lasso logic, reverse-array drawing hit testing, and event-only recognition conversion are all real concerns.
- It treats drawing behavior as a domain contract rather than a pile of helpers. Centralizing add, erase, clear, move, transform, tool-state, and recognition mutation behavior would reduce the current split between `domain/drawing` and worksheet operations.
- It preserves the important architecture boundary: runtime drawing objects use `Map<StrokeId, InkStroke>`, persisted wire data uses JSON-compatible records, and compute storage remains the source of truth.
- It is production-path relevant. The plan explicitly ties implementation to `WorksheetDrawingCollectionImpl`, worksheet operation functions, `ComputeBridge.setFloatingObject`, `floating-object-mapper.ts`, spreadsheet ink coordination, and workbook recognition.
- The spatial-index recommendation is well motivated. The public `@mog/spatial` grid index already handles oversized items and shared query semantics, while the kernel-local index is a divergent implementation with weaker cache freshness semantics.
- The verification list is broad in the right places: kernel tests for domain invariants, mapper tests for serialization, app tests for UI behavior, package typechecks, and browser exercise for UI changes using real input paths.

Major gaps or risks

- The absolute-anchor proposal conflicts with the current public type contract. `ObjectPosition.from` is documented as required for all anchor types, and mapper hydration always builds a `from` anchor. If the intended fix is to remove `from` for absolute anchors, the plan must specify the public type, wire, mapper, API, and renderer changes. If the intended fix is to keep `from` as a canonical resolved anchor even for absolute objects, the plan should say so and forbid placeholder anchors while preserving the existing type.
- Serialization validation is directionally right but not operational enough. For imported or legacy drawings with mismatched record keys, missing tool settings, transient `selected`, non-finite points, or unknown recognition payloads, the plan should define whether the codec throws, repairs, drops invalid strokes, records diagnostics, sets import status, or preserves unsupported data. That policy is essential because compute hydration may happen on existing documents.
- The structured mutation result is only sketched. The plan should define the exact TypeScript shape, including timestamp source, changed versus missing stroke IDs, removed IDs, affected bounds representation, cache invalidation token, and whether no-ops return the original object by identity.
- Cache freshness needs a stronger revision contract. A signature from `updatedAt`, stroke count, and changed IDs is useful, but remote hydration and imported documents can contain stale or missing `updatedAt`. The plan should define the fallback signature precisely enough to prevent false cache hits.
- Recognition conversion is still too high level. It says to convert recognized output into real shape/text objects, but does not define local-to-sheet coordinate conversion, shape API choice, source stroke metadata storage, failure rollback, or undo transaction boundaries.
- The implementation sequence is comprehensive but could be easier to execute with explicit phases. As written, the plan spans codec, anchors, mutation helpers, spatial adapters, hit testing, recognition, defaults, and UI integration. The ordering mostly makes sense, but it needs hard acceptance criteria for each phase so partial implementation does not leave mixed contracts in production.

Contract and verification assessment

The contract section is one of the plan's strongest parts. It captures the right invariants: stable stroke IDs, Map runtime data, Record wire data, key-to-`stroke.id` consistency, metadata preservation across transforms and sync, `position`/`anchor` equivalence, drawing-local coordinates, no false negatives from spatial broad phase, deterministic z-order, host-safe text recognition, and strict package boundaries.

The main contract weakness is that some invariants are stated without deciding the behavior that enforces them. Examples: validation failure handling, malformed import policy, absolute anchor representation, mutation no-op identity, and recognition conversion rollback. These need exact API-level rules before implementation.

The verification gates are appropriate and production-facing. The plan does not rely on benchmark-only or test-only paths, and it correctly calls for browser coverage when spreadsheet UI behavior changes. It also correctly avoids running verification commands during plan writing. To be fully contract-grade, the plan should name the minimum tests that must fail before each phase and pass after it, rather than listing a broad suite that implementers could satisfy unevenly.

Concrete changes that would raise the rating

- Define the anchoring contract precisely: either update `ObjectPosition` so absolute anchors truly do not require `from`, or keep `from` required and require resolver-backed canonical cell anchors for all persisted drawings, including absolute drawings. Include wire, mapper, worksheet API, and renderer implications.
- Add a concrete `DrawingMutationResult` interface and a table of behavior for add, erase, clear, move, transform, tool-state, and recognition mutations, including no-op and missing-stroke cases.
- Specify codec failure and migration policy for old or malformed drawing data: reject, repair, drop with diagnostics, preserve as unsupported, or set import status. Include exact behavior for record key mismatch and transient `selected`.
- Define the spatial cache key/revision scheme with fallback behavior when `updatedAt` is absent or unreliable, and include document-scoped disposal semantics.
- Add phase-level acceptance criteria: anchor safety and codec first, mutation result contract second, spatial/hit testing third, recognition conversion fourth, UI integration last.
- Make recognition conversion concrete by naming the worksheet APIs used to create shapes/text or set cells, defining coordinate conversion from drawing-local bounds to sheet-space objects, and requiring transactional undo-safe deletion of source strokes only after replacement persistence succeeds.
- Add deterministic ordering requirements to every query that returns stroke or drawing IDs, including tie-breakers for equal timestamps and equal z-index values.
