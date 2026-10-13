# Strict Calipers verification

`./run-calipers-verify.sh` runs the pinned Calipers semantic comparator. Every selected case must pass; there is no whole-case failure allowlist. Existing `--case`, `--suite`, `--recalculate`, `--package` and `--out-dir` options remain available.

One recorded random draw is not a stable expected value. For `roundtrip/formula_stress_test` only, `Math!B47` contains `RANDBETWEEN(D1,E2)` with literal bounds 4 and 7. The wrapper copies the corpus to a temporary directory and adds Calipers' supported `compare.cells` range for that one cell. It does not change any input, golden, or submodule file.

An independent check requires the exact formula, literal numeric bounds and a finite numeric integer result in [4,7] in the input, golden and fresh export. It runs even if Calipers returns success. Calipers still checks the formula, type, style and all other cells and workbook properties using the existing corpus configuration. This is a result contract, not a test of random-number distribution or independence. Other volatile cells and transitive dependents get no new exceptions.

Exports always come from a new private directory. They are then copied to `--out-dir`, or retained in a newly allocated output directory whose path is printed. Old destination files never satisfy the current check. Nonzero Calipers exits and contract failures remain failures, including targeted runs. Failed exports are retained for diagnosis. No reroll is used to match a golden draw.

Run the tests with the pinned binary to include unrelated value/formula/style mutations:

```sh
CALIPERS_BIN=/path/to/calipers python3 -m unittest discover -s scripts/calipers-verify -p 'test_*.py'
```

The shell entrypoint fixes the corpus and adapter. Forwarded `--engine`, `--calipers` and `--cases-dir` overrides are rejected, including `--flag=value` and abbreviated forms. Choose the built MOG/Calipers executables through the documented `MOG_BIN` / `CALIPERS_BIN` environment variables.
