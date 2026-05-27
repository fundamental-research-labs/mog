//! ChartEx OOXML dialect parsing and writing.
//!
//! ChartEx shares low-level XML scanner and writer infrastructure with standard
//! charts where the semantics are identical, but it remains a separate dialect
//! boundary from standard `c:chartSpace`.

pub mod read;
pub mod write;

pub use read::*;
pub use write::*;
