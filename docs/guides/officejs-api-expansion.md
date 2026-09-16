# Office.js API expansion

This batch implements 49 additional object-model methods and adds 49 caliper
cases. The catalog scan increases implemented and scripted method coverage from
98 to 147; scripted coverage does not imply Excel-verified parity.

The [method-to-case inventory and Windows golden instructions](../../vendor/calipers/verification/API_EXPANSION.md)
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
search and mutations. Windows Excel goldens and subsequent caliper comparison
are the remaining external validation step.
