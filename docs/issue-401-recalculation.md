# OFFSET recalculation reproduction (#401)

This branch prepares the Excel baseline for
[issue #401](https://github.com/fundamental-research-labs/mog/issues/401).
It pins a Calipers branch with five synthetic cache-free XLSX cases, an explicit
recalculation policy, and a Windows capture script. Mog evaluation code is unchanged;
fixing it follows the Windows evidence review.

## Run on Windows

Prerequisites: desktop Microsoft Excel, Go 1.25+, Rust with the Windows C/C++ build
tools, and Git. Close other Excel workbooks for useful peak-memory measurements.
No Office.js add-in is needed. From this Mog branch:

```powershell
git submodule update --init -- vendor/calipers
powershell -ExecutionPolicy Bypass -File scripts/reproduce-401.ps1
```

The script builds the public Mog CLI and existing native Calipers adapter, then:

1. Generates Windows Excel goldens with an explicit full dependency rebuild.
2. Checks all 23 expected scalar results in the saved goldens.
3. Measures Excel peak memory and duration into per-case configs.
4. Requires five Excel semantic passes against those goldens.
5. Runs Mog against the same inputs/goldens and expects one control pass and four
   semantic failures, with no execution errors or missing-golden skips.

Logs and exported workbooks are retained in
`vendor/calipers/tmp/recalculate/`. Goldens, sidecars, and measured configs are
written under `vendor/calipers/verification/cases/recalculate/`.
See the [suite documentation](../vendor/calipers/verification/cases/recalculate/README.md)
for formulas, inputs, and individual commands. Do not save over the inputs in
Excel: they deliberately contain no formula-result caches.

Commit the captured goldens and budgets to the Calipers draft branch (the
submodule initially checks out its pinned commit):

```powershell
git -C vendor/calipers switch issue-401-recalc-verifiers
git -C vendor/calipers add verification/cases/recalculate
git -C vendor/calipers commit -m "Capture Windows Excel OFFSET recalculation goldens and budgets"
git -C vendor/calipers push origin issue-401-recalc-verifiers
```

Return the two verify logs and `expected-results.log`, or the entire ignored
`vendor/calipers/tmp/recalculate/` directory. The next step is to inspect the
Excel/Mog diffs, update the submodule pin, and implement the Mog fix.

## Preliminary Linux evidence

A Mog build from `origin/main` at `3abffd7a1` ran each input with
`--input init.xlsx --recalculate --output result.xlsx`. All seven control results
matched the fixture expectations. Named and INDEX bases returned counts of 1
instead of 3 and `#REF!` for two-dimensional sums; period counts returned `#REF!`;
header MATCH returned `#N/A`, and the nested lookup returned `-` instead of 30.
These observations are against the synthetic fixture assertions. Windows Excel
has not yet supplied the goldens, so they are not an Excel-vs-Mog verification run.
