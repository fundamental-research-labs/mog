//! Style conversion: DocumentFormat / Stylesheet → StylesWriter.

use std::collections::{BTreeMap, BTreeSet};

use domain_types::{
    AlignmentFormat, BorderFormat, BorderSide, DocumentFormat, FillFormat, FontFormat, ParseOutput,
    ProtectionFormat,
};

use crate::domain::styles::write::{
    AlignmentDef, BorderDef, BorderSideDef, BorderStyle, CellXfDef, ColorDef, FillDef, FontDef,
    FontScheme, HorizontalAlign, PatternType, ProtectionDef, StylesWriter, UnderlineStyle,
    VerticalAlign,
};

/// Build a `StylesWriter` from a palette of `DocumentFormat` entries.
///
/// Build a `StylesWriter` directly from a parsed OOXML `Stylesheet`.
///
/// This is the **lossless** path: every style component (fonts, fills, borders,
/// cellXfs, cellStyleXfs, cellStyles, dxfs, numFmts, colors, tableStyles) is
/// transferred directly — no theme color resolution, no flattening, no
/// information loss. The types are identical (`ooxml_types::styles::*`).
///
/// Used when `RoundTripContext.parsed_stylesheet` is available (i.e., the file
/// was parsed from an XLSX and we have the original style hierarchy).
pub(super) fn build_styles_from_stylesheet(
    stylesheet: &ooxml_types::styles::Stylesheet,
    ext_lst_raw: Option<&[u8]>,
    namespace_attrs: &[(String, String)],
    output: &ParseOutput,
) -> StylesWriter {
    let mut writer = StylesWriter::new();
    let referenced_cell_xfs = referenced_cell_xf_ids(output);

    // Transfer all style components directly — same ooxml_types, zero conversion.
    writer.num_fmts = stylesheet.num_fmts.clone();
    writer.fonts = stylesheet.fonts.clone();
    writer.fills = stylesheet.fills.clone();
    writer.borders = stylesheet.borders.clone();
    writer.cell_xfs = stylesheet.cell_xfs.clone();
    writer.cell_style_xfs = stylesheet.cell_style_xfs.clone();
    writer.cell_styles = stylesheet.cell_styles.clone();
    writer.dxfs = stylesheet.dxfs.clone();
    writer.colors = stylesheet.colors.clone();
    writer.table_styles = stylesheet.table_styles.clone();
    writer.default_table_style = stylesheet.default_table_style.clone();
    writer.default_pivot_style = stylesheet.default_pivot_style.clone();
    writer.known_fonts = stylesheet.known_fonts;
    writer.ext_lst_raw = ext_lst_raw.map(|b| b.to_vec());

    if sanitize_unreferenced_lossless_styles(&mut writer, &referenced_cell_xfs, output) {
        writer.ext_lst_raw = None;
    }

    // Reconstruct namespace map from preserved (prefix, uri) pairs.
    if !namespace_attrs.is_empty() {
        use crate::roundtrip::namespaces::NamespaceMap;
        let mut ns_map = NamespaceMap::new();
        for (prefix, uri) in namespace_attrs {
            if prefix.is_empty() {
                ns_map.set_default(uri);
            } else {
                ns_map.add_prefixed(prefix, uri);
            }
        }
        writer.preserved_namespaces = Some(ns_map);
    }

    writer
}

fn sanitize_unreferenced_lossless_styles(
    writer: &mut StylesWriter,
    referenced_cell_xfs: &BTreeSet<u32>,
    output: &ParseOutput,
) -> bool {
    let mut pruned = sanitize_unreferenced_differential_styles(writer, output);

    if writer.cell_xfs.is_empty() {
        return pruned;
    }

    let mut kept_cell_xfs = writer.cell_xfs.clone();
    for (idx, xf) in kept_cell_xfs.iter_mut().enumerate() {
        if idx != 0 && !referenced_cell_xfs.contains(&(idx as u32)) {
            let default = default_cell_xf();
            if *xf != default {
                *xf = default;
                pruned = true;
            }
        }
    }

    let mut referenced_cell_style_xfs = BTreeSet::from([0_u32]);
    for xf in &kept_cell_xfs {
        if let Some(xf_id) = xf.xf_id {
            referenced_cell_style_xfs.insert(xf_id);
        }
    }

    let mut kept_cell_style_xfs = writer.cell_style_xfs.clone();
    for (idx, xf) in kept_cell_style_xfs.iter_mut().enumerate() {
        if !referenced_cell_style_xfs.contains(&(idx as u32)) {
            let default = default_cell_style_xf();
            if *xf != default {
                *xf = default;
                pruned = true;
            }
        }
    }

    let mut font_ids = BTreeSet::from([0_u32]);
    let mut fill_ids = BTreeSet::from([0_u32]);
    let mut border_ids = BTreeSet::from([0_u32]);
    let mut num_fmt_ids = BTreeSet::new();
    for xf in kept_cell_xfs.iter().chain(kept_cell_style_xfs.iter()) {
        collect_xf_component_ids(
            xf,
            &mut font_ids,
            &mut fill_ids,
            &mut border_ids,
            &mut num_fmt_ids,
        );
    }

    let font_remap = prune_indexed_table(&mut writer.fonts, &font_ids);
    let fill_remap = prune_indexed_table(&mut writer.fills, &fill_ids);
    let border_remap = prune_indexed_table(&mut writer.borders, &border_ids);

    remap_xf_component_ids(&mut kept_cell_xfs, &font_remap, &fill_remap, &border_remap);
    remap_xf_component_ids(
        &mut kept_cell_style_xfs,
        &font_remap,
        &fill_remap,
        &border_remap,
    );

    let original_num_fmts_len = writer.num_fmts.len();
    writer.num_fmts.retain(|fmt| num_fmt_ids.contains(&fmt.id));
    if writer.num_fmts.len() != original_num_fmts_len {
        pruned = true;
    }
    writer.cell_xfs = kept_cell_xfs;
    writer.cell_style_xfs = kept_cell_style_xfs;
    pruned
}

fn sanitize_unreferenced_differential_styles(
    writer: &mut StylesWriter,
    output: &ParseOutput,
) -> bool {
    let referenced_table_styles = referenced_table_style_names(output);
    let original_table_style_count = writer.table_styles.len();
    writer
        .table_styles
        .retain(|style| referenced_table_styles.contains(&style.name));
    let mut pruned = writer.table_styles.len() != original_table_style_count;

    let mut referenced_dxfs = referenced_dxf_ids(output);
    for table_style in &writer.table_styles {
        for element in &table_style.elements {
            if let Some(dxf_id) = element.dxf_id {
                referenced_dxfs.insert(dxf_id);
            }
        }
    }

    if referenced_dxfs.is_empty() {
        if !writer.dxfs.is_empty() {
            writer.dxfs.clear();
            pruned = true;
        }
        return pruned;
    }

    let default_dxf = ooxml_types::styles::DxfDef::default();
    for (idx, dxf) in writer.dxfs.iter_mut().enumerate() {
        if !referenced_dxfs.contains(&(idx as u32)) && *dxf != default_dxf {
            *dxf = default_dxf.clone();
            pruned = true;
        }
    }

    pruned
}

fn referenced_cell_xf_ids(output: &ParseOutput) -> BTreeSet<u32> {
    let mut ids = BTreeSet::from([0_u32]);
    for sheet in &output.sheets {
        ids.extend(sheet.cells.iter().filter_map(|cell| cell.style_id));
        ids.extend(sheet.authored_style_runs.iter().map(|run| run.style_id));
        ids.extend(sheet.row_styles.iter().map(|row| row.style_id));
        ids.extend(sheet.col_styles.iter().map(|col| col.style_id));
        ids.extend(
            sheet
                .dimensions
                .trailing_col_ranges
                .iter()
                .filter_map(|range| range.style_id),
        );
    }
    ids
}

fn referenced_table_style_names(output: &ParseOutput) -> BTreeSet<String> {
    output
        .sheets
        .iter()
        .flat_map(|sheet| sheet.tables.iter())
        .filter_map(|table| table.style_name.clone())
        .collect()
}

fn referenced_dxf_ids(output: &ParseOutput) -> BTreeSet<u32> {
    let mut ids = BTreeSet::new();
    for sheet in &output.sheets {
        for cf in &sheet.conditional_formats {
            for rule in &cf.rules {
                if let Some(style) = conditional_format_rule_style(rule)
                    && let Some(dxf_id) = style.dxf_id
                {
                    ids.insert(dxf_id);
                }
            }
        }
        if let Some(auto_filter) = &sheet.auto_filter {
            collect_auto_filter_dxf_ids(auto_filter, &mut ids);
        }
        if let Some(sort_state) = &sheet.sort_state {
            collect_sort_state_dxf_ids(sort_state, &mut ids);
        }
        for table in &sheet.tables {
            collect_table_dxf_ids(table, &mut ids);
        }
    }
    ids
}

fn collect_auto_filter_dxf_ids(auto_filter: &domain_types::AutoFilter, ids: &mut BTreeSet<u32>) {
    for column in &auto_filter.columns {
        if let Some(domain_types::OoxmlFilterType::Color {
            dxf_id: Some(dxf_id),
            ..
        }) = &column.filter_type
        {
            ids.insert(*dxf_id);
        }
    }
    if let Some(sort_state) = &auto_filter.sort {
        collect_sort_state_dxf_ids(sort_state, ids);
    }
}

fn collect_sort_state_dxf_ids(sort_state: &domain_types::SortState, ids: &mut BTreeSet<u32>) {
    ids.extend(
        sort_state
            .conditions
            .iter()
            .filter_map(|condition| condition.dxf_id),
    );
}

fn collect_table_dxf_ids(table: &domain_types::TableSpec, ids: &mut BTreeSet<u32>) {
    ids.extend(
        [
            table.header_row_dxf_id,
            table.data_dxf_id,
            table.totals_row_dxf_id,
            table.header_row_border_dxf_id,
            table.table_border_dxf_id,
            table.totals_row_border_dxf_id,
        ]
        .into_iter()
        .flatten(),
    );
    for column in &table.columns {
        ids.extend(
            [
                column.header_row_dxf_id,
                column.data_dxf_id,
                column.totals_row_dxf_id,
            ]
            .into_iter()
            .flatten(),
        );
    }
    for column in &table.filter_columns {
        if let domain_types::FilterSpec::Color {
            dxf_id: Some(dxf_id),
            ..
        } = &column.filter
        {
            ids.insert(*dxf_id);
        }
    }
}

fn collect_xf_component_ids(
    xf: &CellXfDef,
    font_ids: &mut BTreeSet<u32>,
    fill_ids: &mut BTreeSet<u32>,
    border_ids: &mut BTreeSet<u32>,
    num_fmt_ids: &mut BTreeSet<u32>,
) {
    if let Some(id) = xf.font_id {
        font_ids.insert(id);
    }
    if let Some(id) = xf.fill_id {
        fill_ids.insert(id);
    }
    if let Some(id) = xf.border_id {
        border_ids.insert(id);
    }
    if let Some(id) = xf.num_fmt_id
        && id >= 164
    {
        num_fmt_ids.insert(id);
    }
}

fn prune_indexed_table<T: Clone>(
    items: &mut Vec<T>,
    keep_ids: &BTreeSet<u32>,
) -> BTreeMap<u32, u32> {
    if items.is_empty() {
        return BTreeMap::new();
    }

    let old_items = std::mem::take(items);
    let mut remap = BTreeMap::new();
    for (old_idx, item) in old_items.into_iter().enumerate() {
        let old_idx = old_idx as u32;
        if keep_ids.contains(&old_idx) {
            let new_idx = items.len() as u32;
            items.push(item);
            remap.insert(old_idx, new_idx);
        }
    }

    if items.is_empty() {
        return BTreeMap::new();
    }
    remap
}

fn remap_xf_component_ids(
    xfs: &mut [CellXfDef],
    font_remap: &BTreeMap<u32, u32>,
    fill_remap: &BTreeMap<u32, u32>,
    border_remap: &BTreeMap<u32, u32>,
) {
    for xf in xfs {
        xf.font_id = xf.font_id.map(|id| *font_remap.get(&id).unwrap_or(&0));
        xf.fill_id = xf.fill_id.map(|id| *fill_remap.get(&id).unwrap_or(&0));
        xf.border_id = xf.border_id.map(|id| *border_remap.get(&id).unwrap_or(&0));
    }
}

fn default_cell_xf() -> CellXfDef {
    CellXfDef {
        num_fmt_id: Some(0),
        font_id: Some(0),
        fill_id: Some(0),
        border_id: Some(0),
        xf_id: Some(0),
        ..Default::default()
    }
}

fn default_cell_style_xf() -> CellXfDef {
    CellXfDef {
        num_fmt_id: Some(0),
        font_id: Some(0),
        fill_id: Some(0),
        border_id: Some(0),
        ..Default::default()
    }
}

/// Build a `StylesWriter` from a flat `DocumentFormat` palette (lossy fallback).
///
/// Each `DocumentFormat` in the palette becomes a cellXf entry. The returned
/// writer's cellXfs[0] is always the default style (empty `DocumentFormat`);
/// cellXfs[N] for N >= 1 corresponds to `palette[N-1]`.
///
/// The caller can use `style_id` values from `CellData` directly as indices
/// into the palette — they get offset by +1 when building `CellData` for the
/// writer (because cellXfs[0] is the default).
pub(super) fn build_styles(palette: &[DocumentFormat]) -> StylesWriter {
    let mut writer = StylesWriter::with_defaults();

    // The default style is already at cellXfs[0] from with_defaults().
    // Now add one cellXf per palette entry.
    for doc_fmt in palette {
        let font_id = doc_fmt
            .font
            .as_ref()
            .map(|f| writer.add_font(convert_font(f)))
            .unwrap_or(0);

        let fill_id = doc_fmt
            .fill
            .as_ref()
            .map(|f| writer.add_fill(convert_fill(f)))
            .unwrap_or(0);

        let border_id = doc_fmt
            .border
            .as_ref()
            .map(|b| writer.add_border(convert_border(b)))
            .unwrap_or(0);

        let num_fmt_id = doc_fmt
            .number_format
            .as_ref()
            .map(|nf| writer.add_num_fmt(nf))
            .unwrap_or(0);

        let alignment = doc_fmt.alignment.as_ref().map(convert_alignment);
        let protection = doc_fmt.protection.as_ref().map(convert_protection);

        let has_font = font_id != 0;
        let has_fill = fill_id != 0;
        let has_border = border_id != 0;
        let has_num_fmt = num_fmt_id != 0;
        let has_alignment = alignment.is_some();
        let has_protection = protection.is_some();

        let xf = CellXfDef {
            num_fmt_id: Some(num_fmt_id),
            font_id: Some(font_id),
            fill_id: Some(fill_id),
            border_id: Some(border_id),
            xf_id: Some(0),
            alignment,
            protection,
            apply_number_format: if has_num_fmt { Some(true) } else { None },
            apply_font: if has_font { Some(true) } else { None },
            apply_fill: if has_fill { Some(true) } else { None },
            apply_border: if has_border { Some(true) } else { None },
            apply_alignment: if has_alignment { Some(true) } else { None },
            apply_protection: if has_protection { Some(true) } else { None },
            pivot_button: false,
            quote_prefix: false,
            ext_lst: None,
        };

        writer.add_cell_xf(xf);
    }

    writer
}

/// Whether the current modeled workbook references any style IDs.
///
/// Imported stylesheets are useful identity/style hints only while some current
/// workbook object still points at their raw cellXfs indices. If all style
/// references disappeared, replaying the imported stylesheet keeps stale style
/// facts alive after deletion.
pub(super) fn output_references_style_ids(output: &ParseOutput) -> bool {
    output.sheets.iter().any(|sheet| {
        sheet.cells.iter().any(|cell| cell.style_id.is_some())
            || !sheet.authored_style_runs.is_empty()
            || !sheet.row_styles.is_empty()
            || !sheet.col_styles.is_empty()
            || sheet
                .dimensions
                .trailing_col_ranges
                .iter()
                .any(|range| range.style_id.is_some())
            || sheet_uses_dxf_or_table_style(sheet)
    })
}

fn sheet_uses_dxf_or_table_style(sheet: &domain_types::SheetData) -> bool {
    sheet
        .conditional_formats
        .iter()
        .any(conditional_format_uses_dxf)
        || sheet.auto_filter.as_ref().is_some_and(auto_filter_uses_dxf)
        || sheet.sort_state.as_ref().is_some_and(sort_state_uses_dxf)
        || sheet.tables.iter().any(table_uses_dxf_or_table_style)
}

fn conditional_format_uses_dxf(cf: &domain_types::ConditionalFormat) -> bool {
    cf.rules
        .iter()
        .filter_map(conditional_format_rule_style)
        .any(|style| style.dxf_id.is_some())
}

fn conditional_format_rule_style(rule: &domain_types::CFRule) -> Option<&domain_types::CFStyle> {
    match rule {
        domain_types::CFRule::CellValue { style, .. }
        | domain_types::CFRule::Formula { style, .. }
        | domain_types::CFRule::Top10 { style, .. }
        | domain_types::CFRule::AboveAverage { style, .. }
        | domain_types::CFRule::DuplicateValues { style, .. }
        | domain_types::CFRule::ContainsText { style, .. }
        | domain_types::CFRule::ContainsBlanks { style, .. }
        | domain_types::CFRule::ContainsErrors { style, .. }
        | domain_types::CFRule::TimePeriod { style, .. } => Some(style),
        domain_types::CFRule::ColorScale { .. }
        | domain_types::CFRule::DataBar { .. }
        | domain_types::CFRule::IconSet { .. } => None,
    }
}

fn auto_filter_uses_dxf(auto_filter: &domain_types::AutoFilter) -> bool {
    auto_filter.columns.iter().any(filter_column_uses_dxf)
        || auto_filter.sort.as_ref().is_some_and(sort_state_uses_dxf)
}

fn filter_column_uses_dxf(column: &domain_types::FilterColumn) -> bool {
    matches!(
        column.filter_type,
        Some(domain_types::OoxmlFilterType::Color {
            dxf_id: Some(_),
            ..
        })
    )
}

fn sort_state_uses_dxf(sort_state: &domain_types::SortState) -> bool {
    sort_state
        .conditions
        .iter()
        .any(|condition| condition.dxf_id.is_some())
}

fn table_uses_dxf_or_table_style(table: &domain_types::TableSpec) -> bool {
    table.style_name.is_some()
        || table.header_row_dxf_id.is_some()
        || table.data_dxf_id.is_some()
        || table.totals_row_dxf_id.is_some()
        || table.header_row_border_dxf_id.is_some()
        || table.table_border_dxf_id.is_some()
        || table.totals_row_border_dxf_id.is_some()
        || table.header_row_cell_style.is_some()
        || table.data_cell_style.is_some()
        || table.totals_row_cell_style.is_some()
        || table.columns.iter().any(|column| {
            column.header_row_dxf_id.is_some()
                || column.data_dxf_id.is_some()
                || column.totals_row_dxf_id.is_some()
                || column.header_row_cell_style.is_some()
                || column.data_cell_style.is_some()
                || column.totals_row_cell_style.is_some()
        })
        || table.filter_columns.iter().any(|column| {
            matches!(
                column.filter,
                domain_types::FilterSpec::Color {
                    dxf_id: Some(_),
                    ..
                }
            )
        })
}

/// Convert a `FontFormat` to a `FontDef`.
fn convert_font(font: &FontFormat) -> FontDef {
    FontDef {
        name: font.name.clone(),
        // DocumentFormat stores size in millipoints (11pt = 11_000); FontDef uses points.
        size: font.size.map(|mp| mp as f64 / 1000.0),
        bold: font.bold,
        italic: font.italic,
        underline: font.underline.as_deref().map(convert_underline),
        strikethrough: font.strikethrough,
        color: font
            .color
            .as_deref()
            .map(|c| hex_to_color_def_with_tint(c, font.color_tint)),
        family: font.family,
        charset: font.charset,
        scheme: font.scheme.as_deref().map(|s| match s {
            "major" => FontScheme::Major,
            "minor" => FontScheme::Minor,
            _ => FontScheme::None,
        }),
        condense: None,
        extend: None,
        outline: None,
        shadow: None,
        vert_align: None,
    }
}

/// Convert a `FillFormat` to a `FillDef`.
fn convert_fill(fill: &FillFormat) -> FillDef {
    let pattern_type = fill
        .pattern_type
        .as_deref()
        .map(|s| match s {
            "solid" => PatternType::Solid,
            "gray125" => PatternType::Gray125,
            "darkGray" => PatternType::DarkGray,
            "mediumGray" => PatternType::MediumGray,
            "lightGray" => PatternType::LightGray,
            "gray0625" => PatternType::Gray0625,
            "darkHorizontal" => PatternType::DarkHorizontal,
            "darkVertical" => PatternType::DarkVertical,
            "darkDown" => PatternType::DarkDown,
            "darkUp" => PatternType::DarkUp,
            "darkGrid" => PatternType::DarkGrid,
            "darkTrellis" => PatternType::DarkTrellis,
            "lightHorizontal" => PatternType::LightHorizontal,
            "lightVertical" => PatternType::LightVertical,
            "lightDown" => PatternType::LightDown,
            "lightUp" => PatternType::LightUp,
            "lightGrid" => PatternType::LightGrid,
            "lightTrellis" => PatternType::LightTrellis,
            _ => PatternType::Solid,
        })
        .unwrap_or(PatternType::Solid);

    let fg_color = if let Some(ref pfg) = fill.pattern_foreground_color {
        Some(hex_to_color_def_with_tint(
            pfg,
            fill.pattern_foreground_color_tint,
        ))
    } else {
        fill.background_color
            .as_ref()
            .map(|bg| hex_to_color_def_with_tint(bg, fill.background_color_tint))
    };
    let bg_color = fill
        .background_color
        .as_deref()
        .map(|c| hex_to_color_def_with_tint(c, fill.background_color_tint));

    FillDef::Pattern {
        pattern_type: Some(pattern_type),
        fg_color,
        bg_color,
    }
}

/// Convert a `BorderFormat` to a `BorderDef`.
fn convert_border(border: &BorderFormat) -> BorderDef {
    let convert_side = |side: &Option<BorderSide>| -> Option<BorderSideDef> {
        side.as_ref().map(|s| {
            let style = BorderStyle::from_ooxml_token(&s.style).unwrap_or_else(|| {
                tracing::warn!(token = %s.style, "unknown BorderStyle on BorderSide → BorderSideDef conversion; using None");
                BorderStyle::None
            });
            let color = s.color.as_deref().map(hex_to_color_def);
            BorderSideDef { style, color }
        })
    };

    // Pass diagonalUp/diagonalDown flags through verbatim — `None` stays absent
    // on the OOXML element, `Some(bool)` emits the explicit attribute value.
    BorderDef {
        left: convert_side(&border.left),
        right: convert_side(&border.right),
        top: convert_side(&border.top),
        bottom: convert_side(&border.bottom),
        diagonal: convert_side(&border.diagonal),
        diagonal_up: border.diagonal_up,
        diagonal_down: border.diagonal_down,
        start: None,
        end: None,
        vertical: None,
        horizontal: None,
        outline: None,
    }
}

/// Convert an `AlignmentFormat` to an `AlignmentDef`.
fn convert_alignment(alignment: &AlignmentFormat) -> AlignmentDef {
    // Map the AlignmentFormat reading-order token ("context" / "ltr" / "rtl" /
    // internal "middle" — ignored here) back to the ECMA-376 integer encoding.
    let reading_order = alignment.reading_order.as_deref().and_then(|s| match s {
        "context" => Some(0u32),
        "ltr" => Some(1),
        "rtl" => Some(2),
        _ => None,
    });

    AlignmentDef {
        horizontal: alignment.horizontal.as_deref().and_then(|s| match s {
            "left" => Some(HorizontalAlign::Left),
            "center" => Some(HorizontalAlign::Center),
            "right" => Some(HorizontalAlign::Right),
            "fill" => Some(HorizontalAlign::Fill),
            "justify" => Some(HorizontalAlign::Justify),
            "centerContinuous" => Some(HorizontalAlign::CenterContinuous),
            "distributed" => Some(HorizontalAlign::Distributed),
            "general" => Some(HorizontalAlign::General),
            _ => None,
        }),
        vertical: alignment.vertical.as_deref().and_then(|s| match s {
            "top" => Some(VerticalAlign::Top),
            "middle" => Some(VerticalAlign::Center),
            "bottom" => Some(VerticalAlign::Bottom),
            "justify" => Some(VerticalAlign::Justify),
            "distributed" => Some(VerticalAlign::Distributed),
            _ => None,
        }),
        wrap_text: alignment.wrap_text,
        // `rotation = 255` (stacked/vertical text, ECMA-376 §18.8.1) fits
        // cleanly in u32 and is passed through. Callers constructing negative
        // rotation values from UI input are expected to normalize to 0-180
        // before reaching this path.
        text_rotation: alignment.rotation.map(|r| r as u32),
        indent: alignment.indent,
        shrink_to_fit: alignment.shrink_to_fit,
        reading_order,
        relative_indent: alignment.relative_indent,
        justify_last_line: alignment.justify_last_line,
        auto_indent: alignment.auto_indent,
    }
}

/// Convert a `ProtectionFormat` to a `ProtectionDef`.
fn convert_protection(protection: &ProtectionFormat) -> ProtectionDef {
    ProtectionDef {
        locked: protection.locked,
        hidden: protection.hidden,
    }
}

/// Convert an underline string to `UnderlineStyle`.
fn convert_underline(s: &str) -> UnderlineStyle {
    match s {
        "single" => UnderlineStyle::Single,
        "double" => UnderlineStyle::Double,
        "singleAccounting" => UnderlineStyle::SingleAccounting,
        "doubleAccounting" => UnderlineStyle::DoubleAccounting,
        _ => UnderlineStyle::None,
    }
}

/// Convert a "#RRGGBB" hex string to a `ColorDef`.
///
/// If the string starts with '#', strips it and prepends "FF" for full alpha.
/// Otherwise passes it through as-is (assumes "AARRGGBB" format).
pub(super) fn hex_to_color_def(hex: &str) -> ColorDef {
    hex_to_color_def_with_tint(hex, None)
}

/// Convert a "#RRGGBB" hex string to a `ColorDef`, optionally attaching a tint.
fn hex_to_color_def_with_tint(hex: &str, tint: Option<f64>) -> ColorDef {
    let argb = if let Some(stripped) = hex.strip_prefix('#') {
        format!("FF{}", stripped.to_uppercase())
    } else {
        hex.to_uppercase()
    };
    let tint_str = tint.filter(|&t| t != 0.0).map(|t| t.to_string());
    ColorDef::Rgb {
        val: argb,
        tint: tint_str,
    }
}
