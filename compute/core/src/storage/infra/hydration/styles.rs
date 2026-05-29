use std::collections::HashMap;
use std::sync::Arc;

use yrs::{Any, Map, MapPrelim, MapRef, Out};

use domain_types::yrs_schema;
use domain_types::{CellData, DocumentFormat, SheetData, WorkbookStylesheet};

use compute_document::hex::{SmallHex, id_to_hex};
use compute_document::schema::*;

const KEY_STYLE_REGISTRY_NUMBER_FORMATS: &str = "numberFormats";
const KEY_STYLE_REGISTRY_FONTS: &str = "fonts";
const KEY_STYLE_REGISTRY_FILLS: &str = "fills";
const KEY_STYLE_REGISTRY_BORDERS: &str = "borders";
const KEY_STYLE_REGISTRY_CELL_STYLE_XFS: &str = "cellStyleXfs";
const KEY_STYLE_REGISTRY_CELL_XFS: &str = "cellXfs";
const KEY_STYLE_REGISTRY_NAMED_CELL_STYLES: &str = "namedCellStyles";
const KEY_STYLE_REGISTRY_DXFS: &str = "differentialFormats";
const KEY_STYLE_REGISTRY_TABLE_STYLES: &str = "tableStyles";
const KEY_STYLE_REGISTRY_INDEXED_COLORS: &str = "indexedColors";
const KEY_STYLE_REGISTRY_DEFAULT_TABLE_STYLE: &str = "defaultTableStyle";
const KEY_STYLE_REGISTRY_DEFAULT_PIVOT_STYLE: &str = "defaultPivotStyle";
const KEY_STYLE_REGISTRY_KNOWN_FONTS: &str = "knownFonts";
const KEY_STYLE_REGISTRY_ROOT_NAMESPACE_ATTRS: &str = "rootNamespaceAttrs";
const KEY_STYLE_REGISTRY_ROOT_MCE_ATTRIBUTES: &str = "rootMceAttributes";
const KEY_STYLE_REGISTRY_EXT_LST_XML: &str = "extLstXml";
const KEY_STYLE_REGISTRY_COUNT: &str = "count";

#[derive(Debug, Clone)]
pub(crate) struct ImportedRangeStyle {
    pub range_id: cell_types::RangeId,
    pub start_row: u32,
    pub start_col: u32,
    pub end_row: u32,
    pub end_col: u32,
    pub style_id: u32,
}

// ===========================================================================
// Row/Col style overrides
// ===========================================================================

/// Hydrate row-level style overrides from `RowStyleEntry`.
///
/// Looks up (or creates) a RowId for each row, resolves the style from the
/// palette, and stores it keyed by RowId.
pub(super) fn hydrate_row_styles(
    txn: &mut yrs::TransactionMut,
    row_formats_map: &MapRef,
    row_id_hexes: &[SmallHex],
    row_styles: &[domain_types::RowStyleEntry],
    style_palette: &[DocumentFormat],
) {
    for rs in row_styles {
        if let Some(format) = style_palette.get(rs.style_id as usize)
            && let Some(row_id) = row_id_hexes.get(rs.row as usize)
        {
            let cell_fmt = document_format_to_cell_format(format);
            let mut entries = yrs_schema::cell_format::to_yrs_prelim(&cell_fmt);
            // Preserve original XLSX cellXfs index for lossless round-trip
            entries.push((
                yrs_schema::cell_format::KEY_XLSX_STYLE_ID,
                Any::Number(rs.style_id as f64),
            ));
            let nested: MapPrelim = entries.into_iter().collect();
            row_formats_map.insert(txn, row_id.as_str(), nested);
        }
    }
}

/// Hydrate column-level style overrides from `ColStyleEntry`.
pub(super) fn hydrate_col_styles(
    txn: &mut yrs::TransactionMut,
    col_formats_map: &MapRef,
    col_id_hexes: &[SmallHex],
    col_styles: &[domain_types::ColStyleEntry],
    style_palette: &[DocumentFormat],
) {
    for cs in col_styles {
        if let Some(format) = style_palette.get(cs.style_id as usize)
            && let Some(col_id) = col_id_hexes.get(cs.col as usize)
        {
            let cell_fmt = document_format_to_cell_format(format);
            let mut entries = yrs_schema::cell_format::to_yrs_prelim(&cell_fmt);
            // Preserve original XLSX cellXfs index for lossless round-trip
            entries.push((
                yrs_schema::cell_format::KEY_XLSX_STYLE_ID,
                Any::Number(cs.style_id as f64),
            ));
            let nested: MapPrelim = entries.into_iter().collect();
            col_formats_map.insert(txn, col_id.as_str(), nested);
        }
    }
}

/// Convert a `DocumentFormat` (nested, from parser) to a flat `CellFormat` (runtime).
pub(super) fn document_format_to_cell_format(doc: &DocumentFormat) -> domain_types::CellFormat {
    domain_types::CellFormat::from(doc)
}

/// Hydrate the workbook-level style palette from import data.
///
/// Converts each `DocumentFormat` in the palette to a `CellFormat`, serialises
/// it to JSON, and stores it in the `stylePalette` Yrs map keyed by the
/// string index ("0", "1", ...).  This map is read at runtime by
/// `properties::resolve_style_index` to inflate compact `{"s": N}` cell
/// properties back into full `CellFormat` objects.
pub(super) fn hydrate_style_palette(
    txn: &mut yrs::TransactionMut,
    workbook: &MapRef,
    style_palette: &[DocumentFormat],
) {
    let palette_map_prelim = MapPrelim::from([] as [(&str, Any); 0]);
    let palette_map: MapRef = workbook.insert(txn, KEY_STYLE_PALETTE, palette_map_prelim);

    for (i, doc_fmt) in style_palette.iter().enumerate() {
        let cell_fmt = document_format_to_cell_format(doc_fmt);
        // SAFETY: serializing a struct with #[derive(Serialize)]; no map keys or non-finite floats.
        let json =
            serde_json::to_string(&cell_fmt).expect("CellFormat serialization should not fail");
        let key = i.to_string();
        palette_map.insert(txn, &*key, Any::String(Arc::from(json.as_str())));
    }
}

pub(super) fn hydrate_workbook_stylesheet(
    txn: &mut yrs::TransactionMut,
    workbook: &MapRef,
    workbook_stylesheet: &Option<WorkbookStylesheet>,
) {
    if let Some(stylesheet) = workbook_stylesheet {
        let stylesheet = stylesheet.normalized();
        hydrate_dxf_registry(txn, workbook, &stylesheet.dxf_registry);
        let map: MapRef = workbook.insert(
            txn,
            KEY_WORKBOOK_STYLESHEET,
            MapPrelim::from([] as [(&str, Any); 0]),
        );
        hydrate_style_registry_vec(
            txn,
            &map,
            KEY_STYLE_REGISTRY_NUMBER_FORMATS,
            &stylesheet.number_formats,
        );
        hydrate_style_registry_vec(txn, &map, KEY_STYLE_REGISTRY_FONTS, &stylesheet.fonts);
        hydrate_style_registry_vec(txn, &map, KEY_STYLE_REGISTRY_FILLS, &stylesheet.fills);
        hydrate_style_registry_vec(txn, &map, KEY_STYLE_REGISTRY_BORDERS, &stylesheet.borders);
        hydrate_style_registry_vec(
            txn,
            &map,
            KEY_STYLE_REGISTRY_CELL_STYLE_XFS,
            &stylesheet.cell_style_xfs,
        );
        hydrate_style_registry_vec(txn, &map, KEY_STYLE_REGISTRY_CELL_XFS, &stylesheet.cell_xfs);
        hydrate_style_registry_vec(
            txn,
            &map,
            KEY_STYLE_REGISTRY_NAMED_CELL_STYLES,
            &stylesheet.named_cell_styles,
        );
        hydrate_style_registry_vec(
            txn,
            &map,
            KEY_STYLE_REGISTRY_DXFS,
            &stylesheet.differential_formats,
        );
        hydrate_style_registry_vec(
            txn,
            &map,
            KEY_STYLE_REGISTRY_TABLE_STYLES,
            &stylesheet.table_styles,
        );
        hydrate_style_registry_value(
            txn,
            &map,
            KEY_STYLE_REGISTRY_INDEXED_COLORS,
            &stylesheet.indexed_colors,
        );
        hydrate_style_registry_value(
            txn,
            &map,
            KEY_STYLE_REGISTRY_DEFAULT_TABLE_STYLE,
            &stylesheet.default_table_style,
        );
        hydrate_style_registry_value(
            txn,
            &map,
            KEY_STYLE_REGISTRY_DEFAULT_PIVOT_STYLE,
            &stylesheet.default_pivot_style,
        );
        map.insert(
            txn,
            KEY_STYLE_REGISTRY_KNOWN_FONTS,
            Any::Bool(stylesheet.known_fonts),
        );
        hydrate_style_registry_vec(
            txn,
            &map,
            KEY_STYLE_REGISTRY_ROOT_NAMESPACE_ATTRS,
            &stylesheet.root_namespace_attrs,
        );
        if !stylesheet.root_mce_attributes.is_empty() {
            let json = serde_json::to_string(&stylesheet.root_mce_attributes)
                .expect("style root MCE serialization should not fail");
            map.insert(
                txn,
                KEY_STYLE_REGISTRY_ROOT_MCE_ATTRIBUTES,
                Any::String(Arc::from(json.as_str())),
            );
        }
        hydrate_style_registry_value(
            txn,
            &map,
            KEY_STYLE_REGISTRY_EXT_LST_XML,
            &stylesheet.ext_lst_xml,
        );
    } else {
        workbook.remove(txn, KEY_WORKBOOK_STYLESHEET);
        workbook.remove(txn, KEY_DXF_REGISTRY);
    }
}

fn hydrate_dxf_registry(
    txn: &mut yrs::TransactionMut,
    workbook: &MapRef,
    registry: &[domain_types::DxfDef],
) {
    if registry.is_empty() {
        workbook.remove(txn, KEY_DXF_REGISTRY);
        return;
    }

    let map: MapRef = workbook.insert(
        txn,
        KEY_DXF_REGISTRY,
        MapPrelim::from([] as [(&str, Any); 0]),
    );
    map.insert(
        txn,
        KEY_STYLE_REGISTRY_COUNT,
        Any::Number(registry.len() as f64),
    );
    for entry in registry {
        let json =
            serde_json::to_string(entry).expect("DXF registry entry serialization should not fail");
        map.insert(
            txn,
            &*entry.id.to_string(),
            Any::String(Arc::from(json.as_str())),
        );
    }
}

fn hydrate_style_registry_vec<T: serde::Serialize>(
    txn: &mut yrs::TransactionMut,
    parent: &MapRef,
    key: &str,
    values: &[T],
) {
    if values.is_empty() {
        return;
    }

    let map: MapRef = parent.insert(txn, key, MapPrelim::from([] as [(&str, Any); 0]));
    map.insert(
        txn,
        KEY_STYLE_REGISTRY_COUNT,
        Any::Number(values.len() as f64),
    );
    for (index, value) in values.iter().enumerate() {
        let json = serde_json::to_string(value)
            .expect("style registry entry serialization should not fail");
        map.insert(
            txn,
            &*index.to_string(),
            Any::String(Arc::from(json.as_str())),
        );
    }
}

fn hydrate_style_registry_value<T: serde::Serialize>(
    txn: &mut yrs::TransactionMut,
    parent: &MapRef,
    key: &str,
    value: &Option<T>,
) {
    if let Some(value) = value {
        let json = serde_json::to_string(value)
            .expect("style registry value serialization should not fail");
        parent.insert(txn, key, Any::String(Arc::from(json.as_str())));
    }
}

/// Merge source style palette entries into the existing workbook palette.
/// Returns a remap: source_style_id -> new_palette_index.
/// Does NOT overwrite existing entries — only appends.
pub(crate) fn merge_style_palette_incremental(
    txn: &mut yrs::TransactionMut,
    workbook: &MapRef,
    source_palette: &[DocumentFormat],
) -> HashMap<u32, u32> {
    let palette_map = match workbook.get(txn, KEY_STYLE_PALETTE) {
        Some(Out::YMap(m)) => m,
        _ => {
            // No existing palette — create one
            workbook.insert(
                txn,
                KEY_STYLE_PALETTE,
                MapPrelim::from([] as [(&str, Any); 0]),
            )
        }
    };

    // Count existing entries
    let existing_count = palette_map.len(txn);

    // Append source palette entries with offset
    let mut remap = HashMap::new();
    for (src_idx, doc_fmt) in source_palette.iter().enumerate() {
        let new_idx = existing_count + src_idx as u32;
        remap.insert(src_idx as u32, new_idx);

        let cell_fmt = document_format_to_cell_format(doc_fmt);
        // SAFETY: serializing a struct with #[derive(Serialize)]; no map keys or non-finite floats.
        let json =
            serde_json::to_string(&cell_fmt).expect("CellFormat serialization should not fail");
        palette_map.insert(
            txn,
            &*new_idx.to_string(),
            Any::String(Arc::from(json.as_str())),
        );
    }
    remap
}

/// Remap style_id indices in a SheetData according to the merge remap.
pub(crate) fn remap_sheet_style_ids(sheet: &mut SheetData, remap: &HashMap<u32, u32>) {
    for cell in &mut sheet.cells {
        if let Some(sid) = cell.style_id {
            cell.style_id = remap.get(&sid).copied();
        }
    }
    for rs in &mut sheet.row_styles {
        if let Some(new_sid) = remap.get(&rs.style_id) {
            rs.style_id = *new_sid;
        }
    }
    for cs in &mut sheet.col_styles {
        if let Some(new_sid) = remap.get(&cs.style_id) {
            cs.style_id = *new_sid;
        }
    }
    for run in &mut sheet.authored_style_runs {
        if let Some(new_sid) = remap.get(&run.style_id) {
            run.style_id = *new_sid;
        }
    }
}

pub(super) fn hydrate_imported_range_styles(
    txn: &mut yrs::TransactionMut,
    sheet_map: &MapRef,
    styles: &[ImportedRangeStyle],
    style_palette: &[DocumentFormat],
) {
    if styles.is_empty() {
        return;
    }

    let range_formats_map: MapRef = match sheet_map.get(txn, KEY_RANGE_FORMATS) {
        Some(Out::YMap(map)) => map,
        _ => sheet_map.insert(
            txn,
            KEY_RANGE_FORMATS,
            MapPrelim::from([] as [(&str, Any); 0]),
        ),
    };

    for style in styles {
        if style.start_row > style.end_row || style.start_col > style.end_col {
            continue;
        }

        let cell_fmt = style_palette
            .get(style.style_id as usize)
            .map(document_format_to_cell_format);
        let mut entries = cell_fmt
            .as_ref()
            .map(yrs_schema::cell_format::to_yrs_prelim)
            .unwrap_or_default();
        entries.push(("_sr", Any::Number(style.start_row as f64)));
        entries.push(("_sc", Any::Number(style.start_col as f64)));
        entries.push(("_er", Any::Number(style.end_row as f64)));
        entries.push(("_ec", Any::Number(style.end_col as f64)));
        entries.push((
            yrs_schema::cell_format::KEY_XLSX_STYLE_ID,
            Any::Number(style.style_id as f64),
        ));

        let range_hex = id_to_hex(style.range_id.as_u128());
        let nested: MapPrelim = entries.into_iter().collect();
        range_formats_map.insert(txn, range_hex.as_str(), nested);
    }
}

/// Hydrate authored style-only cells as compact `rangeFormats` entries.
pub(super) fn hydrate_authored_style_runs(
    txn: &mut yrs::TransactionMut,
    sheet_map: &MapRef,
    runs: &[domain_types::AuthoredStyleRun],
    style_palette: &[DocumentFormat],
) {
    if runs.is_empty() {
        return;
    }

    let range_formats_map: MapRef = match sheet_map.get(txn, KEY_RANGE_FORMATS) {
        Some(Out::YMap(map)) => map,
        _ => sheet_map.insert(
            txn,
            KEY_RANGE_FORMATS,
            MapPrelim::from([] as [(&str, Any); 0]),
        ),
    };

    for run in runs {
        if run.start_row > run.end_row || run.start_col > run.end_col {
            continue;
        }

        let cell_fmt = style_palette
            .get(run.style_id as usize)
            .map(document_format_to_cell_format);
        let mut entries = cell_fmt
            .as_ref()
            .map(yrs_schema::cell_format::to_yrs_prelim)
            .unwrap_or_default();
        entries.push(("_sr", Any::Number(run.start_row as f64)));
        entries.push(("_sc", Any::Number(run.start_col as f64)));
        entries.push(("_er", Any::Number(run.end_row as f64)));
        entries.push(("_ec", Any::Number(run.end_col as f64)));
        entries.push((
            yrs_schema::cell_format::KEY_XLSX_STYLE_ID,
            Any::Number(run.style_id as f64),
        ));

        let range_id = cell_types::RangeId::from_raw(crate::storage::STORAGE_ID_ALLOC.next_u128());
        let range_hex = id_to_hex(range_id.as_u128());
        let nested: MapPrelim = entries.into_iter().collect();
        range_formats_map.insert(txn, range_hex.as_str(), nested);
    }
}

/// Hydrate cell-level style overrides and metadata from `CellData`.
///
/// Stores a compact palette-index reference (`{"s": N}`) per cell instead of
/// the full expanded `CellFormat` JSON (~500 bytes). The style index `s`
/// references the workbook-level `stylePalette` map written by
/// `hydrate_style_palette`.
///
/// Round-trip bookkeeping (cm, vm, ph/date lexical hints, formulaResultType,
/// sstIndex, originalValue) is emitted as sibling keys on the same compact JSON
/// — the wire shape matches the typed `CellProperties` serde layout so
/// `properties::resolve_compact_props` can deserialize it directly.
pub(super) fn hydrate_cell_styles(
    txn: &mut yrs::TransactionMut,
    pos_map: &HashMap<String, String>,
    sheet_map: &MapRef,
    cells: &[CellData],
    range_style_positions: &std::collections::HashSet<(u32, u32)>,
) {
    // Get the properties sub-map
    let properties_map = match sheet_map.get(txn, KEY_CELL_PROPERTIES) {
        Some(Out::YMap(m)) => m,
        _ => return,
    };

    // Cache compact JSON for style-only cells (the vast majority).
    // Key: style_id → pre-built JSON string like `{"s":5}`.
    let mut style_only_cache: HashMap<u32, Arc<str>> = HashMap::new();

    for cell in cells {
        let style_is_range_backed = range_style_positions.contains(&(cell.row, cell.col));
        let has_style = cell.style_id.is_some() && !style_is_range_backed;
        let cell_metadata_index = cell.cell_metadata_index;
        let has_cm = cell_metadata_index.is_some();
        let has_vm = cell.vm.is_some();
        let has_phonetic = cell.phonetic;
        let has_date_lexical_value = cell.date_lexical_value.is_some();
        let has_formula_result_type = cell.formula_result_type.is_some();
        let has_empty_cached_value = cell.has_empty_cached_value;
        let has_original_sst_index = cell.original_sst_index.is_some();
        let has_original_value = cell.original_value.is_some();
        // Skip cells with neither style nor import/export metadata.
        if !has_style
            && !has_cm
            && !has_vm
            && !has_phonetic
            && !has_date_lexical_value
            && !has_formula_result_type
            && !has_empty_cached_value
            && cell.formula_cache_provenance.is_absent_or_unknown()
            && !has_original_sst_index
            && !has_original_value
        {
            continue;
        }

        // Look up cell_id from in-memory pos_map
        let pos_key = format!("{}:{}", cell.row, cell.col);
        let cell_hex = match pos_map.get(&pos_key) {
            Some(s) => s.clone(),
            _ => continue,
        };

        // Fast path: style-only cells (no per-cell metadata) — use cached compact JSON.
        let is_style_only = has_style
            && !has_cm
            && !has_vm
            && !has_phonetic
            && !has_date_lexical_value
            && !has_formula_result_type
            && !has_empty_cached_value
            && !has_original_sst_index
            && !has_original_value;

        let json: Arc<str> = if is_style_only {
            // SAFETY: `is_style_only` requires `has_style` (line 196), which checks
            // `cell.style_id.is_some()` (line 179).
            let sid = cell.style_id.unwrap();
            style_only_cache
                .entry(sid)
                .or_insert_with(|| Arc::from(format!(r#"{{"s":{sid}}}"#).as_str()))
                .clone()
        } else {
            // Slow path: build typed CellProperties and serialize. The serde
            // renames on CellProperties produce the wire keys (`s`, `cm`, `vm`,
            // `formulaResultType`, `hasEmptyCachedValue`, `sstIndex`,
            // `originalValue`) that the reader expects.
            let props = domain_types::CellProperties {
                format: None,
                provenance: None,
                validation: None,
                connection_id: None,
                style_id: if style_is_range_backed {
                    None
                } else {
                    cell.style_id
                },
                cell_metadata_index,
                vm: cell.vm,
                phonetic: cell.phonetic,
                date_lexical_value: cell.date_lexical_value.clone(),
                formula_result_type: cell.formula_result_type,
                has_empty_cached_value,
                formula_cache_provenance: cell.formula_cache_provenance.clone(),
                original_sst_index: cell.original_sst_index,
                original_value: cell.original_value.clone(),
                // CSE flags are runtime-derived; never set on the
                // hydration-fast-path persistent props.
                is_array_formula: false,
                is_cse_anchor: false,
            };
            // SAFETY: serializing a struct with #[derive(Serialize)]; no map
            // keys or non-finite floats.
            let json_str =
                serde_json::to_string(&props).expect("compact props serialization should not fail");
            Arc::from(json_str.as_str())
        };

        properties_map.insert(txn, &*cell_hex, Any::String(json));
    }
}
