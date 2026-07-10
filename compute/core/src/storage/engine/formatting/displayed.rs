use super::*;
use crate::engine_types::DisplayedFormatProjection;
use rustc_hash::FxHashMap;
use std::rc::Rc;

const NO_FORMAT_ID: u32 = u32::MAX;

struct RequestedRowSpan {
    row: u32,
    start: usize,
    end: usize,
}

struct RangeFormatState {
    id: u64,
    format: CellFormat,
}

/// Format Range layers projected onto only the requested positions.
///
/// The scalar spatial index is row-augmented and can degenerate to scanning all
/// imported ranges for each cell. This batch projector inverts the work: each
/// authored rectangle visits only requested rows/columns it actually covers,
/// then overlapping contributions are merged once in RangeId order.
struct PreparedRangeFormatLayers {
    positions: Vec<(u32, u32)>,
    format_ids: Vec<u32>,
    palette: Vec<CellFormat>,
}

impl PreparedRangeFormatLayers {
    fn new(
        sheet_mirror: Option<&crate::mirror::SheetMirror>,
        requested_positions: &[(u32, u32)],
    ) -> Self {
        let mut positions = requested_positions.to_vec();
        positions.sort_unstable();
        positions.dedup();
        let Some(sheet_mirror) = sheet_mirror else {
            return Self {
                positions: Vec::new(),
                format_ids: Vec::new(),
                palette: Vec::new(),
            };
        };
        if positions.is_empty() || sheet_mirror.format_ranges().is_empty() {
            return Self {
                positions: Vec::new(),
                format_ids: Vec::new(),
                palette: Vec::new(),
            };
        }
        let mut format_ids = vec![NO_FORMAT_ID; positions.len()];

        let mut row_spans = Vec::new();
        let mut start = 0;
        while start < positions.len() {
            let row = positions[start].0;
            let mut end = start + 1;
            while end < positions.len() && positions[end].0 == row {
                end += 1;
            }
            row_spans.push(RequestedRowSpan { row, start, end });
            start = end;
        }

        let mut ranges = sheet_mirror
            .format_ranges()
            .iter()
            .filter_map(|range| {
                sheet_mirror
                    .range_format_cache()
                    .get(&range.id)
                    .map(|format| (range, format))
            })
            .collect::<Vec<_>>();
        ranges.sort_unstable_by_key(|(range, _)| range.id.as_u128());

        let default_state = Rc::new(RangeFormatState {
            id: 0,
            format: CellFormat::default(),
        });
        let mut states = vec![default_state; positions.len()];
        let mut covered = vec![false; positions.len()];
        let mut next_state_id = 1_u64;
        let mut transitions: FxHashMap<u64, Rc<RangeFormatState>> = FxHashMap::default();
        for (range, range_format) in ranges {
            // Imported or collaborative state can contain malformed rectangles.
            // They cover no positions and must not make the partition slice panic.
            if range.start_row > range.end_row || range.start_col > range.end_col {
                continue;
            }
            let first_row = row_spans.partition_point(|span| span.row < range.start_row);
            let after_last_row = row_spans.partition_point(|span| span.row <= range.end_row);
            transitions.clear();
            for span in &row_spans[first_row..after_last_row] {
                let row_positions = &positions[span.start..span.end];
                let first_col = row_positions.partition_point(|&(_, col)| col < range.start_col);
                let after_last_col =
                    row_positions.partition_point(|&(_, col)| col <= range.end_col);
                for position_index in (span.start + first_col)..(span.start + after_last_col) {
                    let prior_state = &states[position_index];
                    let next_state = if let Some(next_state) = transitions.get(&prior_state.id) {
                        Rc::clone(next_state)
                    } else {
                        let next_state = Rc::new(RangeFormatState {
                            id: next_state_id,
                            format: properties::merge_formats(&prior_state.format, range_format),
                        });
                        next_state_id = next_state_id
                            .checked_add(1)
                            .expect("format range state ID overflow");
                        transitions.insert(prior_state.id, Rc::clone(&next_state));
                        next_state
                    };
                    states[position_index] = next_state;
                    covered[position_index] = true;
                }
            }
        }

        let mut palette_index: FxHashMap<CellFormat, u32> = FxHashMap::default();
        for (position_index, (state, is_covered)) in
            states.into_iter().zip(covered.iter().copied()).enumerate()
        {
            if !is_covered {
                continue;
            }
            let format_id = if let Some(format_id) = palette_index.get(&state.format) {
                *format_id
            } else {
                let format_id = u32::try_from(palette_index.len())
                    .expect("format range palette exceeds u32::MAX");
                palette_index.insert(state.format.clone(), format_id);
                format_id
            };
            format_ids[position_index] = format_id;
        }
        let mut palette = vec![CellFormat::default(); palette_index.len()];
        for (format, format_id) in palette_index {
            palette[format_id as usize] = format;
        }

        Self {
            positions,
            format_ids,
            palette,
        }
    }

    fn get(&self, row: u32, col: u32) -> Option<&CellFormat> {
        let position_index = self.positions.binary_search(&(row, col)).ok()?;
        let format_id = self.format_ids[position_index];
        if format_id == NO_FORMAT_ID {
            None
        } else {
            self.palette.get(format_id as usize)
        }
    }
}

struct PreparedDisplayedFormatContext<'a> {
    engine: &'a YrsComputeEngine,
    sheet_id: &'a SheetId,
    base_format: CellFormat,
    cell_formats: properties::PreloadedCellFormatLayers,
    row_formats: FxHashMap<u32, CellFormat>,
    col_formats: FxHashMap<u32, CellFormat>,
    range_formats: PreparedRangeFormatLayers,
}

impl<'a> PreparedDisplayedFormatContext<'a> {
    fn new(engine: &'a YrsComputeEngine, sheet_id: &'a SheetId, positions: &[(u32, u32)]) -> Self {
        let grid_index = engine.stores.grid_indexes.get(sheet_id);
        let mut cell_ids = positions
            .iter()
            .filter_map(|&(row, col)| {
                grid_index
                    .and_then(|grid| grid.cell_id_at(row, col))
                    .or_else(|| {
                        engine
                            .mirror
                            .resolve_cell_id(sheet_id, SheetPos::new(row, col))
                    })
            })
            .collect::<Vec<_>>();
        cell_ids.sort_unstable_by_key(|cell_id| cell_id.as_u128());
        cell_ids.dedup();

        let cell_formats = properties::get_cell_format_layers_for_ids(
            engine.stores.storage.doc(),
            engine.stores.storage.workbook_map(),
            engine.stores.storage.sheets(),
            sheet_id,
            &cell_ids,
        );
        let row_formats =
            properties::get_all_row_formats(&engine.stores.storage, sheet_id, grid_index)
                .into_iter()
                .filter_map(|entry| entry.format.map(|format| (entry.row, format)))
                .collect();
        let col_formats =
            properties::get_all_col_formats(&engine.stores.storage, sheet_id, grid_index)
                .into_iter()
                .filter_map(|entry| entry.format.map(|format| (entry.col, format)))
                .collect();

        Self {
            engine,
            sheet_id,
            base_format: properties::get_workbook_base_format(&engine.stores.storage),
            cell_formats,
            row_formats,
            col_formats,
            range_formats: PreparedRangeFormatLayers::new(
                engine.mirror.get_sheet(sheet_id),
                positions,
            ),
        }
    }

    fn resolve(&self, row: u32, col: u32) -> CellFormat {
        let grid_index = self.engine.stores.grid_indexes.get(self.sheet_id);
        let cell_id = grid_index
            .and_then(|grid| grid.cell_id_at(row, col))
            .or_else(|| {
                self.engine
                    .mirror
                    .resolve_cell_id(self.sheet_id, SheetPos::new(row, col))
            });
        let structured_format = cell_id.and_then(|_| {
            services::resolve_structured_format_at_cell(
                &self.engine.mirror,
                self.sheet_id,
                row,
                col,
            )
        });
        let cell_format = cell_id.and_then(|cell_id| self.cell_formats.get(&cell_id));

        let format = properties::get_effective_format_from_preloaded_layers_with_range(
            &self.base_format,
            self.col_formats.get(&col),
            self.row_formats.get(&row),
            col,
            self.range_formats.get(row, col),
            structured_format.as_ref(),
            cell_format,
            self.engine.mirror.get_sheet(self.sheet_id),
            cell_id.is_none(),
        );
        finish_displayed_format(self.engine, self.sheet_id, row, col, format)
    }
}

fn finish_displayed_format(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    mut format: CellFormat,
) -> CellFormat {
    // Theme resolution (matches viewport pipeline order).
    // No formula format inheritance — see `get_resolved_format` for rationale.
    domain_types::theme_color::resolve_theme_refs(&mut format, &engine.settings.theme_palette);

    // CF as 6th cascade layer (range-scoped — applies to blank cells too).
    let cf_cache_entry = engine.stores.cf_cache.get(sheet_id);
    super::super::viewport::apply_cf_to_format(cf_cache_entry, &mut format, row, col);

    // Number-format section color (e.g. [Red]) — value-dependent override.
    // Lower priority than CF font_color, higher than stored font_color.
    let format_code = format.number_format.as_deref().unwrap_or("General");
    // Section colors are bracket directives (`[Red]`, `[ColorN]`). Most cells
    // use General or ordinary numeric formats. Check the code before fetching
    // the value: range-resident value lookup is a spatial query and was the
    // dominant cost for large sheets even though its result was never used.
    if format_code.as_bytes().contains(&b'[')
        && let Some(value) =
            crate::storage::cells::values::get_effective_value(&engine.mirror, sheet_id, row, col)
    {
        let result = compute_formats::format_value(&value, format_code, &engine.settings.locale);
        if let Some(ref color) = result.color {
            super::super::viewport::apply_number_format_color(
                &mut format,
                color,
                cf_cache_entry,
                row,
                col,
            );
        }
    }

    format
}

pub(super) fn get_displayed_cell_properties(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> CellFormat {
    let pos = SheetPos::new(row, col);
    let cell_id = engine
        .stores
        .grid_indexes
        .get(sheet_id)
        .and_then(|grid| grid.cell_id_at(row, col))
        .or_else(|| engine.mirror.resolve_cell_id(sheet_id, pos));

    let format = if let Some(cell_id) = cell_id {
        let cell_hex = id_to_hex(cell_id.as_u128());
        let structured_format =
            services::resolve_structured_format_at_cell(&engine.mirror, sheet_id, row, col);
        properties::get_effective_format(
            &engine.stores.storage,
            sheet_id,
            &cell_hex,
            row,
            col,
            structured_format.as_ref(),
            engine.stores.grid_indexes.get(sheet_id),
            engine.mirror.get_sheet(sheet_id),
        )
    } else {
        properties::get_positional_format(
            &engine.stores.storage,
            sheet_id,
            row,
            col,
            engine.stores.grid_indexes.get(sheet_id),
            engine.mirror.get_sheet(sheet_id),
        )
    };

    finish_displayed_format(engine, sheet_id, row, col, format)
}

pub(super) fn get_displayed_formats_for_cells(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    positions: &[(u32, u32)],
) -> DisplayedFormatProjection {
    if positions.is_empty() {
        return DisplayedFormatProjection {
            palette: Vec::new(),
            format_ids: Vec::new(),
        };
    }

    let context = PreparedDisplayedFormatContext::new(engine, sheet_id, positions);
    let mut palette = Vec::new();
    let mut palette_index: FxHashMap<CellFormat, u32> = FxHashMap::default();
    let mut format_ids = Vec::with_capacity(positions.len());

    for &(row, col) in positions {
        let format = context.resolve(row, col);
        let format_id = if let Some(format_id) = palette_index.get(&format) {
            *format_id
        } else {
            let format_id =
                u32::try_from(palette.len()).expect("displayed format palette exceeds u32::MAX");
            palette_index.insert(format.clone(), format_id);
            palette.push(format);
            format_id
        };
        format_ids.push(format_id);
    }

    DisplayedFormatProjection {
        palette,
        format_ids,
    }
}

pub(super) fn get_displayed_range_properties(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<Vec<Vec<CellFormat>>, ComputeError> {
    if start_row > end_row || start_col > end_col {
        return Err(ComputeError::Eval {
            message: "get_displayed_range_properties: inverted range (start > end)".to_string(),
        });
    }
    let num_rows = (end_row - start_row + 1) as u64;
    let num_cols = (end_col - start_col + 1) as u64;
    let cell_count = num_rows * num_cols;

    if cell_count > 10_000 {
        return Err(ComputeError::Eval {
            message: format!(
                "get_displayed_range_properties: range too large ({} cells, max 10000)",
                cell_count
            ),
        });
    }

    let mut positions = Vec::with_capacity(cell_count as usize);
    for row in start_row..=end_row {
        for col in start_col..=end_col {
            positions.push((row, col));
        }
    }
    let projection = get_displayed_formats_for_cells(engine, sheet_id, &positions);
    let mut format_ids = projection.format_ids.into_iter();
    let mut result = Vec::with_capacity(num_rows as usize);
    for _ in 0..num_rows {
        let mut row_formats = Vec::with_capacity(num_cols as usize);
        for _ in 0..num_cols {
            let format_id = format_ids
                .next()
                .expect("displayed range projection must align with requested positions");
            row_formats.push(projection.palette[format_id as usize].clone());
        }
        result.push(row_formats);
    }
    Ok(result)
}
