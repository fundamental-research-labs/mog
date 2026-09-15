//! Stream-inflate a worksheet part and parse cells without materializing the
//! full decompressed XML document.
//!
//! Pre-`<sheetData>` and post-`</sheetData>` markup is buffered (typically
//! small). Cell XML is parsed from inflate chunks and discarded.

use crate::domain::cells::{
    CellData, CellExtrasInput, ParseExtras, apply_fast_row_attrs, collect_cell_extras,
    collect_formula_extras, parse_row_number, scan_cell, start_tag_at,
};
use crate::infra::scanner::{find_gt_simd, find_lt_simd, find_tag_simd};
use crate::zip::constants::MAX_WORKSHEET_CELLS;
use crate::zip::{CompressedEntry, ZipError};

use super::cell_xml::matches_tag;
use super::deflate::{DEFAULT_BUFFER_SIZE, StreamingDeflate};
use ooxml_types::worksheet::RowHeight;

use std::cell::{Cell, RefCell};

thread_local! {
    static LAST_STREAM_STATS: RefCell<StreamLoadStats> = RefCell::new(StreamLoadStats::default());
    static STREAM_CELL_HOOK: RefCell<Option<StreamCellHook>> = RefCell::new(None);
    static STREAM_RESOLVED_HOOK: RefCell<Option<StreamResolvedHook>> = RefCell::new(None);
    static CURRENT_STREAM_SHEET: Cell<usize> = const { Cell::new(0) };
    static STREAM_RETAIN_CELLS: Cell<bool> = const { Cell::new(true) };
}

type StreamCellHook = Box<dyn FnMut(usize, &CellData, &[u8], &StreamLoadStats)>;
type StreamResolvedHook = Box<dyn FnMut(usize, u32, u32, Option<&str>, Option<&str>)>;

/// Install a cell observer for the duration of `f`.
///
/// The observer is invoked from `stream_parse_worksheet` as each cell is
/// parsed from an inflate chunk, with the current worksheet index.
pub fn with_stream_cell_hook<R>(
    hook: impl FnMut(usize, &CellData, &[u8], &StreamLoadStats) + 'static,
    f: impl FnOnce() -> R,
) -> R {
    STREAM_CELL_HOOK.with(|slot| *slot.borrow_mut() = Some(Box::new(hook)));
    CURRENT_STREAM_SHEET.with(|idx| idx.set(0));
    STREAM_RETAIN_CELLS.with(|flag| flag.set(false));
    let result = f();
    STREAM_CELL_HOOK.with(|slot| *slot.borrow_mut() = None);
    STREAM_RESOLVED_HOOK.with(|slot| *slot.borrow_mut() = None);
    STREAM_RETAIN_CELLS.with(|flag| flag.set(true));
    result
}

pub fn set_stream_resolved_hook(
    hook: impl FnMut(usize, u32, u32, Option<&str>, Option<&str>) + 'static,
) {
    STREAM_RESOLVED_HOOK.with(|slot| *slot.borrow_mut() = Some(Box::new(hook)));
}

pub(crate) fn notify_stream_resolved(
    row: u32,
    col: u32,
    value: Option<&str>,
    formula: Option<&str>,
) {
    STREAM_RESOLVED_HOOK.with(|slot| {
        if let Some(hook) = slot.borrow_mut().as_mut() {
            let sheet_idx = CURRENT_STREAM_SHEET.with(|idx| idx.get());
            hook(sheet_idx, row, col, value, formula);
        }
    });
}

pub(crate) fn stream_retain_cells() -> bool {
    STREAM_RETAIN_CELLS.with(|flag| flag.get())
}

pub(crate) fn set_current_stream_sheet(sheet_idx: usize) {
    CURRENT_STREAM_SHEET.with(|idx| idx.set(sheet_idx));
}

pub(crate) fn notify_stream_cell(cell: &CellData, strings: &[u8], stats: &StreamLoadStats) {
    STREAM_CELL_HOOK.with(|slot| {
        if let Some(hook) = slot.borrow_mut().as_mut() {
            let sheet_idx = CURRENT_STREAM_SHEET.with(|idx| idx.get());
            hook(sheet_idx, cell, strings, stats);
        }
    });
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
}

impl StreamLoadStats {
    fn merge_from(&mut self, other: &Self) {
        self.max_inflate_buffer = self.max_inflate_buffer.max(other.max_inflate_buffer);
        self.inflate_chunk_size = self.inflate_chunk_size.max(other.inflate_chunk_size);
        self.bytes_decompressed = self.bytes_decompressed.saturating_add(other.bytes_decompressed);
        self.uncompressed_size = self.uncompressed_size.saturating_add(other.uncompressed_size);
        self.chunks_processed = self.chunks_processed.saturating_add(other.chunks_processed);
        self.cells_emitted_before_last_chunk = self
            .cells_emitted_before_last_chunk
            .saturating_add(other.cells_emitted_before_last_chunk);
        self.cells_parsed = self.cells_parsed.saturating_add(other.cells_parsed);
    }
}

/// Clear thread-local stream counters before a workbook parse.
pub fn reset_stream_load_stats() {
    LAST_STREAM_STATS.with(|stats| *stats.borrow_mut() = StreamLoadStats::default());
}

/// Merge one worksheet's counters into the thread-local workbook totals.
pub fn record_stream_load_stats(stats: &StreamLoadStats) {
    LAST_STREAM_STATS.with(|slot| slot.borrow_mut().merge_from(stats));
}

/// Totals from the most recent workbook parse on this thread.
pub fn last_stream_load_stats() -> StreamLoadStats {
    LAST_STREAM_STATS.with(|stats| stats.borrow().clone())
}

/// Streamed worksheet payload: cells plus the small head/tail XML regions.
#[derive(Debug)]
pub struct StreamedWorksheet {
    pub pre_sheet_data: Vec<u8>,
    pub post_sheet_data: Vec<u8>,
    pub cells: Vec<CellData>,
    pub strings: Vec<u8>,
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

struct WorksheetStreamParser<'a> {
    shared_strings: &'a [&'a str],
    phase: Phase,
    pending: Vec<u8>,
    pre: Vec<u8>,
    post: Vec<u8>,
    cells: Vec<CellData>,
    strings: Vec<u8>,
    extras: ParseExtras,
    row_heights: Vec<RowHeight>,
    explicit_blank_cells: Vec<(u32, u32)>,
    current_row: u32,
    current_row_style: Option<u32>,
    max_window: usize,
}

impl<'a> WorksheetStreamParser<'a> {
    fn new(shared_strings: &'a [&'a str], cell_hint: usize) -> Self {
        Self {
            shared_strings,
            phase: Phase::Pre,
            pending: Vec::new(),
            pre: Vec::new(),
            post: Vec::new(),
            cells: Vec::with_capacity(cell_hint.min(MAX_WORKSHEET_CELLS)),
            strings: Vec::with_capacity(cell_hint.saturating_mul(8).min(1 << 20)),
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
        if self.phase != Phase::Post && !self.pending.is_empty() {
            // Trailing markup without `</sheetData>` still belongs to the tail
            // when sheetData was never closed; otherwise it is leftover pre.
            match self.phase {
                Phase::Pre => self.pre.append(&mut self.pending),
                Phase::Cells | Phase::Post => self.post.append(&mut self.pending),
            }
        }
        Ok(StreamedWorksheet {
            pre_sheet_data: self.pre,
            post_sheet_data: self.post,
            cells: self.cells,
            strings: self.strings,
            extras: self.extras,
            row_heights: self.row_heights,
            explicit_blank_cells: self.explicit_blank_cells,
            stats: StreamLoadStats {
                max_inflate_buffer: self.max_window,
                ..StreamLoadStats::default()
            },
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
                    self.phase = Phase::Post;
                    if let Some(gt) = find_gt_simd(data, lt) {
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
                let Some(scanned) = scan_cell(
                    data,
                    lt,
                    self.current_row,
                    self.shared_strings,
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
                    if self.cells.len() >= MAX_WORKSHEET_CELLS {
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
                    self.cells.push(cell_data);
                    let last_idx = self.cells.len() - 1;
                    collect_cell_extras(
                        &mut self.extras,
                        last_idx,
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
                            &mut self.extras,
                            last_idx,
                            cell_data,
                            &data[lt..scanned.end],
                            &mut self.strings,
                            scanned.has_xml_space_v,
                        );
                    }
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
    tag.windows(name.len() + 2)
        .any(|window| window.starts_with(name) && window[name.len()] == b'=' && window[name.len() + 1] == b'"')
}

/// Inflate a worksheet ZIP entry in bounded chunks and parse cells as bytes arrive.
///
/// `on_cell` fires for each cell as soon as its XML is parsed from an inflate
/// chunk — before the rest of the sheet (or workbook) is materialized.
/// `on_chunk` fires after each inflate/copy chunk is consumed.
pub fn stream_parse_worksheet(
    entry: &CompressedEntry<'_>,
    shared_strings: &[&str],
    mut on_cell: impl FnMut(&CellData, &[u8], &StreamLoadStats),
    mut on_chunk: impl FnMut(&StreamLoadStats),
) -> Result<StreamedWorksheet, String> {
    let cell_hint = (entry.uncompressed_size / 50).max(64);
    let mut parser = WorksheetStreamParser::new(shared_strings, cell_hint);
    let mut stats = StreamLoadStats {
        inflate_chunk_size: DEFAULT_BUFFER_SIZE,
        uncompressed_size: entry.uncompressed_size,
        ..StreamLoadStats::default()
    };

    if entry.is_stored() {
        stream_stored(
            entry,
            &mut parser,
            &mut stats,
            &mut on_cell,
            &mut on_chunk,
        )?;
    } else if entry.is_deflate() {
        stream_deflate(
            entry,
            &mut parser,
            &mut stats,
            &mut on_cell,
            &mut on_chunk,
        )?;
    } else {
        return Err(format!(
            "Unsupported compression method: {}",
            entry.compression_method
        ));
    }

    let mut streamed = parser.finish()?;
    stats.max_inflate_buffer = stats
        .max_inflate_buffer
        .max(streamed.stats.max_inflate_buffer)
        .max(DEFAULT_BUFFER_SIZE);
    stats.cells_parsed = streamed.cells.len();
    streamed.stats = stats;
    Ok(streamed)
}

fn stream_deflate(
    entry: &CompressedEntry<'_>,
    parser: &mut WorksheetStreamParser<'_>,
    stats: &mut StreamLoadStats,
    on_cell: &mut impl FnMut(&CellData, &[u8], &StreamLoadStats),
    on_chunk: &mut impl FnMut(&StreamLoadStats),
) -> Result<(), String> {
    let mut deflate = StreamingDeflate::new(
        entry.data,
        DEFAULT_BUFFER_SIZE,
        entry.uncompressed_size,
        entry.output_limit,
        entry.crc32,
    )
    .map_err(|e| e.to_string())?;

    loop {
        let cells_before = parser.cells.len();
        let chunk = match deflate.next_chunk().map_err(|e| e.to_string())? {
            Some(chunk) => chunk.to_vec(),
            None => break,
        };
        stats.chunks_processed += 1;
        stats.max_inflate_buffer = stats.max_inflate_buffer.max(chunk.len());
        parser.push_chunk(&chunk)?;
        stats.bytes_decompressed = deflate.bytes_decompressed();
        stats.cells_parsed = parser.cells.len();
        if !deflate.is_finished() {
            stats.cells_emitted_before_last_chunk = parser.cells.len().max(cells_before);
        }
        emit_new_cells(parser, cells_before, stats, on_cell);
        on_chunk(stats);
    }
    stats.bytes_decompressed = deflate.bytes_decompressed();
    Ok(())
}

fn emit_new_cells(
    parser: &WorksheetStreamParser<'_>,
    cells_before: usize,
    stats: &StreamLoadStats,
    on_cell: &mut impl FnMut(&CellData, &[u8], &StreamLoadStats),
) {
    for cell in &parser.cells[cells_before..] {
        on_cell(cell, &parser.strings, stats);
    }
}

fn stream_stored(
    entry: &CompressedEntry<'_>,
    parser: &mut WorksheetStreamParser<'_>,
    stats: &mut StreamLoadStats,
    on_cell: &mut impl FnMut(&CellData, &[u8], &StreamLoadStats),
    on_chunk: &mut impl FnMut(&StreamLoadStats),
) -> Result<(), String> {
    if entry.data.len() != entry.uncompressed_size {
        return Err(ZipError::DataCorruptionDetail(format!(
            "{}: stored entry length {} does not match uncompressed size {}",
            entry.name,
            entry.data.len(),
            entry.uncompressed_size
        ))
        .to_string());
    }
    let mut hasher = crc32fast::Hasher::new();
    let mut offset = 0;
    while offset < entry.data.len() {
        let end = (offset + DEFAULT_BUFFER_SIZE).min(entry.data.len());
        let chunk = &entry.data[offset..end];
        hasher.update(chunk);
        stats.chunks_processed += 1;
        stats.bytes_decompressed = end;
        stats.max_inflate_buffer = stats.max_inflate_buffer.max(chunk.len());
        let last = end == entry.data.len();
        let cells_before = parser.cells.len();
        parser.push_chunk(chunk)?;
        stats.cells_parsed = parser.cells.len();
        if !last {
            stats.cells_emitted_before_last_chunk = parser.cells.len();
        }
        emit_new_cells(parser, cells_before, stats, on_cell);
        on_chunk(stats);
        offset = end;
    }
    let actual = hasher.finalize();
    if actual != entry.crc32 {
        return Err(ZipError::DataCorruptionDetail(format!(
            "{}: CRC mismatch, expected {:08x}, got {:08x}",
            entry.name, entry.crc32, actual
        ))
        .to_string());
    }
    Ok(())
}
