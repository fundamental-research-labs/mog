# RoundTripContext Field Inventory

This inventory is the compatibility contract for `RoundTripContext` and
`SheetRoundTripContext`. Each field has exactly one disposition:

- `typed modeled state`: exported from public domain state.
- `persisted typed metadata`: lexical or identity metadata attached to modeled
  owners.
- `persisted opaque sidecar`: clean unmodeled package data emitted as an
  explicit sidecar.
- `transient parse-output sidecar`: valid for immediate parse-output export
  only.
- `deprecated compatibility only`: deserializable from old snapshots, but not
  package authority.

Yrs persistence is recorded as `domain`, `round_trip`, `ParseOutput`, or `none`.
`round_trip` means it persists only if the app document stores the round-trip
sidecar; it is not semantic authority.

## RoundTripContext

| Field | Disposition | Destination / owner | Yrs | Writer entrypoint | Package graph path | Test owner |
| --- | --- | --- | --- | --- | --- | --- |
| `sheets` | persisted typed metadata | `SheetRoundTripContext` per worksheet | round_trip | sheet feature writers | per-sheet modeled registrations | domain serde tests |
| `parsed_stylesheet` | transient parse-output sidecar | parsed OOXML style sidecar | ParseOutput | styles writer | styles part registration | style writer tests |
| `styles_ext_lst_xml` | persisted typed metadata | style extension metadata | round_trip | styles writer | styles part registration | style writer tests |
| `styles_namespace_attrs` | persisted typed metadata | style root lexical metadata | round_trip | styles writer | styles part registration | style writer tests |
| `content_type_defaults` | deprecated compatibility only | `OpaquePackagePart.default_extension` when lowered | none | ignored unless explicitly lowered | clean opaque subgraph registration only | stale package tests |
| `content_type_overrides` | deprecated compatibility only | modeled part registration or `OpaquePackagePart.content_type` | none | ignored unless explicitly lowered | clean opaque subgraph registration only | stale package tests |
| `root_relationships` | deprecated compatibility only | `OpaquePackageSubgraph.owner_relationship` when lowered | none | ignored unless explicitly lowered | clean opaque subgraph registration only | stale package tests |
| `workbook_relationships` | deprecated compatibility only | modeled workbook graph or opaque owner rel | none | ignored unless explicitly lowered | clean opaque subgraph registration only | stale package tests |
| `sheet_workbook_r_ids` | deprecated compatibility only | relationship ID hint after generated graph registration | none | ignored as package authority | graph allocates and validates IDs | stale package tests |
| `original_sst_count` | deprecated compatibility only | generated shared strings count | none | ignored as authority | sharedStrings generated from cells | shared string tests |
| `shared_strings_list` | transient parse-output sidecar | SST index hint for imported cells | ParseOutput | ignored as authority | sharedStrings generated from cells | shared string tests |
| `shared_strings_rich_runs` | persisted typed metadata | cell-owned rich text metadata | round_trip | shared string writer for matching cells | sharedStrings generated from cells | rich SST tests |
| `shared_strings_phonetic_xml` | persisted typed metadata | cell-owned phonetic metadata | round_trip | shared string writer for matching cells | sharedStrings generated from cells | phonetic SST tests |
| `raw_shared_strings_xml` | deprecated compatibility only | generated shared strings XML | none | ignored as authority | sharedStrings generated from cells | stale sharedStrings tests |
| `raw_doc_props_core_xml` | deprecated compatibility only | `ParseOutput.properties` | domain | document property writer | docProps registration from properties | doc property tests |
| `raw_doc_props_app_xml` | deprecated compatibility only | unsupported app props | none | ignored unless modeled later | none | doc property tests |
| `raw_doc_props_custom_xml` | deprecated compatibility only | `DocumentProperties.custom` | domain | document property writer | docProps registration from properties | doc property tests |
| `raw_metadata_xml` | transient parse-output sidecar | metadata with live `cm`/`vm` cell refs | ParseOutput | metadata writer with live refs | metadata part registration | metadata tests |
| `raw_persons_xml` | deprecated compatibility only | `ParseOutput.persons` | domain | persons writer | persons part registration | person tests |
| `custom_xml_parts` | deprecated compatibility only | `opaque_package_subgraphs` | round_trip | ignored by writer; import lowering creates typed subgraphs | clean opaque subgraph registration only | opaque custom XML tests |
| `web_extension_parts` | deprecated compatibility only | `opaque_package_subgraphs` | round_trip | ignored by writer; import lowering creates typed subgraphs | clean opaque subgraph registration only | web extension tests |
| `opaque_package_subgraphs` | persisted opaque sidecar | `OpaquePackageSubgraph`; never modeled features such as pivots/slicers | round_trip | `write::opaque_subgraph` filters modeled feature subgraphs | clean subgraph registration | opaque subgraph tests |
| `binary_blobs` | deprecated compatibility only | opaque subgraphs or typed feature sidecars; never pivots/slicers | round_trip | ignored by writer except when lowered into typed feature state | clean opaque subgraph registration only | binary passthrough tests |
| `pivot_package` | deprecated compatibility only | modeled pivot storage / `ParseOutput.pivot_tables` | domain | ignored for fresh imports; legacy deserialize only | generated pivot package graph | pivot package tests |
| `extensions` | deprecated compatibility only | namespace / preserved-element fields | none | ignored | none | serde omission tests |
| `workbook_namespace_attrs` | persisted typed metadata | workbook lexical metadata | round_trip | workbook writer | workbook XML | unknown element tests |
| `workbook_preserved_elements` | persisted typed metadata | workbook unknown element metadata | round_trip | workbook writer after modeled filtering | workbook XML | unknown element tests |
| `skipped_named_ranges` | deprecated compatibility only | named-range domain storage | domain | ignored as authority | workbook XML from named ranges | named range tests |
| `original_named_ranges_order` | deprecated compatibility only | named-range domain ordering | domain | ignored as authority | workbook XML from named ranges | named range tests |
| `theme_name` | typed modeled state | `ThemeData` / theme sidecar | domain | theme writer | theme part registration | theme tests |
| `theme_color_scheme` | typed modeled state | `ThemeData` / full theme state | domain | theme writer | theme part registration | theme tests |
| `theme_font_scheme` | typed modeled state | `ThemeData` / full theme state | domain | theme writer | theme part registration | theme tests |
| `theme_format_scheme` | typed modeled state | full theme state | round_trip | theme writer | theme part registration | theme tests |
| `theme_object_defaults_xml` | persisted typed metadata | theme lexical metadata | round_trip | theme writer | theme part registration | theme tests |
| `theme_extra_clr_scheme_lst_xml` | persisted typed metadata | theme lexical metadata | round_trip | theme writer | theme part registration | theme tests |
| `theme_ext_lst_xml` | persisted typed metadata | theme extension metadata | round_trip | theme writer | theme part registration | theme tests |
| `doc_metadata_label_info` | deprecated compatibility only | explicit opaque subgraph if later preserved | none | ignored | none unless opaque subgraph | stale docMetadata tests |

## SheetRoundTripContext

| Field | Disposition | Destination / owner | Yrs | Writer entrypoint | Package graph path | Test owner |
| --- | --- | --- | --- | --- | --- | --- |
| `sheet_opc_rels` | deprecated compatibility only | relationship ID hints after feature lowering | none | ignored as package authority | generated or clean opaque subgraph only | stale worksheet rel tests |
| `raw_vml_drawings` | persisted opaque sidecar | VML owner sidecar while clean | round_trip | VML/header-footer writer | VML part registration | VML tests |
| `legacy_drawing_r_id` | persisted typed metadata | sheet drawing relationship hint | round_trip | drawing writer after owner match | generated sheet drawing rel | drawing tests |
| `legacy_drawing_hf_r_id` | persisted typed metadata | header/footer drawing rel hint | round_trip | header/footer writer after owner match | generated sheet rel | header/footer tests |
| `comments_root_namespace_attrs` | persisted typed metadata | comments lexical metadata | round_trip | comments writer | comments part registration | comments tests |
| `comment_authors` | persisted typed metadata | comments author metadata | round_trip | comments writer | comments part registration | comments tests |
| `row_descents` | persisted typed metadata | worksheet row metadata | round_trip | sheet writer for existing rows | worksheet XML | row metadata tests |
| `row_spans` | persisted typed metadata | worksheet row lexical hints | round_trip | sheet writer for existing rows | worksheet XML | row metadata tests |
| `bare_empty_rows` | persisted typed metadata | worksheet row lexical hints | round_trip | sheet writer for existing rows | worksheet XML | row metadata tests |
| `row_thick_bot` | persisted typed metadata | worksheet row lexical hints | round_trip | sheet writer for existing rows | worksheet XML | row metadata tests |
| `row_thick_top` | persisted typed metadata | worksheet row lexical hints | round_trip | sheet writer for existing rows | worksheet XML | row metadata tests |
| `row_collapsed` | persisted typed metadata | worksheet row lexical hints | round_trip | sheet writer for existing rows | worksheet XML | row metadata tests |
| `row_hidden_explicit_false` | persisted typed metadata | worksheet row lexical hints | round_trip | sheet writer for existing rows | worksheet XML | row metadata tests |
| `row_outline_level_zero` | persisted typed metadata | worksheet row lexical hints | round_trip | sheet writer for existing rows | worksheet XML | row metadata tests |
| `original_dimension` | persisted typed metadata | worksheet dimension hint | round_trip | sheet writer only if current bounds match | worksheet XML | dimension tests |
| `has_empty_ext_lst` | deprecated compatibility only | no durable owner | none | filtered worksheet writer | worksheet XML only | extLst tests |
| `ext_lst_xml` | transient parse-output sidecar | unknown worksheet extensions | ParseOutput | worksheet writer after modeled filtering | worksheet XML only | extension tests |
| `preserved_namespace_attrs` | persisted typed metadata | worksheet lexical metadata | round_trip | sheet writer | worksheet XML | namespace tests |
| `ChartSpec.rt.auxiliary_files` | persisted chart-owned sidecar | chart style/color parts for imported chart identity | chart domain storage | chart writer | chart aux registrations | chart tests |
| `ChartSpec.rt.chart_rels_bytes` | persisted chart-owned sidecar | chart sidecar relationships for imported chart identity | chart domain storage | chart writer | chart aux registrations | chart tests |
| `cell_formulas` | persisted typed metadata | cell formula metadata until modeled per cell | round_trip | sheet writer for matching formulas | worksheet XML | formula metadata tests |
| `custom_properties_xml` | transient parse-output sidecar | worksheet custom property refs until modeled | ParseOutput | feature writer with live refs | feature-owned relationship registration | custom property tests |
| `xml_space_value_cells` | persisted typed metadata | cell lexical metadata | round_trip | sheet writer for matching cells | worksheet XML | cell lexical tests |
| `explicit_blank_cells` | persisted typed metadata | sparse blank-cell lexical metadata | round_trip | sheet writer | worksheet XML | blank cell tests |
| `skipped_storage_cells` | transient parse-output sidecar | dynamic-array spill cached cells | ParseOutput | sheet writer until recalculated/edited | worksheet XML | dynamic array tests |
| `xml_space_formula_cells` | persisted typed metadata | formula lexical metadata | round_trip | sheet writer for matching formulas | worksheet XML | formula lexical tests |
| `force_recalc_cells` | persisted typed metadata | formula recalc metadata | round_trip | sheet writer for matching formulas | worksheet XML | formula flag tests |
| `sheet_preserved_elements` | persisted typed metadata | worksheet unknown elements | round_trip | sheet writer after modeled filtering | worksheet XML | unknown element tests |
| `drawing_anchor_passthroughs` | persisted typed metadata | drawing anchor lexical metadata | round_trip | drawing writer | drawing part registration | drawing tests |
| `imported_drawing` | persisted opaque sidecar | clean imported drawing part | round_trip | drawing writer | drawing part and rel registration | drawing package tests |
| `drawing_root_namespace_attrs` | persisted typed metadata | drawing lexical metadata | round_trip | drawing writer | drawing part registration | drawing tests |
| `original_drawing_path` | persisted typed metadata | drawing identity hint | round_trip | drawing writer after owner match | graph resolves emitted path | drawing path tests |
| `drawing_opc_rels` | persisted typed metadata | drawing relationship ID hints | round_trip | drawing writer after owner match | drawing rel registration | drawing rel tests |
| `has_drawing_rels_file` | persisted typed metadata | drawing rels lexical/package metadata | round_trip | drawing writer when owner exists | drawing rels registration | drawing rel tests |
| `merge_cells_has_count` | persisted typed metadata | merge-cells lexical metadata | round_trip | sheet writer | worksheet XML | merge tests |
