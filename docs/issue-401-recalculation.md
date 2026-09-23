# OFFSET recalculation regression (#401)

`OFFSET` must preserve the origin and dimensions of its base reference before
applying the requested displacement and size. Mog now uses the shared reference
resolver for both value evaluation and reference-area evaluation, covering named
cells/ranges, whole-row names, and `INDEX` results. The Calipers pin includes the
five Windows Excel goldens and measured budgets captured for
[issue #401](https://github.com/fundamental-research-labs/mog/issues/401).

The baseline returned **1 pass / 4 failures** against those goldens: only the
literal-reference controls passed. After the fix, **all 5 cases pass**, including
all 23 formula results. Comparison settings and Excel goldens are unchanged.

## Verify the committed goldens

Requires Rust/C++ build tools, Go 1.25+, and Git. Excel is not required to verify.
From this Mog branch on Windows:

```powershell
git submodule update --init -- vendor/calipers
powershell -ExecutionPolicy Bypass -File scripts/reproduce-401.ps1
```

The script builds Mog, the existing Calipers adapter, and Calipers, then runs the
`recalculate` suite against the committed goldens. Exports go to
`target-native/issue-401/`; failures return a nonzero exit. It does not regenerate
goldens or budgets.

On Linux/macOS:

```sh
./run-calipers-verify.sh --suite recalculate
```

The [suite documentation](../vendor/calipers/verification/cases/recalculate/README.md)
lists the formulas and expected results. The cache-free `init.xlsx` inputs must
remain unchanged; saving them in Excel would populate their formula caches.
Calipers' Windows capture script records the original failing baseline and is
not needed to verify the fixed Mog build.
