use super::*;
use crate::storage::engine::table_result_merge::merge_mutation_result;

pub(in crate::storage::engine) fn materialize_table_visible_formats(
    stores: &mut EngineStores,
    mirror: &CellMirror,
    table: &CanonicalTable,
) -> Result<MutationResult, ComputeError> {
    let Some(sheet_id) = SheetId::from_uuid_str(&table.sheet_id).ok() else {
        return Ok(MutationResult::empty());
    };

    let styled_table = crate::storage::table_format::build_table_for_style_resolution(table);
    let mut grouped_ranges: Vec<(CellFormat, Vec<(u32, u32, u32, u32)>)> = Vec::new();

    for row in table.range.start_row()..=table.range.end_row() {
        let mut run_start: Option<u32> = None;
        let mut run_patch = CellFormat::default();

        for col in table.range.start_col()..=table.range.end_col() {
            let table_format = compute_table::styles::resolve_table_cell_format(
                &styled_table,
                row,
                col,
            )
            .map(|format| crate::storage::table_format::table_cell_format_to_cell_format(&format));
            let cell_hex = existing_cell_hex(stores, mirror, &sheet_id, row, col);
            let cell_hex = cell_hex.as_ref().map(|hex| hex.as_str()).unwrap_or("");
            let without_table = crate::storage::properties::get_effective_format(
                &stores.storage,
                &sheet_id,
                cell_hex,
                row,
                col,
                None,
                stores.grid_indexes.get(&sheet_id),
                mirror.get_sheet(&sheet_id),
            );
            let with_table = crate::storage::properties::get_effective_format(
                &stores.storage,
                &sheet_id,
                cell_hex,
                row,
                col,
                table_format.as_ref(),
                stores.grid_indexes.get(&sheet_id),
                mirror.get_sheet(&sheet_id),
            );
            let patch = diff_cell_format(&without_table, &with_table);

            if patch == CellFormat::default() {
                if let Some(start_col) = run_start.take() {
                    push_grouped_format_range(
                        &mut grouped_ranges,
                        run_patch.clone(),
                        (row, start_col, row, col - 1),
                    );
                    run_patch = CellFormat::default();
                }
                continue;
            }

            match run_start {
                Some(_) if run_patch == patch => {}
                Some(start_col) => {
                    push_grouped_format_range(
                        &mut grouped_ranges,
                        run_patch,
                        (row, start_col, row, col - 1),
                    );
                    run_start = Some(col);
                    run_patch = patch;
                }
                None => {
                    run_start = Some(col);
                    run_patch = patch;
                }
            }
        }

        if let Some(start_col) = run_start {
            push_grouped_format_range(
                &mut grouped_ranges,
                run_patch,
                (row, start_col, row, table.range.end_col()),
            );
        }
    }

    let mut result = MutationResult::empty();
    for (format, ranges) in grouped_ranges {
        let (_, format_result) = super::super::formatting::set_format_for_ranges(
            stores, mirror, &sheet_id, &ranges, &format,
        )?;
        merge_mutation_result(&mut result, format_result);
    }

    Ok(result)
}

fn existing_cell_hex(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<compute_document::hex::SmallHex> {
    stores
        .grid_indexes
        .get(sheet_id)
        .and_then(|grid| grid.cell_id_at(row, col))
        .or_else(|| mirror.resolve_cell_id(sheet_id, SheetPos::new(row, col)))
        .map(|cell_id| id_to_hex(cell_id.as_u128()))
}

fn push_grouped_format_range(
    grouped_ranges: &mut Vec<(CellFormat, Vec<(u32, u32, u32, u32)>)>,
    format: CellFormat,
    range: (u32, u32, u32, u32),
) {
    if let Some((_, ranges)) = grouped_ranges
        .iter_mut()
        .find(|(existing_format, _)| *existing_format == format)
    {
        ranges.push(range);
        return;
    }
    grouped_ranges.push((format, vec![range]));
}

fn diff_cell_format(before: &CellFormat, after: &CellFormat) -> CellFormat {
    CellFormat {
        font_family: diff_clone(&before.font_family, &after.font_family),
        font_size: diff_copy(before.font_size, after.font_size),
        font_color: diff_clone(&before.font_color, &after.font_color),
        font_color_tint: diff_copy(before.font_color_tint, after.font_color_tint),
        bold: diff_copy(before.bold, after.bold),
        italic: diff_copy(before.italic, after.italic),
        underline_type: diff_copy(before.underline_type, after.underline_type),
        strikethrough: diff_copy(before.strikethrough, after.strikethrough),
        superscript: diff_copy(before.superscript, after.superscript),
        subscript: diff_copy(before.subscript, after.subscript),
        font_outline: diff_copy(before.font_outline, after.font_outline),
        font_shadow: diff_copy(before.font_shadow, after.font_shadow),
        font_theme: diff_clone(&before.font_theme, &after.font_theme),
        font_charset: diff_copy(before.font_charset, after.font_charset),
        font_family_type: diff_copy(before.font_family_type, after.font_family_type),
        horizontal_align: diff_copy(before.horizontal_align, after.horizontal_align),
        vertical_align: diff_copy(before.vertical_align, after.vertical_align),
        wrap_text: diff_copy(before.wrap_text, after.wrap_text),
        indent: diff_copy(before.indent, after.indent),
        text_rotation: diff_copy(before.text_rotation, after.text_rotation),
        shrink_to_fit: diff_copy(before.shrink_to_fit, after.shrink_to_fit),
        reading_order: diff_clone(&before.reading_order, &after.reading_order),
        auto_indent: diff_copy(before.auto_indent, after.auto_indent),
        number_format: diff_clone(&before.number_format, &after.number_format),
        background_color: diff_clone(&before.background_color, &after.background_color),
        background_color_tint: diff_copy(before.background_color_tint, after.background_color_tint),
        pattern_type: diff_copy(before.pattern_type, after.pattern_type),
        pattern_foreground_color: diff_clone(
            &before.pattern_foreground_color,
            &after.pattern_foreground_color,
        ),
        pattern_foreground_color_tint: diff_copy(
            before.pattern_foreground_color_tint,
            after.pattern_foreground_color_tint,
        ),
        gradient_fill: diff_clone(&before.gradient_fill, &after.gradient_fill),
        borders: diff_borders(before.borders.as_ref(), after.borders.as_ref()),
        locked: diff_copy(before.locked, after.locked),
        hidden: diff_copy(before.hidden, after.hidden),
        quote_prefix: diff_copy(before.quote_prefix, after.quote_prefix),
        pivot_button: diff_copy(before.pivot_button, after.pivot_button),
    }
}

fn diff_clone<T: Clone + PartialEq>(before: &Option<T>, after: &Option<T>) -> Option<T> {
    (before != after).then(|| after.clone()).flatten()
}

fn diff_copy<T: Copy + PartialEq>(before: Option<T>, after: Option<T>) -> Option<T> {
    (before != after).then_some(after).flatten()
}

fn diff_borders(
    before: Option<&domain_types::CellBorders>,
    after: Option<&domain_types::CellBorders>,
) -> Option<domain_types::CellBorders> {
    let border_diff = domain_types::CellBorders {
        top: diff_clone(
            &before.and_then(|borders| borders.top.clone()),
            &after.and_then(|borders| borders.top.clone()),
        ),
        right: diff_clone(
            &before.and_then(|borders| borders.right.clone()),
            &after.and_then(|borders| borders.right.clone()),
        ),
        bottom: diff_clone(
            &before.and_then(|borders| borders.bottom.clone()),
            &after.and_then(|borders| borders.bottom.clone()),
        ),
        left: diff_clone(
            &before.and_then(|borders| borders.left.clone()),
            &after.and_then(|borders| borders.left.clone()),
        ),
        diagonal: diff_clone(
            &before.and_then(|borders| borders.diagonal.clone()),
            &after.and_then(|borders| borders.diagonal.clone()),
        ),
        diagonal_up: diff_copy(
            before.and_then(|borders| borders.diagonal_up),
            after.and_then(|borders| borders.diagonal_up),
        ),
        diagonal_down: diff_copy(
            before.and_then(|borders| borders.diagonal_down),
            after.and_then(|borders| borders.diagonal_down),
        ),
        vertical: diff_clone(
            &before.and_then(|borders| borders.vertical.clone()),
            &after.and_then(|borders| borders.vertical.clone()),
        ),
        horizontal: diff_clone(
            &before.and_then(|borders| borders.horizontal.clone()),
            &after.and_then(|borders| borders.horizontal.clone()),
        ),
        outline: diff_copy(
            before.and_then(|borders| borders.outline),
            after.and_then(|borders| borders.outline),
        ),
    };

    (border_diff != domain_types::CellBorders::default()).then_some(border_diff)
}
