# Regression fixture provenance

`insert-compact.xlsx` is derived from the synthetic blank workbook at
[`verification/cases/roundtrip/empty/init.xlsx`](https://github.com/fundamental-research-labs/calipers/blob/5f8e8360580ede100eaaa6bac73ee474fe753b3d/verification/cases/roundtrip/empty/init.xlsx)
in the public Calipers repository, pinned at
`5f8e8360580ede100eaaa6bac73ee474fe753b3d`.

The derived fixture removes only the `dc:creator` and `cp:lastModifiedBy`
elements from `docProps/core.xml`. Every other ZIP member retains its exact
uncompressed bytes, and the other content in `core.xml` is unchanged. The
workbook archive is therefore not byte-identical to the original fixture.
This cleanup does not remove metadata from earlier repository history.

The four corresponding layout inputs use the same metadata-only sanitation;
their public source cases and measurement scope are documented in
[layout/README.md](layout/README.md). Other fixtures are outside this sanitation
change.
