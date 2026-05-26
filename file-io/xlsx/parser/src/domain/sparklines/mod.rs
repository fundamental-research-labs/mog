//! Sparklines domain — sparkline group parsing and writing.

pub mod read;
pub mod types;
pub mod write;

pub use read::SparklineType;
pub use read::parse_sparklines;
