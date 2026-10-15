# Native candidate acceptance

Passed on macOS ARM64 with native source
`b06a8f0182eeeb4968dbd00bede68d42434ff294`, based on public main
`c8dd394806b8242f1cad0e3b27f5d58ee7c276cb`, using Rust 1.98.0.
This documentation/evidence follow-up does not change the tested native source.

- [Full recording](evidence/acceptance.mp4), [final still](evidence/accepted.png),
  [terminal events](evidence/acceptance.cast), [result](evidence/result.json).
- [Repeatable scenario](acceptance.py).
- [Independent source and native-test review](evidence/independent-review.md).
- [Protocol and its limitations](../../guides/output-candidates.md).

The scenario executes the real native CLI with a private temporary session
registry and synthetic workbooks. It registers a live intended workbook at a
different ordinary save path, writes A1=21 and B1=`=A1*2`, prepares one candidate,
and checks its digest. A separate native reader sees 21, 42 and the formula.
The scenario also verifies identical-request replay, rejected late edits and
second attempts, rejected manual reverts, cancellation, no declared final
output, and removal of every owned worker and temporary fixture.

The binary SHA-256 is
`b5227618650ab6484c9613165bfb8ba27b90348a988f61259ebf6be1408a8099`.
The 16.03-second video preserves the 12.05-second terminal flow plus a four-second
final-frame hold, without cuts or speedups. Candidate and completed transitions
were visually inspected for legibility and unrelated information. Only the
machine-local executable path in terminal metadata was replaced with an
environment variable; terminal output events are unchanged.

## Supporting checks

At the exact source above, `cargo test -p mog -p compute-api --locked
--no-fail-fast` executed 36 targets: **276 passed, 3 failed, 2 existing ignored
doctests**. All 18 added tests passed. The same three failures reproduced on an
unchanged separate checkout of the exact base:

- `api_expansion::expansion_caliper_scripts_execute`: absent `vendor/calipers`
  fixture directory in the public checkout.
- `functions::all_fifty_function_calipers_cases_produce_expected_values_and_errors`:
  absent caliper fixtures.
- `format_semantics::format_font_fill_and_protection_round_trip_all_exposed_fields`:
  column width 54 versus expected 48.

Those failures remain visible; the full suite is not claimed green. Independent
review separately passed the 18 focused tests, all 68 compute-api tests, and 11
additional actual-CLI adversarial cases, including killing or cancelling a
100,000-cell export. No baseline test or assertion was weakened or skipped.

A local compiler cache collision between the base and candidate checkouts was
resolved by clearing the task-owned compute-api artifacts and rebuilding the
candidate before this final run. The verified native executables and evidence
were retained before task-owned compilation caches were removed.

This is native candidate staging evidence only. It does not prove Windows,
Excel-host compatibility, a deployed runtime image, model task quality,
financial correctness, or final-result publication. Host integration and its
validation/publication policy remain separate release gates.

## Reproduce

Build the tested native source, record the built executable digest, then run
from the repository root with this evidence script present:

```sh
cargo build -p mog --locked
export MOG_ACCEPTANCE_BINARY="$PWD/target/debug/mog"
# Supply the digest of that exact executable, not another machine's build.
python3 docs/verification/output-candidate/acceptance.py \
  --binary "$MOG_ACCEPTANCE_BINARY" \
  --source b06a8f0182eeeb4968dbd00bede68d42434ff294 \
  --binary-sha256 YOUR_BUILT_BINARY_SHA256 \
  --result /path/to/new-acceptance-result.json
```

The script verifies the expected binary hash and unchanged native source,
refuses to overwrite a result, uses bounded real commands, and cleans its
workers and fixtures in `finally`. It requires no credentials or remote service.
Record it with `asciinema record --headless --return --window-size 170x27
--output-format asciicast-v2 --command '...' acceptance.cast` if video evidence
is wanted. The existing recording used `agg` with a four-second final-frame
hold and a 30-fps MP4 conversion with one-pixel even-dimension padding.
