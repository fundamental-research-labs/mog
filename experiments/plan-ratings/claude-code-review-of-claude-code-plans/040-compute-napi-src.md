Rating: 9/10

# Review of 040 — `mog/compute/napi/src`

## Summary judgment

This is an excellent, evidence-grounded plan. Every factual claim it makes about
the source was independently verifiable against the tree, with line citations that
land exactly. It correctly identifies the most important structural defect (the
global table mutex held for the entire duration of every coordinator operation,
serializing all documents process-wide) and sequences fixes by value, with sound
architectural reasoning, explicit cross-folder contracts, and concrete verification
gates. It reads like a specification an implementer could execute against, not a
sketch. The deductions are small: a couple of napi-rs mechanics are slightly
hand-waved, and one already-existing de-risking property of the consumer is missed.

## Major strengths

- **Accurate, citable evidence.** I confirmed each claim:
  - `with_coordinator` (`coordinator.rs:55-68`) holds the `COORDINATORS` table guard
    in scope across the entire `f(&mut coord)` call — the global-serialization finding
    is exactly right, and it correctly concludes the per-coordinator inner mutex is
    nearly decorative.
  - Handle reuse via `insert_coordinator` (`:91-99`) vs. `coordinator_create_from_state`
    always `push`-ing (`:109-111`) — the two-allocation-policy divergence is real.
  - `coordinator_dispose` (`:119-121`) silently ignores out-of-range handles; non-generational
    `u32` slot indices genuinely permit stale-handle aliasing onto a reused slot.
  - `.unwrap()` on `serde_json::to_string` at `:142`, `:172-184`, `:335` — confirmed.
  - `filter_map(|s| SheetId::from_uuid_str(s).ok())` at `:166-169` silently narrows the
    lock-checked sheet set — a genuine correctness hole in `check_push`.
  - Stringly-typed wire protocol, `scope_json` string parsing (`:227-255`), and the
    `as (...) => any` casts + `JSON.parse` in `collaborative-engine.ts:101-192` — all confirmed.
- **Right prioritization.** Phase 1 (concurrency + handle safety) is correctly flagged
  highest-value and is self-contained to this folder; Phases 2–3 are correctly identified
  as requiring lockstep consumer migration.
- **Contract discipline.** The plan treats `js_name` exports as a published contract,
  insists on additive/old-name-preserving changes, and calls out binary byte-fidelity
  (Yrs updates/state vectors/snapshots) as a round-trip invariant — exactly the right
  guardrails for an FFI seam.
- **Scope hygiene.** Clean in/out-of-scope boundaries: the macro codegen (`bridge-napi`),
  the generated `ComputeEngine` class, and the engine crates are explicitly not edited;
  behavioral fixes that belong upstream are flagged as cross-folder dependencies.

## Major gaps or risks

- **napi-rs tagged-union ergonomics under-specified.** Step 5 proposes `PushResult` as a
  "discriminated result … or model it as a tagged union the way napi best supports." This
  is the one place the plan defers a real design decision. napi-rs does not cleanly map a
  Rust enum to a JS tagged union; the implementer will likely need a flat `#[napi(object)]`
  with optional fields (mirroring today's `{ ok, error?, serverDiff? }`) or an `Either`.
  The plan should pick the shape rather than leave it open, since the consumer contract
  hinges on it.
- **`index.d.ts` verification tension.** The plan lists `Cargo.toml`/`package.json`/
  `index.d.ts` as out of scope (gitignored, regenerated) yet makes "diff `index.d.ts`" a
  verification gate (line 106). For a gitignored, regenerated artifact a diff has no
  committed baseline; the gate needs a concrete mechanism (e.g. snapshot the prior `.d.ts`
  before rebuild, or assert against a checked-in expected-exports list — which overlaps the
  Phase 4 symbol-set test).
- **Missed de-risking observation.** The consumer already defensively branches on
  `typeof result === 'string' ? JSON.parse(result) : result` for `join`/`push`/`activeLocks`
  (`collaborative-engine.ts:103,131,191`). This means the JSON-string→typed-object migration
  under the same `js_name` is *already* forward-compatible at those call sites — a fact that
  materially lowers the Phase 2 risk the plan frames as its biggest. Noting it would have
  sharpened the sequencing argument.
- **Async-future `Send` constraint not addressed.** Phase 3 proposes `#[napi] async fn` as an
  alternative to `AsyncTask`. An `async fn` future holding an `Arc<Mutex<…>>` guard across an
  await point must be `Send`; `AsyncTask` (compute on the libuv pool, no guard across await)
  is the safer mechanism and the plan should commit to it rather than offering both.

## Contract and verification assessment

The contract section is the plan's strongest part: it enumerates exported-symbol stability,
coordinator authoritativeness (full-apply-or-typed-error), exact lock semantics (TTL,
structural serialization), `Drop`-based cleanup for the engine class, semantics-free chart
rendering, and byte-level binary fidelity. The verification gates are appropriately layered:
new crate-level tests (handle lifecycle/aliasing regression, allocation policy, malformed-sheet-id
push, lock-scope round-trip, structural-not-timing concurrency test), an exported-symbol
assertion, byte-fidelity round-trip tests, plus the integration safety net (`api-eval`,
`xlsx-corpus-eval`, collab e2e). The explicit "structurally test that the table guard is
released before work, not via fragile timing" is a notably mature instruction. The only soft
spots are the `index.d.ts` gate mechanism (above) and that the byte-fidelity test lacks a stated
oracle/source of canonical bytes.

## Concrete changes that would raise the rating

1. Commit to a single `PushResult`/`JoinResult` wire shape (flat optional-field object vs.
   `Either`/external-tagged), with field-by-field mapping from today's JSON, instead of leaving
   the tagged-union choice open.
2. Replace the `index.d.ts` "diff" gate with a concrete baseline mechanism (pre-rebuild snapshot
   or a checked-in expected-`js_name` manifest the symbol-set test asserts against).
3. Note that `collaborative-engine.ts` already branches on string-vs-object results, and use that
   to tighten the Phase 2 cutover sequence (binding can emit typed objects under the same name
   immediately; consumer cast removal is a follow-on cleanup, not a blocking lockstep edit).
4. Pick `AsyncTask` explicitly for Phase 3 and state the `Send`/guard-across-await rationale,
   rather than offering `#[napi] async fn` as an equal alternative.
5. Specify the byte-fidelity test's source of truth (capture buffers from the current binding
   before the protocol change as golden inputs) so the round-trip assertion is reproducible.
