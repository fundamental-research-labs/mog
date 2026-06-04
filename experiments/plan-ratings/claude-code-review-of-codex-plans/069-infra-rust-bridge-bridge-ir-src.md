Rating: 8/10

# Review of Plan 069: Rust Bridge IR Contract Hardening


## Summary judgment

This is a strong, unusually well-grounded plan. Every factual claim it makes about
the current state of `bridge-ir/src` is verifiable in the source, and the diagnosis
is correct rather than generic. It correctly identifies the central architectural
problem — `bridge-ir` is *intended* to be the single descriptor contract but is not
yet, because pyo3/wasm/tauri/delegate macro crates still carry their own local
parsers — and proposes a sound, incremental path to make it real. The plan's main
weaknesses are scope sprawl well beyond the nominal source folder and a handful of
deferred "decide whether X" branches that leave the plan less prescriptive than it
could be. It is implementable as written by a coordinated set of workers, which is
why it lands at 8 rather than higher.

## Verification against the actual code

I confirmed the plan's "observed contract gaps" against the tree:

- **`Unknown` fallback** — real. `parse.rs:116-117` does
  `type_name.unwrap_or_else(|| Ident::new("Unknown", ...))`, with the exact
  "preserving for pre-existing snapshots" comment the plan describes.
- **Versions read but not rejected** — real. `parse.rs:33` binds `_version` and
  drops it; `param_struct.rs:80` does the same. No range check exists.
- **Tagged-enum losslessness mismatch** — real. `bridge-core/src/descriptor.rs:92-98`
  has `VariantField { ... ty: String }`, while `bridge-ir/src/ir.rs:140-149`
  `VariantField` carries only `rust_name`, `wire_name`, `tag: Box<ParamTag>` — the
  field type string is genuinely dropped, and `parse.rs:402-433` never reads one.
  So the doc comments claiming "round-trips losslessly" (parse.rs:14-15,
  ir.rs:123-124) are indeed overstated.
- **Param-struct vs general taxonomy** — real. `param_struct.rs:121-136` accepts
  `str/prim/bytes/serde/parse` only; the general `ParamTag` (ir.rs:113-120) adds
  `TaggedEnum`. The asymmetry is exactly as described.
- **Shared naming only partly centralized** — real. `classify::to_snake_case`
  exists; the four non-napi macro crates each have their own
  `macros/src/expand/parse.rs` (and delegate additionally `descriptor.rs`),
  confirming duplicate parsing the plan wants to remove.
- **`extra-traits` is enabled** (`bridge-ir/Cargo.toml:11`), so objective 4's
  "derive `PartialEq`/`Eq` where syn permits" is feasible as stated.

Package names in the verification gates are correct: the macro crates really are
named `bridge-napi-macros`, `bridge-pyo3-macros`, `bridge-wasm-macros`,
`bridge-tauri-macros`, `bridge-delegate-macros` (under each parent's `macros/`
dir), and only `bridge-napi-macros` currently depends on `bridge-ir`. This level
of accuracy is the plan's biggest asset — it is not hallucinating structure.

## Major strengths

- **Correct, evidence-based problem statement.** The "current role" and "observed
  gaps" sections read like they were written from the code, not from a template.
- **Clear separation of contract from policy.** The invariants section nails the
  load-bearing distinction: `bridge-ir` stays target-neutral; access-kind
  *collapse* (`Structural`→write-like, `Session`→read-like) is explicitly a
  per-target adapter concern, never done in shared IR. This matches the existing
  ir.rs:59-74 doc comment and is the right line to hold.
- **Verification gates are concrete and well-layered.** It enumerates per-crate
  `cargo test`/`clippy`, orders bridge package tests before compute-binding tests
  (so descriptor failures surface at the macro layer), and lists specific
  contract tests to add (version rejection, source-identity rejection, emit→parse
  round-trip, cross-target snapshots, access-kind lowering, param-struct blockers).
- **Honest non-goals.** Explicitly refuses to fold target preambles into
  `ApiDescriptor`, refuses to move bridge-core's Rust-source parser into
  `bridge-ir`, and refuses to collapse `Structural`/`Session` in shared IR. These
  are precisely the mistakes a less careful plan would make.
- **Realistic parallelization model** with a stated dependency ordering
  (bridge-core emission lands before mandatory parser changes; target migrations
  wait on stable helper methods).

## Major gaps or risks

- **Scope sprawl vs. the nominal folder.** The item is "bridge-ir/src," but the
  plan's real surface area is bridge-core, bridge-derive, and four target macro
  crates. That is defensible (the contract genuinely spans them) but the plan never
  acknowledges the size delta or proposes a minimal first slice that delivers value
  inside `bridge-ir` alone. A reader could reasonably ask: what is the smallest
  shippable increment? The version-enforcement + source-identity + losslessness-doc
  fixes are self-contained in `bridge-ir`; the migration of four macro crates is a
  much larger, riskier follow-on. The plan would be stronger if it explicitly
  staged "harden in place" before "consolidate consumers."
- **Several decisions are deferred rather than made.** Objective 3 ("decide whether
  variant field Rust type strings are codegen-relevant"), objective 4 (centralize
  return-shape inspection "if all target crates need the same..."), and step 2's
  "keep `group` optional only if a real production caller still emits without it"
  all punt the actual decision into implementation. For a hardening plan these are
  answerable now with a short audit, and leaving them open weakens prescriptiveness
  and invites divergent worker choices. Notably, `parse.rs:36-37` already comments
  "always present today" for `group` — the audit is nearly done; the plan should
  just commit to making it mandatory (or not) and say why.
- **Removing the `Unknown` fallback is a cross-cutting breaking change** whose blast
  radius is asserted ("audit handwritten tests and fixtures") but not measured. The
  plan should require enumerating the actual fixtures/snapshots that rely on the
  fallback before flipping it, and gate the change on that inventory, so workers
  don't discover the breakage mid-migration.
- **Delegate re-emission is flagged as risky but under-specified.** The plan
  correctly notes delegate strips/preserves security facts and re-emits descriptors
  (`bridge-delegate/macros/src/expand/descriptor.rs` confirms a local descriptor
  path). But "verify with existing gated delegate tests" is the only mitigation;
  round-tripping IR *out* through delegate's re-emitter is the subtlest part and
  deserves its own explicit round-trip test in the corpus.
- **No coverage baseline.** The plan asserts "no golden corpus" (true — only
  `bridge-ir/tests/{parse.rs,param_struct.rs}` exist) but doesn't state what those
  existing tests already cover, so the incremental corpus work is unscoped.
- **Crates omitted without comment.** `bridge-describe`, `bridge-ts`, and
  `bridge-types` exist in the workspace; the plan doesn't say whether any consume
  descriptors. Probably none do, but a one-line "these do not parse descriptors"
  would close the loop and prevent a missed consumer.

## Contract and verification assessment

The contract section is the best part of the plan. It states a single canonical
versioned grammar, one mandatory source identity per descriptor, an explicit list
of first-class facts, and the target-neutral-vs-target-specific boundary — all
consistent with the code. The verification plan is genuinely strong: it pairs each
structural change with a named test (version rejection, missing-source rejection,
emit→parse round-trip, per-target adapter snapshots, access-kind lowering for all
seven access shapes, param-struct Mode-B blockers, extras ordering). The ordering
discipline (macro-layer tests before compute-binding tests) is correct and will
localize failures.

Two contract-clarity gaps remain: (1) the losslessness claim needs to be resolved
to a *single* documented truth (either preserve `VariantField.ty` end-to-end with
round-trip tests, or delete the "lossless" comments and test the explicitly-preserved
subset) — the plan offers both branches but doesn't pick; (2) the param-struct
TaggedEnum question (can `bridge-derive` even emit one?) is answerable by reading
`bridge-derive/src/param_struct.rs` now, and the answer determines whether step 6
adds a parser branch or a negative test. Deciding these before execution would turn
several conditional steps into deterministic ones.

## Concrete changes that would raise the rating

1. **Stage the work explicitly.** Define Phase 1 = self-contained `bridge-ir`
   hardening (version enforcement, mandatory source identity, losslessness doc/test
   fix, IR derives + helper methods, diagnostics) with its own green gate, and
   Phase 2 = consumer consolidation (migrate the four macro crates). This makes the
   plan shippable in slices and de-risks the large migration.
2. **Resolve the deferred decisions up front** by doing the small audits the plan
   already implies: is `group` ever emitted absent? Does `bridge-derive` emit
   tagged-enum param-struct fields? Are `VariantField.ty` strings used by any target
   codegen? Each is a quick `rg`, and each answer collapses an if/else branch into a
   concrete step.
3. **Require a fixture inventory before removing the `Unknown` fallback** — list the
   exact tests/snapshots depending on it and update-or-justify each, as a gating
   checklist item rather than a prose aside.
4. **Add an explicit delegate re-emission round-trip test** to the corpus
   (descriptor → IR → delegate re-emit → IR), since that path is both the riskiest
   and the one most likely to silently drop a security fact.
5. **State the existing-test baseline and the omitted crates** (`bridge-describe`,
   `bridge-ts`, `bridge-types`) so corpus scope and consumer coverage are bounded.
6. **Pin the losslessness contract to one answer** and update ir.rs/parse.rs doc
   comments accordingly, so the "lossless" language and the actual behavior can
   never drift again.
