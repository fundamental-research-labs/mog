//! Stream-inflate a worksheet part and parse cells without materializing the
//! full decompressed XML document.
//!
//! Pre-`<sheetData>` and post-`</sheetData>` markup is buffered (typically
//! small). Cell XML is parsed from inflate chunks and discarded.

use crate::domain::cells::{
    CellExtrasInput, ParseExtras, apply_fast_row_attrs, collect_cell_extras,
    collect_formula_extras, parse_row_number, scan_cell, start_tag_at,
};
use crate::infra::scanner::{find_gt_simd, find_lt_simd, find_tag_simd};
use crate::zip::constants::MAX_WORKSHEET_CELLS;
use crate::zip::{CompressedEntry, ZipError};

use crate::domain::cells::matches_tag;
use super::deflate::{DEFAULT_BUFFER_SIZE, StreamingDeflate};
use ooxml_types::worksheet::RowHeight;

use crate::output::results::FullCellData;
use crate::output::to_parse_output::cell_context::CellConversionContext;

/// A native consumer for decoded worksheet cells. Returning `true` retains the
/// cell's import metadata in the parse result; the consumer already owns its value.
/// Collection-only callers use the same parser without a sink.
pub trait XlsxCellSink {
    fn cell(&mut self, sheet: usize, cell: domain_types::CellData, stats: &StreamLoadStats)
    -> bool;

    /// Restore authored cells in array/data-table regions from the consumer's
    /// store, so cross-cell metadata can be resolved even for out-of-order XML.
    fn retain_range_cells(
        &mut self,
        sheet: usize,
        cells: &mut Vec<FullCellData>,
        ranges: &[(u32, u32, u32, u32)],
    );

    fn sheet_complete(&mut self, sheet: usize, stats: &StreamLoadStats);
}

/// Observed inflate/parse counters for a single worksheet stream.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StreamLoadStats {
    /// Peak inflate/XML window retained while parsing this sheet.
    pub max_inflate_buffer: usize,
    /// Decompression chunk size used for this sheet.
    pub inflate_chunk_size: usize,
    /// Bytes emitted by inflate (or copied for STORE).
    pub bytes_decompressed: usize,
    /// Declared uncompressed size from the ZIP central directory.
    pub uncompressed_size: usize,
    /// Number of inflate/copy chunks processed.
    pub chunks_processed: usize,
    /// Cells parsed before the final chunk was consumed.
    pub cells_emitted_before_last_chunk: usize,
    /// Total cells parsed from this sheet.
    pub cells_parsed: usize,
    /// Largest per-cell text scratch buffer; released before the next cell.
    pub max_cell_text_buffer: usize,
    /// Retained cells requiring import metadata, distinct from the live grid.
    pub retained_metadata_cells: usize,
}

impl StreamLoadStats {
    pub fn merge_from(&mut self, other: &Self) {
        self.max_inflate_buffer = self.max_inflate_buffer.max(other.max_inflate_buffer);
        self.inflate_chunk_size = self.inflate_chunk_size.max(other.inflate_chunk_size);
        self.bytes_decompressed = self
            .bytes_decompressed
            .saturating_add(other.bytes_decompressed);
        self.uncompressed_size = self
            .uncompressed_size
            .saturating_add(other.uncompressed_size);
        self.chunks_processed = self.chunks_processed.saturating_add(other.chunks_processed);
        self.cells_emitted_before_last_chunk = self
            .cells_emitted_before_last_chunk
            .saturating_add(other.cells_emitted_before_last_chunk);
        self.cells_parsed = self.cells_parsed.saturating_add(other.cells_parsed);
        self.max_cell_text_buffer = self.max_cell_text_buffer.max(other.max_cell_text_buffer);
        self.retained_metadata_cells = self
            .retained_metadata_cells
            .saturating_add(other.retained_metadata_cells);
    }
}

/// Streamed worksheet payload: cells plus the small head/tail XML regions.
#[derive(Debug)]
pub struct StreamedWorksheet {
    pub pre_sheet_data: Vec<u8>,
    pub post_sheet_data: Vec<u8>,
    pub cells: Vec<FullCellData>,
    pub extras: ParseExtras,
    pub row_heights: Vec<RowHeight>,
    pub explicit_blank_cells: Vec<(u32, u32)>,
    pub stats: StreamLoadStats,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    Pre,
    Cells,
    Post,
}

struct WorksheetStreamParser<'a, 'b, 'c> {
    shared_strings: &'a [String],
    shared_string_refs: Vec<&'a str>,
    context: &'a CellConversionContext<'a>,
    sheet_index: usize,
    sink: &'b mut Option<&'c mut dyn XlsxCellSink>,
    stats: StreamLoadStats,
    phase: Phase,
    pending: Vec<u8>,
    pre: Vec<u8>,
    post: Vec<u8>,
    cells: Vec<FullCellData>,
    strings: Vec<u8>,
    extras: ParseExtras,
    row_heights: Vec<RowHeight>,
    explicit_blank_cells: Vec<(u32, u32)>,
    current_row: u32,
    current_row_style: Option<u32>,
    max_window: usize,
}

impl<'a, 'b, 'c> WorksheetStreamParser<'a, 'b, 'c> {
    fn new(
        shared_strings: &'a [String],
        context: &'a CellConversionContext<'a>,
        sheet_index: usize,
        sink: &'b mut Option<&'c mut dyn XlsxCellSink>,
        uncompressed_size: usize,
    ) -> Self {
        Self {
            shared_string_refs: shared_strings.iter().map(String::as_str).collect(),
            shared_strings,
            context,
            sheet_index,
            sink,
            stats: StreamLoadStats {
                inflate_chunk_size: DEFAULT_BUFFER_SIZE,
                uncompressed_size,
                ..Default::default()
            },
            phase: Phase::Pre,
            pending: Vec::new(),
            pre: Vec::new(),
            post: Vec::new(),
            cells: Vec::new(),
            strings: Vec::new(),
            extras: ParseExtras::default(),
            row_heights: Vec::new(),
            explicit_blank_cells: Vec::new(),
            current_row: 0,
            current_row_style: None,
            max_window: 0,
        }
    }

    fn note_window(&mut self, extra: usize) {
        let window = self.pending.len()
            + extra
            + match self.phase {
                Phase::Pre => self.pre.len(),
                Phase::Post => self.post.len(),
                Phase::Cells => 0,
            };
        self.max_window = self.max_window.max(window);
    }

    fn push_chunk(&mut self, chunk: &[u8]) -> Result<(), String> {
        self.note_window(chunk.len());
        if !self.pending.is_empty() {
            self.pending.extend_from_slice(chunk);
            let data = std::mem::take(&mut self.pending);
            self.consume(&data)?;
        } else {
            self.consume(chunk)?;
        }
        Ok(())
    }

    fn finish(mut self) -> Result<StreamedWorksheet, String> {
        if !self.pending.is_empty() {
            let pending = std::mem::take(&mut self.pending);
            self.consume(&pending)?;
        }
        if self.phase == Phase::Cells {
            return Err("Truncated worksheet XML: incomplete cell or sheetData element".into());
        }
        if self.phase != Phase::Post && !self.pending.is_empty() {
            // Trailing markup without `</sheetData>` still belongs to the tail
            // when sheetData was never closed; otherwise it is leftover pre.
            match self.phase {
                Phase::Pre => self.pre.append(&mut self.pending),
                Phase::Cells | Phase::Post => self.post.append(&mut self.pending),
            }
        }
        let mut ranges: Vec<_> = self
            .cells
            .iter()
            .filter_map(|cell| {
                crate::output::to_parse_output::stream_range(cell.array_ref.as_deref()?)
            })
            .collect();
        ranges.extend(
            self.extras
                .data_tables
                .iter()
                .map(|dt| (dt.start_row, dt.start_col, dt.end_row, dt.end_col)),
        );
        if let Some(sink) = self.sink.as_deref_mut() {
            if !ranges.is_empty() {
                sink.retain_range_cells(self.sheet_index, &mut self.cells, &ranges);
            }
        }
        crate::domain::cells::apply_parse_extras(
            &mut self.cells,
            &self.extras,
            &[],
            &[],
            self.shared_strings,
        );
        self.stats.max_inflate_buffer = self.max_window.max(DEFAULT_BUFFER_SIZE);
        self.stats.retained_metadata_cells = self.cells.len();
        if let Some(sink) = self.sink.as_deref_mut() {
            sink.sheet_complete(self.sheet_index, &self.stats);
        }
        Ok(StreamedWorksheet {
            pre_sheet_data: self.pre,
            post_sheet_data: self.post,
            cells: self.cells,
            extras: self.extras,
            row_heights: self.row_heights,
            explicit_blank_cells: self.explicit_blank_cells,
            stats: self.stats,
        })
    }

    fn consume(&mut self, data: &[u8]) -> Result<(), String> {
        match self.phase {
            Phase::Pre => self.consume_pre(data),
            Phase::Cells => self.consume_cells(data),
            Phase::Post => {
                self.post.extend_from_slice(data);
                Ok(())
            }
        }
    }

    fn consume_pre(&mut self, data: &[u8]) -> Result<(), String> {
        if let Some(tag) = start_tag_at(data, 0, b"sheetData").or_else(|| {
            let mut search = 0;
            while let Some(lt) = find_tag_simd(data, b"sheetData", search) {
                if let Some(tag) = start_tag_at(data, lt, b"sheetData") {
                    return Some(tag);
                }
                search = lt + 1;
            }
            None
        }) {
            self.pre.extend_from_slice(&data[..tag.lt]);
            if tag.is_self_closing {
                self.phase = Phase::Post;
                if tag.content_start < data.len() {
                    self.post.extend_from_slice(&data[tag.content_start..]);
                }
                return Ok(());
            }
            self.phase = Phase::Cells;
            if tag.content_start < data.len() {
                return self.consume_cells(&data[tag.content_start..]);
            }
            return Ok(());
        }

        let keep = spanning_tag_keep(data);
        if keep < data.len() {
            self.pre.extend_from_slice(&data[..data.len() - keep]);
            self.pending.extend_from_slice(&data[data.len() - keep..]);
        } else {
            self.pending.extend_from_slice(data);
        }
        Ok(())
    }

    fn consume_cells(&mut self, data: &[u8]) -> Result<(), String> {
        let mut pos = 0;
        while pos < data.len() {
            let Some(lt) = find_lt_simd(data, pos) else {
                break;
            };
            if lt + 1 >= data.len() {
                self.pending.extend_from_slice(&data[lt..]);
                return Ok(());
            }

            if data[lt + 1] == b'/' {
                if matches_tag(data, lt + 2, b"sheetData") {
                    if let Some(gt) = find_gt_simd(data, lt) {
                        self.phase = Phase::Post;
                        let after = gt + 1;
                        if after < data.len() {
                            self.post.extend_from_slice(&data[after..]);
                        }
                    } else {
                        self.pending.extend_from_slice(&data[lt..]);
                    }
                    return Ok(());
                }
                if let Some(gt) = find_gt_simd(data, lt) {
                    pos = gt + 1;
                    continue;
                }
                self.pending.extend_from_slice(&data[lt..]);
                return Ok(());
            }

            if let Some(row_tag) = start_tag_at(data, lt, b"row") {
                if let Some(row_num) = parse_row_number(data, row_tag.name_end) {
                    self.current_row = row_num.saturating_sub(1);
                }
                let applied = apply_fast_row_attrs(
                    &data[lt..=row_tag.tag_end],
                    self.current_row,
                    row_tag.is_self_closing,
                    &mut self.row_heights,
                    Some(&mut self.extras),
                );
                self.current_row_style = applied.row_style;
                pos = row_tag.content_start;
                continue;
            }

            if start_tag_at(data, lt, b"c").is_some() {
                self.strings.clear();
                let Some(scanned) = scan_cell(
                    data,
                    lt,
                    self.current_row,
                    &self.shared_string_refs,
                    &mut self.strings,
                    self.current_row_style,
                    &[],
                ) else {
                    self.pending.extend_from_slice(&data[lt..]);
                    return Ok(());
                };

                if let Some(style_only) = scanned.authored_style_only {
                    self.extras.authored_style_only_cells.push(style_only);
                }

                if let Some(cell_data) = scanned.cell {
                    if self.stats.cells_parsed >= MAX_WORKSHEET_CELLS {
                        return Err(format!(
                            "worksheet cell count exceeds XLSX parser safety limit {MAX_WORKSHEET_CELLS}"
                        ));
                    }
                    if is_explicit_blank_tag(&data[lt..=scanned.end.saturating_sub(1).max(lt)])
                        && cell_data.value_len == 0
                    {
                        self.explicit_blank_cells
                            .push((cell_data.row, cell_data.col));
                    }
                    let mut cell_extras = ParseExtras::default();
                    collect_cell_extras(
                        &mut cell_extras,
                        0,
                        cell_data,
                        &self.strings,
                        CellExtrasInput {
                            cm_val: scanned.cm_val,
                            vm_val: scanned.vm_val,
                            has_ph: scanned.has_ph,
                            has_explicit_s: scanned.has_explicit_s,
                            has_xml_space_v: scanned.has_xml_space_v,
                            sst_raw_idx: scanned.sst_raw_idx,
                        },
                    );
                    if !scanned.is_self_closing {
                        collect_formula_extras(
                            &mut cell_extras,
                            0,
                            cell_data,
                            &data[lt..scanned.end],
                            &mut self.strings,
                            scanned.has_xml_space_v,
                        );
                    }
                    let mut full = crate::domain::cells::convert_cell_data(
                        &cell_data,
                        &self.strings,
                        &mut Vec::new(),
                    );
                    crate::domain::cells::apply_parse_extras(
                        std::slice::from_mut(&mut full),
                        &cell_extras,
                        std::slice::from_ref(&cell_data),
                        &self.strings,
                        self.shared_strings,
                    );
                    self.extras.sf_masters.extend(cell_extras.sf_masters);
                    self.extras.sf_refs.extend(cell_extras.sf_refs);
                    self.extras.data_tables.extend(cell_extras.data_tables);
                    self.stats.cells_parsed += 1;
                    self.stats.max_cell_text_buffer =
                        self.stats.max_cell_text_buffer.max(self.strings.len());
                    if self.stats.bytes_decompressed < self.stats.uncompressed_size {
                        self.stats.cells_emitted_before_last_chunk += 1;
                    }
                    let retain = match self.sink.as_deref_mut() {
                        Some(sink) => sink.cell(
                            self.sheet_index,
                            self.context.convert(&full, Default::default()),
                            &self.stats,
                        ),
                        None => true,
                    };
                    if retain {
                        self.cells.push(full);
                    }
                    self.strings.clear();
                }
                pos = scanned.end;
                continue;
            }

            if let Some(gt) = find_gt_simd(data, lt) {
                pos = gt + 1;
            } else {
                self.pending.extend_from_slice(&data[lt..]);
                return Ok(());
            }
        }
        Ok(())
    }
}

fn spanning_tag_keep(data: &[u8]) -> usize {
    data.iter()
        .rposition(|&b| b == b'<')
        .map(|idx| data.len() - idx)
        .unwrap_or(32.min(data.len()))
}

fn is_explicit_blank_tag(tag: &[u8]) -> bool {
    !has_attr(tag, b"s")
        && !has_attr(tag, b"t")
        && !has_attr(tag, b"cm")
        && !has_attr(tag, b"vm")
        && !has_attr(tag, b"ph")
}

fn has_attr(tag: &[u8], name: &[u8]) -> bool {
    tag.windows(name.len() + 2).any(|window| {
        window.starts_with(name) && window[name.len()] == b'=' && window[name.len() + 1] == b'"'
    })
}

/// Inflate worksheet XML in bounded chunks and resolve each cell exactly once
/// before publishing it. Only requested metadata survives in the returned sheet.
pub(crate) fn stream_parse_worksheet(
    entry: &CompressedEntry<'_>,
    shared_strings: &[String],
    context: &CellConversionContext<'_>,
    sheet_index: usize,
    sink: &mut Option<&mut dyn XlsxCellSink>,
) -> Result<StreamedWorksheet, String> {
    let mut parser = WorksheetStreamParser::new(
        shared_strings,
        context,
        sheet_index,
        sink,
        entry.uncompressed_size,
    );
    if entry.is_stored() {
        if entry.data.len() != entry.uncompressed_size {
            return Err(ZipError::DataCorruptionDetail(format!(
                "{}: stored entry length does not match uncompressed size",
                entry.name
            ))
            .to_string());
        }
        std::str::from_utf8(entry.data).map_err(|err| {
            ZipError::DataCorruptionDetail(format!(
                "{} contains malformed UTF-8 at byte {}",
                entry.name,
                err.valid_up_to()
            ))
            .to_string()
        })?;
        let mut hasher = crc32fast::Hasher::new();
        for chunk in entry.data.chunks(DEFAULT_BUFFER_SIZE) {
            hasher.update(chunk);
            parser.stats.chunks_processed += 1;
            parser.stats.bytes_decompressed += chunk.len();
            parser.push_chunk(chunk)?;
        }
        if hasher.finalize() != entry.crc32 {
            return Err(
                ZipError::DataCorruptionDetail(format!("{}: CRC mismatch", entry.name)).to_string(),
            );
        }
    } else if entry.is_deflate() {
        let mut deflate = StreamingDeflate::new(
            entry.data,
            DEFAULT_BUFFER_SIZE,
            entry.uncompressed_size,
            entry.output_limit,
            entry.crc32,
        )
        .map_err(|e| e.to_string())?;
        while let Some(chunk) = deflate.next_chunk().map_err(|e| e.to_string())? {
            parser.stats.chunks_processed += 1;
            parser.stats.bytes_decompressed += chunk.len();
            parser.push_chunk(chunk)?;
        }
    } else {
        return Err(format!(
            "Unsupported compression method: {}",
            entry.compression_method
        ));
    }
    parser.finish()
}
