use cell_types::{RangeId, SheetId};
use domain_types::{AuthoredStyleRun, CellFormat, DocumentFormat};
use rustc_hash::FxHashMap;

use crate::mirror::CellMirror;
use crate::storage::engine::stores::EngineStores;

use super::super::super::super::export::cell_format_to_document_format;
use super::super::PaletteOps;

const FORMAT_RANGE_ROW_BUCKET_SIZE: u32 = 128;

#[derive(Debug, Clone, Copy)]
struct FormatRangeStyleEntry {
    range_id: RangeId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    style_id: Option<u32>,
}

pub(super) struct FormatRangeStyleLookup {
    buckets: FxHashMap<u32, Vec<FormatRangeStyleEntry>>,
}

impl FormatRangeStyleLookup {
    pub(super) fn new(
        sheet: &crate::mirror::SheetMirror,
        palette: &impl PaletteOps,
    ) -> FormatRangeStyleLookup {
        let mut buckets: FxHashMap<u32, Vec<FormatRangeStyleEntry>> = FxHashMap::default();

        for range in sheet.format_ranges() {
            let style_id = match sheet.range_xlsx_style_id_cache().get(&range.id).copied() {
                Some(style_id) => Some(style_id),
                None => {
                    let Some(format) = sheet.range_format_cache().get(&range.id) else {
                        continue;
                    };
                    style_id_for_cell_format(format, palette)
                }
            };
            let entry = FormatRangeStyleEntry {
                range_id: range.id,
                start_row: range.start_row,
                start_col: range.start_col,
                end_row: range.end_row,
                end_col: range.end_col,
                style_id,
            };
            let start_bucket = range.start_row / FORMAT_RANGE_ROW_BUCKET_SIZE;
            let end_bucket = range.end_row / FORMAT_RANGE_ROW_BUCKET_SIZE;
            for bucket in start_bucket..=end_bucket {
                buckets.entry(bucket).or_default().push(entry);
            }
        }

        for entries in buckets.values_mut() {
            entries.sort_by(|left, right| right.range_id.as_u128().cmp(&left.range_id.as_u128()));
        }

        FormatRangeStyleLookup { buckets }
    }

    pub(super) fn style_id_at(&self, row: u32, col: u32) -> Option<u32> {
        let bucket = row / FORMAT_RANGE_ROW_BUCKET_SIZE;
        let entries = self.buckets.get(&bucket)?;
        for entry in entries {
            if row >= entry.start_row
                && row <= entry.end_row
                && col >= entry.start_col
                && col <= entry.end_col
            {
                return entry.style_id;
            }
        }
        None
    }
}

pub(super) fn style_id_for_cell_format(
    format: &CellFormat,
    palette: &impl PaletteOps,
) -> Option<u32> {
    let doc_fmt = cell_format_to_document_format(format);
    if doc_fmt == DocumentFormat::default() {
        return None;
    }
    Some(palette.get_or_insert(doc_fmt))
}
pub(in crate::storage::engine) fn export_authored_style_runs_for_sheet(
    _stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    palette: &impl PaletteOps,
) -> Vec<AuthoredStyleRun> {
    let Some(sheet) = mirror.get_sheet(sheet_id) else {
        return Vec::new();
    };

    let mut runs = Vec::new();
    for range in sheet.format_ranges() {
        let style_id = sheet
            .range_xlsx_style_id_cache()
            .get(&range.id)
            .copied()
            .or_else(|| {
                sheet
                    .range_format_cache()
                    .get(&range.id)
                    .and_then(|format| style_id_for_cell_format(format, palette))
            });
        let Some(style_id) = style_id else {
            continue;
        };
        runs.push(AuthoredStyleRun {
            start_row: range.start_row,
            start_col: range.start_col,
            end_row: range.end_row,
            end_col: range.end_col,
            style_id,
        });
    }

    runs.sort_by_key(|r| (r.start_row, r.start_col, r.end_row, r.end_col, r.style_id));
    runs.dedup();
    runs
}

#[cfg(test)]
mod tests {
    use cell_types::{RangeId, SheetId};
    use domain_types::{CellFormat, DocumentFormat};

    use crate::mirror::{FormatRange, SheetMirror};
    use crate::storage::engine::services::export::LocalPalette;

    use super::FormatRangeStyleLookup;

    fn sheet_with_format_ranges() -> SheetMirror {
        let mut sheet = SheetMirror::new(
            SheetId::from_uuid_str("00000000-0000-4000-8000-000000000001").unwrap(),
            "Sheet1".to_string(),
            20,
            20,
        );

        let low = RangeId::from_raw(100);
        let high = RangeId::from_raw(200);
        sheet.format_ranges.push(FormatRange {
            id: low,
            start_row: 0,
            start_col: 0,
            end_row: 10,
            end_col: 10,
        });
        sheet.format_ranges.push(FormatRange {
            id: high,
            start_row: 5,
            start_col: 5,
            end_row: 15,
            end_col: 15,
        });
        sheet.range_xlsx_style_id_cache.insert(low, 7);
        sheet.range_format_cache.insert(high, CellFormat::default());

        sheet
    }

    #[test]
    fn format_range_style_lookup_uses_highest_matching_range_id() {
        let sheet = sheet_with_format_ranges();
        let mut palette = Vec::<DocumentFormat>::new();
        let palette = LocalPalette::from_vec(&mut palette);
        let lookup = FormatRangeStyleLookup::new(&sheet, &palette);

        assert_eq!(lookup.style_id_at(1, 1), Some(7));
        assert_eq!(
            lookup.style_id_at(6, 6),
            None,
            "higher default format range should suppress lower styled range"
        );
        assert_eq!(lookup.style_id_at(16, 16), None);
    }

    #[test]
    fn format_range_style_lookup_ignores_ranges_without_format_data() {
        let mut sheet = sheet_with_format_ranges();
        let empty_high = RangeId::from_raw(300);
        sheet.format_ranges.push(FormatRange {
            id: empty_high,
            start_row: 0,
            start_col: 0,
            end_row: 4,
            end_col: 4,
        });
        let mut palette = Vec::<DocumentFormat>::new();
        let palette = LocalPalette::from_vec(&mut palette);
        let lookup = FormatRangeStyleLookup::new(&sheet, &palette);

        assert_eq!(lookup.style_id_at(1, 1), Some(7));
    }
}
