use super::*;
use crate::cells::{ColumnFormatRange, FormatRange};
use cell_types::RangeId;
use cell_types::interval_tree::RectLike;
use domain_types::CellFormat;

#[derive(Debug)]
struct FormatEntry<R> {
    sheet: SheetId,
    id: RangeId,
    old: Option<(VectorPosition, R, Option<CellFormat>, Option<u32>)>,
}
macro_rules! format_patch {
    ($ty:ty,$function:ident,$column:expr,$ranges:ident,$formats:ident,$styles:ident,$rebuild:ident) => {
        impl MetadataSwap for FormatEntry<$ty> {
            fn is_changed(&self, _: &WorkbookStorage, cell_store: &CellStore) -> bool {
                let current = cell_store.get_sheet(&self.sheet).and_then(|sheet| {
                    sheet
                        .$ranges
                        .iter()
                        .find(|r| r.id == self.id)
                        .map(|r| (r, sheet.$formats.get(&self.id), sheet.$styles.get(&self.id)))
                });
                current
                    != self
                        .old
                        .as_ref()
                        .map(|(_, r, f, s)| (r, f.as_ref(), s.as_ref()))
            }
            fn swap(
                &mut self,
                _: &mut WorkbookStorage,
                cell_store: &mut CellStore,
                effects: &mut HistoryEffects,
            ) {
                if let Some(sheet) = cell_store.get_sheet_mut(&self.sheet) {
                    let current = sheet.$ranges.iter().position(|r| r.id == self.id).map(|i| {
                        (
                            VectorPosition::capture(&sheet.$ranges, i, |r| {
                                r.id.as_u128().to_string()
                            }),
                            sheet.$ranges.remove(i),
                            sheet.$formats.remove(&self.id),
                            sheet.$styles.remove(&self.id),
                        )
                    });
                    for (_, range, _, _) in current.iter().chain(self.old.iter()) {
                        effects.format_rects.push((
                            self.sheet,
                            range.start_row(),
                            range.start_col(),
                            range.end_row(),
                            range.end_col(),
                        ));
                    }
                    if let Some((position, r, f, s)) = self.old.take() {
                        let index =
                            position.resolve(&sheet.$ranges, |r| r.id.as_u128().to_string());
                        sheet.$ranges.insert(index, r);
                        if let Some(f) = f {
                            sheet.$formats.insert(self.id, f);
                        }
                        if let Some(s) = s {
                            sheet.$styles.insert(self.id, s);
                        }
                    }
                    self.old = current;
                }
                effects.sheets.insert(self.sheet);
            }
        }
        pub(crate) fn $function(sheet: &SheetStore, id: RangeId) {
            if !sheet.history.is_active() || sheet.history.owns_sheet(sheet.id) {
                return;
            }
            sheet.history.record_once(
                HistoryKey::Metadata(MetadataKey::FormatRange(sheet.id, id, $column)),
                || {
                    let old = sheet
                        .$ranges
                        .iter()
                        .enumerate()
                        .find(|(_, r)| r.id == id)
                        .map(|(i, r)| {
                            (
                                VectorPosition::capture(&sheet.$ranges, i, |r| {
                                    r.id.as_u128().to_string()
                                }),
                                *r,
                                sheet.$formats.get(&id).cloned(),
                                sheet.$styles.get(&id).copied(),
                            )
                        });
                    HistoryPatch::Metadata(MetadataPatch(Box::new(FormatEntry::<$ty> {
                        sheet: sheet.id,
                        id,
                        old,
                    })))
                },
            );
        }
    };
}
format_patch!(
    FormatRange,
    capture_format_range,
    false,
    format_ranges,
    range_format_cache,
    range_xlsx_style_id_cache,
    rebuild_format_range_spatial_index
);
format_patch!(
    ColumnFormatRange,
    capture_column_format_range,
    true,
    col_format_ranges,
    col_format_range_cache,
    col_range_xlsx_style_id_cache,
    rebuild_col_format_range_spatial_index
);
