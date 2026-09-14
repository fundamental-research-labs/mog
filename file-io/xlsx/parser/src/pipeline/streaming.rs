//! Streaming ZIP decompression module for XLSX parsing.
//!
//! This module provides streaming decompression capabilities that allow
//! emitting cells as chunks decompress, reducing memory usage and latency.
//!
//! # Architecture
//!
//! The streaming parser works in two stages:
//! 1. `StreamingDeflate` - Incrementally decompresses DEFLATE data in chunks
//! 2. `StreamingCellParser` - Parses XML cell data from decompressed chunks
//!
//! XML elements may span chunk boundaries, so the parser maintains pending
//! data between chunks.

mod cell_parser;
mod cell_xml;
mod deflate;
mod state;
mod utf8;
mod worksheet;

pub use cell_parser::StreamingCellParser;
pub use deflate::{DEFAULT_BUFFER_SIZE, StreamingDeflate};
pub use state::ParseState;
pub use worksheet::{
    StreamLoadStats, StreamedWorksheet, last_stream_load_stats, record_stream_load_stats,
    reset_stream_load_stats, stream_parse_worksheet, with_stream_cell_hook,
};
pub(crate) use worksheet::{notify_stream_cell, set_current_stream_sheet};
