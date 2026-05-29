# Parse Result Sidecar Storage Audit

This inventory classifies parser-only fields that are skipped from JSON output,
carry raw package bytes/XML, or retain source package relationship data. A
field may stay on `FullParseResult` or `FullParsedSheet` only when it is a
conversion input, an explicit diagnostic input, or a bridge into an owned
`domain-types`/Yrs/export owner.

| Parse result field | Classification | Owner after `ParseOutput` conversion | Yrs/export path | Invalidation/deletion rule |
| --- | --- | --- | --- | --- |
| `FullParsedSheet.sheet_id`, `state`, `uid` | Typed workbook/sheet state | `SheetData.sheet_id`, `visibility`, `uid` | sheet metadata in compute storage; workbook/sheet writers emit workbook sheet records | Mutating/deleting the sheet mutates/deletes the metadata owner |
| `FullParsedSheet.authored_style_runs`, `explicit_blank_cells`, row descents/spans/bare rows | Typed sheet layout/style metadata | sheet row/cell metadata | sheet Yrs maps; worksheet writer emits current row/cell metadata | Cell/row edits replace current modeled metadata; deleted rows/cells do not replay parser state |
| `FullParsedSheet.conditional_formatting_full`, `sparkline_groups`, data validation sidecar flags | Typed worksheet feature state | conditional formats, sparklines, data validations | sheet Yrs metadata; worksheet writer emits current feature collections | Deleting/mutating the feature removes or rewrites its package XML |
| `FullParsedSheet.parsed_pivot_configs`, `FullParseResult.pivot_caches` | Typed pivot state plus eval cache records | `ParseOutput.pivot_tables`, `pivot_cache_records` | pivot/table storage and export package registration | Pivot owner deletion removes pivot parts/rels; cache records are eval-only |
| `FullParsedSheet.comments_root_namespace_attrs`, `comments_ext_lst_xml` | Comment package lexical metadata | `SheetData.comment_package` | compute sheet metadata; comments writer emits validated current owner metadata with generated comment XML | Deleting the sheet comment owner removes package metadata; comment mutations regenerate XML from current comments and must not replay stale whole comments parts |
| `FullParsedSheet.header_footer_xml` | Unsupported raw worksheet XML | none | dropped-import diagnostic | Header/footer XML is not replayed from parser state |
| `FullParsedSheet.worksheet_semantic_containers` | Owner-scoped opaque worksheet state | `SheetData.worksheet_semantic_containers` | sheet metadata map; worksheet writer emits current containers | Sheet deletion removes containers; updates replace current owner data |
| `FullParsedSheet.worksheet_controls_xml` | Unsupported raw worksheet XML | none | dropped-import diagnostic | Form controls export from current modeled control owners only |
| `FullParsedSheet.ext_lst_xml` | Unsupported worksheet raw XML | none | dropped-import diagnostic | No raw worksheet extension-list replay |
| `FullParsedSheet.sheet_opc_rels` | Parse-only relationship lookup | hyperlinks, comments, print settings, threaded comments, drawings, OLE, slicers | each converted owner registers relationships on export | Relationship IDs are regenerated or owner-scoped; stale sheet rels are not replayed |
| `FullParsedSheet.table_xml_passthroughs` | Unsupported raw table package parts | typed `ParsedTable` records only | dropped-import diagnostic | Table export uses current table models |
| `FullParsedSheet.auto_filter`, `sort_state` | Typed worksheet feature state | `SheetData.auto_filter`, `sort_state` | sheet metadata; worksheet writer emits typed OOXML | Feature deletion/mutation rewrites from current typed state |
| `FullParsedSheet.custom_properties_xml` | Unsupported raw worksheet XML | none | dropped-import diagnostic | Worksheet custom property refs are not replayed |
| `FullParsedSheet.raw_vml_drawings`, `legacy_drawing_r_id`, `legacy_drawing_hf_r_id` | Mixed conversion input and unsupported sidecar | comment shape props, header/footer images, form-control/OLE VML where modeled | modeled owners export current VML; unmodeled raw VML emits dropped-import diagnostic | Deleting comments, header/footer images, form controls, or OLE owners removes corresponding VML output |
| `FullParsedSheet.parsed_drawing`, `parsed_charts`, `parsed_chart_ex` | Typed drawing/chart owner state | floating objects, connectors, charts, chart auxiliary data | object/chart Yrs storage; drawing/chart/package writers register current owners | Owner deletion removes drawing/chart parts and relationships |
| `FullParseResult.shared_strings_rich_runs`, `shared_strings_phonetic_xml` | Typed shared-string import hints | cell rich text and shared-string hints | cell storage and shared-string export hints | Cell edits replace hints; stale original SST entries are not global storage |
| `StylesOutput.raw_*`, `ColorOutput.raw_tint`, `FullParseResult.parsed_stylesheet`, `styles_ext_lst_xml` | Typed style registry and style lexical metadata | `WorkbookStylesheet` registries/root lexical data | workbook style registry Yrs storage; styles writer emits current registries | Style registry edits rewrite styles; stale imported stylesheet blobs are not replayed |
| `FullParseResult.imported_media_parts`, `imported_ole_parts` | Parse-only owner hydration input | picture data URLs and OLE embedding/preview payloads | floating-object owner storage; drawing/OLE writers emit current owner bytes | Deleting picture/OLE owners removes package parts and relationships |
| `FullParseResult.extensions` | Transitional parse-only extension bucket | styles root namespaces and legacy feature-specific bytes where still converted | only converted owned fields may survive; remaining entries emit dropped diagnostics | No global extension replay is allowed |
| `FullParseResult.raw_doc_props_*_xml` | Parse-only lexical source for typed document properties | `properties`, `extended_properties` | workbook metadata storage; docProps writers emit current typed values | Property edits rewrite typed docProps; raw docProp bytes are not production storage |
| `FullParseResult.raw_metadata_xml`, `metadata`, `rich_data` | Typed workbook metadata with raw parse input | `WorkbookMetadata` and `WorkbookRichData` | workbook metadata Yrs storage; metadata/rich data writers emit current state | Metadata edits rewrite current owner state |
| `FullParseResult.raw_doc_metadata_label_info` | Unsupported package part | none | dropped-import diagnostic | `docMetadata/LabelInfo.xml` is not replayed |
| `FullParseResult.content_type_defaults`, `content_type_overrides` | Parse-only package lookup | content types attached to concrete emitted owners | package assembly registers current owners | Source content type tables are not replayed globally |
| `FullParseResult.root_relationships`, `workbook_relationships`, `sheet_workbook_r_ids` | Parse-only relationship identity/lookup | workbook sheets, properties, styles, theme, external links, slicers, connections | package graph registers relationships from current owners | Unowned source rels are not replayed |
| `FullParseResult.custom_xml_parts` | Unsupported package parts | none | dropped-import diagnostic | Custom XML parts are not emitted without a modeled custom XML owner |
| `FullParseResult.raw_persons_xml`, `raw_threaded_comments` | Parse-only threaded comment input | `persons` and `Comment` threaded fields | workbook persons/comment Yrs storage; threaded comments writer emits current comments | Deleting comments/person owners removes threaded comment package output |
| `FullParseResult.workbook_views`, `workbook_properties`, `file_version`, `file_sharing`, `web_publishing`, `calc_pr_settings` | Typed workbook state | corresponding `ParseOutput` workbook fields | workbook metadata storage; workbook writer emits current state | Mutations rewrite current workbook metadata |
| `ParsedChartEx.chart_rels_bytes`, `auxiliary_files`, chart/drawing auxiliary raw XML | Chart-owned opaque/typed auxiliary state | `ChartSpec` auxiliary relationships/files | chart owner storage; chart auxiliary writer emits only referenced chart owner data | Deleting chart owners removes auxiliary package parts |
| `FutureMetadataBlock.raw_xml` and domain `ext_lst_xml` fields | Owner-scoped lexical metadata | metadata, theme, style, slicer, comment, external-link, or connection owner | owner-specific Yrs storage and writer | Owner mutation/deletion owns invalidation; no package-wide replay |

Diagnostic coverage is intentionally focused on data that has no current
modeled owner after conversion. Relationship tables, content type declarations,
and imported binary maps are conversion inputs unless a specific unmodeled part
is detected by the dropped-import diagnostics.
