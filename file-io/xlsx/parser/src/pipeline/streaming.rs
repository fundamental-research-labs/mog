//! Unified worksheet loading over incremental ZIP inflation.
//!
//! `StreamingDeflate` validates and inflates bounded byte chunks; the worksheet
//! parser resolves cells and forwards them to an optional native consumer.

mod deflate;
mod utf8;
mod worksheet;

pub use deflate::{DEFAULT_BUFFER_SIZE, StreamingDeflate};
pub(crate) use worksheet::stream_parse_worksheet;
pub use worksheet::{StreamLoadStats, XlsxCellSink};
