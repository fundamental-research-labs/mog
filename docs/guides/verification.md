# Verification and benchmarks

Run commands from the repository root.

`./run-calipers-bench.sh` walks the calipers verify corpus **one case at a time** and writes wall time + peak working set to JSON, then a US Letter HTML/SVG report. Open the HTML and use **Export as PDF** (stacked 8.5×11in pages).

```bash
# Mog-only (any OS) — inspect HTML before a Windows Excel run
./run-calipers-bench.sh
./run-calipers-bench.sh --suite default

# Both series on one Windows machine (build Mog, run Mog, then Excel COM)
./run-calipers-bench.sh --excel
```

Excel is desktop `Excel.Application` via COM plus a sideloaded Office.js add-in
(not AppSource / Office Scripts). The repository runners build a small native
adapter from Calipers' pinned `save` / `run` protocol to Mog's flags; `mog` itself
has no subcommands. The HTML also reports Office.js Excel API coverage
(Microsoft method catalog vs Mog host vs verification scripts). See
`vendor/calipers` `bench` / `bench-report` and `scripts/officejs-coverage`.

## Engine microbenchmarks

`scripts/bench/storage_bench.py` measures storage and Office.js workloads in
fresh processes and records timing, peak memory, and source provenance. It
requires Linux, GNU time, and Python 3. Use `--help` for workload and output
options; keep generated reports outside the source tree.
