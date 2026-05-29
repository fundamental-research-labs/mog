# XLSX Test Contracts

Shared Phase 0 contracts for trustworthy file I/O testing.

## Public Locations

- Shared Rust contracts: `file-io/xlsx/test-contracts`
- Public synthetic/generated fixtures: `file-io/xlsx/parser/test-corpus` or lane-owned public fixture folders under `file-io/xlsx`
- Public smoke/golden budget files for generated fixtures: `file-io/xlsx/parser/testing/budgets`
- Public gate adapters and parser/archive validation: `file-io/xlsx/parser/src/testing`
- Stable gate command surface: `cargo run -p xlsx-parser --bin xlsx-gate --features cli -- <gate>`

## Internal Locations

- Raw private corpus inputs and corpus snapshots: `../mog-data`
- Internal plans, private reports, private budget snapshots, and autonomous worker output: `../mog-internal`
- Public examples and website repos must not depend on these internal artifacts.

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

Phase 0 implements the `package-graph` archive adapter and performance gates,
and publishes explicit `not implemented` stubs for corpus-owned gates.

## Lane E Rollout Surface

Lane E owns orchestration, not new report schemas. The gate binary exposes the
shared command metadata and rollout suites from the Rust contracts:

```bash
pnpm gate:xlsx:list
pnpm gate:xlsx:schedule
pnpm gate:xlsx:plan:smoke
pnpm gate:xlsx:plan:golden
pnpm gate:xlsx:plan:full
pnpm gate:xlsx:check:smoke
```

Report policy enforcement is also contract-backed:

```bash
pnpm --filter @mog/xlsx-parser-wasm run gate:enforce-policy -- report.json
```

Golden/full reports must use the shared envelope, carry stable fingerprints for
failed scenarios, avoid broad `unknown`/`misc`/raw XML diff buckets, and include
named reasons for failed performance budget updates.
