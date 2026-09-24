# Native diagnostics

Release builds retain function names and source line tables for native crash
symbolication while keeping release optimizations. They do not include local
variable debug information. A native signal still requires a captured stack or
core dump from the host; `RUST_BACKTRACE=1` only prints Rust panic backtraces.

Set `MOG_DIAGNOSTICS_FILE=/absolute/path/mog-events.jsonl` to append timestamped
stage records (also echoed to stderr). The parent directory must exist. Records
identify the process, workbook loading, JavaScript initialization, Office.js
bootstrap, user-script evaluation, recalculation, and saving. They contain no
script source or workbook contents. A native crash leaves a `started` record
without its matching terminal record; nested stages identify the narrowest
operation reached. `evaluate_javascript` covers execution of the user script;
`run_script` also reports a returned JavaScript exception as `failed`. Persistent
session workers inherit the file destination. Logging is best effort and does
not change command results when the destination is unavailable.
