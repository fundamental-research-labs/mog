//! Diagnostics, theme conversion, and named ranges.

use domain_types::{
    ImportedMetadataXml, MetadataCellReference, NamedRange, ParseDiagnostics,
    ParseError as DtParseError, ParseStats as DtParseStats, SheetData, ThemeColor,
    ThemeColorSource, ThemeData, WorkbookMetadata,
};

use crate::output::results::FullParseResult;

use super::normalize_rgb_color;

// =============================================================================
// Named ranges
// =============================================================================

pub(super) fn convert_named_ranges(result: &FullParseResult) -> Vec<NamedRange> {
    result
        .defined_names
        .iter()
        .map(|dn| NamedRange {
            name: dn.name.clone(),
            refers_to: dn.refers_to.clone(),
            local_sheet_id: dn.local_sheet_id,
            hidden: dn.hidden,
            comment: dn.comment.clone(),
            custom_menu: dn.custom_menu.clone(),
            description: dn.description.clone(),
            help: dn.help.clone(),
            status_bar: dn.status_bar.clone(),
            xlm: dn.xlm,
            function_group_id: dn.function_group_id,
            shortcut_key: dn.shortcut_key.clone(),
            function: dn.function,
            vb_procedure: dn.vb_procedure,
            publish_to_server: dn.publish_to_server,
            workbook_parameter: dn.workbook_parameter,
            xml_space_preserve: dn.xml_space_preserve,
        })
        .collect()
}

// =============================================================================
// Theme
// =============================================================================

pub(super) fn convert_theme(result: &FullParseResult) -> Option<ThemeData> {
    // We need at least one typed theme field to produce ThemeData.
    let has_colors = result.theme_color_scheme.is_some();
    let has_fonts = result.theme_font_scheme.is_some();
    let has_name = result.theme_name.is_some();

    if !has_colors && !has_fonts && !has_name {
        return None;
    }

    // ECMA-376 color scheme index order (matches get_by_index).
    let color_slot_names: &[(u8, &str)] = &[
        (0, "dk1"),
        (1, "lt1"),
        (2, "dk2"),
        (3, "lt2"),
        (4, "accent1"),
        (5, "accent2"),
        (6, "accent3"),
        (7, "accent4"),
        (8, "accent5"),
        (9, "accent6"),
        (10, "hlink"),
        (11, "folHlink"),
    ];

    let colors = if let Some(cs) = result.theme_color_scheme.as_ref() {
        color_slot_names
            .iter()
            .filter_map(|&(idx, name)| {
                let hex = cs.resolve_hex(idx)?;
                let color = normalize_rgb_color(&hex);

                // Check for sysClr source info for round-trip fidelity.
                let source = cs.get_by_index(idx).and_then(|dc| {
                    use ooxml_types::drawings::DrawingColor;
                    match dc {
                        DrawingColor::SysClr { val, last_clr, .. } => {
                            Some(ThemeColorSource::SysClr {
                                val: val.to_ooxml().to_string(),
                                last_clr: last_clr.clone().unwrap_or_default(),
                            })
                        }
                        _ => None, // srgbClr is the default — omit source
                    }
                });

                Some(ThemeColor {
                    name: name.to_string(),
                    color,
                    source,
                })
            })
            .collect()
    } else {
        Vec::new()
    };

    let major_font = result
        .theme_font_scheme
        .as_ref()
        .map(|fs| fs.major_font.latin.typeface.clone());
    let minor_font = result
        .theme_font_scheme
        .as_ref()
        .map(|fs| fs.minor_font.latin.typeface.clone());

    let name = result.theme_name.clone();

    Some(ThemeData {
        colors,
        major_font,
        minor_font,
        theme_part_path: result.theme_part_path.clone(),
        theme_relationship_id_hint: result.theme_relationship_id_hint.clone(),
        theme_relationship_type: result.theme_relationship_type.clone(),
        name,
        color_scheme: result.theme_color_scheme.clone(),
        font_scheme: result.theme_font_scheme.clone(),
        format_scheme: result.theme_format_scheme.clone(),
        object_defaults_xml: result.theme_object_defaults_xml.clone(),
        extra_clr_scheme_lst_xml: result.theme_extra_clr_scheme_lst_xml.clone(),
        ext_lst_xml: result.theme_ext_lst_xml.clone(),
        cust_clr_lst_xml: result.theme_cust_clr_lst_xml.clone(),
        root_sibling_order: result.theme_root_sibling_order.clone(),
    })
}

pub(super) fn imported_metadata_xml(
    raw_xml: &[u8],
    metadata: &WorkbookMetadata,
    sheets: &[SheetData],
) -> ImportedMetadataXml {
    ImportedMetadataXml {
        bytes: raw_xml.to_vec(),
        generated_at_import: crate::domain::metadata::spreadsheet_xml::write_metadata_model_xml(
            metadata,
        ),
        cell_metadata_refs: metadata_refs(sheets, |cell| cell.cell_metadata_index),
        value_metadata_refs: metadata_refs(sheets, |cell| cell.vm),
    }
}

fn metadata_refs(
    sheets: &[SheetData],
    index_of: impl Fn(&domain_types::CellData) -> Option<u32>,
) -> Vec<MetadataCellReference> {
    let index_of = &index_of;
    let mut refs: Vec<_> = sheets
        .iter()
        .enumerate()
        .flat_map(|(sheet_index, sheet)| {
            sheet.cells.iter().filter_map(move |cell| {
                index_of(cell).map(|index| MetadataCellReference {
                    sheet_index: sheet_index as u32,
                    row: cell.row,
                    col: cell.col,
                    index,
                })
            })
        })
        .collect();
    refs.sort_by_key(|reference| {
        (
            reference.sheet_index,
            reference.row,
            reference.col,
            reference.index,
        )
    });
    refs
}

// =============================================================================
// Diagnostics
// =============================================================================

pub(super) fn build_diagnostics(result: &FullParseResult) -> ParseDiagnostics {
    let errors: Vec<DtParseError> = result
        .errors
        .iter()
        .map(|e| DtParseError {
            code: e.code,
            severity: e.severity.clone(),
            message: e.message.clone(),
            part: e.part.clone(),
            row: e.row,
            col: e.col,
        })
        .collect();

    let stats = DtParseStats {
        total_cells: result.stats.total_cells,
        total_sheets: result.stats.total_sheets,
        parse_time_us: result.stats.parse_time_us as u64,
    };

    // Collect force-recalc cells across all sheets, preserving sheet identity.
    let mut force_recalc_cells = std::collections::HashSet::new();
    for (sheet_idx, sheet) in result.sheets.iter().enumerate() {
        for cell in &sheet.cells {
            if cell.force_recalc {
                force_recalc_cells.insert((sheet_idx as u32, cell.row, cell.col));
            }
        }
    }

    ParseDiagnostics {
        errors,
        stats,
        force_recalc_cells,
        import_report: None,
    }
}
