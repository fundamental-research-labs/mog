# Known Formula Discrepancies

This page records accepted formula-result differences between Mog's current
precision policy and Excel cached values. These are not open correctness bugs in
the shipped default precision profile; they are known differences with explicit
implementation reasons.

Public status notes:

- The default precision profile is shipped through the current public SDK and
  runtime surfaces.
- `compute-core` and `value-types` are workspace-internal Rust crates
  (`publish = false`) that implement the shipped runtime behavior.
- `dd-precision` is implemented in public source as an opt-in compile feature,
  but it is not part of the default build profile.
- The real-workbook corpus observations behind these cases are
  workspace-internal. This public page intentionally omits workbook IDs, sheet
  names, cell addresses, and private cached values that are not reproducible
  from the public checkout.

The standard evaluator stores numeric cell values as finite `f64` values, uses
compensated aggregation where implemented, and applies a 15-significant-digit
model for numeric comparisons and direct subtraction cancellation. The
double-double arithmetic types (`F64x2`, `DdSum`) are always present in
`value-types`; engine propagation through arithmetic and `SUM` is gated by the
`dd-precision` feature.

---

## KFD-001: Cancellation After SUM of Large Values

**Status**: Accepted for the shipped default precision profile
**Observation status**: workspace-internal corpus observation; no public XLSX
fixture is committed
**Impact**: Rare - requires two large aggregates that nearly cancel to a small
result

### Signature

| Field | Public description |
|-------|--------------------|
| Formula shape | `=SUM(range_a)-SUM(range_b)` |
| Operand scale | Each `SUM` is large, commonly around `1e9` in the observed case |
| Result scale | The final difference is small, commonly around `1e0` in the observed case |
| Default engine behavior | Each aggregate is materialized as a finite `f64` numeric cell value before the subtraction |
| Public fixture | Not shipped |

### Root Cause

This is a cancellation-sensitive formula:

```text
SUM(range_a) = large f64 aggregate
SUM(range_b) = nearby large f64 aggregate
difference   = small residual
```

At magnitude `~1e9`, a binary `f64` has spacing on the order of `1e-7`. The
small residual depends on low-order bits of the two large intermediate totals.
Mog's default `SUM` implementation uses Kahan compensated summation, not naive
addition, but the default aggregate result is still emitted as one finite `f64`.
Once both aggregate totals have been materialized, the later subtraction cannot
recover low-order information that was not carried forward.

### Why Excel Can Differ

The exact Excel calculation path for the private corpus workbook is outside this
repository. The observed cached value is consistent with Excel carrying a
different intermediate precision or rounding path across the aggregate and
subtraction boundary than Mog's default profile carries.

### Codebase Evidence

- `compute/core/src/eval/engine/aggregate.rs`: default `agg_sum` uses
  `value_types::KahanSum`; with `dd-precision`, it uses `value_types::DdSum` and
  returns `CellValue::number_dd`.
- `compute/core/src/eval/engine/operators.rs`: default arithmetic emits
  single-`f64` numeric results; with `dd-precision`, arithmetic propagates
  `F64x2` high/low terms.
- `compute/core/Cargo.toml`: default features include `native`; `dd-precision`
  is opt-in.
- `compute/core/crates/types/value-types/src/lib.rs`: `F64x2` and `DdSum` are
  public in the crate even when the engine does not enable the feature.
- `compute/core/crates/types/value-types/Cargo.toml`: `dd-precision` adds the
  `FiniteF64` low error term for intermediate arithmetic.

### Mitigations

| Approach | Current status | Notes |
|----------|----------------|-------|
| Kahan aggregation | shipped default behavior | Reduces aggregation error before the result is materialized as `f64`. |
| 15-digit comparison/subtraction cancellation | shipped default behavior | Handles equality checks and direct near-zero subtraction between two operands, but does not reconstruct low-order bits already lost by materialized aggregate totals. |
| Double-double engine lane | not shipped by default | Available as the `dd-precision` compile feature for engine arithmetic and `SUM`; useful for investigation or custom builds that prioritize cancellation parity. |
| Broader result tolerances | not preferred | Would hide numeric regressions without changing the underlying precision policy. |

### Decision

Keep the default behavior. The current profile is finite-`f64` plus targeted
compensation and Excel-style 15-digit comparison semantics. Workloads that need
tighter parity for cancellation-heavy arithmetic should be evaluated with the
opt-in `dd-precision` lane or a dedicated public repro fixture before changing
the shipped default profile.

---

## KFD-002: Balance-Check Branch Flip from Low-Order Drift

**Status**: Accepted under the shipped 15-significant-digit comparison model
**Observation status**: workspace-internal corpus observation; no public XLSX
fixture is committed
**Impact**: Rare - requires an equality branch over totals computed through
independent arithmetic chains

### Signature

| Field | Public description |
|-------|--------------------|
| Formula shape | `=IF(total_a=total_b,"OK",total_a-total_b)` |
| Predicate operands | Two independently computed totals that agree at the 15-significant-digit comparison scale |
| Default engine behavior | The comparison evaluates equal and `IF` returns the true branch |
| Observed Excel cache shape | A private corpus workbook cached the residual numeric branch instead |
| Public fixture | Not shipped |

### Root Cause

The formula is a balance check. Two totals represent the same business quantity
but arrive through independent dependency chains. At the observed scale, their
low-order difference is below the precision model used by Mog comparisons.

Mog's comparison path snaps numeric operands to the 15-significant-digit model
before ordering or equality checks. Therefore:

```text
total_a == total_b  -> TRUE
IF(TRUE, "OK", residual) -> "OK"
```

This is a branch-selection difference, not a `SUM` implementation difference.
Once the predicate is true, `IF` evaluates and returns only the selected branch.

### Codebase Evidence

- `compute/core/src/eval/engine/operators.rs`: numeric comparisons call
  `cmp_15_significant_digits`.
- `compute/core/crates/types/value-types/src/precision.rs`:
  `cmp_15_significant_digits` snaps both operands before comparing, and
  `subtraction_cancels_at_15_digits` handles direct near-zero subtraction under
  the same precision policy.
- `compute/core/src/eval/engine/logical_primitives.rs`: scalar `IF` evaluates
  the condition, coerces it to boolean, and evaluates only the selected branch.

### Why We Do Not Change This

Changing this case to match a cached residual would require weakening or
bypassing the 15-significant-digit comparison model for equality predicates. That
would affect balance checks broadly and could reintroduce low-order drift as
user-visible branch changes. The current result follows the implemented
precision policy consistently.

### Decision

Keep the default behavior and document the discrepancy. If a public fixture is
added later, it should make clear whether the intended compatibility target is
Excel's cached branch for that workbook or Mog's current 15-digit comparison
semantics.
