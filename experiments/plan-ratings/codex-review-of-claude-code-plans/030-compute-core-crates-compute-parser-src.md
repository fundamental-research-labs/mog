Rating: 8/10

Summary judgment

This is a strong, evidence-based production-path plan for `compute-parser`. The core findings match the current source: `parse_formula` returns error spans ending at `input.len()`, error positions are computed differently from success spans, `last_error_kind` mixes first-write and direct overwrite behavior, structured-ref parse errors are discarded by `try_parse_structured_ref`, the UTF-16 reference scanner contains user-input-reachable `expect` assumptions, and `identity_transform` uses `SheetId::from_raw(0)` as a current-sheet sentinel.

The plan is not just a grab bag of parser polish. It connects diagnostics, span coordinate contracts, reference bounds, structured-reference invariants, editor tokenization, and identity formula conversion into one coherent reliability push. The sequencing is mostly sensible, especially isolating the `CellRef::Positional.sheet` representation change last.

I would not rate it higher because several implementation contracts are still too loose for the blast radius. The span-coordinate change conflicts with existing `ParseError` docs that say error spans are in the original input, the proposed error channel needs a precise typed diagnostic/ranking model rather than a vague `set_specific`, and the `Option<SheetId>` change reaches far beyond this folder into serialized `formula-types`, scheduler/eval/storage code, and many existing `SheetId(0)` sentinel sites. Those are solvable, but the plan should pin them down before implementation starts.

Major strengths

- The plan correctly targets production APIs and runtime paths: `parse_formula`, AST spans, structured refs, `IdentityFormula`, reference token scanning, and downstream compute consumers.
- It is grounded in source evidence, including the unused or display-only `ParseErrorKind` variants, `references.rs` comments about backtracking for bounds, and the sentinel TODO in `identity_transform/refs.rs`.
- It treats parser control flow carefully. The "commit vs backtrack" warning for out-of-bounds refs is exactly the right risk, because overusing `cut()` would reject formulas that currently parse as identifiers or other alpha-starting expressions.
- It preserves important non-functional constraints: no new dependencies, no `unsafe`, stack-depth discipline, lexer fast paths, and UTF-16 editor offsets.
- It recognizes that structured references have two relevant surfaces: the standalone parser used by table code and the main formula grammar path. Surfacing committed structured-ref diagnostics is production-relevant.
- The verification section covers the right styles of tests: regression cases, property tests, round-trip/display tests, identity-transform tests, and consumer compilation.
- The highest-risk cross-crate change is sequenced last and identified as a standalone PR candidate, rather than being buried in parser diagnostics work.

Major gaps or risks

- The span contract is not fully resolved. `parse_formula` success docs say spans are relative to the formula body after `=`, but `ParseError` currently documents spans as byte ranges in the original input. The plan chooses body-relative errors but should explicitly update or preserve that public contract and name all consumers that expect original-input coordinates.
- The proposed error channel is under-specified. "Specific beats generic" and "set-once-at-cut" need a concrete model, such as a `ParseDiagnostic { kind, span, precedence }`, a precedence table, and rules for nested errors, missing delimiters, trailing input, and depth failures.
- The final `ParseErrorKind` taxonomy remains ambiguous. "Either wire these variants or remove them" is a good objective, but implementation needs a target produced-set before edits. In particular, `UnknownSheetName` is risky because unresolved sheet names currently produce unresolved references rather than parse errors; changing that would alter the accepted language.
- Step 6 is bigger than the folder scope suggests. `CellRef` derives `Serialize`/`Deserialize`, many compute-core modules construct or match `CellRef::Positional { sheet, row, col }`, and multiple code paths already special-case `SheetId::from_raw(0)`. The plan should include a full inventory and storage/wire compatibility stance, not only "formula-types plus compute-cf/compute-table/compute/core compile."
- The structured-ref property test wording is imprecise because `try_parse_structured_ref` delegates to `parse_structured_ref` after bracket matching. The meaningful contract is probably formula-grammar path vs direct parser, plus normalization/display agreement, not two independent parsers agreeing internally.
- The UTF-16 scanner fallback needs a sharper invariant. Replacing `expect` with a "total fallback" is good for panic-freedom, but the plan should define whether invalid byte offsets are clamped, skipped, debug-asserted, or treated as a scanner bug while preserving deterministic output.
- The benchmark gate is directionally useful, but the plan does not specify a threshold or when criterion output is release-blocking. Most steps are error-path-only; the success-path-sensitive pieces should be identified explicitly.

Contract and verification assessment

The contract section is above average. It names totality over UTF-8 input, `ParsedExpr::classify` behavior, reference bounds, depth limits, `ParseErrorKind` observability, resolver semantics, lexer fast paths, and the no-unsafe/no-new-dependency constraints. Those are the right contracts for this folder.

Verification is broad but needs exact gates. For a Rust parser change, the plan should require exact commands such as `cargo test -p compute-parser` and `cargo clippy -p compute-parser`. If Step 6 changes `formula-types`, the gate should expand to `cargo test -p formula-types`, `cargo test -p compute-core`, relevant `compute-cf`/`compute-table` tests, and clippy for every touched crate. If wasm/TS surfaces consume spans or reference tokens, the plan should name the relevant bridge or TypeScript gates instead of relying on generic "consumer compile."

The plan correctly says the reviewer should not run cargo under the experiment constraints. That is fine. The implementer-facing verification list just needs to become command-level and tied to each phase, especially because the last phase changes a serialized public type.

Concrete changes that would raise the rating

- Split the work into two explicit deliverables: parser diagnostics/span/structured-ref/token hardening, then the cross-crate `CellRef::Positional.sheet: Option<SheetId>` data-model change.
- Add a concrete diagnostic-channel design with fields, precedence ranking, span coordinate rules, and examples for `=1+`, unmatched delimiters, malformed structured refs, trailing input, and max-depth errors.
- Resolve the `ParseError` coordinate contract explicitly: either body-relative for both Ok and Err with docs updated everywhere, or original-input-relative errors with a clear translation layer for editor consumers.
- Define the final `ParseErrorKind` produced set before implementation, including an explicit decision for `UnknownSheetName`, `ExpectedClosingParen`, `ExpectedClosingBracket`, `MalformedNumber`, `MalformedArrayLiteral`, and `InvalidReference`.
- Add a full blast-radius inventory for `SheetId::from_raw(0)` and `CellRef::Positional` across parser, formula-types, compute-core scheduler/eval/storage/import/export, bridge code, tests, and serde snapshots.
- Tighten structured-ref verification to compare direct `parse_structured_ref`, formula parsing of `=Table[...]`, normalization paths, and display/round-trip output on the same generated corpus.
- Replace generic verification prose with exact command lines and phase-specific gates, including the required `cargo test -p ...` and `cargo clippy -p ...` commands for every crate touched.
