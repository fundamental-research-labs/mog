# Public Experiments

`experiments/` is for source-adjacent experiments that are useful to keep with
the public repository but are not shipped as SDK, runtime, CLI, or app package
artifacts.

Good fits:

- Reproducible analysis scripts over public inputs.
- Public prototypes that exercise supported Mog entrypoints.
- Reports and figures whose source data can be documented publicly.
- Small public fixtures with explicit provenance and a narrow scanner allowlist
  when the file type is normally blocked.

Not allowed:

- Local absolute paths.
- Names of internal sibling repositories or private run handles.
- Non-public workbook or dataset provenance.
- Outputs copied from non-public evaluations or planning records.
- Package manifests that are not represented in the package inventory.

Public experiments still participate in repository boundary checks. Run
`pnpm check:private-leaks` before committing changes here.
