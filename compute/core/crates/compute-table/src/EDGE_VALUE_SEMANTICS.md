# Table Engine: Edge Value Semantics

> **AUTHORITATIVE REFERENCE** -- All table engine modules (`sort.rs`, `compare.rs`,
> `filter.rs`, `filter_resolve.rs`, `slicer_cache.rs`, `filter_dropdown.rs`,
> `visibility.rs`) MUST conform to this specification. When in doubt, this document wins.

## Type Ranking (cross-type comparison order)

| Rank | Type    | Notes                                    |
|------|---------|------------------------------------------|
| 0    | Number  | Includes NaN and Infinity                |
| 1    | Text    | Case-insensitive comparison              |
| 2    | Boolean | FALSE < TRUE                             |
| 3    | Error   | Fixed sub-ordering (see Error section)   |
| 4    | Blank   | Null, Array, Lambda all rank here        |

## Quick Reference Table

| Value         | Sort              | Filter (positive) | Filter (negative) | TopBottom     | Average       | Equality      | Slicer          |
|---------------|-------------------|--------------------|--------------------|---------------|---------------|---------------|-----------------|
| **NaN**       | Always last       | false              | true               | Excluded      | Excluded      | NaN == NaN    | Deduped, last   |
| **+Infinity** | By numeric value  | Normal compare     | Normal compare     | Excluded      | Excluded      | +Inf == +Inf  | Normal          |
| **-Infinity** | By numeric value  | Normal compare     | Normal compare     | Excluded      | Excluded      | -Inf == -Inf  | Normal          |
| **Error**     | After booleans    | false              | true               | Excluded      | Excluded      | Same variant  | Deduped by type |
| **Null/Blank**| Always last       | false              | true               | Excluded      | Excluded      | Null == Null  | Deduped, last   |
| **Array**     | Always last       | Treated as blank   | Treated as blank   | Excluded      | Excluded      | N/A           | Key: `__BLANK__`|
| **Lambda**    | Always last       | Treated as blank   | Treated as blank   | Excluded      | Excluded      | N/A           | Key: `__BLANK__`|

## NaN

- **Sort**: Treated as blank for ordering purposes -- always last regardless of
  ascending/descending direction. This is enforced by `is_sort_blank()` in `sort.rs`.
- **Filter (value)**: Matches via canonical key `"__NUM__:NaN"`. NaN in the included
  list matches NaN in data.
- **Filter (condition)**: Fails all positive numeric operators (Equals, GreaterThan,
  LessThan, Between, etc.). Passes negative operators (NotEquals, NotBetween,
  IsNotBlank). String operators (Contains, BeginsWith, etc.) fall through and match
  against the string `"NaN"`.
- **Filter (TopBottom)**: Excluded -- `n.is_finite()` check rejects NaN.
- **Filter (Average)**: Excluded from computation -- `n.is_finite()` check rejects NaN.
- **Equality**: NaN == NaN is true (for dedup, slicer selection, value filters, custom
  sort order matching). Implemented in `cell_values_equal()`.
- **Slicer**: Deduplicated via key `"__NUM__:NaN"`. Sorts last within numbers,
  regardless of ascending/descending direction (explicit NaN check in `sort_cache_items`).

## Infinity (+/-)

- **Sort**: Treated as a normal number, sorts by numeric value. -Inf < all finite < +Inf.
- **Filter (condition)**: Compared normally via `compare_values()`. +Inf > any finite
  number; -Inf < any finite number.
- **Filter (TopBottom)**: Excluded -- `n.is_finite()` rejects both +Inf and -Inf.
- **Filter (Average)**: Excluded from average computation -- `n.is_finite()` rejects both.
- **Equality**: +Inf == +Inf, -Inf == -Inf, +Inf != -Inf.

## Error Values

Error sub-ordering (fixed, not alphabetical):

| Rank | Error         |
|------|---------------|
| 0    | #NULL!        |
| 1    | #DIV/0!       |
| 2    | #VALUE!       |
| 3    | #REF!         |
| 4    | #NAME?        |
| 5    | #NUM!         |
| 6    | #N/A          |
| 7    | #GETTING_DATA |
| 8    | #SPILL!       |
| 9    | #CALC!        |

- **Sort**: All errors sort after booleans (rank 3), before blanks (rank 4).
  Within errors, sorted by the fixed rank above.
- **Filter (condition)**: Positive operators return false (type mismatch with numbers/text).
  Negative operators return true.
- **Filter (value)**: Matched by error variant via `cell_values_equal()`.
  Same variant = match, different variant = no match.
- **Equality**: Same variant is equal, different variant is not equal.
- **Slicer**: Deduplicated by canonical key `"__ERR__:#N/A"` etc. Displayed as
  error string (`#N/A`, `#REF!`, etc.).

## Null / Blank

- **Sort**: Always last, regardless of ascending/descending direction.
  Enforced by `is_sort_blank()` returning true for Null.
- **Filter (positive ops)**: false -- blank does not match any value condition.
- **Filter (negative ops)**: true -- blank does not fail exclusion conditions
  (NotEquals, NotContains, NotBetween all return true for blanks).
- **Filter (IsBlank/IsNotBlank)**: IsBlank returns true, IsNotBlank returns false.
- **Filter (value)**: Controlled by `include_blanks` flag on `ValueFilter`.
  When true, Null rows are visible. When false, they are hidden.
- **Filter (TopBottom)**: Excluded -- not a finite number.
- **Filter (Average)**: Excluded -- not a number at all.
- **Equality**: Null == Null only. Null != empty string, Null != 0, Null != false.
- **Slicer**: Deduplicated via key `"__BLANK__"`. Displayed as `"(Blank)"`.
  Sorts last regardless of direction.
- **Note**: Empty string `""` is NOT blank. It is a Text value with rank 1.

## Array / Lambda (internal types)

- **Sort**: Treated as blank (rank 4) -- always last regardless of direction.
  `is_sort_blank()` returns true for both.
- **Filter**: Treated as blank. Positive operators return false, negative return true.
- **Equality**: Not compared via `cell_values_equal()` (returns false for cross-type).
- **Slicer**: Canonical key is `"__BLANK__"` (same as Null). Displayed as
  `"(Array)"` / `"(Lambda)"`.
