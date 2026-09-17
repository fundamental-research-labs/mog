# Office.js API expansion

This batch implements 49 additional object-model methods and adds 49 caliper
cases. The catalog scan increases implemented and scripted method coverage from
98 to 147; scripted coverage does not imply Excel-verified parity.

The [method-to-case inventory and Excel verification details](../../vendor/calipers/verification/API_EXPANSION.md)
live with the calipers fixtures. No goldens were generated in this environment.

The implementation reuses engine table filters, threaded comments, conditional
formats, range bindings and formatting. Shared helpers handle collection methods,
criteria translation, client results and null objects. Used-range bounds include
formatting geometrically, without expanding full-column formatting into cells.

Local checks:

```sh
cargo test -p mog --locked
cargo test -p compute-api --locked
python -m unittest discover -s scripts/officejs-coverage -p 'test_*.py'
(cd vendor/calipers && go test ./scripts/gen-officejs-cases)
```

`compute/officejs/tests/api_expansion.rs` executes all 49 new scripts and checks
the values they record, plus edge cases for object identity, errors, geometry,
search and mutations. The 49 Windows Excel goldens were recorded on 2026-09-16
and merged in calipers #43. With the parity fixes and calipers color
normalization, all 296 corpus cases pass, including all 193 Office.js cases.
Run the complete comparison from the repository root:

```sh
cargo build -p mog --locked
MOG_BIN="$PWD/target-native/debug/mog" ./run-calipers-verify.sh
```

Golden comparison exposed shared export and API differences: table formatting
must remain differential until conversion; conversion must retain borders and
banding; table deletion clears its range; totals constants become labels;
strings use Excel parsing; validation queries return RangeAreas; and freeze,
merge and named-formula export must preserve Excel's pane and array metadata.
Calipers resolves equivalent RGB/ARGB and tinted colors and ignores the unused
background of solid fills, while retaining patterned-fill background checks.
