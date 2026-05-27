# XLSX Corpus Perf Gates

Lane D perf gates exercise the production import -> domain conversion -> export -> package validation path.

Run generated sentinels:

```bash
pnpm --filter @mog/xlsx-corpus-eval run perf-smoke
```

Run a curated real-file set:

```bash
MOG_XLSX_PERF_MANIFEST=/path/to/perf-manifest.json pnpm --filter @mog/xlsx-corpus-eval run perf-smoke
```

Manifest shape:

```json
{
  "fixtures": [
    {
      "id": "finance-wide.xlsx",
      "path": "files/finance-wide.xlsx",
      "tiers": ["smoke", "golden"],
      "classes": ["wide-sheet", "producer-excel"]
    }
  ]
}
```

`path` is resolved relative to the manifest file. `tiers` may use `smoke`, `golden`, `full`, or a concrete gate name such as `perf-smoke`.
