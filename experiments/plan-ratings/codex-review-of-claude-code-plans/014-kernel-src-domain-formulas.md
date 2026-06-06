Rating: 8/10

Summary judgment

This is a strong, source-grounded plan that targets real production-path defects in `kernel/src/domain/formulas`. The `RectRange` conversion gap, fire-and-forget `importNames`, by-name scoped delete, dead `evaluateValue` surface, N+1 reads, and misleading structured-reference stubs are all legitimate issues visible in the current code. The plan also preserves the right architectural center of gravity: Rust compute-core owns evaluation and reference rewriting, TypeScript should keep `IdentityFormula` as the persisted contract, and mutation events should stay with the bridge result handler.

It falls short of a 9 or 10 because several of its highest-risk areas remain framed as "confirm", "decide", or "preferred/fallback" rather than as crisp implementation contracts. It also misses that generated bridge APIs for by-id/by-name/by-scope/count/exists/resolve/remove-by-scope/import already exist, which should materially sharpen the sequencing and avoid unnecessary bridge work. The plan is directionally correct, but it needs a tighter bridge-shape matrix and explicit public behavior decisions before implementation.

Major strengths

- The plan correctly identifies the duplicated wire conversion as the central correctness risk. The current `create` path hand-builds wire refs and omits `RectRange`, while the shared converter tests already cover `RectRange`.
- It is production-path oriented. The proposed changes operate on the kernel domain and compute bridge path, not mocks or evaluation-only scaffolding.
- The architectural invariants are well chosen: identity-backed storage, Rust-owned evaluation/rewrite semantics, atomic named-range rename, no direct event emission, sheet-scope precedence, and constant-formula display fallback.
- The test list is focused on behavior that could regress: all identity ref variants, failed imports, scoped deletion, atomic update, resolution precedence, and constant formula display.
- The plan calls out the camelCase-vs-snake_case transport mismatch before editing. That is the right highest-risk gate because `mapRustNamedRange` currently assumes transport-normalized nested fields while `wireToIdentityFormula` expects raw snake_case wire fields.

Major gaps or risks

- The generated bridge already exposes `getNamedRangeById`, `getNamedRangeByName`, `getNamedRangesByScope`, `namedRangeExists`, `namedRangeCount`, `validateNamedRangeName`, `resolveNamedRange`, `removeNamedRangesByScope`, and `importNamedRanges`. Phase 0 and Phase 4 should not say "confirm or expose"; they should specify which existing generated methods are safe to use, what shape they return, and which legacy `getAll` fan-outs they replace.
- The plan does not fully address that `getVisibleNamedRanges` and the direct generated named-range query methods are typed as `DefinedName[]`/`DefinedName | null`, while `getAllNamedRangesWire` is typed as `DefinedNameWire[]`. Current `getVisible` still maps visible names through `mapRustNamedRange`, so the plan needs an explicit contract for visible/direct results before centralizing on wire converters.
- Phase 3 is not a specification yet. "Either remove the dead stub and route Name Manager value display through a real bridge evaluation call, or remove the orphaned formatting helpers" leaves the implementer to choose a product/API behavior. The plan should decide whether value display is unsupported, omitted, lazy-evaluated, or bridge-evaluated, including error and array formatting semantics.
- Phase 5 is architecturally important but underspecified. Surfacing real structured-reference rewrite counts through `MutationResult` needs a named field, affected mutation list, table-operation sequencing, and tests spanning Rust and TypeScript. The fallback of deleting stubs and logs may be reasonable, but it should be split into a separate plan or made a concrete no-count contract.
- `importNames` needs exact failure semantics. Returning a number conflicts with "surface/aggregate failures" unless the plan says whether the function throws on any failed write, returns partial success plus failure details via a new type, or preserves the number return and logs/attaches errors elsewhere.
- The verification commands are placeholders. For an implementation plan, `pnpm --filter <kernel> typecheck` should be replaced with the actual package filter after checking the workspace package name, and cross Rust/table work should list the relevant cargo gates if Phase 5 takes the preferred path.

Contract and verification assessment

The contract section is the best part of the plan, but it needs one more layer of precision at the bridge boundary: a method-by-method table for `toIdentityFormula`, `getAllNamedRangesWire`, `getVisibleNamedRanges`, direct named-range queries, and write/import/remove methods, with raw return type, transport-normalized runtime shape, desired domain shape, and converter/adapter used. Without that table, the central converter refactor could either fix `create` while breaking reads, or leave visible/direct query paths silently lossy.

The verification plan is solid for named-range unit behavior and correctly avoids test-only shortcuts. It should add tests for the existing generated direct query methods if they replace `getAll` fan-out, and it should include a transport-normalization regression that proves both snake_case wire and camelCase normalized payloads are handled intentionally. If value display changes, an API or app eval is not optional because that is a user-facing contract.

Concrete changes that would raise the rating

1. Replace Phase 0 with a concrete bridge-shape matrix and make the output of that phase a checked-in adapter or explicit no-adapter decision.
2. Rewrite Phase 4 around the already-generated named-range APIs, including `removeNamedRangesByScope` and `importNamedRanges`, or explicitly justify why the domain layer should not use them.
3. Choose one value-display contract in the plan instead of leaving it open, then list the exact API files and tests that prove that behavior.
4. Split structured-reference count surfacing into a separate cross-folder/Rust plan unless this plan defines the exact `MutationResult` contract and table mutation sequencing.
5. Specify `importNames` failure behavior precisely, including whether partial success throws, how duplicate handling interacts with failed writes, and whether writes are sequential or `Promise.allSettled`.
6. Replace placeholder verification commands with exact workspace filters and add a direct-query/visible-names regression test alongside the existing named-range tests.
