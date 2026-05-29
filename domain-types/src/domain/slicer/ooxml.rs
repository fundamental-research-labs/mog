use ooxml_types::drawings::CellAnchor;
use ooxml_types::slicers::{
    SlicerAnchor as OoxmlSlicerAnchor, SlicerAnchorMode as OoxmlSlicerAnchorMode,
    SlicerCacheDef as OoxmlSlicerCacheDef, SlicerDef as OoxmlSlicerDef, SlicerTabularItem,
    TableSlicerCache,
};
use value_types::CellValue;

use super::super::floating_object::{AnchorMode, FloatingObjectAnchor};
use super::{
    CrossFilterMode, PivotFieldArea, SlicerSortOrder, SlicerSource, SlicerStyle, SlicerStylePreset,
    StoredSlicer,
};

// ══════════════════════════════════════════════════════════════════
// Conversion helpers between ooxml-types and domain enums

fn ooxml_cross_filter_to_domain(cf: ooxml_types::slicers::SlicerCrossFilter) -> CrossFilterMode {
    match cf {
        ooxml_types::slicers::SlicerCrossFilter::None => CrossFilterMode::None,
        ooxml_types::slicers::SlicerCrossFilter::ShowItemsWithDataAtTop => {
            CrossFilterMode::ShowItemsWithDataAtTop
        }
        ooxml_types::slicers::SlicerCrossFilter::ShowItemsWithNoData => {
            CrossFilterMode::ShowItemsWithNoData
        }
    }
}

fn domain_cross_filter_to_ooxml(cf: CrossFilterMode) -> ooxml_types::slicers::SlicerCrossFilter {
    match cf {
        CrossFilterMode::None => ooxml_types::slicers::SlicerCrossFilter::None,
        CrossFilterMode::ShowItemsWithDataAtTop => {
            ooxml_types::slicers::SlicerCrossFilter::ShowItemsWithDataAtTop
        }
        CrossFilterMode::ShowItemsWithNoData => {
            ooxml_types::slicers::SlicerCrossFilter::ShowItemsWithNoData
        }
    }
}

fn ooxml_sort_order_to_domain(so: ooxml_types::slicers::SlicerSortOrder) -> SlicerSortOrder {
    match so {
        ooxml_types::slicers::SlicerSortOrder::Ascending => SlicerSortOrder::Ascending,
        ooxml_types::slicers::SlicerSortOrder::Descending => SlicerSortOrder::Descending,
    }
}

fn domain_sort_order_to_ooxml(so: SlicerSortOrder) -> ooxml_types::slicers::SlicerSortOrder {
    match so {
        SlicerSortOrder::Ascending | SlicerSortOrder::DataSourceOrder => {
            ooxml_types::slicers::SlicerSortOrder::Ascending
        }
        SlicerSortOrder::Descending => ooxml_types::slicers::SlicerSortOrder::Descending,
    }
}

// ══════════════════════════════════════════════════════════════════
// XLSX import conversion: old domain-types intermediates → StoredSlicer

/// Convert XLSX import types (ooxml-types) to StoredSlicer.
///
/// This bridges the ParseOutput types (`SlicerDef`, `SlicerCacheDef`,
/// `SlicerAnchor`) from ooxml-types to the canonical runtime type
/// (`StoredSlicer`).  Called during hydration to populate the workbook
/// `slicers` Y.Map.
pub fn xlsx_import_to_stored_slicer(
    slicer: &OoxmlSlicerDef,
    cache: Option<&OoxmlSlicerCacheDef>,
    anchor: Option<&OoxmlSlicerAnchor>,
    sheet_id: &str,
) -> StoredSlicer {
    // Deterministic ID from slicer name — stable across re-imports of the same file.
    let id = format!("slicer-{}", slicer.name);

    // Build source from cache definition
    let source = if let Some(cache_def) = cache {
        if let Some(ref tsc) = cache_def.table_slicer_cache {
            // Table-backed slicer
            SlicerSource::Table {
                table_id: tsc.table_id.to_string(),
                column_cell_id: cache_def.source_name.clone(),
            }
        } else if cache_def.tabular_data.is_some() || !cache_def.pivot_tables.is_empty() {
            // Pivot-backed slicer
            SlicerSource::Pivot {
                pivot_id: cache_def
                    .pivot_tables
                    .first()
                    .map(|pt| pt.name.clone())
                    .unwrap_or_default(),
                field_name: cache_def.source_name.clone(),
                field_area: PivotFieldArea::Row, // OOXML doesn't specify area in cache
            }
        } else {
            // Default: treat as table source with source_name
            SlicerSource::Table {
                table_id: String::new(),
                column_cell_id: cache_def.source_name.clone(),
            }
        }
    } else {
        // No cache found — placeholder table source
        SlicerSource::Table {
            table_id: String::new(),
            column_cell_id: String::new(),
        }
    };

    // Sort order, cross-filter, custom_list_sort, show_items_with_no_data from cache
    let (sort_order, cross_filter, custom_list_sort, show_items_with_no_data) = cache
        .and_then(|c| {
            if let Some(ref tsc) = c.table_slicer_cache {
                Some((
                    ooxml_sort_order_to_domain(tsc.sort_order),
                    ooxml_cross_filter_to_domain(tsc.cross_filter),
                    tsc.custom_list_sort,
                    false, // TableSlicerCache doesn't have show_missing
                ))
            } else {
                c.tabular_data.as_ref().map(|tab| {
                    (
                        ooxml_sort_order_to_domain(tab.sort_order),
                        ooxml_cross_filter_to_domain(tab.cross_filter),
                        tab.custom_list_sort,
                        tab.show_missing,
                    )
                })
            }
        })
        .unwrap_or((
            SlicerSortOrder::Ascending,
            CrossFilterMode::ShowItemsWithDataAtTop,
            false,
            false,
        ));

    // Selected values from tabular items
    let selected_values = cache
        .and_then(|c| c.tabular_data.as_ref())
        .map(|tab| {
            tab.items
                .iter()
                .filter(|item| item.s)
                .map(|item| CellValue::from(item.x.to_string()))
                .collect()
        })
        .unwrap_or_default();
    let pivot_tabular_items = cache
        .and_then(|c| c.tabular_data.as_ref())
        .map(|tab| tab.items.clone())
        .unwrap_or_default();

    // Map OOXML style name → preset enum
    let preset = slicer.style.as_deref().and_then(|s| {
        let s = s.strip_prefix("SlicerStyle").unwrap_or(s);
        match s {
            "Light1" => Some(SlicerStylePreset::Light1),
            "Light2" => Some(SlicerStylePreset::Light2),
            "Light3" => Some(SlicerStylePreset::Light3),
            "Light4" => Some(SlicerStylePreset::Light4),
            "Light5" => Some(SlicerStylePreset::Light5),
            "Light6" => Some(SlicerStylePreset::Light6),
            "Dark1" => Some(SlicerStylePreset::Dark1),
            "Dark2" => Some(SlicerStylePreset::Dark2),
            "Dark3" => Some(SlicerStylePreset::Dark3),
            "Dark4" => Some(SlicerStylePreset::Dark4),
            "Dark5" => Some(SlicerStylePreset::Dark5),
            "Dark6" => Some(SlicerStylePreset::Dark6),
            "Other1" => Some(SlicerStylePreset::Other1),
            "Other2" => Some(SlicerStylePreset::Other2),
            _ => None,
        }
    });

    // Build anchor position from SlicerAnchor.
    let position = anchor.map(|a| FloatingObjectAnchor {
        anchor_row: a.from.row,
        anchor_col: a.from.col,
        anchor_row_offset: a.from.row_off,
        anchor_col_offset: a.from.col_off,
        anchor_mode: match a.anchor_mode.unwrap_or(OoxmlSlicerAnchorMode::TwoCell) {
            OoxmlSlicerAnchorMode::TwoCell => AnchorMode::TwoCell,
            OoxmlSlicerAnchorMode::OneCell => AnchorMode::OneCell,
        },
        absolute_x: None,
        absolute_y: None,
        end_row: Some(a.to.row).filter(|_| a.anchor_mode != Some(OoxmlSlicerAnchorMode::OneCell)),
        end_col: Some(a.to.col).filter(|_| a.anchor_mode != Some(OoxmlSlicerAnchorMode::OneCell)),
        end_row_offset: Some(a.to.row_off)
            .filter(|_| a.anchor_mode != Some(OoxmlSlicerAnchorMode::OneCell)),
        end_col_offset: Some(a.to.col_off)
            .filter(|_| a.anchor_mode != Some(OoxmlSlicerAnchorMode::OneCell)),
        extent_cx: a.extent.as_ref().map(|ext| ext.cx),
        extent_cy: a.extent.as_ref().map(|ext| ext.cy),
    });

    StoredSlicer {
        id,
        sheet_id: sheet_id.to_string(),
        source,
        cache_name: Some(slicer.cache.clone()),
        cache_uid: cache.and_then(|c| c.uid.clone()),
        caption: slicer
            .caption
            .clone()
            .unwrap_or_else(|| slicer.name.clone()),
        name: Some(slicer.name.clone()),
        style: SlicerStyle {
            preset,
            custom: None,
            column_count: slicer.column_count as i32,
            button_height: 0,
            show_selection_indicator: true,
            cross_filter,
            custom_list_sort,
            show_items_with_no_data,
            sort_order,
        },
        table_column_index: cache
            .and_then(|c| c.table_slicer_cache.as_ref())
            .map(|tsc| tsc.column),
        pivot_cache_id: cache
            .and_then(|c| c.tabular_data.as_ref())
            .map(|tab| tab.pivot_cache_id),
        pivot_table_tab_id: cache
            .and_then(|c| c.pivot_tables.first())
            .map(|pt| pt.tab_id),
        pivot_tabular_items,
        row_height: slicer.row_height,
        level: slicer.level,
        uid: slicer.uid.clone(),
        ext_lst_xml: slicer.ext_lst.clone(),
        cache_ext_lst_xml: cache.and_then(|c| c.ext_lst.clone()),
        position,
        anchor_object_id: anchor.and_then(|a| a.object_id),
        anchor_macro_name: anchor.and_then(|a| a.macro_name.clone()),
        anchor_nv_ext_lst_xml: anchor.and_then(|a| a.nv_ext_lst.clone()),
        z_index: anchor
            .and_then(|a| a.drawing.anchor_index)
            .and_then(|idx| i32::try_from(idx).ok())
            .unwrap_or(0),
        locked: slicer.locked_position,
        show_header: slicer.show_caption,
        start_item: slicer.start_item.map(|v| v as i32),
        multi_select: true,
        selected_values,
        created_at: None,
        updated_at: None,
    }
}

/// Reconstruct an ooxml-types `SlicerCacheDef` from a `StoredSlicer`.
///
/// Used by the export path to produce `ParseOutput.slicer_caches` from
/// the workbook `slicers` Y.Map.
pub fn stored_slicer_to_cache_def(stored: &StoredSlicer) -> OoxmlSlicerCacheDef {
    let cache_name = stored
        .cache_name
        .clone()
        .unwrap_or_else(|| format!("Slicer_{}", stored.caption));
    match &stored.source {
        SlicerSource::Table {
            table_id,
            column_cell_id,
        } => OoxmlSlicerCacheDef {
            name: cache_name,
            uid: stored.cache_uid.clone(),
            source_name: column_cell_id.clone(),
            pivot_tables: vec![],
            tabular_data: None,
            table_slicer_cache: Some(TableSlicerCache {
                table_id: table_id.parse::<u32>().unwrap_or(0),
                column: stored.table_column_index.unwrap_or(0),
                sort_order: domain_sort_order_to_ooxml(stored.style.sort_order),
                custom_list_sort: stored.style.custom_list_sort,
                cross_filter: domain_cross_filter_to_ooxml(stored.style.cross_filter),
                ext_lst: None,
            }),
            ext_lst: stored.cache_ext_lst_xml.clone(),
        },
        SlicerSource::Pivot {
            pivot_id,
            field_name,
            ..
        } => {
            let items: Vec<SlicerTabularItem> = if stored.pivot_tabular_items.is_empty() {
                stored
                    .selected_values
                    .iter()
                    .enumerate()
                    .map(|(i, _v)| SlicerTabularItem {
                        x: i as u32,
                        s: true,
                        nd: false,
                        unknown_attrs: Vec::new(),
                    })
                    .collect()
            } else {
                stored.pivot_tabular_items.clone()
            };
            let pivot_tables = if pivot_id.is_empty() && stored.pivot_table_tab_id.is_none() {
                Vec::new()
            } else {
                vec![ooxml_types::slicers::SlicerPivotTableRef {
                    tab_id: stored.pivot_table_tab_id.unwrap_or(0),
                    name: pivot_id.clone(),
                }]
            };
            OoxmlSlicerCacheDef {
                name: cache_name,
                uid: stored.cache_uid.clone(),
                source_name: field_name.clone(),
                pivot_tables,
                tabular_data: Some(ooxml_types::slicers::SlicerTabularData {
                    pivot_cache_id: stored.pivot_cache_id.unwrap_or(0),
                    sort_order: domain_sort_order_to_ooxml(stored.style.sort_order),
                    custom_list_sort: stored.style.custom_list_sort,
                    show_missing: stored.style.show_items_with_no_data,
                    cross_filter: domain_cross_filter_to_ooxml(stored.style.cross_filter),
                    items,
                    ext_lst: None,
                }),
                table_slicer_cache: None,
                ext_lst: stored.cache_ext_lst_xml.clone(),
            }
        }
    }
}

/// Reconstruct an ooxml-types `SlicerDef` from a `StoredSlicer`.
///
/// Used by the export path to produce `SheetData.slicers` from
/// the workbook `slicers` Y.Map.
pub fn stored_slicer_to_slicer_def(stored: &StoredSlicer) -> OoxmlSlicerDef {
    let cache_name = stored
        .cache_name
        .clone()
        .unwrap_or_else(|| format!("Slicer_{}", stored.caption));
    let style_name = stored.style.preset.map(|p| {
        let variant = match p {
            SlicerStylePreset::Light1 => "Light1",
            SlicerStylePreset::Light2 => "Light2",
            SlicerStylePreset::Light3 => "Light3",
            SlicerStylePreset::Light4 => "Light4",
            SlicerStylePreset::Light5 => "Light5",
            SlicerStylePreset::Light6 => "Light6",
            SlicerStylePreset::Dark1 => "Dark1",
            SlicerStylePreset::Dark2 => "Dark2",
            SlicerStylePreset::Dark3 => "Dark3",
            SlicerStylePreset::Dark4 => "Dark4",
            SlicerStylePreset::Dark5 => "Dark5",
            SlicerStylePreset::Dark6 => "Dark6",
            SlicerStylePreset::Other1 => "Other1",
            SlicerStylePreset::Other2 => "Other2",
        };
        format!("SlicerStyle{}", variant)
    });
    OoxmlSlicerDef {
        name: stored.name.clone().unwrap_or_else(|| {
            stored
                .id
                .strip_prefix("slicer-")
                .unwrap_or(&stored.id)
                .to_string()
        }),
        cache: cache_name,
        caption: Some(stored.caption.clone()),
        start_item: stored.start_item.map(|v| v as u32),
        column_count: stored.style.column_count as u32,
        show_caption: stored.show_header,
        level: stored.level,
        style: style_name,
        locked_position: stored.locked,
        row_height: stored.row_height,
        uid: stored.uid.clone(),
        ext_lst: stored.ext_lst_xml.clone(),
    }
}

/// Reconstruct an ooxml-types `SlicerAnchor` from a `StoredSlicer`.
///
/// Returns `None` if the stored slicer has no position data.
pub fn stored_slicer_to_anchor(stored: &StoredSlicer) -> Option<OoxmlSlicerAnchor> {
    let pos = stored.position.as_ref()?;
    let is_one_cell = pos.anchor_mode == AnchorMode::OneCell;
    let end_row = if is_one_cell {
        pos.anchor_row
    } else {
        pos.end_row?
    };
    let end_col = if is_one_cell {
        pos.anchor_col
    } else {
        pos.end_col?
    };
    let end_row_offset = pos.end_row_offset.unwrap_or(0);
    let end_col_offset = pos.end_col_offset.unwrap_or(0);
    Some(OoxmlSlicerAnchor {
        slicer_name: stored.name.clone().unwrap_or_else(|| {
            stored
                .id
                .strip_prefix("slicer-")
                .unwrap_or(&stored.id)
                .to_string()
        }),
        object_id: stored.anchor_object_id,
        from: CellAnchor {
            col: pos.anchor_col,
            col_off: pos.anchor_col_offset,
            row: pos.anchor_row,
            row_off: pos.anchor_row_offset,
        },
        to: CellAnchor {
            col: end_col,
            col_off: end_col_offset,
            row: end_row,
            row_off: end_row_offset,
        },
        anchor_mode: Some(if is_one_cell {
            OoxmlSlicerAnchorMode::OneCell
        } else {
            OoxmlSlicerAnchorMode::TwoCell
        }),
        extent: if is_one_cell {
            Some(ooxml_types::drawings::Extent {
                cx: pos.extent_cx.unwrap_or(0),
                cy: pos.extent_cy.unwrap_or(0),
            })
        } else {
            None
        },
        macro_name: stored.anchor_macro_name.clone(),
        nv_ext_lst: stored.anchor_nv_ext_lst_xml.clone(),
        drawing: ooxml_types::drawings::DrawingAnchorMetadata {
            anchor_index: usize::try_from(stored.z_index).ok(),
        },
    })
}
