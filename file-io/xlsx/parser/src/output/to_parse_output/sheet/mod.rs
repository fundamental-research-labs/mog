use super::*;

mod comments;

use comments::build_sheet_comments;

fn env_flag_default_true(name: &str) -> bool {
    std::env::var(name)
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            !matches!(normalized.as_str(), "0" | "false" | "no" | "off")
        })
        .unwrap_or(true)
}

// =============================================================================
// Sheet conversion
// =============================================================================

/// Convert a single `FullParsedSheet` into `SheetData`.
pub(super) fn convert_sheet(
    sheet: &FullParsedSheet,
    shared_strings: &[String],
    shared_strings_rich_runs: &[Option<Vec<domain_types::RichTextRun>>],
    shared_strings_phonetic_xml: &[Option<Vec<u8>>],
    dxfs: &[crate::domain::styles::types::DxfDef],
    theme_colors: &[String],
    media_data_urls: &HashMap<String, String>,
    binary_parts: &HashMap<String, Vec<u8>>,
    metadata: Option<&crate::output::results::MetadataOutput>,
) -> SheetData {
    // --- Cells ---
    let projection_roles = build_projection_roles(&sheet.cells, metadata);
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
                shared_strings_rich_runs,
                shared_strings_phonetic_xml,
                role,
                sst_compaction.as_ref(),
                compact_numeric_provenance,
                compact_non_formula_cached_type,
            )
        })
        .collect();
    let mut authored_style_points = Vec::new();
    let mut cells = Vec::with_capacity(converted_cells.len());
    for mut cell in converted_cells {
        if is_style_only_cell(&cell) {
            authored_style_points.push((cell.row, cell.col, cell.style_id.unwrap_or(0)));
        } else {
            if is_styleless_blank_cell(&cell) {
                cell.original_value = Some(String::new());
            }
            cells.push(cell);
        }
    }
    let mut occupied_cells: HashSet<(u32, u32)> =
        cells.iter().map(|cell| (cell.row, cell.col)).collect();
    for &(row, col) in &sheet.explicit_blank_cells {
        if occupied_cells.insert((row, col)) {
            cells.push(explicit_blank_cell(row, col));
        }
    }
    cells.sort_by_key(|cell| (cell.row, cell.col));
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
            height_str: rh.height_str.clone(),
            custom_height: rh.custom_height,
            hidden: rh.hidden.unwrap_or(false),
            explicit_hidden: rh.hidden.is_some(),
            custom_format: rh.custom_format,
            outline_level: rh.outline_level,
            explicit_outline_level_zero: rh.outline_level == Some(0),
            collapsed: rh.collapsed,
            thick_top: rh.thick_top,
            thick_bot: rh.thick_bot,
            phonetic: rh.ph,
            descent: sheet.row_descents.get(&rh.row).copied(),
            xml_hints: RowXmlHints {
                spans: rh
                    .spans
                    .clone()
                    .or_else(|| sheet.row_spans.get(&rh.row).cloned()),
                bare_empty: false,
            },
        })
        .collect();
    // Add metadata-only entries for rows that have typed row-owned metadata but
    // no RowHeight entry.
    {
        let existing_rows: std::collections::HashSet<u32> =
            row_heights.iter().map(|rd| rd.row).collect();
        for (&row, spans) in &sheet.row_spans {
            if !existing_rows.contains(&row) {
                row_heights.push(RowDimension {
                    row,
                    height: 0.0,
                    height_str: None,
                    custom_height: false,
                    hidden: false,
                    explicit_hidden: false,
                    custom_format: false,
                    outline_level: None,
                    explicit_outline_level_zero: false,
                    collapsed: None,
                    thick_top: false,
                    thick_bot: false,
                    phonetic: false,
                    descent: None,
                    xml_hints: RowXmlHints {
                        spans: Some(spans.clone()),
                        bare_empty: false,
                    },
                });
            }
        }
        let existing_rows: std::collections::HashSet<u32> =
            row_heights.iter().map(|rd| rd.row).collect();
        for &row in &sheet.bare_empty_rows {
            if !existing_rows.contains(&row) {
                row_heights.push(RowDimension {
                    row,
                    height: 0.0,
                    height_str: None,
                    custom_height: false,
                    hidden: false,
                    explicit_hidden: false,
                    custom_format: false,
                    outline_level: None,
                    explicit_outline_level_zero: false,
                    collapsed: None,
                    thick_top: false,
                    thick_bot: false,
                    phonetic: false,
                    descent: None,
                    xml_hints: RowXmlHints {
                        spans: None,
                        bare_empty: true,
                    },
                });
            } else if let Some(dim) = row_heights.iter_mut().find(|rd| rd.row == row) {
                dim.xml_hints.bare_empty = true;
            }
        }
        let existing_rows: std::collections::HashSet<u32> =
            row_heights.iter().map(|rd| rd.row).collect();
        for (&row, &d) in &sheet.row_descents {
            if !existing_rows.contains(&row) {
                row_heights.push(RowDimension {
                    row,
                    height: 0.0,
                    height_str: None,
                    custom_height: false,
                    hidden: false,
                    explicit_hidden: false,
                    custom_format: false,
                    outline_level: None,
                    explicit_outline_level_zero: false,
                    collapsed: None,
                    thick_top: false,
                    thick_bot: false,
                    phonetic: false,
                    descent: Some(d),
                    xml_hints: RowXmlHints::default(),
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
                    width_str: cw.width_str.clone(),
                    width_present: Some(cw.width.is_some()),
                    custom_width: cw.custom_width,
                    custom_width_attr: cw.custom_width_attr,
                    hidden: cw.hidden,
                    hidden_attr: cw.hidden_attr,
                    best_fit: cw.best_fit,
                    best_fit_attr: cw.best_fit_attr,
                    outline_level: cw.outline_level,
                    collapsed: cw.collapsed,
                    collapsed_attr: cw.collapsed_attr,
                    phonetic: cw.phonetic,
                    phonetic_attr: cw.phonetic_attr,
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
                width_str: cw.width_str.clone(),
                width_present: Some(cw.width.is_some()),
                custom_width: cw.custom_width,
                custom_width_attr: cw.custom_width_attr,
                hidden: cw.hidden,
                hidden_attr: cw.hidden_attr,
                best_fit: cw.best_fit,
                best_fit_attr: cw.best_fit_attr,
                outline_level: cw.outline_level,
                collapsed: cw.collapsed,
                collapsed_attr: cw.collapsed_attr,
                phonetic: cw.phonetic,
                phonetic_attr: cw.phonetic_attr,
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
        thick_top: sheet.thick_top,
        thick_bottom: sheet.thick_bottom,
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
    let primary_pane = sheet
        .view_options
        .first()
        .and_then(|view| view.pane.as_ref())
        .or(sheet.frozen_pane.as_ref());
    let frozen_pane = primary_pane
        .filter(|pane| pane.is_frozen())
        .map(|fp| FrozenPane {
            rows: fp.y_split as u32,
            cols: fp.x_split as u32,
            top_left_cell: fp.top_left_cell.clone(),
        });

    // --- Sheet view ---
    let view = sheet
        .view_options
        .first()
        .cloned()
        .map(ooxml_types::worksheet::SheetView::from)
        .map(|view| SheetView::from_ooxml(&view))
        .unwrap_or_default();

    // Extra sheet views (index 1+) for round-trip fidelity of multiple <sheetView> elements.
    let extra_sheet_views: Vec<SheetView> = sheet
        .view_options
        .iter()
        .skip(1)
        .cloned()
        .map(ooxml_types::worksheet::SheetView::from)
        .map(|view| SheetView::from_ooxml(&view))
        .collect();

    let comments = build_sheet_comments(sheet);

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
            let target = h
                .target
                .clone()
                .or_else(|| rel.map(|(target, _)| target.to_string()));
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
            password_hash: p.password.clone(),
            hash_value: p.hash_value.clone(),
            algorithm_name: p.algorithm_name.clone(),
            salt_value: p.salt_value.clone(),
            spin_count: p.spin_count,
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
    let x14_data_validations = convert_data_validations(&sheet.x14_data_validations);
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
    floating_objects.extend(convert_ole_objects(
        &sheet.ole_objects,
        binary_parts,
        media_data_urls,
    ));

    // --- Header/footer images ---
    // Parse HF images from VML drawings and resolve image rel IDs to file paths.
    let hf_images = convert_hf_images(sheet);
    let comment_package = build_sheet_comment_package_info(sheet);
    let drawing_package = build_sheet_drawing_package_info(sheet);

    // --- Build SheetData ---
    let mut sheet_properties = sheet.sheet_properties.clone();
    if let Some(properties) = &mut sheet_properties {
        properties.page_set_up_pr = None;
    }

    SheetData {
        name: sheet.name.clone(),
        rows,
        cols,
        worksheet_root_namespaces: Default::default(),
        worksheet_ext_lst_xml: None,
        worksheet_dimension_ref: sheet.worksheet_dimension_ref.clone(),
        sheet_id: sheet.sheet_id,
        visibility: sheet.state,
        uid: sheet.uid.clone(),
        cells,
        authored_style_runs,
        dimensions,
        merges,
        frozen_pane,
        view,
        sheet_views_ext_lst_xml: sheet.sheet_views_ext_lst_xml.clone(),
        row_styles,
        col_styles,
        // Domain objects
        charts,
        conditional_formats,
        comments,
        legacy_comment_authors: sheet.comment_authors.clone(),
        comment_package,
        drawing_package,
        hyperlinks,
        data_validations,
        x14_data_validations,
        sparklines,
        sparkline_groups,
        tables: Vec::new(), // Populated by caller with per-sheet tables.
        slicers,
        slicer_anchors,
        timelines: sheet.timelines.clone(),
        timeline_anchors: sheet.timeline_anchors.clone(),
        floating_objects,
        print_settings,
        page_breaks,
        hf_images,
        protection,
        worksheet_semantic_containers: sheet.worksheet_semantic_containers.clone(),
        sheet_calc_pr: sheet.sheet_calc_pr.clone(),
        auto_filter: sheet.auto_filter.clone(),
        sort_state: sheet.sort_state.clone(),
        data_validations_declared_count: sheet.data_validations_declared_count,
        data_validations_disable_prompts: sheet.data_validations_disable_prompts,
        data_validations_x_window: sheet.data_validations_x_window,
        data_validations_y_window: sheet.data_validations_y_window,
        x14_data_validations_declared_count: sheet.x14_data_validations_declared_count,
        x14_data_validations_disable_prompts: sheet.x14_data_validations_disable_prompts,
        x14_data_validations_x_window: sheet.x14_data_validations_x_window,
        x14_data_validations_y_window: sheet.x14_data_validations_y_window,
        outline_groups,
        sheet_properties,
        outline_properties: sheet.outline_properties.clone(),
        extra_sheet_views,
    }
}

fn build_sheet_drawing_package_info(
    sheet: &FullParsedSheet,
) -> Option<domain_types::SheetDrawingPackageInfo> {
    let owner_part = sheet
        .owner_part_path
        .clone()
        .unwrap_or_else(|| format!("xl/worksheets/sheet{}.xml", sheet.index + 1));
    let rel = sheet
        .sheet_opc_rels
        .iter()
        .find(|rel| rel.rel_type == crate::infra::opc::REL_DRAWING)?;
    let drawing_path_hint = crate::infra::opc::resolve_relationship_target(
        Some(owner_part.as_str()),
        rel.target.as_str(),
    )
    .ok()
    .map(|path| domain_types::normalize_package_path(&path));
    Some(domain_types::SheetDrawingPackageInfo {
        drawing_path_hint,
        drawing_relationship_id_hint: Some(rel.id.clone()),
        drawing_relationship_target_hint: Some(rel.target.clone()),
        worksheet_relationships_file_present: true,
    })
}
