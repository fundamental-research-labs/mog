# Known Formula Discrepancies

Documented cases where compute-core produces results that differ from Excel's cached values, along with root cause analysis and resolution status. These are **not bugs** — they are understood precision or behavioral differences between our IEEE 754 strict f64 engine and Excel's internal implementation.

---

## KFD-001: Catastrophic Cancellation in SUM of Large-Magnitude Values

**Status**: Accepted (inherent f64 limitation)
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

All summation algorithms — naive, Kahan compensated, and even exact summation of the f64 input values — produce the same error, because the intermediate sums themselves are not representable to sufficient precision in f64.

### Why Excel Gets a Different Answer

Excel almost certainly uses **80-bit extended precision** (x87 FPU) for intermediate SUM calculations on Windows. The x87 FPU has a 64-bit mantissa (~18.9 decimal digits) vs the 52-bit mantissa of SSE2 doubles. This provides enough intermediate precision to preserve the ~0.49 difference.

Our Rust code compiles to SSE2 instructions on x86-64, which use strict IEEE 754 64-bit arithmetic.

### Verification

Confirmed via Python simulation that all f64 summation methods produce identical results:

| Method | Result | Error vs Excel |
|--------|--------|----------------|
| Naive f64 | 0.4925038814544678 | -4.77e-7 |
| Kahan (return sum) | 0.4925038814544678 | -4.77e-7 |
| Kahan (return sum-c) | 0.4925038814544678 | -4.77e-7 |
| Decimal exact of f64 values | 0.4925039310000000 | -4.27e-7 |

The Kahan compensation values (`c1 = -6.4e-8`, `c2 = 4.5e-8`) are 17 orders of magnitude smaller than the ~10^9 sums, so applying them rounds back to the same f64.

### Possible Fixes (if ever needed)

| Approach | Precision | Performance | Complexity |
|----------|-----------|-------------|------------|
| **Double-double arithmetic** | ~31 decimal digits | ~2-3x slower for SUM | Medium (two f64 per value, no deps) |
| **f128 software emulation** | ~34 decimal digits | ~10x slower | Low (crate dependency) |
| **x87 80-bit mode** | ~18.9 decimal digits | Native speed | High (platform-specific, x86-only, requires inline asm) |
| **Increase comparison tolerance** | N/A | None | Trivial (but masks real bugs) |

### Decision

Accepted as-is. The mismatch only manifests when catastrophic cancellation eliminates ~9 orders of magnitude of precision. In the test corpus, this produces 1 mismatch out of 998 evaluated formulas (99.90% accuracy). Double-double arithmetic remains an option if more corpus files expose this pattern at scale.

---

## KFD-002: Balance Check Branch Flip from Accumulated Rounding

**Status**: Accepted (our engine is arguably more correct)
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

Both values agree to ~13 significant digits. The divergence is ~1 ULP at this magnitude (~10^6), well within IEEE 754 f64 noise.

- **Our engine**: Both paths converge to the same `f64` representation → `Y7 == X38` is `TRUE` → returns `"OK"`
- **Excel**: The two paths accumulate rounding differently (likely due to 80-bit extended precision intermediates) → `Y7 - X38 ≈ 9.3e-10` → returns the residual

### Why Our Result Is Defensible

Mathematically, `Balance_Sheet!Y7` and `Cash_Flow!X38` represent the same quantity computed two ways. The intended result of the balance check is `"OK"`. Excel's `9.3e-10` residual is a floating-point artifact — it does not represent a real financial discrepancy. Our engine happens to accumulate rounding symmetrically across the two paths, preserving the equality that the spreadsheet author intended.

### Why We Don't Fix This

1. The mismatch is in the **IF branch taken**, not in any arithmetic function
2. Both engines agree on all 7,366 other formulas in this file (99.99% accuracy)
3. "Fixing" this would mean deliberately introducing asymmetric rounding — making our engine worse to match an Excel artifact
4. No summation algorithm change would help; the divergence is spread across dozens of intermediate cells

### Decision

Accepted as-is. This is the inverse of a bug — our engine produces the mathematically expected result while Excel does not. Documented for transparency when evaluating corpus accuracy.
