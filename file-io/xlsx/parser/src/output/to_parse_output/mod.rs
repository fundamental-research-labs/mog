//! `FullParseResult` → `ParseOutput` + `RoundTripContext` + `ParseDiagnostics` conversion.
//!
//! This module converts the parser's raw output into the shared domain types defined
//! in the `domain-types` crate. It is the bridge between the XLSX parser's internal
//! representation and the pipeline-wide `ParseOutput` contract.
//!
//! ## Design principles
//!
//! - **Position-keyed**: No UUIDs or CellIds — those are allocated by the hydration layer.
//! - **Style resolution**: Uses `domain_types::style_resolver::resolve_styles()` to flatten
//!   the OOXML multi-level style tables into a `Vec<DocumentFormat>` palette.
//! - **Shared string resolution**: Inlines SST references at conversion time.
//! - **Round-trip data**: Raw XML blobs, OPC relationships, and other byte-level preservation
//!   data is moved into `RoundTripContext` — kept separate from the semantic data.
//! - **Diagnostics**: Parse errors and statistics are moved into `ParseDiagnostics`.
//!
//! ## Stubbed domains
//!
//! Complex domain objects (charts, CF, validations, sparklines, slicers, etc.) are
//! stubbed with empty Vecs until export support is wired.

mod cells;
mod features;
mod metadata;
pub(crate) mod pivot_convert;
mod round_trip;
mod styles;
use crate::infra::opc::{REL_DRAWING, resolve_relationship_target};
use cells::*;
use features::*;
use round_trip::*;
use styles::*;

use std::collections::HashMap;
use std::collections::HashSet;

use base64::Engine as _;
use domain_types::{
    AuthoredStyleRun,
    BlobPart,
    // Round-trip types
    CalculationProperties,
    // Parse output types
    CellData,
    ColDimension,
    ColStyleEntry,
    // Domain types
    Comment,
    FrozenPane,
    Hyperlink,
    HyperlinkTargetKind,
    MergeRegion,
    // Diagnostics types
    ParseDiagnostics,
    ParseOutput,
    PersonInfo,
    RoundTripContext,
    RowDimension,
    RowStyleEntry,
    SheetData,
    SheetDimensions,
    SheetRoundTripContext,
    SheetView,
    TrailingColRange,
    VmlDrawingPart,
    VmlRels,
};
use formula_types::{CellRef, RangeType};
use ooxml_types::doc_props::CustomPropertyValue;

// Parser-internal imports (no re-export indirection)
use crate::output::results::{FullParseResult, FullParsedSheet};

fn env_flag_default_true(name: &str) -> bool {
    std::env::var(name)
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            !matches!(normalized.as_str(), "0" | "false" | "no" | "off")
        })
        .unwrap_or(true)
}

fn custom_property_value_to_domain(
    value: &CustomPropertyValue,
) -> domain_types::DocumentCustomPropertyValue {
    match value {
        CustomPropertyValue::Lpwstr(value) => {
            domain_types::DocumentCustomPropertyValue::Lpwstr(value.clone())
        }
        CustomPropertyValue::I4(value) => domain_types::DocumentCustomPropertyValue::I4(*value),
        CustomPropertyValue::R8(value) => domain_types::DocumentCustomPropertyValue::R8(*value),
        CustomPropertyValue::Bool(value) => domain_types::DocumentCustomPropertyValue::Bool(*value),
        CustomPropertyValue::Filetime(value) => {
            domain_types::DocumentCustomPropertyValue::Filetime(value.clone())
        }
    }
}

// =============================================================================
// Public entry point
// =============================================================================

/// Convert a `FullParseResult` into the shared pipeline types.
///
/// Returns a triple:
/// - `ParseOutput`: Semantic data (cells, merges, styles, named ranges, etc.)
/// - `RoundTripContext`: Raw XML/OPC preservation blobs for lossless re-export
/// - `ParseDiagnostics`: Errors, statistics, and recalc hints
pub fn full_parse_result_to_parse_output(
    result: &FullParseResult,
) -> (ParseOutput, RoundTripContext, ParseDiagnostics) {
    // 1. Resolve styles into a flat DocumentFormat palette
    let style_input = build_style_input(&result.styles, result);
    let style_palette = domain_types::style_resolver::resolve_styles(&style_input);

    // 2. Convert sheets, collecting workbook-level items along the way
    let mut sheet_data_vec = Vec::with_capacity(result.sheets.len());
    let mut sheet_rt_vec = Vec::with_capacity(result.sheets.len());
    let mut all_parsed_pivots = Vec::new();
    let mut all_data_table_regions = Vec::new();

    // Extract DXF table and theme colors for CF style resolution
    let dxfs = result
        .parsed_stylesheet
        .as_ref()
        .map(|s| s.dxfs.as_slice())
        .unwrap_or(&[]);
    let theme_colors = styles::extract_theme_color_palette(result);
    let media_data_urls = build_media_data_url_map(result);

    for (sheet_idx, sheet) in result.sheets.iter().enumerate() {
        let (mut sd, mut srt) = convert_sheet(
            sheet,
            &result.shared_strings,
            &result.shared_strings_rich_runs,
            &result.shared_strings_phonetic_xml,
            dxfs,
            &theme_colors,
            &media_data_urls,
        );
        // Assign tables to each sheet (tables are per-sheet data)
        sd.tables = convert_tables(&sheet.tables);
        // Collect the ParsedPivotTable (config + ooxml sidecar) from the v2 converter
        all_parsed_pivots.extend(sheet.parsed_pivot_configs.iter().cloned());
        all_data_table_regions.extend(convert_data_tables(&sheet.data_tables, sheet_idx as u32));
        // Preserve namespace declarations and unknown elements from <worksheet> for round-trip
        if let Some(ref ext) = result.extensions {
            if let Some(ns_map) = ext.sheet_namespaces.get(sheet_idx) {
                srt.preserved_namespace_attrs = ns_map
                    .all()
                    .iter()
                    .map(|decl| {
                        let prefix = decl.prefix.clone().unwrap_or_default();
                        (prefix, decl.uri.clone())
                    })
                    .collect();
            }
            if let Some(preserved) = ext.sheet_preserved.get(sheet_idx) {
                srt.sheet_preserved_elements = preserved.to_position_pairs();
            }
        }
        sheet_data_vec.push(sd);
        sheet_rt_vec.push(srt);
    }

    // 3. Convert named ranges
    let named_ranges = convert_named_ranges(result);

    // 4. Convert theme
    let theme = convert_theme(result);

    // 5. Convert workbook protection (already domain_types::WorkbookProtection from full_parse)
    let protection = result.workbook_protection.clone();

    // 6. Convert document properties
    let properties =
        (result.doc_props_core.is_some() || result.doc_props_custom.is_some()).then(|| {
            let core = result.doc_props_core.as_ref();
            let typed_custom: Vec<_> = result
                .doc_props_custom
                .as_ref()
                .map(|custom| {
                    custom
                        .properties
                        .iter()
                        .map(|prop| domain_types::DocumentCustomProperty {
                            name: prop.name.clone(),
                            value: custom_property_value_to_domain(&prop.value),
                        })
                        .collect()
                })
                .unwrap_or_default();
            domain_types::DocumentProperties {
                title: core.and_then(|core| core.title.clone()),
                creator: core.and_then(|core| core.creator.clone()),
                description: core.and_then(|core| core.description.clone()),
                subject: core.and_then(|core| core.subject.clone()),
                created: core.and_then(|core| core.created.clone()),
                modified: core.and_then(|core| core.modified.clone()),
                last_modified_by: core.and_then(|core| core.last_modified_by.clone()),
                category: core.and_then(|core| core.category.clone()),
                keywords: core.and_then(|core| core.keywords.clone()),
                custom: typed_custom
                    .iter()
                    .map(|prop| (prop.name.clone(), prop.value.as_legacy_string()))
                    .collect(),
                typed_custom,
            }
        });

    // 7. Calculation properties
    let calculation = result
        .calc_pr_settings
        .clone()
        .map(CalculationProperties::from)
        .unwrap_or_else(|| CalculationProperties {
            iterate: result.iterative_calc,
            iterate_count: result.max_iterations.unwrap_or(100),
            iterate_delta: result.max_change.unwrap_or(0.001),
            calc_id: result.calc_id,
            has_explicit_iterate_count: result.max_iterations.is_some(),
            has_explicit_iterate_delta: result.max_change.is_some(),
            ..Default::default()
        });

    let metadata = result
        .metadata
        .as_ref()
        .and_then(metadata::metadata_to_domain);

    // 8. Slicer caches (workbook-level) — already ooxml-types, pass through directly
    let slicer_caches = result.slicer_caches.clone();

    // 8b. Parse persons and merge threaded comments into sheet comments
    let persons = merge_threaded_comments(result, &mut sheet_data_vec);
    for sheet in &mut sheet_data_vec {
        extend_sheet_data_extent(sheet);
    }

    // 8c. Extract pivot cache records for eval-only use through the pivot conversion contract.
    let pivot_cache_records: std::collections::HashMap<u32, Vec<Vec<value_types::CellValue>>> =
        result
            .pivot_caches
            .iter()
            .filter_map(|(cache_id, parsed_cache)| {
                let rows = crate::domain::pivot::convert::resolve_cache_records(Some(parsed_cache));
                (!rows.is_empty()).then_some((*cache_id, rows))
            })
            .collect();

    // 9. Build ParseOutput
    let parse_output = ParseOutput {
        sheets: sheet_data_vec,
        style_palette,
        named_ranges,
        pivot_tables: all_parsed_pivots,
        pivot_cache_records,
        data_table_regions: all_data_table_regions,
        slicer_caches,
        theme,
        properties,
        extended_properties: result.doc_props_app.clone(),
        protection,
        calculation,
        metadata,
        workbook_views: result
            .workbook_views
            .iter()
            .cloned()
            .map(domain_types::domain::workbook::WorkbookView::from)
            .collect(),
        workbook_properties: result.workbook_properties.clone(),
        file_version: result.file_version.clone(),
        file_sharing: result.file_sharing.clone(),
        external_links: result.external_links.clone(),
        persons,
    };

    // 9. Build RoundTripContext
    let round_trip = build_round_trip_context(result, &parse_output.sheets, sheet_rt_vec);

    // 10. Build ParseDiagnostics
    let mut diagnostics = build_diagnostics(result);
    append_import_compatibility_acknowledgements(&result.sheets, &mut diagnostics);
    append_object_import_diagnostics(&parse_output, &mut diagnostics);

    (parse_output, round_trip, diagnostics)
}

fn append_object_import_diagnostics(
    parse_output: &ParseOutput,
    diagnostics: &mut ParseDiagnostics,
) {
    let mut report = diagnostics.clone().into_import_report();

    for (sheet_idx, sheet) in parse_output.sheets.iter().enumerate() {
        for chart in &sheet.charts {
            let Some(status) = chart.import_status.as_ref() else {
                continue;
            };
            if status.recoverability == domain_types::ImportRecoverability::FullySupported {
                continue;
            }

            let mut reference = status.reference.clone().unwrap_or_default();
            if reference.part.is_none() {
                reference.part = Some(format!("sheet:{}", sheet_idx));
            }
            if reference.feature_kind.is_none() {
                reference.feature_kind = Some(status.feature_kind);
            }

            let id = reference.id.clone().unwrap_or_else(|| {
                domain_types::deterministic_diagnostic_id(
                    &domain_types::ImportDiagnosticCode::ChartPartEmptySeries,
                    reference.part.as_deref(),
                    reference.relationship_id.as_deref(),
                    None,
                    None,
                    reference.object_name.as_deref(),
                )
            });
            let message = match status.recoverability {
                domain_types::ImportRecoverability::PreservedNotRenderable => {
                    "Imported chart was preserved but is not renderable".to_string()
                }
                _ => format!("Imported {:?} has degraded support", status.feature_kind),
            };

            let diagnostic = domain_types::ImportDiagnostic {
                id,
                code: domain_types::ImportDiagnosticCode::ChartPartEmptySeries,
                severity: domain_types::ImportSeverity::Warning,
                feature: status.feature_kind,
                recoverability: status.recoverability,
                message,
                reference: Some(reference),
            };

            diagnostics
                .errors
                .push(domain_types::ParseError::from(diagnostic.clone()));
            report.diagnostics.push(diagnostic);
            report.object_statuses.push(status.clone());
        }
    }

    diagnostics.import_report = Some(report.canonicalized());
}

fn append_import_compatibility_acknowledgements(
    sheets: &[FullParsedSheet],
    diagnostics: &mut ParseDiagnostics,
) {
    let diagram_count = count_ooxml_smartart_diagrams(sheets);
    let text_effect_count = count_ooxml_wordart_text_effects(sheets);

    if diagram_count == 0 && text_effect_count == 0 {
        return;
    }

    let mut report = diagnostics.clone().into_import_report();

    if diagram_count > 0 {
        let diagnostic = compatibility_acknowledgement(
            domain_types::ImportFeatureKind::Diagram,
            "ooxml-smartart",
            domain_types::ImportRecoverability::PartiallySupported,
            detected_count_message(
                diagram_count,
                "diagram",
                "diagrams",
                "OOXML SmartArt",
                "Diagram source metadata was preserved; editable Mog diagrams are not materialized yet.",
            ),
        );
        diagnostics
            .errors
            .push(domain_types::ParseError::from(diagnostic.clone()));
        report.diagnostics.push(diagnostic);
    }

    if text_effect_count > 0 {
        let diagnostic = compatibility_acknowledgement(
            domain_types::ImportFeatureKind::TextEffects,
            "ooxml-wordart",
            domain_types::ImportRecoverability::FullySupported,
            loaded_count_message(
                text_effect_count,
                "text-effect object",
                "text-effect objects",
                "OOXML WordArt",
            ),
        );
        diagnostics
            .errors
            .push(domain_types::ParseError::from(diagnostic.clone()));
        report.diagnostics.push(diagnostic);
    }

    diagnostics.import_report = Some(report.canonicalized());
}

fn compatibility_acknowledgement(
    feature: domain_types::ImportFeatureKind,
    source_id: &str,
    recoverability: domain_types::ImportRecoverability,
    message: String,
) -> domain_types::ImportDiagnostic {
    domain_types::ImportDiagnostic {
        id: domain_types::deterministic_diagnostic_id(
            &domain_types::ImportDiagnosticCode::CompatibilityAcknowledgement,
            None,
            None,
            None,
            None,
            Some(source_id),
        ),
        code: domain_types::ImportDiagnosticCode::CompatibilityAcknowledgement,
        severity: domain_types::ImportSeverity::Info,
        feature,
        recoverability,
        message,
        reference: Some(domain_types::ImportDiagnosticRef {
            feature_kind: Some(feature),
            object_id: Some(source_id.to_string()),
            ..domain_types::ImportDiagnosticRef::default()
        }),
    }
}

fn loaded_count_message(count: usize, singular: &str, plural: &str, source: &str) -> String {
    let noun = if count == 1 { singular } else { plural };
    format!("Loaded {count} {noun} from {source}.")
}

fn detected_count_message(
    count: usize,
    singular: &str,
    plural: &str,
    source: &str,
    caveat: &str,
) -> String {
    let noun = if count == 1 { singular } else { plural };
    format!("Detected {count} {noun} from {source}. {caveat}")
}

fn count_ooxml_smartart_diagrams(sheets: &[FullParsedSheet]) -> usize {
    sheets
        .iter()
        .map(|sheet| sheet.smartart_diagrams.len())
        .sum()
}

fn count_ooxml_wordart_text_effects(sheets: &[FullParsedSheet]) -> usize {
    sheets
        .iter()
        .filter_map(|sheet| sheet.parsed_drawing.as_ref())
        .flat_map(|drawing| drawing.anchors.iter())
        .map(|anchor| {
            let content = match anchor {
                crate::domain::drawings::Anchor::TwoCell(anchor) => &anchor.content,
                crate::domain::drawings::Anchor::OneCell(anchor) => &anchor.content,
                crate::domain::drawings::Anchor::Absolute(anchor) => &anchor.content,
            };
            count_wordart_text_effects_in_content(content)
        })
        .sum()
}

fn count_wordart_text_effects_in_content(
    content: &domain_types::domain::drawings::DrawingContent,
) -> usize {
    match content {
        domain_types::domain::drawings::DrawingContent::Shape(shape) => usize::from(
            shape
                .tx_body
                .as_ref()
                .and_then(|body| body.body_props.from_word_art)
                .unwrap_or(false),
        ),
        domain_types::domain::drawings::DrawingContent::GroupShape(group) => group
            .children
            .iter()
            .map(count_wordart_text_effects_in_content)
            .sum(),
        _ => 0,
    }
}

// =============================================================================
// Sheet conversion
// =============================================================================

fn include_extent_pos(rows: &mut u32, cols: &mut u32, row: u32, col: u32) {
    *rows = (*rows).max(row.saturating_add(1));
    *cols = (*cols).max(col.saturating_add(1));
}

fn include_extent_cell_ref(rows: &mut u32, cols: &mut u32, cell_ref: &CellRef) {
    if let CellRef::Positional { row, col, .. } = cell_ref {
        include_extent_pos(rows, cols, *row, *col);
    }
}

fn include_extent_a1_ref(rows: &mut u32, cols: &mut u32, raw: &str) {
    match compute_parser::ParsedExpr::classify(raw) {
        compute_parser::ParsedExpr::Cell(node) => {
            include_extent_cell_ref(rows, cols, &node.reference);
        }
        compute_parser::ParsedExpr::Range(range) if range.range_type == RangeType::CellRange => {
            include_extent_cell_ref(rows, cols, &range.start);
            include_extent_cell_ref(rows, cols, &range.end);
        }
        _ => {}
    }
}

fn is_style_only_cell(cell: &CellData) -> bool {
    cell.value.is_null()
        && cell.formula.is_none()
        && cell.style_id.is_some()
        && cell.cell_formula.is_none()
        && !cell.cm
        && cell.formula_result_type.is_none()
        && !cell.has_empty_cached_value
        && cell.vm.is_none()
        && cell.original_sst_index.is_none()
        && cell
            .original_value
            .as_ref()
            .is_none_or(|value| value.is_empty())
}

fn coalesce_style_only_points(points: &[(u32, u32, u32)]) -> Vec<AuthoredStyleRun> {
    if points.is_empty() {
        return Vec::new();
    }

    let mut points = points.to_vec();
    points.sort_unstable();
    points.dedup();

    let mut row_runs: Vec<AuthoredStyleRun> = Vec::new();
    for (row, col, style_id) in points {
        if let Some(last) = row_runs.last_mut()
            && last.start_row == row
            && last.end_row == row
            && last.style_id == style_id
            && last.end_col.saturating_add(1) == col
        {
            last.end_col = col;
            continue;
        }
        row_runs.push(AuthoredStyleRun {
            start_row: row,
            start_col: col,
            end_row: row,
            end_col: col,
            style_id,
        });
    }

    let mut rectangles: Vec<AuthoredStyleRun> = Vec::new();
    let mut active: std::collections::HashMap<(u32, u32, u32), usize> =
        std::collections::HashMap::new();
    for run in row_runs {
        let key = (run.start_col, run.end_col, run.style_id);
        if let Some(&idx) = active.get(&key)
            && rectangles[idx].end_row.saturating_add(1) == run.start_row
        {
            rectangles[idx].end_row = run.end_row;
            continue;
        }
        let idx = rectangles.len();
        active.insert(key, idx);
        rectangles.push(run);
    }

    rectangles.sort_by_key(|r| (r.start_row, r.start_col, r.end_row, r.end_col, r.style_id));
    rectangles
}

fn normalize_authored_style_runs(runs: &mut Vec<AuthoredStyleRun>) {
    runs.retain(|run| run.start_row <= run.end_row && run.start_col <= run.end_col);
    runs.sort_by_key(|r| (r.start_row, r.start_col, r.end_row, r.end_col, r.style_id));
    runs.dedup();
}

fn compute_sheet_extent(sheet: &FullParsedSheet) -> (u32, u32) {
    // Account for dimension data and metadata-only anchors in addition to
    // concrete <c> cells. Phantom-cell hydration for merges, comments, and
    // hyperlinks needs row/col identities even when the anchor has no cell data.
    let (mut rows, mut cols) = compute_dimensions(&sheet.cells);

    if let Some(dim_rows) = sheet.row_heights.iter().map(|rh| rh.row + 1).max() {
        rows = rows.max(dim_rows);
    }
    if let Some(desc_rows) = sheet.row_descents.keys().map(|&r| r + 1).max() {
        rows = rows.max(desc_rows);
    }
    if let Some(dim_cols) = sheet.col_widths.iter().map(|cw| cw.max).max() {
        // ColWidth::max is 1-based, so it already equals the required count.
        cols = cols.max(dim_cols);
    }

    for merge in &sheet.merges {
        include_extent_pos(&mut rows, &mut cols, merge.start_row, merge.start_col);
        include_extent_pos(&mut rows, &mut cols, merge.end_row, merge.end_col);
    }
    for comment in &sheet.comments {
        if let Some((row, col)) = crate::infra::a1::parse_a1_cell(&comment.cell_ref) {
            include_extent_pos(&mut rows, &mut cols, row, col);
        }
    }
    for hyperlink in &sheet.hyperlinks {
        include_extent_a1_ref(&mut rows, &mut cols, &hyperlink.cell_ref);
    }
    for run in &sheet.authored_style_runs {
        include_extent_pos(&mut rows, &mut cols, run.end_row, run.end_col);
    }

    (rows, cols)
}

fn extend_sheet_data_extent(sheet: &mut SheetData) {
    let mut rows = sheet.rows;
    let mut cols = sheet.cols;

    for cell in &sheet.cells {
        include_extent_pos(&mut rows, &mut cols, cell.row, cell.col);
    }
    for row in &sheet.dimensions.row_heights {
        rows = rows.max(row.row.saturating_add(1));
    }
    for col in &sheet.dimensions.col_widths {
        cols = cols.max(col.col.saturating_add(1));
    }
    for row_style in &sheet.row_styles {
        rows = rows.max(row_style.row.saturating_add(1));
    }
    for col_style in &sheet.col_styles {
        cols = cols.max(col_style.col.saturating_add(1));
    }
    for run in &sheet.authored_style_runs {
        include_extent_pos(&mut rows, &mut cols, run.end_row, run.end_col);
    }
    for merge in &sheet.merges {
        include_extent_pos(&mut rows, &mut cols, merge.start_row, merge.start_col);
        include_extent_pos(&mut rows, &mut cols, merge.end_row, merge.end_col);
    }
    for comment in &sheet.comments {
        if let Some((row, col)) = crate::infra::a1::parse_a1_cell(&comment.cell_ref) {
            include_extent_pos(&mut rows, &mut cols, row, col);
        }
    }
    for hyperlink in &sheet.hyperlinks {
        include_extent_a1_ref(&mut rows, &mut cols, &hyperlink.cell_ref);
    }

    sheet.rows = rows;
    sheet.cols = cols;
}

fn build_media_data_url_map(result: &FullParseResult) -> HashMap<String, String> {
    let mut data_urls = HashMap::new();

    let Some(extensions) = result.extensions.as_ref() else {
        return data_urls;
    };

    for (path, data) in extensions.binary_passthrough.entries() {
        let normalized = path.replace('\\', "/");
        if !normalized.starts_with("xl/media/") {
            continue;
        }

        let mime = image_mime_type_for_path(&normalized);
        let encoded = base64::engine::general_purpose::STANDARD.encode(data);
        let data_url = format!("data:{mime};base64,{encoded}");

        data_urls.insert(normalized.clone(), data_url.clone());
        if let Some(file_name) = normalized.strip_prefix("xl/media/") {
            data_urls.insert(format!("../media/{file_name}"), data_url.clone());
            data_urls.insert(format!("media/{file_name}"), data_url.clone());
            data_urls.insert(file_name.to_string(), data_url);
        }
    }

    data_urls
}

fn image_mime_type_for_path(path: &str) -> &'static str {
    match path
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "webp" => "image/webp",
        "tif" | "tiff" => "image/tiff",
        "svg" | "svgz" => "image/svg+xml",
        "emf" => "image/x-emf",
        "wmf" => "image/x-wmf",
        _ => "application/octet-stream",
    }
}

/// Convert a single `FullParsedSheet` into `SheetData` + `SheetRoundTripContext`.
fn convert_sheet(
    sheet: &FullParsedSheet,
    shared_strings: &[String],
    shared_strings_rich_runs: &[Option<Vec<domain_types::RichTextRun>>],
    shared_strings_phonetic_xml: &[Option<Vec<u8>>],
    dxfs: &[crate::domain::styles::types::DxfDef],
    theme_colors: &[String],
    media_data_urls: &HashMap<String, String>,
) -> (SheetData, SheetRoundTripContext) {
    // --- Cells ---
    let projection_roles = build_projection_roles(&sheet.cells);
    let compact_sst_provenance = env_flag_default_true("MOG_XLSX_COMPACT_SST_PROVENANCE");
    let compact_numeric_provenance = env_flag_default_true("MOG_XLSX_COMPACT_NUMERIC_PROVENANCE");
    let compact_non_formula_cached_type =
        env_flag_default_true("MOG_XLSX_COMPACT_NON_FORMULA_CACHED_TYPE");
    let sst_compaction = compact_sst_provenance.then(|| {
        SharedStringProvenanceCompaction::from_shared_strings(
            shared_strings,
            shared_strings_rich_runs,
            shared_strings_phonetic_xml,
        )
    });
    let converted_cells: Vec<CellData> = sheet
        .cells
        .iter()
        .map(|c| {
            let role = projection_roles
                .get(&(c.row, c.col))
                .copied()
                .unwrap_or_default();
            convert_cell_with_projection_role_and_provenance(
                c,
                shared_strings,
                role,
                sst_compaction.as_ref(),
                compact_numeric_provenance,
                compact_non_formula_cached_type,
            )
        })
        .collect();
    let mut authored_style_points = Vec::new();
    let mut cells = Vec::with_capacity(converted_cells.len());
    for cell in converted_cells {
        if is_style_only_cell(&cell) {
            authored_style_points.push((cell.row, cell.col, cell.style_id.unwrap_or(0)));
        } else {
            cells.push(cell);
        }
    }
    let mut authored_style_runs = sheet.authored_style_runs.clone();
    authored_style_runs.extend(coalesce_style_only_points(&authored_style_points));
    normalize_authored_style_runs(&mut authored_style_runs);
    // --- Dimensions ---
    let (rows, cols) = compute_sheet_extent(sheet);

    let mut row_heights: Vec<RowDimension> = sheet
        .row_heights
        .iter()
        .map(|rh| RowDimension {
            row: rh.row,
            height: rh.height,
            custom_height: rh.custom_height,
            hidden: rh.hidden.unwrap_or(false),
            custom_format: rh.custom_format,
            descent: sheet.row_descents.get(&rh.row).copied(),
        })
        .collect();
    // Add descent-only entries for rows that have dyDescent but no RowHeight entry.
    // Without this, per-row dyDescent data is lost for rows without explicit height/style.
    {
        let existing_rows: std::collections::HashSet<u32> =
            row_heights.iter().map(|rd| rd.row).collect();
        for (&row, &d) in &sheet.row_descents {
            if !existing_rows.contains(&row) {
                row_heights.push(RowDimension {
                    row,
                    height: 0.0,
                    custom_height: false,
                    hidden: false,
                    custom_format: false,
                    descent: Some(d),
                });
            }
        }
        row_heights.sort_by_key(|rd| rd.row);
    }

    // Expand OOXML column ranges (min..=max) into individual ColDimension
    // entries, but cap at the data column count. Ranges that extend beyond
    // the data region (typically <col max="16384">) are stored separately
    // as trailing_col_ranges for round-trip fidelity — no ColIds are
    // allocated for those columns during hydration.
    let mut col_widths: Vec<ColDimension> = Vec::new();
    let mut trailing_col_ranges: Vec<TrailingColRange> = Vec::new();
    for cw in &sheet.col_widths {
        let width = cw.width.unwrap_or(0.0);
        // 1-indexed boundary: columns beyond this are "trailing"
        let boundary_1 = cols; // cols is count, equals max_0_indexed + 1
        let effective_max = cw.max.min(boundary_1);
        // Expand the in-data portion into individual ColDimension entries
        if cw.min <= effective_max {
            for one_based in cw.min..=effective_max {
                col_widths.push(ColDimension {
                    col: one_based.saturating_sub(1),
                    width,
                    custom_width: cw.custom_width,
                    hidden: cw.hidden,
                    best_fit: cw.best_fit,
                    collapsed: cw.collapsed,
                });
            }
        }
        // If the range extends beyond data cols, store the tail as a trailing range
        if cw.max > boundary_1 {
            let trailing_min = (boundary_1 + 1).max(cw.min);
            trailing_col_ranges.push(TrailingColRange {
                min: trailing_min,
                max: cw.max,
                width,
                custom_width: cw.custom_width,
                hidden: cw.hidden,
                best_fit: cw.best_fit,
                collapsed: cw.collapsed,
                style_id: cw.style.filter(|&s| s > 0).map(|s| s as u32),
            });
        }
    }

    let dimensions = SheetDimensions {
        default_row_height: sheet.default_row_height,
        default_col_width: sheet.default_col_width,
        default_row_descent: sheet.default_row_descent,
        base_col_width: sheet.base_col_width,
        custom_height: sheet.custom_height,
        zero_height: sheet.zero_height,
        outline_level_row: sheet.outline_level_row,
        outline_level_col: sheet.outline_level_col,
        row_heights,
        col_widths,
        trailing_col_ranges,
    };

    // --- Merges ---
    let merges: Vec<MergeRegion> = sheet
        .merges
        .iter()
        .map(|m| MergeRegion {
            start_row: m.start_row,
            start_col: m.start_col,
            end_row: m.end_row,
            end_col: m.end_col,
        })
        .collect();

    // --- Frozen pane ---
    let frozen_pane = sheet.frozen_pane.as_ref().map(|fp| FrozenPane {
        rows: fp.y_split as u32,
        cols: fp.x_split as u32,
        top_left_cell: fp.top_left_cell.clone(),
    });

    // --- Sheet view ---
    let view = sheet
        .view_options
        .first()
        .map(|v| {
            let (scroll_row, scroll_col) = v
                .top_left_cell
                .as_deref()
                .and_then(crate::infra::a1::parse_a1_cell)
                .unwrap_or((0, 0));

            // Extract the primary selection (last selection element, or the one without
            // a pane attribute). In OOXML, the last <selection> is the active one.
            let primary_selection = v.selections.last();
            let active_cell = primary_selection.and_then(|s| s.active_cell.clone());
            let sqref = primary_selection.and_then(|s| s.sqref.clone());

            SheetView {
                show_gridlines: v.show_grid_lines,
                show_row_col_headers: v.show_row_col_headers,
                show_zeros: v.show_zeros,
                show_outline_symbols: v.show_outline_symbols,
                show_formulas: v.show_formulas,
                right_to_left: v.right_to_left,
                show_ruler: v.show_ruler,
                show_white_space: v.show_white_space,
                default_grid_color: v.default_grid_color,
                window_protection: v.window_protection,
                color_id: if v.color_id == 64 {
                    None
                } else {
                    Some(v.color_id)
                },
                zoom_scale: if v.zoom_scale == 100 {
                    None
                } else {
                    Some(v.zoom_scale)
                },
                zoom_scale_normal: if v.zoom_scale_normal == 0 {
                    None
                } else {
                    Some(v.zoom_scale_normal)
                },
                view: v.view.clone(),
                zoom_scale_page_layout_view: v.zoom_scale_page_layout_view,
                zoom_scale_sheet_layout_view: v.zoom_scale_sheet_layout_view,
                scroll_row,
                scroll_col,
                has_explicit_top_left_cell: v.top_left_cell.is_some(),
                tab_selected: v.tab_selected,
                active_cell,
                sqref,
                selections: v.selections.clone(),
            }
        })
        .unwrap_or_default();

    // Extra sheet views (index 1+) for round-trip fidelity of multiple <sheetView> elements.
    let extra_sheet_views: Vec<ooxml_types::worksheet::SheetView> = sheet
        .view_options
        .iter()
        .skip(1)
        .map(|v| v.clone().into())
        .collect();

    // --- Comments ---
    let mut comments: Vec<Comment> = sheet
        .comments
        .iter()
        .map(|c| {
            let author = sheet
                .comment_authors
                .get(c.author_id as usize)
                .cloned()
                .unwrap_or_default();
            Comment {
                id: String::new(),
                cell_ref: c.cell_ref.clone(),
                author,
                author_id: None,
                author_email: None,
                content: Some(c.text.clone()),
                runs: convert_comment_runs(&c.runs),
                thread_id: None,
                parent_id: None,
                person_id: None,
                resolved: Some(false),
                timestamp: None,
                created_at: None,
                modified_at: None,
                xr_uid: c.xr_uid.clone(),
                shape_id: c.shape_id,
                ext_lst_xml: None,
                content_type: None,
                mentions: Vec::new(),
                comment_type: domain_types::domain::comment::CommentType::Note,
                visible: None,
                note_height: None,
                note_width: None,
            }
        })
        .collect();

    // --- Hydrate VML shape data (visible, note_height, note_width) onto note comments ---
    {
        use crate::domain::comments::read::parse_vml_shapes;
        struct ShapeData {
            visible: bool,
            note_height: Option<f64>,
            note_width: Option<f64>,
        }
        let mut shape_by_cell: HashMap<String, ShapeData> = HashMap::new();
        for (_, bytes, _) in &sheet.raw_vml_drawings {
            for shape in parse_vml_shapes(bytes) {
                if let Some(ref cell_ref) = shape.cell_ref {
                    shape_by_cell.insert(
                        cell_ref.clone(),
                        ShapeData {
                            visible: shape.visible,
                            note_height: shape.note_height,
                            note_width: shape.note_width,
                        },
                    );
                }
            }
        }
        if !shape_by_cell.is_empty() {
            for comment in comments.iter_mut() {
                if let Some(data) = shape_by_cell.get(&comment.cell_ref) {
                    if data.visible {
                        comment.visible = Some(true);
                    }
                    comment.note_height = data.note_height;
                    comment.note_width = data.note_width;
                }
            }
        }
    }

    // --- Hyperlinks ---
    // Build a lookup from relationship ID to target URL for resolving external hyperlinks.
    let rel_map: HashMap<&str, (&str, Option<&str>)> = sheet
        .sheet_opc_rels
        .iter()
        .map(|r| (r.id.as_str(), (r.target.as_str(), r.target_mode.as_deref())))
        .collect();

    let hyperlinks: Vec<Hyperlink> = sheet
        .hyperlinks
        .iter()
        .map(|h| {
            let location = non_empty(&h.location);
            let display = non_empty(&h.display);
            let tooltip = non_empty(&h.tooltip);
            // Resolve external URL from the relationship ID via sheet OPC rels.
            let rel = h.r_id.as_deref().and_then(|rid| rel_map.get(rid).copied());
            let target = rel.map(|(target, _)| target.to_string());
            let target_kind = h.target_kind.or_else(|| {
                if h.r_id.is_some() {
                    Some(HyperlinkTargetKind::Relationship)
                } else if location.is_some() {
                    Some(HyperlinkTargetKind::InlineLocation)
                } else {
                    None
                }
            });
            let target_mode = h
                .target_mode
                .clone()
                .or_else(|| rel.and_then(|(_, target_mode)| target_mode.map(str::to_string)));
            Hyperlink {
                cell_ref: h.cell_ref.clone(),
                target,
                location,
                display,
                tooltip,
                uid: h.uid.clone(),
                target_kind,
                target_mode,
            }
        })
        .collect();

    // --- Row/Col styles ---
    let row_styles: Vec<RowStyleEntry> = sheet
        .row_heights
        .iter()
        .filter(|rh| rh.style.map(|s| s > 0).unwrap_or(false))
        .map(|rh| RowStyleEntry {
            row: rh.row,
            style_id: rh.style.unwrap() as u32,
        })
        .collect();

    // Cap col_styles expansion at data cols, matching col_widths treatment.
    // Trailing col styles are already captured in trailing_col_ranges.style_id.
    let col_styles: Vec<ColStyleEntry> = sheet
        .col_widths
        .iter()
        .filter(|cw| cw.style.map(|s| s > 0).unwrap_or(false))
        .flat_map(|cw| {
            let style_id = cw.style.unwrap() as u32;
            let effective_max = cw.max.min(cols);
            (cw.min..=effective_max).map(move |one_based| ColStyleEntry {
                col: one_based.saturating_sub(1),
                style_id,
            })
        })
        .collect();

    // --- Sheet protection ---
    let protection = sheet.protection.as_ref().map(|p| {
        domain_types::SheetProtection {
            is_protected: p.sheet,
            password_hash: None,
            algorithm_name: None,
            salt_value: None,
            spin_count: None,
            // In OOXML, selectLockedCells/selectUnlockedCells default to false
            // (meaning selection IS allowed). The domain type inverts the sense:
            // true = user can select. So we negate the parser's value.
            select_locked: !p.select_locked_cells,
            select_unlocked: !p.select_unlocked_cells,
            // OOXML permission attributes use inverted semantics: "1" = prohibited,
            // "0" = allowed. Parser stores raw OOXML booleans (true = prohibited).
            // Domain type uses intuitive semantics (true = allowed), so negate.
            format_cells: !p.format_cells,
            format_columns: !p.format_columns,
            format_rows: !p.format_rows,
            insert_columns: !p.insert_columns,
            insert_rows: !p.insert_rows,
            insert_hyperlinks: !p.insert_hyperlinks,
            delete_columns: !p.delete_columns,
            delete_rows: !p.delete_rows,
            sort: !p.sort,
            auto_filter: !p.auto_filter,
            pivot_tables: !p.pivot_tables,
            objects: p.objects,
            scenarios: p.scenarios,
        }
    });

    // --- Domain object conversions ---
    // Build charts from parsed_charts (which have lossless ChartSpace) rather than
    // the lossy charts field (which has custom JSON that can't round-trip).
    let mut charts = convert_parsed_charts_to_chart_specs(sheet);
    charts.extend(convert_parsed_chart_ex_to_chart_specs(sheet));
    let conditional_formats =
        convert_conditional_formats(&sheet.conditional_formatting_full, dxfs, theme_colors);
    let data_validations = convert_data_validations(&sheet.data_validations);
    // Slicers and anchors are already ooxml-types — pass through directly
    let slicers = sheet.slicers.clone();
    let slicer_anchors = sheet.slicer_anchors.clone();
    let print_settings = sheet
        .print_settings
        .as_ref()
        .map(|settings| convert_print_settings(settings, &sheet.sheet_opc_rels));
    let page_breaks = sheet.page_breaks.as_ref().map(convert_page_breaks);
    let (sparklines, sparkline_groups) =
        convert_sparkline_groups(&sheet.sparkline_groups, &sheet.name);
    let outline_groups = compute_outline_groups(&sheet.row_heights, &sheet.col_widths);
    // Unified floating objects: merge all drawing-based objects, connectors,
    // form controls, OLE objects into a single Vec<FloatingObject>.
    let mut floating_objects =
        convert_floating_objects(sheet.parsed_drawing.as_ref(), media_data_urls);
    floating_objects.extend(convert_connectors(&sheet.connectors));
    floating_objects.extend(convert_form_controls(&sheet.form_controls));
    floating_objects.extend(convert_ole_objects(&sheet.ole_objects));

    // --- Header/footer images ---
    // Parse HF images from VML drawings and resolve image rel IDs to file paths.
    let hf_images = convert_hf_images(sheet);

    // --- Build SheetData ---
    let sheet_data = SheetData {
        name: sheet.name.clone(),
        rows,
        cols,
        sheet_id: sheet.sheet_id,
        visibility: sheet.state,
        uid: sheet.uid.clone(),
        cells,
        authored_style_runs,
        dimensions,
        merges,
        frozen_pane,
        view,
        row_styles,
        col_styles,
        // Domain objects
        charts,
        conditional_formats,
        comments,
        hyperlinks,
        data_validations,
        sparklines,
        sparkline_groups,
        tables: Vec::new(), // Populated by caller with per-sheet tables.
        slicers,
        slicer_anchors,
        floating_objects,
        print_settings,
        page_breaks,
        hf_images,
        protection,
        // Typed OOXML preservation: typed auto_filter flows from the parse path
        // directly; the former `SheetRoundTripContext.auto_filter_xml`
        // raw-XML passthrough is deleted.
        auto_filter: sheet.auto_filter.clone(),
        // Typed OOXML preservation: standalone worksheet-level sort state now flows
        // through the typed field rather than through
        // `SheetRoundTripContext.sort_state_xml`.
        sort_state: sheet.sort_state.clone(),
        data_validations_declared_count: sheet.data_validations_declared_count,
        data_validations_disable_prompts: sheet.data_validations_disable_prompts,
        data_validations_x_window: sheet.data_validations_x_window,
        data_validations_y_window: sheet.data_validations_y_window,
        outline_groups,
        outline_properties: sheet.outline_properties.clone(),
        extra_sheet_views,
    };

    // --- Build SheetRoundTripContext ---
    let sheet_rt = SheetRoundTripContext {
        sheet_opc_rels: Vec::new(),
        raw_vml_drawings: sheet
            .raw_vml_drawings
            .iter()
            .map(|(path, data, rels)| VmlDrawingPart {
                path: path.clone(),
                data: data.clone(),
                rels: rels.as_ref().map(|(rp, rd)| VmlRels {
                    path: rp.clone(),
                    data: rd.clone(),
                }),
            })
            .collect(),
        legacy_drawing_r_id: sheet.legacy_drawing_r_id.clone(),
        legacy_drawing_hf_r_id: sheet.legacy_drawing_hf_r_id.clone(),
        comments_root_namespace_attrs: sheet.comments_root_namespace_attrs.clone(),
        comment_authors: sheet.comment_authors.clone(),
        row_spans: sheet.row_spans.clone(),
        bare_empty_rows: sheet.bare_empty_rows.clone(),
        row_thick_bot: sheet
            .row_heights
            .iter()
            .filter(|rh| rh.thick_bot)
            .map(|rh| rh.row)
            .collect(),
        row_thick_top: sheet
            .row_heights
            .iter()
            .filter(|rh| rh.thick_top)
            .map(|rh| rh.row)
            .collect(),
        row_collapsed: sheet
            .row_heights
            .iter()
            .filter_map(|rh| rh.collapsed.map(|c| (rh.row, c)))
            .collect(),
        row_hidden_explicit_false: sheet
            .row_heights
            .iter()
            .filter(|rh| rh.hidden == Some(false))
            .map(|rh| rh.row)
            .collect(),
        row_outline_level_zero: sheet
            .row_heights
            .iter()
            .filter(|rh| rh.outline_level == Some(0))
            .map(|rh| rh.row)
            .collect(),
        has_empty_ext_lst: sheet.has_empty_ext_lst,
        ext_lst_xml: sheet.ext_lst_xml.clone(),
        preserved_namespace_attrs: Vec::new(), // populated per-sheet from extensions below
        custom_properties_xml: None,
        sheet_preserved_elements: Vec::new(),
        // Collect drawing anchor passthroughs: twoCellAnchors with content-level
        // mc:AlternateContent (e.g., ChartEx wrapped in mc:AlternateContent).
        // These need verbatim round-trip to preserve the mc wrapper, fallback shape,
        // original relationship IDs, and cNvPr extensions (creationId, etc.).
        drawing_anchor_passthroughs: sheet
            .parsed_drawing
            .as_ref()
            .map(|d| {
                d.anchors
                    .iter()
                    .enumerate()
                    .filter_map(|(idx, a)| {
                        match a {
                            crate::domain::drawings::Anchor::TwoCell(tc) => {
                                if let Some(ref mc) = tc.mc_alternate_content {
                                    // Only include content-level mc:AlternateContent (starts with <xdr:twoCellAnchor).
                                    // Form control mc:AlternateContent wraps the anchor (starts with <mc:AlternateContent)
                                    // and must NOT be included — form controls are handled via the floating objects path.
                                    if mc.raw_xml.starts_with("<xdr:twoCellAnchor") {
                                        return Some((idx, mc.raw_xml.clone()));
                                    }
                                }
                            }
                            crate::domain::drawings::Anchor::OneCell(oc) => {
                                if let Some(ref mc) = oc.mc_alternate_content {
                                    // Content-level mc:AlternateContent in oneCellAnchors
                                    // (e.g., slicer/timeslicer graphicFrames).
                                    if mc.raw_xml.starts_with("<xdr:oneCellAnchor") {
                                        return Some((idx, mc.raw_xml.clone()));
                                    }
                                }
                            }
                            _ => {}
                        }
                        None
                    })
                    .collect()
            })
            .unwrap_or_default(),
        imported_drawing: sheet.parsed_drawing.as_ref().and_then(|d| {
            let owner_path = format!("xl/worksheets/sheet{}.xml", sheet.index + 1);
            let path = sheet
                .sheet_opc_rels
                .iter()
                .find(|r| r.rel_type == REL_DRAWING)
                .and_then(|r| resolve_relationship_target(Some(&owner_path), &r.target).ok())?;
            let data = d.raw_drawing_xml.clone()?;
            let rels = d.raw_drawing_rels_xml.clone().map(|data| {
                let filename = path.rsplit('/').next().unwrap_or("drawing.xml");
                BlobPart {
                    path: format!("xl/drawings/_rels/{filename}.rels"),
                    data,
                }
            });
            Some(domain_types::ImportedDrawingPart { path, data, rels })
        }),
        drawing_root_namespace_attrs: sheet
            .parsed_drawing
            .as_ref()
            .map(|d| d.root_namespace_attrs.clone())
            .unwrap_or_default(),
        original_drawing_path: sheet
            .sheet_opc_rels
            .iter()
            .find(|r| r.rel_type == REL_DRAWING)
            .and_then(|r| {
                let owner_path = format!("xl/worksheets/sheet{}.xml", sheet.index + 1);
                resolve_relationship_target(Some(&owner_path), &r.target).ok()
            }),
        // Preserve drawing OPC rels for relationship ID fidelity.
        drawing_opc_rels: sheet
            .parsed_drawing
            .as_ref()
            .map(|d| {
                d.opc_rels
                    .iter()
                    .map(|r| domain_types::OpcRelationship {
                        id: r.id.clone(),
                        rel_type: r.rel_type.clone(),
                        target: r.target.clone(),
                        target_mode: r.target_mode.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        // Preserve whether a drawing .rels file existed (even if empty).
        has_drawing_rels_file: sheet
            .parsed_drawing
            .as_ref()
            .map(|d| d.has_rels_file)
            .unwrap_or(false),
        // Preserve whether the original <mergeCells> had a count attribute.
        merge_cells_has_count: sheet.merge_cells_has_count,
    };

    (sheet_data, sheet_rt)
}

// =============================================================================
// Threaded comments merging
// =============================================================================

/// Threaded comment relationship type URI.
const REL_TYPE_THREADED_COMMENT: &str =
    "http://schemas.microsoft.com/office/2017/10/relationships/threadedComment";

/// Parse persons from `xl/persons/person.xml` and merge threaded comment data
/// into the per-sheet `Comment` entries. Returns the workbook-level person list.
///
/// For each sheet that has a threadedComment relationship in its OPC rels:
/// 1. Find the corresponding raw threaded comment XML from `result.raw_threaded_comments`
/// 2. Parse the threaded comments
/// 3. Merge threaded comment data (person_id, parent_id, timestamp, actual text)
///    into legacy comments matched by relationship-backed candidate ids.
fn merge_threaded_comments(result: &FullParseResult, sheets: &mut [SheetData]) -> Vec<PersonInfo> {
    use crate::domain::comments::read::parse_threaded_comments;

    // 1. Parse persons from person.xml
    let persons: Vec<PersonInfo> = result
        .raw_persons_xml
        .as_ref()
        .map(|xml| {
            // parse_persons is a private fn in comments::read, but parse_threaded_comments
            // extracts persons from the ThreadedComments element. Since person.xml is standalone,
            // we parse it directly with our SIMD scanner.
            parse_person_xml(xml)
        })
        .unwrap_or_default();

    // Build person lookup: person_id → display_name
    let person_names: HashMap<&str, &str> = persons
        .iter()
        .map(|p| (p.id.as_str(), p.display_name.as_str()))
        .collect();

    // 2. Build a map of archive path → raw threaded comment bytes
    let tc_bytes_map: HashMap<&str, &[u8]> = result
        .raw_threaded_comments
        .iter()
        .map(|(path, data)| (path.as_str(), data.as_slice()))
        .collect();

    // 3. For each sheet, merge threaded comments
    for (sheet_idx, sheet_data) in sheets.iter_mut().enumerate() {
        let parsed_sheet = match result.sheets.get(sheet_idx) {
            Some(s) => s,
            None => continue,
        };

        // Find the threaded comment target from this sheet's OPC rels
        let tc_path = parsed_sheet.sheet_opc_rels.iter().find_map(|rel| {
            if rel.rel_type == REL_TYPE_THREADED_COMMENT {
                let owner_path = format!("xl/worksheets/sheet{}.xml", parsed_sheet.index + 1);
                resolve_relationship_target(Some(&owner_path), &rel.target).ok()
            } else {
                None
            }
        });

        let tc_path = match tc_path {
            Some(p) => p,
            None => continue, // No threaded comments for this sheet
        };

        // Find the raw XML for this threaded comment file
        let tc_xml = match tc_bytes_map.get(tc_path.as_str()) {
            Some(xml) => *xml,
            None => continue,
        };

        // Parse the threaded comments
        let threaded = parse_threaded_comments(tc_xml);
        if threaded.comments.is_empty() {
            continue;
        }

        // Build lookup: threaded comment id → threaded comment
        let tc_by_id: HashMap<&str, &crate::domain::comments::read::ThreadedComment> = threaded
            .comments
            .iter()
            .map(|tc| (tc.id.as_str(), tc))
            .collect();

        // Merge into legacy comments only when a relationship-backed threaded part
        // contains an id matching the legacy fallback marker (`tc=...`) or xr:uid.
        for comment in &mut sheet_data.comments {
            let matched_thread_id = threaded_candidate_ids(comment)
                .find(|id| tc_by_id.contains_key(*id))
                .map(str::to_string);

            if let Some(tc) = matched_thread_id
                .as_deref()
                .and_then(|id| tc_by_id.get(id).copied())
            {
                // Enrich with threaded comment data
                comment.thread_id = Some(tc.id.clone());
                comment.person_id = Some(tc.person_id.clone());
                comment.parent_id = tc.parent_id.clone();
                comment.timestamp = tc.created.clone();
                comment.resolved = Some(tc.done);
                comment.ext_lst_xml = tc.ext_lst_xml.clone();
                comment.comment_type = domain_types::domain::comment::CommentType::ThreadedComment;
                comment.xr_uid = None;

                // Replace the legacy stub text with the actual threaded comment text.
                // Legacy comments for threaded comments contain "[Threaded comment]..." placeholder.
                comment.content = Some(tc.text.clone());

                // Resolve author display name from person list
                if let Some(name) = person_names.get(tc.person_id.as_str()) {
                    comment.author = name.to_string();
                }

                // Enrich with mention data if present
                use domain_types::domain::comment::{CommentContentType, CommentMention};
                comment.mentions = tc
                    .mentions
                    .iter()
                    .map(|m| {
                        let display_text = person_names
                            .get(m.mention_person_id.as_str())
                            .map(|s| s.to_string())
                            .unwrap_or_default();
                        CommentMention {
                            display_text,
                            user_id: m.mention_person_id.clone(),
                            email: None,
                            start_index: m.start_index,
                            length: m.length,
                        }
                    })
                    .collect();
                comment.content_type = if comment.mentions.is_empty() {
                    None
                } else {
                    Some(CommentContentType::Mention)
                }
            }
        }

        // Add threaded comment replies that don't have a legacy comment counterpart.
        // Replies (parent_id != None) may not have separate legacy comments — they share
        // the parent's legacy comment. We need to add them as separate Comment entries.
        let existing_ids: HashSet<String> = sheet_data
            .comments
            .iter()
            .filter_map(|c| c.thread_id.clone())
            .collect();

        let tc_order: HashMap<&str, usize> = threaded
            .comments
            .iter()
            .enumerate()
            .map(|(i, tc)| (tc.id.as_str(), i))
            .collect();

        for tc in &threaded.comments {
            if existing_ids.contains(tc.id.as_str()) {
                continue; // Already merged
            }
            // This is a threaded comment without a legacy counterpart (typically a reply)
            let author = person_names
                .get(tc.person_id.as_str())
                .map(|s| s.to_string())
                .unwrap_or_default();

            // Extract mention data from parsed threaded comment
            let (content_type, mentions) = if tc.mentions.is_empty() {
                (None, Vec::new())
            } else {
                use domain_types::domain::comment::{CommentContentType, CommentMention};
                let m: Vec<CommentMention> = tc
                    .mentions
                    .iter()
                    .map(|m| {
                        // Resolve display_text from person list if available
                        let display_text = person_names
                            .get(m.mention_person_id.as_str())
                            .map(|s| s.to_string())
                            .unwrap_or_default();
                        CommentMention {
                            display_text,
                            user_id: m.mention_person_id.clone(),
                            email: None,
                            start_index: m.start_index,
                            length: m.length,
                        }
                    })
                    .collect();
                (Some(CommentContentType::Mention), m)
            };

            let comment = Comment {
                id: String::new(),
                cell_ref: tc.cell_ref.clone(),
                author,
                author_id: None,
                author_email: None,
                content: Some(tc.text.clone()),
                runs: Vec::new(),
                thread_id: Some(tc.id.clone()),
                parent_id: tc.parent_id.clone(),
                person_id: Some(tc.person_id.clone()),
                resolved: Some(tc.done),
                timestamp: tc.created.clone(),
                created_at: None,
                modified_at: None,
                xr_uid: None,
                shape_id: None,
                ext_lst_xml: tc.ext_lst_xml.clone(),
                content_type,
                mentions,
                comment_type: domain_types::domain::comment::CommentType::ThreadedComment,
                visible: None,
                note_height: None,
                note_width: None,
            };
            insert_threaded_comment_in_original_order(&mut sheet_data.comments, comment, &tc_order);
        }
    }

    persons
}

fn insert_threaded_comment_in_original_order(
    comments: &mut Vec<Comment>,
    comment: Comment,
    tc_order: &HashMap<&str, usize>,
) {
    let Some(new_order) = comment
        .thread_id
        .as_deref()
        .and_then(|tid| tc_order.get(tid).copied())
    else {
        comments.push(comment);
        return;
    };

    let mut insert_after: Option<usize> = None;
    let mut insert_before: Option<usize> = None;

    for (idx, existing) in comments.iter().enumerate() {
        let Some(existing_order) = existing
            .thread_id
            .as_deref()
            .and_then(|tid| tc_order.get(tid).copied())
        else {
            continue;
        };

        if existing_order < new_order {
            insert_after = Some(idx);
        } else if existing_order > new_order {
            insert_before = Some(idx);
            break;
        }
    }

    let insert_idx = insert_after
        .map(|idx| idx + 1)
        .or(insert_before)
        .unwrap_or(comments.len());
    comments.insert(insert_idx, comment);
}

fn threaded_candidate_ids(comment: &Comment) -> impl Iterator<Item = &str> {
    let author_marker = comment
        .author
        .strip_prefix("tc=")
        .map(str::trim)
        .filter(|id| !id.is_empty());
    let xr_uid = comment
        .xr_uid
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty());

    author_marker
        .into_iter()
        .chain(xr_uid)
        .scan(HashSet::new(), |seen, id| {
            if seen.insert(id) {
                Some(Some(id))
            } else {
                Some(None)
            }
        })
        .flatten()
}

/// Parse `xl/persons/person.xml` into `Vec<PersonInfo>`.
fn parse_person_xml(xml: &[u8]) -> Vec<PersonInfo> {
    use crate::infra::scanner::{find_gt_simd, find_tag_simd};
    use crate::infra::xml::parse_string_attr;

    let mut persons = Vec::new();
    let mut pos = 0;

    while let Some(person_start) = find_tag_simd(xml, b"person", pos) {
        // Skip "personList" tags
        let after = person_start + 6; // length of "person"
        if after < xml.len() && xml[after] == b'L' {
            pos = person_start + 1;
            continue;
        }

        let tag_end = find_gt_simd(xml, person_start).unwrap_or(xml.len());
        let element = &xml[person_start..tag_end + 1];

        persons.push(PersonInfo {
            display_name: parse_string_attr(element, b"displayName=\"").unwrap_or_default(),
            id: parse_string_attr(element, b"id=\"").unwrap_or_default(),
            user_id: parse_string_attr(element, b"userId=\""),
            provider_id: parse_string_attr(element, b"providerId=\""),
        });

        pos = tag_end + 1;
    }

    persons
}

#[cfg(test)]
mod tests;
