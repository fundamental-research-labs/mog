# Independent review of native output candidates

Code review passed at `b06a8f0182eeeb4968dbd00bede68d42434ff294`, against public
main `c8dd394806b8242f1cad0e3b27f5d58ee7c276cb`, on 15 October 2026. An independent
agent used a separate clean branch/worktree and compilation target. No actionable
production-source findings remained. This approves the narrow candidate slice,
not final task publication or a release through pending repository gates.

The review inspected the owned typed batch capture, logical value/formula
comparison, default invalidation, projection and partial-failure rejection,
opaque actor/checkpoint/task/workbook/request binding, freeze before export,
durable single attempt, exact digest replay, and cancellation/deadline behavior.
Atomic no-clobber candidate publication does not replace the declared output;
unknown outcomes and lost sessions cannot pick a plausible fallback file.

Independent Rust 1.98.0 execution at that source:

- **18/18** focused tests: `cargo test --offline --locked -p mog --test
  edit_checkpoint --test output_candidate`.
- **68/68** compute-api tests: `cargo test --offline --locked -p compute-api`;
  two existing doctests remain ignored.
- **11/11** additional real native CLI cases, using private synthetic fixtures:
  numeric/text/boolean distinctions, different formula text with identical
  calculated results, formula no-op and volatile-formula reverts, unsupported
  format invalidation, completed receipt after worker close, lost live worker,
  capabilities/missing flags, actual kill during a 100,000-cell export, and
  cancellation during that export.

The killed export retained an unknown same-request outcome, rejected another
request, and published no candidate/final output. Cancellation returned
unavailable/output_cancelled and published neither candidate nor final output.
The independently built executable SHA-256 was
`e63098ba7b4cb1ef350cecd517d06dddea16d891c5dd93c119c38eeb10f793c8`.
All review-owned workers and fixtures were cleaned up.

The recording harness was reviewed before execution. Two harness-only
corrections canonicalized macOS temporary paths and asserted fixture removal
after leaving the temporary-directory context. These did not alter production
code. Recording inspection/publication is separate from this code/test review.

The broad suite's three unchanged-base failures remain documented in the
acceptance README. No full-suite green, Windows/Excel host, final task success,
financial correctness, or deployed runtime-image claim is made. Synchronous
native export is not a hard CPU/I/O deadline, and same-user filesystem tampering
is outside the registry trust boundary.
