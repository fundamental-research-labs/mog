# RoundTripContext Field Inventory

This inventory is the field ownership contract for `RoundTripContext` and
`SheetRoundTripContext`. Each field has exactly one disposition:

- `typed modeled state`: exported from public domain state.
- `persisted typed metadata`: lexical or identity metadata attached to modeled
  owners.
- `persisted opaque sidecar`: clean unmodeled package data emitted as an
  explicit sidecar.
- `transient parse-output sidecar`: valid for immediate parse-output export
  only.

Yrs persistence is recorded as `domain`, `round_trip`, `ParseOutput`, or `none`.
`round_trip` means it persists only if the app document stores the round-trip
sidecar; it is not semantic authority.

## RoundTripContext

| Field | Disposition | Destination / owner | Yrs | Writer entrypoint | Package graph path | Test owner |
| --- | --- | --- | --- | --- | --- | --- |
| `sheets` | persisted typed metadata | `SheetRoundTripContext` per worksheet | round_trip | sheet feature writers | per-sheet modeled registrations | domain serde tests |
| `opaque_package_subgraphs` | persisted opaque sidecar | `OpaquePackageSubgraph`; never modeled feature subgraphs | round_trip | `write::opaque_subgraph` filters modeled feature subgraphs | clean subgraph registration | opaque subgraph tests |
| `workbook_namespace_attrs` | persisted typed metadata | workbook lexical metadata | round_trip | workbook writer | workbook XML | unknown element tests |
| `workbook_preserved_elements` | persisted typed metadata | workbook unknown element metadata | round_trip | workbook writer after modeled filtering | workbook XML | unknown element tests |

## SheetRoundTripContext

| Field | Disposition | Destination / owner | Yrs | Writer entrypoint | Package graph path | Test owner |
| --- | --- | --- | --- | --- | --- | --- |
| `sheet_opc_rels` | persisted typed metadata | sheet relationship identity hints used by owner-specific opaque import lowering | round_trip | owner-specific feature writers only | generated or clean opaque subgraph only | stale worksheet rel tests |
| `raw_vml_drawings` | persisted opaque sidecar | VML owner sidecar while clean | round_trip | VML/header-footer writer | VML part registration | VML tests |
| `legacy_drawing_r_id` | persisted typed metadata | sheet drawing relationship hint | round_trip | drawing writer after owner match | generated sheet drawing rel | drawing tests |
| `legacy_drawing_hf_r_id` | persisted typed metadata | header/footer drawing rel hint | round_trip | header/footer writer after owner match | generated sheet rel | header/footer tests |
| `comments_root_namespace_attrs` | persisted typed metadata | comments lexical metadata | round_trip | comments writer | comments part registration | comments tests |
| `comment_authors` | persisted typed metadata | comments author metadata | round_trip | comments writer | comments part registration | comments tests |
| `ext_lst_xml` | persisted opaque sidecar | unknown worksheet extensions | round_trip | worksheet writer after modeled filtering | worksheet XML only | extension tests |
| `preserved_namespace_attrs` | persisted typed metadata | worksheet lexical metadata | round_trip | sheet writer | worksheet XML | namespace tests |
| `ChartSpec.rt.auxiliary_files` | persisted chart-owned sidecar | chart style/color parts for imported chart identity | chart domain storage | chart writer | chart aux registrations | chart tests |
| `ChartSpec.rt.chart_rels_bytes` | persisted chart-owned sidecar | chart sidecar relationships for imported chart identity | chart domain storage | chart writer | chart aux registrations | chart tests |
| `custom_properties_xml` | transient parse-output sidecar | worksheet custom property refs until modeled; `serde(skip)` in `SheetRoundTripContext` so it cannot persist as document round-trip state | none | feature writer with live refs during same import/export operation | feature-owned relationship registration | custom property tests |
| `sheet_preserved_elements` | persisted typed metadata | worksheet unknown elements | round_trip | sheet writer after modeled filtering | worksheet XML | unknown element tests |
| `drawing_anchor_passthroughs` | persisted typed metadata | drawing anchor lexical metadata | round_trip | drawing writer | drawing part registration | drawing tests |
| `imported_drawing` | persisted opaque sidecar | clean imported drawing part | round_trip | drawing writer | drawing part and rel registration | drawing package tests |
| `drawing_root_namespace_attrs` | persisted typed metadata | drawing lexical metadata | round_trip | drawing writer | drawing part registration | drawing tests |
| `original_drawing_path` | persisted typed metadata | drawing identity hint | round_trip | drawing writer after owner match | graph resolves emitted path | drawing path tests |
| `drawing_opc_rels` | persisted typed metadata | drawing relationship ID hints | round_trip | drawing writer after owner match | drawing rel registration | drawing rel tests |
| `has_drawing_rels_file` | persisted typed metadata | drawing rels lexical/package metadata | round_trip | drawing writer when owner exists | drawing rels registration | drawing rel tests |
