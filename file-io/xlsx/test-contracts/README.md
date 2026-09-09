# XLSX Test Contracts

Shared contracts for trustworthy file I/O testing.

## Public Locations

- Shared Rust contracts: `file-io/xlsx/test-contracts`
- Public synthetic/generated fixtures: `file-io/xlsx/parser/test-corpus` or other public fixture folders under `file-io/xlsx`
- Public smoke/golden budget files for generated fixtures: `file-io/xlsx/parser/testing/budgets`
- Public gate adapters and parser/archive validation: `file-io/xlsx/parser/src/testing`
- Stable gate command surface: `cargo run -p xlsx-parser --bin xlsx-gate --features cli -- <gate>`

## Private Artifact Boundaries

- Raw private inputs, snapshots, reports, budget baselines, plans, and
  autonomous worker output must stay outside this public repository.
- Public examples and website repos must not depend on private artifacts.

## Gate Names

- `ooxml-contract`
- `package-graph`
- `corpus-smoke`
- `corpus-anti-cheat`
- `corpus-golden`
- `perf-smoke`
- `perf-golden`
- `corpus-full`
- `perf-full`

List the gate binary's command metadata:

```bash
cargo run -p xlsx-parser --bin xlsx-gate --features cli -- list
```

Golden/full reports must use the shared envelope, carry stable fingerprints for
failed scenarios, avoid broad `unknown`/`misc`/raw XML diff buckets, and include
named reasons for failed performance budget updates.
