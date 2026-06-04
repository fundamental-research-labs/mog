Rating: 8/10

# Review of 089 — `mog/compute/pyo3/src` (Python compute binding & packaging surface)

## Summary judgment

This is a strong, evidence-driven plan for a deceptively small target (one 117-line
`lib.rs`). The author read the real code: every line citation I spot-checked is
accurate. `lib.rs` does register only `ComputeEngine` + `pivot_detect_fields`
(`lib.rs:108-116`); the `generate!` block does emit 8 stateless families
(`lib.rs:93-102`); the Python layer does consume `_native` only via
`from mog._native import ComputeEngine` (`_bridge.py:20`) and
`getattr(_native, "pivot_detect_fields", None)` (`pivots.py:251`) with a
pure-Python fallback (`pivots.py:259`, `_fallback_detect_fields_from_values`
at `pivots.py:284`); and `free.rs` does name functions `<prefix>_<method>` while
emitting no registration helper (`emit_pure_function`, `free.rs:26-63`). The
diagnosis — a generated-vs-registered surface gap plus brittle hand-coupling of a
single `wrap_pyfunction!` literal to a macro-derived name — is correct and is the
right thing to fix.

The plan is well-staged, names its out-of-folder dependencies honestly, preserves
the real production contracts (JSON-string calling convention, class name, abi3
single-wheel), and explicitly rejects the cheap non-fix (more `getattr`
fallbacks). It loses a couple of points because the central deliverable — the
REGISTER/DROP partition of the 7 unregistered families — is deferred to a Stage 0
investigation rather than resolved, and because the highest-value claim ("dead
cdylib surface") may, on the evidence, resolve mostly to DROP, which would make the
headline objective smaller than framed.

## Major strengths

- **Accurate, line-anchored evidence.** The plan does not assert; it cites and the
  citations hold. This is the difference between a plan an implementer can trust
  and one they must re-derive.
- **Correct root-cause framing.** It identifies the actual fragility (hand-typed
  `pivot_detect_fields` literal coupled to `format_ident!`-derived name, no
  compile-time guarantee they match) rather than just "register the missing
  functions."
- **Bidirectional surface invariant.** Objective 1 ("exports exactly equal the
  intended set — in both directions") is the right contract: it catches both dead
  symbols and missing ones, and the Stage-3 parity gate enforces it against
  `api_dispositions.json` rather than against tests-that-happen-to-touch-it.
- **Honest dependency accounting.** The macro change living in `bridge-pyo3` is
  flagged as a hard dependency with an explicit interim fallback (declarative
  `wrap_pyfunction!` list still gated by the parity test). Non-goals (GIL release,
  submodule namespacing, JSON-convention changes) are correctly fenced off.
- **Preserves real contracts.** `compute_api` re-export (`lib.rs:10`), the
  JSON-in/JSON-out convention (`_bridge.py:52-90`), abi3-py39 single wheel, and
  "no logic in this crate" are all called out as must-preserve.

## Major gaps or risks

- **The central decision is deferred, not made.** Stage 0 partitions the 7
  families into REGISTER/DROP, but the plan does not perform it — it only says how
  to. For 7 of 8 families the plan cannot state the end-state surface. That is
  defensible for a plan (the disposition manifest is the oracle), but it means the
  spec's core output is "investigate," and the size/value of the headline fix is
  unknown until then. A brief pass over `api_dispositions.json` for, say, the chart
  and format families would have de-risked the whole plan and is exactly the kind
  of read-only check the plan otherwise excels at.
- **The "dead surface" framing may overstate the payoff.** Today everything routes
  through `ComputeEngine` instance methods (e.g. import via
  `compute_import_from_xlsx_bytes`, `workbook.py:151`). It is plausible the
  intended answer for most of the 7 families is DROP — i.e. they were never meant
  to be a stateless Python surface. If so, the "register the missing surface"
  objective shrinks to "stop generating dead code," which is real but smaller than
  the prose implies. The plan hedges toward "prefer REGISTER if unsure," which
  risks adding exports nothing consumes (the parity gate would then force a
  disposition to be invented). Leaning DROP-by-default for unconsumed families
  would be the more conservative production stance.
- **`free.rs` naming detail slightly misquoted.** The plan says the name is
  `format_ident!("{}_{}", fn_prefix, method)` (`free.rs:32-36`). The actual code
  uses `type_snake`/`effective_prefix` and has an empty-prefix branch
  (`free.rs:31-37`). Immaterial to the argument, but the precision elsewhere sets
  an expectation this one misses.
- **Stage 1 macro design is under-specified.** "Emit a `register_<TypeSnake>`
  helper or a slice of wrap-able items" is two materially different macro contracts
  (a registration fn vs. a const inventory). Since this is the durable fix and a
  cross-crate edit, the plan should pick one shape and state why, so the
  `bridge-pyo3` owner isn't designing blind.
- **Version-skew objective is thin.** `__native_version__` + an `__init__` assert
  is sensible, but the failure mode it guards (stale `.so` vs. package version) is
  not shown to actually occur in this tree; it reads as a nice-to-have bundled into
  a surface-correctness plan. Low risk, but it widens scope.

## Contract and verification assessment

Contract clarity is high. The plan correctly fixes the immovable contracts
(`ComputeEngine` name + JSON convention, `pivot_detect_fields` name + JSON shape,
abi3, `compute_api` re-export) and proposes *strengthening* the weakest one — the
`getattr(..., None)` fallback — into a guaranteed export, which is the right
direction.

Verification gates are the plan's strongest section and are concrete: a new
native-export parity gate wired into `pnpm check:python-sdk`
(`README.md:11-14`), a presence assertion replacing the silent fallback, per-family
round-trip smokes, the version check, and explicit reuse of existing gates
(`verify_surface --strict`, `audit_stubs --strict`,
`generate_python_surface.py --check`, the contract/security tests). The gates map
cleanly onto the objectives (parity gate → obj 1/3; presence test → obj 2; version
check → obj 5). The edge cases (name collisions must hard-error not shadow; abi3
floor for new registration APIs) are real and well-chosen.

One gap: the parity gate is specified to compare `_native` exports against "the
Stage-0 intended set derived from `api_dispositions.json`," but the mechanical
mapping from a disposition entry to an *expected native free-function symbol* is
not defined. Without that mapping rule the gate is a stub. This is the one place
the verification story is asserted rather than specified.

## Concrete changes that would raise the rating

1. **Resolve Stage 0 in the plan, at least partially.** Read
   `api_dispositions.json` and the `sub_apis/*` call sites for the 7 families and
   publish the REGISTER/DROP partition (even if provisional). This converts the
   plan's core deliverable from "investigate" to "do," and right-sizes the
   headline claim. (→ would move toward 9.)
2. **Default unconsumed families to DROP, not REGISTER.** State that an
   exported-but-unconsumed symbol is a contract liability (the gate then demands an
   invented disposition), so the conservative production stance is to stop
   generating what nothing consumes and add per-method `skip_targets "pyo3"` at the
   descriptor layer.
3. **Pin the macro contract.** Choose either a generated
   `register_<TypeSnake>(m)` fn or a generated inventory slice, and justify the
   choice against abi3 and duplicate-name detection, so `bridge-pyo3` can be edited
   without a second design round.
4. **Specify the disposition→native-symbol mapping rule** that the parity gate
   relies on, so the gate is implementable as written rather than a placeholder.
5. **Fix the `free.rs` naming citation** (`type_snake`/`effective_prefix`, empty
   prefix branch) to match the maintained precision of the rest of the evidence.
6. **Either justify or split out the version-metadata objective.** If there is no
   observed skew failure, mark it explicitly secondary so it does not dilute the
   surface-correctness focus.
