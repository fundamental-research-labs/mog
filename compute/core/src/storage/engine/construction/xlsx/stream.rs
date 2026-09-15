use super::*;
use value_types::CellValue;
use xlsx_parser::{StreamLoadStats, XlsxCellSink};

/// Owns the staged workbook throughout parsing. Failure drops the entire stage;
/// callbacks never borrow global state or mutate the caller's existing workbook.
pub(super) struct NativeCellSink<'a> {
    pub store: CellStore,
    pub sheets: Vec<SheetId>,
    pub stats: StreamLoadStats,
    progress: &'a mut dyn FnMut(&StreamLoadStats, &CellStore),
}

impl<'a> NativeCellSink<'a> {
    pub fn new(progress: &'a mut dyn FnMut(&StreamLoadStats, &CellStore)) -> Self {
        Self {
            store: CellStore::new(),
            sheets: Vec::new(),
            stats: StreamLoadStats::default(),
            progress,
        }
    }
}

impl XlsxCellSink for NativeCellSink<'_> {
    fn cell(
        &mut self,
        index: usize,
        mut cell: domain_types::CellData,
        stats: &StreamLoadStats,
    ) -> bool {
        while self.sheets.len() <= index {
            self.sheets.push(
                self.store
                    .open_stream_sheet(&format!("__stream{}", self.sheets.len())),
            );
        }
        let value = std::mem::take(&mut cell.value);
        // Values already belong to the live store. Keep only authored blanks or
        // cells with metadata that must survive conversion/round-trip export.
        let retain = value.is_null()
            || cell
                != domain_types::CellData {
                    row: cell.row,
                    col: cell.col,
                    ..Default::default()
                };
        self.store
            .ingest_streamed_xlsx_cell(&self.sheets[index], cell.row, cell.col, value);
        (self.progress)(stats, &self.store);
        retain
    }

    fn retain_range_cells(
        &mut self,
        index: usize,
        cells: &mut Vec<xlsx_parser::FullCellData>,
        ranges: &[(u32, u32, u32, u32)],
    ) {
        let Some(sheet_id) = self.sheets.get(index) else {
            return;
        };
        let Some(sheet) = self.store.get_sheet(sheet_id) else {
            return;
        };
        let mut retained: rustc_hash::FxHashSet<_> =
            cells.iter().map(|cell| (cell.row, cell.col)).collect();
        for (id, row, col) in sheet.cells() {
            if !ranges
                .iter()
                .any(|&(r0, c0, r1, c1)| r0 <= row && row <= r1 && c0 <= col && col <= c1)
                || !retained.insert((row, col))
            {
                continue;
            }
            let Some(value) = self.store.get_cell_value(&id) else {
                continue;
            };
            let (cell_type, cached_value_type, value) = match value {
                CellValue::Number(n) => (
                    xlsx_parser::CELL_TYPE_VAL_NUMBER,
                    xlsx_parser::CELL_TYPE_NUMBER,
                    Some(n.get().to_string()),
                ),
                CellValue::Text(text) => (
                    xlsx_parser::CELL_TYPE_VAL_STRING,
                    xlsx_parser::CELL_TYPE_STRING,
                    Some(text.to_string()),
                ),
                CellValue::Boolean(b) => (
                    xlsx_parser::CELL_TYPE_VAL_BOOL,
                    xlsx_parser::CELL_TYPE_BOOL,
                    Some(if *b { "1" } else { "0" }.into()),
                ),
                CellValue::Error(e, _) => (
                    xlsx_parser::CELL_TYPE_VAL_ERROR,
                    xlsx_parser::CELL_TYPE_ERROR,
                    Some(e.to_string()),
                ),
                CellValue::Null => (xlsx_parser::CELL_TYPE_VAL_EMPTY, 0, None),
                // The worksheet XML parser only produces scalar caches. Rich
                // values are resolved later from retained metadata.
                _ => unreachable!("non-scalar cell before XLSX metadata hydration"),
            };
            cells.push(xlsx_parser::FullCellData {
                row,
                col,
                cell_type,
                cached_value_type,
                value,
                ..Default::default()
            });
        }
        cells.sort_by_key(|cell| (cell.row, cell.col));
    }

    fn sheet_complete(&mut self, sheet: usize, stats: &StreamLoadStats) {
        if let Some(&id) = self.sheets.get(sheet) {
            self.store.finish_stream_sheet(id);
        }
        self.stats.merge_from(stats);
    }
}
