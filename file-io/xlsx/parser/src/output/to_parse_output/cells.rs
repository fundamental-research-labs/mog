//! Cell conversion: projection classification, cell value resolution, and helpers.

use std::sync::Arc;

use domain_types::{
    CellData, FormulaCacheProvenance, FormulaCacheState, FormulaCachedValuePresence,
    ImportedCellProjectionRole,
};
use value_types::{CellError, CellValue};

use crate::output::results::{
    FullCellData, CELL_TYPE_VAL_BOOL as CELL_TYPE_BOOL, CELL_TYPE_VAL_DATE as CELL_TYPE_DATE,
    CELL_TYPE_VAL_EMPTY as CELL_TYPE_EMPTY, CELL_TYPE_VAL_ERROR as CELL_TYPE_ERROR,
    CELL_TYPE_VAL_FORMULA as CELL_TYPE_FORMULA, CELL_TYPE_VAL_NUMBER as CELL_TYPE_NUMBER,
    CELL_TYPE_VAL_STRING as CELL_TYPE_STRING,
};

// Cell type constants for cached formula values
pub(super) const CACHED_VALUE_TYPE_BOOL: u8 = 3;
pub(super) const CACHED_VALUE_TYPE_ERROR: u8 = 4;
pub(super) const CACHED_VALUE_TYPE_STRING: u8 = 6;

#[derive(Debug, Clone)]
pub(super) struct SharedStringProvenanceCompaction {
    recoverable: Vec<bool>,
}

impl SharedStringProvenanceCompaction {
    pub(super) fn from_shared_strings(
        shared_strings: &[String],
        rich_runs: &[Option<Vec<domain_types::RichTextRun>>],
        phonetic_xml: &[Option<Vec<u8>>],
    ) -> Self {
        let mut text_counts = std::collections::HashMap::<&str, usize>::new();
        for text in shared_strings {
            *text_counts.entry(text.as_str()).or_default() += 1;
        }

        let recoverable = shared_strings
            .iter()
            .enumerate()
            .map(|(idx, text)| {
                !text.is_empty()
                    && text_counts.get(text.as_str()) == Some(&1)
                    && rich_runs.get(idx).and_then(Option::as_ref).is_none()
                    && phonetic_xml.get(idx).and_then(Option::as_ref).is_none()
            })
            .collect();

        Self { recoverable }
    }

    #[inline]
    fn is_recoverable(&self, idx: u32) -> bool {
        self.recoverable.get(idx as usize).copied().unwrap_or(false)
    }
}

// =============================================================================
// Projection classification
// =============================================================================

/// Parse an A1-style range reference into 0-based (start_row, start_col, end_row, end_col).
pub(super) fn parse_range_ref(s: &str) -> Option<(u32, u32, u32, u32)> {
    // Array formula `ref` values are rectangular cell ranges. The generic A1
    // parser also accepts whole-row/whole-column ranges, which would let a
    // malformed array declaration claim an entire sheet. A degenerate
    // one-cell declaration (`A1`) is valid for a scalar dynamic-array result
    // and must remain a source even though it has no spill children.
    if s.contains('!') {
        return None;
    }
    let range = compute_parser::parse_a1_range(s)?;
    if range.range_type != formula_types::RangeType::CellRange {
        return None;
    }
    let (
        formula_types::CellRef::Positional {
            row: start_row,
            col: start_col,
            ..
        },
        formula_types::CellRef::Positional {
            row: end_row,
            col: end_col,
            ..
        },
    ) = (range.start, range.end)
    else {
        return None;
    };
    Some((start_row, start_col, end_row, end_col))
}

fn collect_dynamic_spill_ranges(
    cells: &[FullCellData],
    metadata: Option<&crate::output::results::MetadataOutput>,
) -> Vec<(u32, u32, u32, u32)> {
    // Scan declarations once and only retain ranges whose own cell proves it
    // is a dynamic-array source. This keeps the pre-classification pass linear
    // in the sparse worksheet cell list instead of looking up every range in
    // every cell.
    cells
        .iter()
        .filter_map(|cell| {
            let array_ref = cell.array_ref.as_deref()?;
            let range = parse_range_ref(array_ref)?;
            is_dynamic_array_source(cell, metadata).then_some(range)
        })
        .collect()
}

fn cell_in_range(row: u32, col: u32, range: &(u32, u32, u32, u32)) -> bool {
    range_is_well_formed(range)
        && (range.0..=range.2).contains(&row)
        && (range.1..=range.3).contains(&col)
}

fn range_source_position(range: &(u32, u32, u32, u32)) -> (u32, u32) {
    // The first endpoint names the array formula source. Reversed ranges are
    // rejected by `range_is_well_formed` instead of being normalized into a
    // different source position.
    (range.0, range.1)
}

fn range_is_well_formed(range: &(u32, u32, u32, u32)) -> bool {
    range.0 <= range.2 && range.1 <= range.3
}

fn has_formula_owner(cell: &FullCellData) -> bool {
    if cell
        .formula
        .as_deref()
        .is_some_and(|formula| !formula.trim().is_empty())
    {
        return true;
    }

    // The parser preserves a self-closing `<f ca="1"/>` as force-recalc
    // state and an empty Normal CellFormula. It is a cache marker, not an
    // independent formula. Other formula kinds remain owners even when their
    // text is carried by another cell (for example shared-formula children).
    cell.cell_formula.as_ref().is_some_and(|formula| {
        formula.t != ooxml_types::worksheet::CellFormulaType::Normal
            || !formula.text.trim().is_empty()
    })
}

fn is_array_formula_metadata(cell: &FullCellData) -> bool {
    cell.cell_formula
        .as_ref()
        .is_none_or(|formula| formula.t == ooxml_types::worksheet::CellFormulaType::Array)
}

fn is_dynamic_array_source(
    cell: &FullCellData,
    metadata: Option<&crate::output::results::MetadataOutput>,
) -> bool {
    let Some(array_ref) = cell.array_ref.as_deref() else {
        return false;
    };
    let Some(range) = parse_range_ref(array_ref) else {
        return false;
    };
    range_is_well_formed(&range)
        && range_source_position(&range) == (cell.row, cell.col)
        && cell
            .formula
            .as_deref()
            .is_some_and(|formula| !formula.trim().is_empty())
        && is_array_formula_metadata(cell)
        && cell.cell_metadata_index.is_some_and(|cm| {
            metadata.is_some_and(|metadata| cell_metadata_is_dynamic_array(metadata, cm))
        })
}

fn cell_metadata_has_unrelated_entries(
    metadata: &crate::output::results::MetadataOutput,
    cm_index: u32,
) -> bool {
    if cm_index == 0 {
        return true;
    }
    let Some(block_index) = cm_index.checked_sub(1).map(|idx| idx as usize) else {
        return true;
    };
    let Some(block) = metadata.cell_metadata.get(block_index) else {
        return true;
    };
    block.records.is_empty()
        || block
            .records
            .iter()
            .any(|record| !metadata_record_is_dynamic_array(metadata, record.t))
}

fn cell_has_unrelated_metadata(
    cell: &FullCellData,
    metadata: Option<&crate::output::results::MetadataOutput>,
) -> bool {
    let Some(cm_index) = cell.cell_metadata_index else {
        return false;
    };
    metadata.map_or(true, |metadata| {
        cell_metadata_has_unrelated_entries(metadata, cm_index)
    })
}

fn classify_projection_role_with_non_source_matches(
    cell: &FullCellData,
    metadata: Option<&crate::output::results::MetadataOutput>,
    non_source_matches: usize,
) -> ImportedCellProjectionRole {
    if has_formula_owner(cell) {
        if is_dynamic_array_source(cell, metadata) {
            return ImportedCellProjectionRole::DynamicArraySource;
        }
        return ImportedCellProjectionRole::Normal;
    }

    if non_source_matches == 1 && !cell_has_unrelated_metadata(cell, metadata) {
        // Cached children are derived whenever exactly one proven dynamic
        // array claims their coordinate. Excel files vary between an empty
        // `<f ca="1"/>`, a plain cache, and a child carrying XLDAPR `cm`.
        // Unknown metadata remains visible rather than being discarded.
        return ImportedCellProjectionRole::DynamicArraySpillTarget;
    }

    if cell.cell_metadata_index.is_some() {
        return ImportedCellProjectionRole::UnknownCellMetadata;
    }

    ImportedCellProjectionRole::Normal
}

#[cfg(test)]
pub(super) fn classify_projection_role(
    cell: &FullCellData,
    spill_ranges: &[(u32, u32, u32, u32)],
    metadata: Option<&crate::output::results::MetadataOutput>,
) -> ImportedCellProjectionRole {
    let non_source_matches = spill_ranges
        .iter()
        .filter(|range| {
            cell_in_range(cell.row, cell.col, range)
                && (cell.row, cell.col) != range_source_position(range)
        })
        .count();
    classify_projection_role_with_non_source_matches(cell, metadata, non_source_matches)
}

pub(super) fn build_projection_roles(
    cells: &[FullCellData],
    metadata: Option<&crate::output::results::MetadataOutput>,
) -> std::collections::HashMap<(u32, u32), ImportedCellProjectionRole> {
    let spill_ranges = collect_dynamic_spill_ranges(cells, metadata);
    let mut roles = std::collections::HashMap::new();

    // Sweep sparse cells and ranges in row order. Counting every active claim
    // is deliberate: overlapping claims are ambiguous and must not be
    // assigned to whichever source happened to be iterated first.
    let mut ordered_ranges: Vec<usize> = (0..spill_ranges.len()).collect();
    ordered_ranges.sort_unstable_by_key(|&idx| spill_ranges[idx]);
    let mut ordered_cells: Vec<usize> = (0..cells.len()).collect();
    ordered_cells.sort_unstable_by_key(|&idx| (cells[idx].row, cells[idx].col));

    let mut active_ranges = Vec::new();
    let mut next_range = 0;
    let mut next_cell = 0;
    while next_cell < ordered_cells.len() {
        let row = cells[ordered_cells[next_cell]].row;
        while next_range < ordered_ranges.len() && spill_ranges[ordered_ranges[next_range]].0 <= row
        {
            active_ranges.push(ordered_ranges[next_range]);
            next_range += 1;
        }
        active_ranges.retain(|&idx| spill_ranges[idx].2 >= row);

        let row_start = next_cell;
        while next_cell < ordered_cells.len() && cells[ordered_cells[next_cell]].row == row {
            next_cell += 1;
        }

        for &cell_idx in &ordered_cells[row_start..next_cell] {
            let cell = &cells[cell_idx];
            let non_source_matches = active_ranges
                .iter()
                .filter(|&&range_idx| {
                    let range = &spill_ranges[range_idx];
                    cell_in_range(cell.row, cell.col, range)
                        && (cell.row, cell.col) != range_source_position(range)
                })
                .count();
            let role = classify_projection_role_with_non_source_matches(
                cell,
                metadata,
                non_source_matches,
            );
            if role != ImportedCellProjectionRole::Normal {
                roles.insert((cell.row, cell.col), role);
            }
        }
    }
    roles
}

fn cell_metadata_is_dynamic_array(
    metadata: &crate::output::results::MetadataOutput,
    cm_index: u32,
) -> bool {
    let Some(block_index) = cm_index.checked_sub(1).map(|idx| idx as usize) else {
        return false;
    };
    let Some(block) = metadata.cell_metadata.get(block_index) else {
        return false;
    };

    block
        .records
        .iter()
        .any(|record| metadata_record_is_dynamic_array(metadata, record.t))
}

fn metadata_record_is_dynamic_array(
    metadata: &crate::output::results::MetadataOutput,
    type_index: u32,
) -> bool {
    let Some(type_index) = type_index.checked_sub(1).map(|idx| idx as usize) else {
        return false;
    };

    // `rc/@t` is a 1-based index into metadataTypes. Only fall back to the
    // future-metadata order when that type entry is absent; an unrelated
    // metadata type at the same index must not be mistaken for XLDAPR merely
    // because a future group happens to occupy that slot.
    if let Some(metadata_type) = metadata.metadata_types.get(type_index) {
        return metadata_type.name.trim().eq_ignore_ascii_case("XLDAPR");
    }
    metadata
        .future_metadata
        .get(type_index)
        .is_some_and(|group| group.name.trim().eq_ignore_ascii_case("XLDAPR"))
}

// =============================================================================
// Cell conversion
// =============================================================================

/// Convert a single `FullCellData` to `CellData`.
#[cfg(test)]
pub(super) fn convert_cell(cell: &FullCellData, shared_strings: &[String]) -> CellData {
    convert_cell_with_projection_role(cell, shared_strings, ImportedCellProjectionRole::Normal)
}

#[cfg(test)]
pub(super) fn convert_cell_with_projection_role(
    cell: &FullCellData,
    shared_strings: &[String],
    projection_role: ImportedCellProjectionRole,
) -> CellData {
    convert_cell_with_projection_role_and_provenance(
        cell,
        shared_strings,
        &[],
        &[],
        projection_role,
        None,
        false,
        false,
    )
}

pub(super) fn convert_cell_with_projection_role_and_provenance(
    cell: &FullCellData,
    shared_strings: &[String],
    shared_strings_rich_runs: &[Option<Vec<domain_types::RichTextRun>>],
    shared_strings_phonetic_xml: &[Option<Vec<u8>>],
    projection_role: ImportedCellProjectionRole,
    sst_compaction: Option<&SharedStringProvenanceCompaction>,
    compact_numeric_provenance: bool,
    compact_non_formula_cached_type: bool,
) -> CellData {
    let value = resolve_cell_value(cell, shared_strings);
    let is_formula = cell.cell_type == CELL_TYPE_FORMULA;
    // Propagate the formula text whenever the parser populated it. Earlier
    // versions gated propagation on `cell.cell_type == CELL_TYPE_FORMULA`
    // (i.e. the OOXML `<f>` element being present on the cell). That gate
    // silently dropped synthesized formulas written by `apply_parse_extras`
    // — most importantly the `TABLE($A$2,$A$1)` text that
    // `synthesize_data_table_formula` writes into every body cell of a
    // `<f t="dataTable">` region. Per the projection-family-unification plan
    // (Stream D2): the data model is symmetric — every cell that owns a
    // formula carries it through the read boundary, regardless of whether
    // the OOXML had a per-cell `<f>` element. The OOXML asymmetry (master
    // carries `<f>`, body cells carry only `<v>`) is a write-side
    // compactness, suppressed by the writer when re-emitting Data Table
    // body cells.
    let formula = cell.formula.clone();

    // A formula cell has an explicit empty <v/> when:
    // - It's a formula cell (has a formula — includes t="str" shared formula cells
    //   whose cell_type is CELL_TYPE_VAL_STRING, not CELL_TYPE_VAL_FORMULA)
    // - It has a value field (Some) but the value is empty string
    // - The resolved CellValue is Null (empty string → Null in resolve_formula_cached_value)
    // Note: cell_formula covers shared formula children (t="shared" si="N") which
    // have cell_formula.is_some() but formula.is_none() (no formula text).
    let has_empty_cached_value = cell.has_empty_cached_value
        || ((is_formula || cell.formula.is_some() || cell.cell_formula.is_some())
            && cell.value.as_ref().map_or(false, |v| v.is_empty())
            && cell.cached_value_type == 0);
    let is_formula_cell = is_formula || cell.formula.is_some() || cell.cell_formula.is_some();

    let can_drop_sst_provenance = cell
        .sst_index
        .and_then(|idx| sst_compaction.map(|compaction| compaction.is_recoverable(idx)))
        .unwrap_or(false);
    let has_effective_formula_result_type = cell.cached_value_type != 0
        && (!compact_non_formula_cached_type
            || cell.formula.is_some()
            || cell.cell_formula.is_some());
    let can_drop_numeric_original_value = compact_numeric_provenance
        && cell.formula.is_none()
        && cell.cell_formula.is_none()
        && !has_effective_formula_result_type
        && cell.cell_type == CELL_TYPE_NUMBER
        && numeric_original_value_is_writer_canonical(cell.value.as_deref());

    CellData {
        row: cell.row,
        col: cell.col,
        value,
        rich_string: rich_string_for_cell(
            cell,
            shared_strings,
            shared_strings_rich_runs,
            shared_strings_phonetic_xml,
        ),
        formula,
        array_ref: cell.array_ref.clone(),
        style_id: if cell.style_idx > 0 || cell.has_explicit_style {
            Some(cell.style_idx as u32)
        } else {
            None
        },
        cell_formula: cell.cell_formula.clone(),
        cell_metadata_index: cell.cell_metadata_index,
        formula_result_type: if has_effective_formula_result_type {
            Some(cell.cached_value_type)
        } else {
            None
        },
        has_empty_cached_value,
        formula_cache_provenance: formula_cache_provenance(
            cell,
            is_formula_cell,
            has_empty_cached_value,
            has_effective_formula_result_type,
        ),
        vm: cell.vm,
        imported_rich_error: None,
        phonetic: cell.phonetic,
        date_lexical_value: cell.date_lexical_value.clone(),
        original_sst_index: if can_drop_sst_provenance {
            None
        } else {
            cell.sst_index
        },
        original_value: if can_drop_sst_provenance || can_drop_numeric_original_value {
            None
        } else {
            cell.value.clone()
        },
        projection_role,
    }
}

fn formula_cache_provenance(
    cell: &FullCellData,
    is_formula_cell: bool,
    has_empty_cached_value: bool,
    has_effective_formula_result_type: bool,
) -> FormulaCacheProvenance {
    if !is_formula_cell {
        return FormulaCacheProvenance::default();
    }

    let cached_value_presence = if has_empty_cached_value {
        FormulaCachedValuePresence::ExplicitEmpty
    } else if cell.value.as_ref().is_some_and(|value| !value.is_empty()) {
        FormulaCachedValuePresence::NonEmpty
    } else {
        FormulaCachedValuePresence::Absent
    };
    let cached_value_kind = has_effective_formula_result_type.then_some(cell.cached_value_type);

    if !cell.force_recalc
        && cached_value_kind.is_none()
        && cached_value_presence.is_absent()
        && cell.value.is_none()
        && !cell.preserve_space_formula
        && !cell.preserve_space_value
    {
        return FormulaCacheProvenance::default();
    }

    FormulaCacheProvenance {
        state: FormulaCacheState::ImportedCurrent,
        force_recalc: cell.force_recalc,
        cached_value_kind,
        cached_value_presence,
        cached_value_lexeme: cell.value.clone(),
        formula_identity_fingerprint: cell.formula.clone(),
        formula_preserve_space: cell.preserve_space_formula,
        value_preserve_space: cell.preserve_space_value,
        ..Default::default()
    }
}

fn rich_string_for_cell(
    cell: &FullCellData,
    shared_strings: &[String],
    shared_strings_rich_runs: &[Option<Vec<domain_types::RichTextRun>>],
    shared_strings_phonetic_xml: &[Option<Vec<u8>>],
) -> Option<domain_types::RichSharedString> {
    if cell.cell_type != CELL_TYPE_STRING {
        return None;
    }
    let index = cell.sst_index? as usize;
    let plain_text = shared_strings.get(index)?.clone();
    let runs = shared_strings_rich_runs
        .get(index)
        .and_then(Clone::clone)
        .unwrap_or_default();
    let phonetic_xml = shared_strings_phonetic_xml
        .get(index)
        .and_then(Clone::clone);
    if runs.is_empty() && phonetic_xml.is_none() {
        return None;
    }
    let (phonetic_runs, phonetic_properties) = phonetic_xml
        .as_deref()
        .map(parse_phonetic_xml)
        .unwrap_or_default();
    Some(domain_types::RichSharedString {
        plain_text,
        runs,
        phonetic_runs,
        phonetic_properties,
        phonetic_xml,
    })
}

fn numeric_original_value_is_writer_canonical(value: Option<&str>) -> bool {
    let Some(value) = value else {
        return false;
    };
    let Ok(parsed) = value.parse::<f64>() else {
        return false;
    };
    parsed.is_finite() && format_number_like_writer(parsed) == value
}

fn format_number_like_writer(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e15 {
        format!("{n:.0}")
    } else {
        let s = format!("{n}");
        if s.contains('.') {
            s.trim_end_matches('0').trim_end_matches('.').to_string()
        } else {
            s
        }
    }
}

/// Resolve a FullCellData's value to CellValue.
pub(super) fn resolve_cell_value(cell: &FullCellData, _shared_strings: &[String]) -> CellValue {
    if cell.cell_type == CELL_TYPE_FORMULA {
        return resolve_formula_cached_value(cell);
    }

    match cell.cell_type {
        CELL_TYPE_EMPTY => CellValue::Null,
        CELL_TYPE_NUMBER => {
            match cell.value.as_ref().and_then(|v| v.parse::<f64>().ok()) {
                // Finite f64 → Number(FiniteF64)
                // Non-finite f64 (NaN, Inf) → Error(Num), same as CellValue::number()
                Some(n) => CellValue::number(n),
                // Unparseable string in a numeric cell → Text fallback
                None => cell
                    .value
                    .as_ref()
                    .map(|v| CellValue::Text(Arc::from(v.as_str())))
                    .unwrap_or(CellValue::Null),
            }
        }
        CELL_TYPE_STRING => cell
            .value
            .as_ref()
            .map(|v| CellValue::Text(Arc::from(v.as_str())))
            .unwrap_or(CellValue::Text(Arc::from(""))),
        CELL_TYPE_DATE => cell
            .value
            .as_ref()
            .map(|v| CellValue::Text(Arc::from(v.as_str())))
            .unwrap_or(CellValue::Null),
        CELL_TYPE_BOOL => {
            let b = cell
                .value
                .as_ref()
                .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
                .unwrap_or(false);
            CellValue::Boolean(b)
        }
        CELL_TYPE_ERROR => {
            let err = cell
                .value
                .as_ref()
                .map(|v| parse_error_code(v))
                .unwrap_or(CellError::Value);
            CellValue::Error(err, None)
        }
        _ => CellValue::Null,
    }
}

/// Resolve cached value for a formula cell.
pub(super) fn resolve_formula_cached_value(cell: &FullCellData) -> CellValue {
    let value_str = match &cell.value {
        Some(v) => v,
        None => return CellValue::Null,
    };

    match cell.cached_value_type {
        CACHED_VALUE_TYPE_STRING => CellValue::Text(Arc::from(value_str.as_str())),
        CACHED_VALUE_TYPE_ERROR => CellValue::Error(parse_error_code(value_str), None),
        CACHED_VALUE_TYPE_BOOL => {
            CellValue::Boolean(value_str == "1" || value_str.eq_ignore_ascii_case("true"))
        }
        _ => {
            // Default: try parsing as number, fall back to text.
            // Uses CellValue::number() so non-finite f64 (NaN, Inf) → Error(Num).
            match value_str.parse::<f64>().ok() {
                Some(n) => CellValue::number(n),
                None if value_str.is_empty() => CellValue::Null,
                None => CellValue::Text(Arc::from(value_str.as_str())),
            }
        }
    }
}

/// Parse an Excel error code string to `CellError`.
pub(super) fn parse_error_code(s: &str) -> CellError {
    match s {
        "#NULL!" => CellError::Null,
        "#DIV/0!" => CellError::Div0,
        "#VALUE!" => CellError::Value,
        "#REF!" => CellError::Ref,
        "#NAME?" => CellError::Name,
        "#NUM!" => CellError::Num,
        "#N/A" => CellError::Na,
        "#GETTING_DATA" => CellError::GettingData,
        "#SPILL!" => CellError::Spill,
        "#CALC!" => CellError::Calc,
        _ => CellError::Value,
    }
}

fn parse_phonetic_xml(
    xml: &[u8],
) -> (
    Vec<domain_types::PhoneticRun>,
    Option<domain_types::PhoneticProperties>,
) {
    let mut runs = Vec::new();
    let mut pos = 0;
    while let Some(start) = find_bytes(xml, b"<rPh", pos) {
        let Some(end_tag) = find_bytes(xml, b"</rPh>", start) else {
            break;
        };
        let end = end_tag + b"</rPh>".len();
        let region = &xml[start..end];
        let text = find_t_content(region)
            .map(|text| decode_xml_text(text).unwrap_or_default())
            .unwrap_or_default();
        runs.push(domain_types::PhoneticRun {
            text,
            start_index: attr_u32(region, b"sb").unwrap_or(0),
            end_index: attr_u32(region, b"eb").unwrap_or(0),
        });
        pos = end;
    }

    let phonetic_properties = find_bytes(xml, b"<phoneticPr", 0).map(|start| {
        let end = xml[start..]
            .iter()
            .position(|&b| b == b'>')
            .map(|offset| start + offset + 1)
            .unwrap_or(xml.len());
        let region = &xml[start..end];
        domain_types::PhoneticProperties {
            font_id: attr_u32(region, b"fontId"),
            phonetic_type: attr_string(region, b"type"),
            alignment: attr_string(region, b"alignment"),
        }
    });

    (runs, phonetic_properties)
}

fn find_bytes(haystack: &[u8], needle: &[u8], start: usize) -> Option<usize> {
    haystack
        .get(start..)?
        .windows(needle.len())
        .position(|window| window == needle)
        .map(|pos| pos + start)
}

fn find_t_content(xml: &[u8]) -> Option<&[u8]> {
    let start = find_bytes(xml, b"<t", 0)?;
    let content_start = xml[start..].iter().position(|&b| b == b'>')? + start + 1;
    let content_end = find_bytes(xml, b"</t>", content_start)?;
    Some(&xml[content_start..content_end])
}

fn attr_u32(xml: &[u8], name: &[u8]) -> Option<u32> {
    attr_string(xml, name)?.parse().ok()
}

fn attr_string(xml: &[u8], name: &[u8]) -> Option<String> {
    let mut needle = Vec::with_capacity(name.len() + 2);
    needle.extend_from_slice(name);
    needle.extend_from_slice(b"=\"");
    let start = find_bytes(xml, &needle, 0)? + needle.len();
    let end = xml[start..].iter().position(|&b| b == b'"')? + start;
    std::str::from_utf8(&xml[start..end])
        .ok()
        .map(str::to_owned)
}

fn decode_xml_text(xml: &[u8]) -> Option<String> {
    let mut out = String::new();
    let mut i = 0;
    while i < xml.len() {
        if xml[i] == b'&' {
            if xml[i..].starts_with(b"&amp;") {
                out.push('&');
                i += 5;
                continue;
            }
            if xml[i..].starts_with(b"&lt;") {
                out.push('<');
                i += 4;
                continue;
            }
            if xml[i..].starts_with(b"&gt;") {
                out.push('>');
                i += 4;
                continue;
            }
            if xml[i..].starts_with(b"&quot;") {
                out.push('"');
                i += 6;
                continue;
            }
            if xml[i..].starts_with(b"&apos;") {
                out.push('\'');
                i += 6;
                continue;
            }
        }
        let s = std::str::from_utf8(&xml[i..]).ok()?;
        let ch = s.chars().next()?;
        out.push(ch);
        i += ch.len_utf8();
    }
    Some(out)
}

// =============================================================================
// Helpers
// =============================================================================

pub(super) fn compute_dimensions(cells: &[FullCellData]) -> (u32, u32) {
    if cells.is_empty() {
        return (0, 0);
    }
    let max_row = cells.iter().map(|c| c.row).max().unwrap_or(0);
    let max_col = cells.iter().map(|c| c.col).max().unwrap_or(0);
    (max_row + 1, max_col + 1)
}

pub(super) fn non_empty(s: &str) -> Option<String> {
    if s.is_empty() {
        None
    } else {
        Some(s.to_string())
    }
}
