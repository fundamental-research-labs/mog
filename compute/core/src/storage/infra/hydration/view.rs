use std::sync::Arc;

use yrs::{Any, Map, MapPrelim, MapRef};

use domain_types::yrs_schema;
use domain_types::{FrozenPane, SheetView};

use crate::import::parse_output_to_snapshot::view_lowering::classify_top_left_cell;

// ===========================================================================
// Sheet metadata hydration
// ===========================================================================

/// Hydrate frozen pane data into the meta map.
pub(super) fn hydrate_frozen_pane(
    txn: &mut yrs::TransactionMut,
    meta_map: &MapRef,
    frozen_pane: &Option<FrozenPane>,
) {
    if let Some(fp) = frozen_pane {
        if fp.rows > 0 {
            meta_map.insert(txn, "frozenRows", Any::Number(fp.rows as f64));
        }
        if fp.cols > 0 {
            meta_map.insert(txn, "frozenCols", Any::Number(fp.cols as f64));
        }
        if let Some(ref tlc) = fp.top_left_cell {
            // Classify the top-left-cell string via the typed boundary
            // (boundary 1.15, see
            // `import::parse_output_to_snapshot::view_lowering`). Only
            // well-formed single-cell references are written to Yrs —
            // malformed input is dropped rather than persisted. The raw
            // bytes are preserved on the valid path for writer round-trip
            // fidelity (Yrs is an external-format boundary where String is
            // legitimate per the typed-boundary rules).
            if classify_top_left_cell(tlc).is_some() {
                meta_map.insert(
                    txn,
                    "frozenPaneTopLeftCell",
                    Any::String(tlc.clone().into()),
                );
            }
        }
    }
}

/// Hydrate sheet view options into the meta map.
///
/// Uses the `SheetView` struct from `ParseOutput` which has concrete values
/// (not Option<bool> like the old `SheetViewImport`).
pub(super) fn hydrate_view_options(
    txn: &mut yrs::TransactionMut,
    meta_map: &MapRef,
    view: &SheetView,
) {
    // Only write non-default values to keep the Yrs doc lean
    if !view.show_gridlines {
        meta_map.insert(txn, "showGridlines", Any::Bool(false));
    }
    if !view.show_row_col_headers {
        meta_map.insert(txn, "showRowHeaders", Any::Bool(false));
        meta_map.insert(txn, "showColumnHeaders", Any::Bool(false));
    }
    if view.right_to_left {
        meta_map.insert(txn, "rightToLeft", Any::Bool(true));
    }
    if view.show_formulas {
        meta_map.insert(txn, "showFormulas", Any::Bool(true));
    }
    if !view.show_zeros {
        meta_map.insert(txn, "showZeroValues", Any::Bool(false));
    }
    if let Some(scale) = view.zoom_scale {
        meta_map.insert(txn, "zoomScale", Any::Number(scale as f64));
    }
    if view.workbook_view_id != 0 {
        meta_map.insert(
            txn,
            "workbookViewId",
            Any::Number(view.workbook_view_id as f64),
        );
    }
    if view.scroll_row > 0 {
        meta_map.insert(txn, "scrollTopRow", Any::Number(view.scroll_row as f64));
    }
    if view.scroll_col > 0 {
        meta_map.insert(txn, "scrollLeftCol", Any::Number(view.scroll_col as f64));
    }
    // Store additional view properties for round-trip fidelity
    if let Some(zoom_normal) = view.zoom_scale_normal {
        meta_map.insert(txn, "zoomScaleNormal", Any::Number(zoom_normal as f64));
    }
    if let Some(zoom) = view.zoom_scale_page_layout_view {
        meta_map.insert(txn, "zoomScalePageLayoutView", Any::Number(zoom as f64));
    }
    if let Some(zoom) = view.zoom_scale_sheet_layout_view {
        meta_map.insert(txn, "zoomScaleSheetLayoutView", Any::Number(zoom as f64));
    }
    if view.tab_selected {
        meta_map.insert(txn, "tabSelected", Any::Bool(true));
    }
    if let Some(ref ac) = view.active_cell {
        meta_map.insert(txn, "activeCell", Any::String(Arc::from(ac.as_str())));
    }
    if let Some(ref sq) = view.sqref {
        meta_map.insert(txn, "sqref", Any::String(Arc::from(sq.as_str())));
    }
    if let Some(ref pane) = view.pane {
        let json = serde_json::to_string(pane).unwrap_or_default();
        if !json.is_empty() {
            meta_map.insert(
                txn,
                "sheetPaneConfig",
                Any::String(Arc::from(json.as_str())),
            );
        }
    }
    if view.has_explicit_top_left_cell {
        meta_map.insert(txn, "hasExplicitTopLeftCell", Any::Bool(true));
    }
    // Store additional sheetView attributes for round-trip fidelity
    if let Some(ref vt) = view.view {
        meta_map.insert(txn, "viewType", Any::String(Arc::from(vt.as_str())));
    }
    if !view.show_outline_symbols {
        meta_map.insert(txn, "showOutlineSymbols", Any::Bool(false));
    }
    if !view.show_ruler {
        meta_map.insert(txn, "showRuler", Any::Bool(false));
    }
    if !view.show_white_space {
        meta_map.insert(txn, "showWhiteSpace", Any::Bool(false));
    }
    if !view.default_grid_color {
        meta_map.insert(txn, "defaultGridColor", Any::Bool(false));
    }
    if view.window_protection {
        meta_map.insert(txn, "windowProtection", Any::Bool(true));
    }
    if let Some(cid) = view.color_id {
        meta_map.insert(txn, "colorId", Any::Number(cid as f64));
    }
    // Store multi-pane selections as JSON for round-trip fidelity
    yrs_schema::helpers::write_json_vec(meta_map, txn, "selections", &view.selections);
    if let Some(xml) = view
        .ext_lst_xml
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        meta_map.insert(txn, "sheetViewExtLstXml", Any::String(Arc::from(xml)));
    }
}

/// Hydrate sheet protection using structured Y.Map entries via
/// `yrs_schema::protection`.
pub(super) fn hydrate_sheet_protection(
    txn: &mut yrs::TransactionMut,
    meta_map: &MapRef,
    protection: &Option<domain_types::domain::protection::SheetProtection>,
) {
    if let Some(prot) = protection {
        // Write using yrs_schema for structured storage
        let entries = yrs_schema::protection::sheet_to_yrs_prelim(prot);
        let prot_prelim: MapPrelim = entries.into_iter().collect();
        meta_map.insert(txn, "protectionDetails", prot_prelim);

        // Also write the top-level convenience keys for existing UI code
        meta_map.insert(txn, "isProtected", Any::Bool(prot.is_protected));
        if let Some(ref hash) = prot.password_hash {
            meta_map.insert(
                txn,
                "protectionPasswordHash",
                Any::String(Arc::from(hash.as_str())),
            );
        }
    }
}

/// Hydrate print settings using structured Y.Map entries via `yrs_schema::print`.
pub(super) fn hydrate_print_settings(
    txn: &mut yrs::TransactionMut,
    meta_map: &MapRef,
    print_settings: &Option<domain_types::domain::print::PrintSettings>,
) {
    if let Some(ps) = print_settings {
        let entries = yrs_schema::print::to_yrs_prelim(ps);
        let ps_prelim: MapPrelim = entries.into_iter().collect();
        meta_map.insert(txn, "printSettings", ps_prelim);
    }
}

/// Hydrate header/footer images into the meta map as a JSON array.
pub(super) fn hydrate_hf_images(
    txn: &mut yrs::TransactionMut,
    meta_map: &MapRef,
    hf_images: &[domain_types::domain::print::HeaderFooterImageInfo],
) {
    if !hf_images.is_empty() {
        let json = domain_types::yrs_schema::print::hf_images_to_json(hf_images);
        meta_map.insert(txn, "hfImages", Any::String(Arc::from(json.as_str())));
    }
}

/// Hydrate page breaks into the meta map using `yrs_schema::page_breaks`.
pub(super) fn hydrate_page_breaks(
    txn: &mut yrs::TransactionMut,
    meta_map: &MapRef,
    page_breaks: &Option<domain_types::domain::print::PageBreaks>,
) {
    if let Some(pb) = page_breaks {
        let entries = yrs_schema::page_breaks::to_yrs_prelim(pb);
        for (key, value) in entries {
            meta_map.insert(txn, key, value);
        }
    }
}
