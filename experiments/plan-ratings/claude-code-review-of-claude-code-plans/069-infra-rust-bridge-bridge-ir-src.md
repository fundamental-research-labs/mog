Rating: 8/10

# Review — 069 `mog/infra/rust-bridge/bridge-ir/src`


## Summary judgment

This is a strong, evidence-grounded plan that correctly identifies the highest-value
work for a contract IR crate: harden the parser and make its central invariant
(lossless `emit → parse` round-trip) mechanically enforced rather than asserted in
prose. The framing — "make `bridge-ir` correct, complete, and authoritative enough to
be the single parser" instead of adding features — is exactly right for a crate whose
de-duplication promise is only half-adopted. Nearly every factual claim checks out
against the source at the line level, the sequencing is sound (round-trip gate first to
de-risk the rest), and the non-goals and load-bearing invariants are unusually
well-understood.

The plan loses points for one substantive technical error: objective 3's diagnosis of
the `parse_type_until_comma` "bug" is wrong, and its proposed fix describes behavior the
code already has while not addressing the actual (narrower) latent defect. Because that
objective ships parser behavior changes and drives new test cases, the error would
mislead an implementer.

## Major strengths

- **Accurate, line-cited evidence.** I verified the load-bearing claims directly:
  - Version discarded: `parse.rs:31-34` binds `bridge_version` to `_version` and drops
    it; `param_struct.rs:79-81` does the same. Confirmed.
  - `crate_path` dead: `parse.rs:124` hardcodes `crate_path: None`; `ir.rs:39-41` doc
    calls it "currently informational." No reader found. Confirmed.
  - Call-site spans: `parse.rs:374-381` uses `Span::call_site()` for missing
    `tagged_enum` `name`/`tag`. Confirmed.
  - Adoption gap: only `bridge-napi/macros` and `bridge-ir` itself reference `bridge-ir`
    in any `Cargo.toml`; `bridge-pyo3`/`-wasm`/`-tauri`/`-delegate` each ship their own
    `expand/parse.rs`. Confirmed.
  - Speculative consumer: `bridge-cli-macros` does not exist in the tree, so
    `is_mode_b_eligible` (`param_struct.rs:60`) has no production caller. Confirmed.
- **Correct identification of the keystone gate.** The round-trip test is the right
  first step and genuinely makes objectives 2/4 safe to land. The plan also correctly
  anticipates the enabling cross-folder change: `bridge-core::emit::emit_descriptor` is
  `pub(crate)` (`bridge-core/src/emit.rs:50`), so it must be exposed for a dev-dep test —
  flagged accurately as a minimal, no-semantic-change exposure.
- **Invariant literacy.** The "contracts to preserve" section is excellent and not
  boilerplate: `to_snake_case` acronym behavior is load-bearing and tested
  (`classify.rs:51-53`, `h_t_t_p_server`); `fn_prefix` is a real tri-state
  (`parse.rs:48-60`); unit-return normalization is a single point (`parse.rs:236,495`);
  `extras` determinism rests on `BTreeMap` (`ir.rs:49`). The plan explicitly forbids
  "fixing" the acronym case — the right call.
- **Honest scoping.** Backward-compat (byte-identical minimal DSL still parses),
  optional-and-skippable additions so the four independent parsers don't break, and the
  napi `From`-adapter removal deferred as cross-folder follow-up rather than smuggled in.

## Major gaps or risks

- **Objective 3 is misdiagnosed (the main flaw).** The current scanner does
  `input.parse::<proc_macro2::TokenTree>()` (`parse.rs:463`), which consumes a *whole*
  delimited group atomically. A `(String, i32)` or `[u8; 4]` param type therefore
  arrives as a single `Group` token tree and its inner comma never reaches the top-level
  `peek(Token![,])` check. The plan's stated evidence — "`[serde] pair: (String, i32),`
  breaks at the inner comma" (line 41) — is **false**; tuples and bracketed arrays
  already parse correctly. The plan's proposed fix ("match-by-`Delimiter` on
  `TokenTree::Group` … a `Group` token is atomic") describes behavior the code *already*
  has, so for tuples/arrays it is a no-op. The genuine latent defect is narrower: the
  `>` inside the `->` of a closure/fn-trait bound (`Box<dyn Fn(A, B) -> C>`) decrements
  `angle_depth` past zero, corrupting the depth count — and the plan's Group-based
  rewrite does **not** address that, because `->` is bare punctuation, not a group. An
  implementer following this objective would write a `(String, i32)` test expecting it
  to fail under the old code (it passes), and could "fix" the scanner without actually
  repairing the only type family that breaks. The objective is salvageable, but its
  root-cause analysis and fix mechanism need correcting.
- **Real-world impact of the actual bug is unquantified.** Whether `bridge-core` ever
  emits fn-pointer/closure-trait param types is not established. If it never does, the
  "latent correctness bug in the production parse path" framing overstates severity; if
  it can, the plan should name a concrete API that triggers it. Either way the plan
  should tie the fix to an emittable type, which the round-trip test would surface.
- **Minor inaccuracy.** Line 45 says "only a `client/` dir is present" near
  `bridge-cli`; no `client/` dir exists under `rust-bridge/`. Immaterial to the work but
  a small evidence slip.

## Contract and verification assessment

The verification strategy is the plan's best feature. Gates are concrete and mapped to
objectives: round-trip structural equality, version-mismatch `Err` tests, diagnostics
span tests, a minimal-historical-DSL backward-compat test, and preservation of all
existing `tests/parse.rs` / `tests/param_struct.rs` / `classify.rs` assertions
(including the acronym case). The plan correctly notes that objective 4 (public-type
change) plus 2/3 (behavior changes) warrant a `bridge-napi-macros` build as a downstream
gate, and that the round-trip gate is the safety net for the IR-shape change. The one
weakness: objective 3's unit tests are specified against a misdiagnosed failure mode, so
the most important of them (tuple/array) assert nothing meaningful, and the
`Fn(...) -> C` case is the only one that would actually exercise a fix. The diagnostics
test's reliance on `to_string`/location proxies is appropriately hedged given `syn`'s
limited span introspection in unit tests.

## Concrete changes that would raise the rating

1. **Correct objective 3.** State the real failure mode: top-level commas are already
   shielded for grouped types because `parse::<TokenTree>()` is atomic; the actual bug
   is the `>` in `->` (and any joint `>`-punct) mis-decrementing `angle_depth`. Replace
   the "count `()`/`[]` depth" fix — which addresses a non-problem — with one that
   handles arrow tokens (e.g. detect `Punct('-')` joined to `>`, or fork and let
   `Type::parse` consume up to a top-level comma). Keep only `Fn(A,B) -> C` (and a bare
   `fn(A,B) -> C`) as the failing-case tests; demote the tuple/array cases to
   regression-guard tests explicitly labeled "already passing."
2. **Tie the scanner fix to an emittable type.** Cite a `bridge-core` API (or state none
   exists) that produces an arrow-bearing param type, so severity is honest and the
   round-trip test covers it.
3. **Drop or soften the "latent production bug" language** unless (2) finds a real
   trigger; otherwise frame it as defensive hardening.
4. Fix the `client/` reference (line 45) or remove it.
5. Optional: for objective 2, specify behavior when the version *token is absent* on a
   genuinely old hand-rolled descriptor — the plan says current emit always includes it,
   but the parser's tolerance contract (line 52) and the new hard version check should
   be reconciled explicitly (e.g. "absent ⇒ assume v1" vs "absent ⇒ error").
