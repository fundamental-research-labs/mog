# Known Formula Discrepancies

Documented cases where compute-core produces results that differ from Excel's cached values, along with root cause analysis and resolution status. These are **not bugs** — they are understood precision or behavioral differences between Mog's standard precision profile and Excel's internal implementation.

The standard evaluator stores numeric cell values as finite `f64` values, uses compensated aggregation for functions such as `SUM`, and applies an Excel-compatible 15-significant-digit model for numeric comparisons and direct subtraction cancellation. Double-double arithmetic is implemented behind the opt-in `dd-precision` feature; it is not part of the default build profile.

---

## KFD-001: Catastrophic Cancellation in SUM of Large-Magnitude Values

**Status**: Accepted for the default precision profile
**Impact**: Rare — requires two large sums (~10^9) that nearly cancel to a small difference (~10^0)

### Example

| Field | Value |
|-------|-------|
| File | `c05Z52WSEaRrkn2CRnYPkvZGcKSQaGbR/latest.xlsx` |
| Cell | `BS Mapping!M50` |
| Formula | `=SUM(M3:M33)-SUM(M34:M49)` |
| Computed | `0.4925038814544678` |
| Expected | `0.492504358291626` |
| Error | `~3.6e-7` absolute, `~7.3e-7` relative |

### Root Cause

The formula subtracts two sums that are nearly equal:

```
SUM(M3:M33) ≈ 1,246,420,004.05
SUM(M34:M49) ≈ 1,246,420,003.56
Difference   ≈ 0.49
```

IEEE 754 f64 has a 52-bit mantissa (~15.9 decimal digits). At magnitude ~10^9, the representable precision is ~2.2e-7 (1 ULP). The ~0.49 difference lives in the low-order bits that f64 cannot fully represent at this scale. You need ~19 significant digits to preserve the difference accurately, but f64 only provides ~16.

The default `SUM` implementation uses Kahan compensated summation, not naive addition. For this case, compensation alone does not remove the mismatch because the two aggregate results are still materialized as single `f64` values before the cancellation-sensitive subtraction.

### Why Excel Gets a Different Answer

The exact Excel calculation path is outside this repository. The historical cached value is consistent with Excel carrying more intermediate precision through the aggregate/subtraction path than Mog's default precision profile carries.

Mog has an opt-in `F64x2`/`DdSum` double-double path behind `dd-precision` for this class of cancellation-heavy arithmetic, but standard builds leave that feature off.

### Codebase Evidence

- `compute/core/src/eval/engine/aggregate.rs`: default `agg_sum` uses `value_types::KahanSum`; `DdSum` is selected only with `dd-precision`.
- `compute/core/src/eval/engine/operators.rs`: default arithmetic emits single-`f64` numeric results; the double-double operator path is gated by `dd-precision`.
- `compute/core/Cargo.toml`: default features include `native`, while `dd-precision` is opt-in.

### Mitigations

| Approach | Current status | Notes |
|----------|----------------|-------|
| **Double-double arithmetic** | Available behind `dd-precision` | Carries `hi`/`lo` terms through arithmetic and `SUM`, but is not the default profile. |
| **15-digit comparison/subtraction handling** | Enabled in standard builds | Helps balance-check comparisons and direct near-zero subtraction, but does not recover low-order bits lost by materialized `f64` aggregates. |
| **Broader tolerances** | Not preferred | Would mask real numeric regressions instead of addressing the precision profile. |

### Decision

Accepted as-is for the standard precision profile. The mismatch only manifests when catastrophic cancellation eliminates ~9 orders of magnitude of precision. Use the opt-in double-double path to investigate or support workloads that require tighter parity for cancellation-heavy arithmetic.

---

## KFD-002: Balance Check Branch Flip from Accumulated Rounding

**Status**: Accepted (handled by 15-digit comparison semantics)
**Impact**: Rare — requires an equality check on two values computed via independent long arithmetic chains

### Example

| Field | Value |
|-------|-------|
| File | `RZwXzojfKAJnnKDHnsG8Dkq6HPQCTmlP/latest.xlsx` |
| Cell | `Cash_Flow!X78` |
| Formula | `=IF(Balance_Sheet!Y7=X38,"OK",Balance_Sheet!Y7-X38)` |
| Computed | `"OK"` (string) |
| Expected | `0.0000000009313225746154785` (number) |
| Category | `wrong_type` — string vs number |

### Root Cause

The formula is a **balance check** that verifies total assets equal total liabilities + equity. The two operands are computed via independent paths through a financial model:

| Cell | Our engine | Excel cached |
|------|-----------|-------------|
| `Balance_Sheet!Y7` | `2551956.848113` | `2551956.848112736` |
| `Cash_Flow!X38` | `2551956.848113` | `2551956.848112735` |

Both values agree to ~13 significant digits. The divergence is ~1 ULP at this magnitude (~10^6), well within ordinary floating-point noise for long arithmetic chains.

- **Our engine**: Numeric comparisons use the 15-significant-digit precision model, so `Y7 == X38` is `TRUE` → returns `"OK"`
- **Excel cached value**: The two paths retain a tiny residual → `Y7 - X38 ≈ 9.3e-10` → returns the residual

### Codebase Evidence

- `compute/core/src/eval/engine/operators.rs`: number comparisons call `cmp_15_significant_digits`.
- `compute/core/crates/types/value-types/src/precision.rs`: `cmp_15_significant_digits` snaps both operands before comparing.
- `compute/core/src/eval/engine/logical_primitives.rs`: `IF` evaluates the condition, coerces it to boolean, and returns only the selected branch.

### Why Our Result Is Defensible

Mathematically, `Balance_Sheet!Y7` and `Cash_Flow!X38` represent the same quantity computed two ways. The intended result of the balance check is `"OK"`. Excel's `9.3e-10` residual is a floating-point artifact — it does not represent a real financial discrepancy. Mog's comparison model deliberately treats this scale of low-order drift as equal.

### Why We Don't Fix This

1. The mismatch is in the **IF branch taken**, not in any arithmetic function
2. "Fixing" this would mean weakening the 15-significant-digit comparison model to match an Excel residual
3. No targeted summation change would be appropriate; the branch depends on equality semantics between independently computed totals

### Decision

Accepted as-is. This is the inverse of a bug — our engine produces the mathematically expected result while Excel does not. Documented for transparency when evaluating corpus accuracy.
