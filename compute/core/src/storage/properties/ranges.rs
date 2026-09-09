//! Native format ranges: the sheet mirror owns overlays and its derived spatial indexes.
use super::merge::{merge_formats, normalize_format_patch};
use crate::mirror::SheetMirror;
use cell_types::{IdAllocator, RangeId};
use domain_types::CellFormat;

pub fn add_format_range(
    mirror: &mut SheetMirror,
    range_id: RangeId,
    sr: u32,
    sc: u32,
    er: u32,
    ec: u32,
    format: &CellFormat,
) {
    crate::storage::engine::history::metadata::capture_format_range(mirror, range_id);
    mirror.format_ranges.retain(|range| range.id != range_id);
    mirror.format_ranges.push(crate::mirror::FormatRange {
        id: range_id,
        precedence: range_id.as_u128(),
        layer: crate::mirror::FormatRangeLayer::Inherited,
        start_row: sr,
        start_col: sc,
        end_row: er,
        end_col: ec,
    });
    mirror
        .range_format_cache
        .insert(range_id, normalize_format_patch(format));
    mirror.range_xlsx_style_id_cache.remove(&range_id);
    mirror.rebuild_format_range_spatial_index();
}

pub fn remove_format_range(mirror: &mut SheetMirror, range_id: RangeId) {
    crate::storage::engine::history::metadata::capture_format_range(mirror, range_id);
    mirror.format_ranges.retain(|range| range.id != range_id);
    mirror.range_format_cache.remove(&range_id);
    mirror.range_xlsx_style_id_cache.remove(&range_id);
    mirror.rebuild_format_range_spatial_index();
}

#[derive(Clone)]
struct ColFormatRangeRecord {
    id: RangeId,
    start_col: u32,
    end_col: u32,
    format: CellFormat,
    xlsx_style_id: Option<u32>,
}
fn column_records(mirror: &SheetMirror) -> Vec<ColFormatRangeRecord> {
    mirror
        .col_format_ranges
        .iter()
        .filter_map(|range| {
            Some(ColFormatRangeRecord {
                id: range.id,
                start_col: range.start_col,
                end_col: range.end_col,
                format: mirror.col_format_range_cache.get(&range.id)?.clone(),
                xlsx_style_id: mirror.col_range_xlsx_style_id_cache.get(&range.id).copied(),
            })
        })
        .collect()
}
fn install_column_record(mirror: &mut SheetMirror, record: ColFormatRangeRecord) {
    mirror
        .col_format_ranges
        .push(crate::mirror::ColumnFormatRange {
            id: record.id,
            start_col: record.start_col,
            end_col: record.end_col,
        });
    mirror
        .col_format_range_cache
        .insert(record.id, record.format);
    if let Some(index) = record.xlsx_style_id {
        mirror
            .col_range_xlsx_style_id_cache
            .insert(record.id, index);
    }
}

fn column_range_segments_for_patch(
    records: &[ColFormatRangeRecord],
    start_col: u32,
    end_col: u32,
    patch: &CellFormat,
) -> Vec<ColFormatRangeRecord> {
    let mut bounds = vec![start_col, end_col.saturating_add(1)];
    for record in records {
        if record.end_col < start_col || record.start_col > end_col {
            continue;
        }
        bounds.push(record.start_col.max(start_col));
        if record.end_col < end_col {
            bounds.push(record.end_col.saturating_add(1));
        }
    }
    bounds.sort_unstable();
    bounds.dedup();

    let mut segments: Vec<ColFormatRangeRecord> = Vec::new();
    for pair in bounds.windows(2) {
        let segment_start = pair[0];
        let segment_end = pair[1].saturating_sub(1);
        if segment_start > segment_end {
            continue;
        }

        let mut matching: Vec<_> = records
            .iter()
            .filter(|record| record.start_col <= segment_start && record.end_col >= segment_start)
            .collect();
        matching.sort_by_key(|record| record.id.as_u128());

        let mut merged = CellFormat::default();
        let mut has_base = false;
        for record in matching {
            merged = merge_formats(&merged, &record.format);
            has_base = true;
        }
        let format = if has_base {
            merge_formats(&merged, patch)
        } else {
            patch.clone()
        };

        if let Some(last) = segments.last_mut()
            && last.end_col.saturating_add(1) == segment_start
            && last.format == format
            && last.xlsx_style_id.is_none()
        {
            last.end_col = segment_end;
            continue;
        }

        segments.push(ColFormatRangeRecord {
            id: RangeId::from_raw(0),
            start_col: segment_start,
            end_col: segment_end,
            format,
            xlsx_style_id: None,
        });
    }

    segments
}

pub(crate) fn set_col_format_range_with_alloc(
    mirror: &mut SheetMirror,
    start_col: u32,
    end_col: u32,
    format: &CellFormat,
    id_alloc: &IdAllocator,
) {
    if start_col > end_col {
        return;
    }
    let records = column_records(mirror);
    let mut segments = column_range_segments_for_patch(
        &records,
        start_col,
        end_col,
        &normalize_format_patch(format),
    );
    clear_col_format_ranges_in_span(mirror, start_col, end_col, id_alloc);
    for segment in &mut segments {
        segment.id = id_alloc.next_range_id();
    }
    for segment in segments {
        crate::storage::engine::history::metadata::capture_column_format_range(mirror, segment.id);
        install_column_record(mirror, segment);
    }
    mirror.rebuild_col_format_range_spatial_index();
}

pub(crate) fn clear_col_format_ranges_in_span(
    mirror: &mut SheetMirror,
    start_col: u32,
    end_col: u32,
    id_alloc: &IdAllocator,
) {
    if start_col > end_col {
        return;
    }
    let records = column_records(mirror);
    if mirror.history.is_active() {
        for record in &records {
            if record.end_col >= start_col && record.start_col <= end_col {
                crate::storage::engine::history::metadata::capture_column_format_range(
                    mirror, record.id,
                );
            }
        }
    }
    mirror.col_format_ranges.clear();
    mirror.col_format_range_cache.clear();
    mirror.col_range_xlsx_style_id_cache.clear();
    for record in records {
        if record.end_col < start_col || record.start_col > end_col {
            install_column_record(mirror, record);
            continue;
        }
        let mut original_id_available = true;
        if record.start_col < start_col {
            let mut left = record.clone();
            left.end_col = start_col - 1;
            install_column_record(mirror, left);
            original_id_available = false;
        }
        if record.end_col > end_col {
            let mut right = record;
            if !original_id_available {
                right.id = id_alloc.next_range_id();
                crate::storage::engine::history::metadata::capture_column_format_range(
                    mirror, right.id,
                );
            }
            right.start_col = end_col + 1;
            install_column_record(mirror, right);
        }
    }
    mirror.rebuild_col_format_range_spatial_index();
}

/// Transient import records, consumed once when building the native sheet.
#[derive(Debug, Clone, Default)]
pub(crate) struct ImportedFormats {
    rectangles: Vec<crate::storage::infra::hydration::ImportedRangeStyle>,
    columns: Vec<(RangeId, domain_types::ColStyleRange)>,
}
impl ImportedFormats {
    pub(crate) fn from_sheet(
        sheet: &domain_types::SheetData,
        promoted: &[crate::storage::infra::hydration::ImportedRangeStyle],
        allocator: &IdAllocator,
    ) -> Self {
        let mut rectangles = Vec::with_capacity(sheet.authored_style_runs.len() + promoted.len());
        for run in &sheet.authored_style_runs {
            rectangles.push(crate::storage::infra::hydration::ImportedRangeStyle {
                range_id: allocator.next_range_id(),
                start_row: run.start_row,
                start_col: run.start_col,
                end_row: run.end_row,
                end_col: run.end_col,
                style_id: run.style_id,
            });
        }
        rectangles.extend_from_slice(promoted);
        Self {
            rectangles,
            columns: sheet
                .col_style_ranges
                .iter()
                .cloned()
                .map(|range| (allocator.next_range_id(), range))
                .collect(),
        }
    }
    pub(crate) fn install(&self, mirror: &mut SheetMirror, palette: &[CellFormat]) {
        for (id, range) in &self.columns {
            if range.start_col > range.end_col {
                continue;
            }
            let Some(format) = palette.get(range.style_id as usize) else {
                continue;
            };
            install_column_record(
                mirror,
                ColFormatRangeRecord {
                    id: *id,
                    start_col: range.start_col,
                    end_col: range.end_col,
                    format: format.clone(),
                    xlsx_style_id: Some(range.style_id),
                },
            );
        }
        for range in &self.rectangles {
            if range.start_row > range.end_row || range.start_col > range.end_col {
                continue;
            }
            let mut format = palette
                .get(range.style_id as usize)
                .cloned()
                .unwrap_or_default();
            super::cascade::materialize_imported_cell_xf_defaults(&mut format);
            mirror.format_ranges.push(crate::mirror::FormatRange {
                id: range.range_id,
                precedence: range.range_id.as_u128(),
                layer: crate::mirror::FormatRangeLayer::Inherited,
                start_row: range.start_row,
                start_col: range.start_col,
                end_row: range.end_row,
                end_col: range.end_col,
            });
            mirror.range_format_cache.insert(range.range_id, format);
            mirror
                .range_xlsx_style_id_cache
                .insert(range.range_id, range.style_id);
        }
        mirror.rebuild_format_range_spatial_index();
        mirror.rebuild_col_format_range_spatial_index();
    }
}

/// Owned copy of the source sheet's native format ranges, with new RangeIds.
pub(crate) struct CopiedFormats {
    rectangles: Vec<(crate::mirror::FormatRange, CellFormat, Option<u32>)>,
    columns: Vec<ColFormatRangeRecord>,
}
impl CopiedFormats {
    pub(crate) fn from_sheet(source: &SheetMirror, allocator: &IdAllocator) -> Self {
        let rectangles = source
            .format_ranges
            .iter()
            .filter_map(|range| {
                let format = source.range_format_cache.get(&range.id)?.clone();
                let style = source.range_xlsx_style_id_cache.get(&range.id).copied();
                let mut bounds = *range;
                bounds.id = allocator.next_range_id();
                Some((bounds, format, style))
            })
            .collect();
        let mut columns = column_records(source);
        for column in &mut columns {
            column.id = allocator.next_range_id();
        }
        Self {
            rectangles,
            columns,
        }
    }
    pub(crate) fn install(self, mirror: &mut SheetMirror) {
        for (range, format, style) in self.rectangles {
            mirror.format_ranges.push(range);
            mirror.range_format_cache.insert(range.id, format);
            if let Some(style) = style {
                mirror.range_xlsx_style_id_cache.insert(range.id, style);
            }
        }
        for column in self.columns {
            install_column_record(mirror, column);
        }
        mirror.rebuild_format_range_spatial_index();
        mirror.rebuild_col_format_range_spatial_index();
    }
}

/// Clear selected overlay fields in a rectangle, then add an optional direct patch.
/// Splits only intersecting metadata rectangles; cell values and identities are untouched.
pub(crate) fn patch_native_format_ranges(
    mirror: &mut SheetMirror,
    bounds: cell_types::SheetRange,
    clear: impl Fn(&CellFormat) -> Result<CellFormat, value_types::ComputeError>,
    direct: Option<&CellFormat>,
    allocator: &IdAllocator,
) -> Result<(), value_types::ComputeError> {
    let mut records = Vec::new();
    let mut max_precedence = 0;
    for range in &mirror.format_ranges {
        max_precedence = max_precedence.max(range.precedence);
        let Some(format) = mirror.range_format_cache.get(&range.id) else {
            continue;
        };
        let style = mirror.range_xlsx_style_id_cache.get(&range.id).copied();
        let original = cell_types::SheetRange::new(
            range.start_row,
            range.start_col,
            range.end_row,
            range.end_col,
        );
        let Some(overlap) = original.intersection(&bounds) else {
            records.push((*range, format.clone(), style));
            continue;
        };
        let cleared = clear(format)?;
        if cleared == *format {
            records.push((*range, format.clone(), style));
            continue;
        }
        for piece in rectangle_difference(original, overlap) {
            let mut outside = *range;
            outside.id = allocator.next_range_id();
            set_rectangle(&mut outside, piece);
            records.push((outside, format.clone(), style));
        }
        if cleared != CellFormat::default() {
            let mut inside = *range;
            set_rectangle(&mut inside, overlap);
            records.push((inside, cleared, None));
        }
    }
    if let Some(format) = direct.filter(|format| **format != CellFormat::default()) {
        let id = allocator.next_range_id();
        records.push((
            crate::mirror::FormatRange {
                id,
                precedence: max_precedence.checked_add(1).ok_or_else(|| {
                    value_types::ComputeError::InvalidInput {
                        message: "Format overlay precedence exhausted".into(),
                    }
                })?,
                layer: crate::mirror::FormatRangeLayer::Direct,
                start_row: bounds.start_row(),
                start_col: bounds.start_col(),
                end_row: bounds.end_row(),
                end_col: bounds.end_col(),
            },
            format.clone(),
            None,
        ));
    }
    if mirror.history.is_active() {
        let next: rustc_hash::FxHashMap<_, _> = records
            .iter()
            .map(|(range, format, style)| (range.id, (range, format, style)))
            .collect();
        for range in &mirror.format_ranges {
            if next.get(&range.id).is_none_or(|(r, f, s)| {
                **r != *range
                    || mirror.range_format_cache.get(&range.id) != Some(*f)
                    || mirror.range_xlsx_style_id_cache.get(&range.id) != s.as_ref()
            }) {
                crate::storage::engine::history::metadata::capture_format_range(mirror, range.id);
            }
        }
        let existing: rustc_hash::FxHashSet<_> =
            mirror.format_ranges.iter().map(|r| r.id).collect();
        for (range, _, _) in &records {
            if !existing.contains(&range.id) {
                crate::storage::engine::history::metadata::capture_format_range(mirror, range.id);
            }
        }
    }
    mirror.format_ranges.clear();
    mirror.range_format_cache.clear();
    mirror.range_xlsx_style_id_cache.clear();
    for (range, format, style) in records {
        mirror.range_format_cache.insert(range.id, format);
        if let Some(style) = style {
            mirror.range_xlsx_style_id_cache.insert(range.id, style);
        }
        mirror.format_ranges.push(range);
    }
    mirror.rebuild_format_range_spatial_index();
    Ok(())
}

fn set_rectangle(range: &mut crate::mirror::FormatRange, bounds: cell_types::SheetRange) {
    range.start_row = bounds.start_row();
    range.start_col = bounds.start_col();
    range.end_row = bounds.end_row();
    range.end_col = bounds.end_col();
}
pub(crate) fn rectangle_difference(
    a: cell_types::SheetRange,
    cut: cell_types::SheetRange,
) -> Vec<cell_types::SheetRange> {
    let mut out = Vec::with_capacity(4);
    if a.start_row() < cut.start_row() {
        out.push(cell_types::SheetRange::new(
            a.start_row(),
            a.start_col(),
            cut.start_row() - 1,
            a.end_col(),
        ));
    }
    if cut.end_row() < a.end_row() {
        out.push(cell_types::SheetRange::new(
            cut.end_row() + 1,
            a.start_col(),
            a.end_row(),
            a.end_col(),
        ));
    }
    if a.start_col() < cut.start_col() {
        out.push(cell_types::SheetRange::new(
            cut.start_row(),
            a.start_col(),
            cut.end_row(),
            cut.start_col() - 1,
        ));
    }
    if cut.end_col() < a.end_col() {
        out.push(cell_types::SheetRange::new(
            cut.start_row(),
            cut.end_col() + 1,
            cut.end_row(),
            a.end_col(),
        ));
    }
    out
}
