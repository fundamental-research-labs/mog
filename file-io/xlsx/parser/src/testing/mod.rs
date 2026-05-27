//! Parser-side adapters for shared XLSX file I/O test contracts.

pub mod ooxml_contract;
pub mod package_graph;
pub mod perf;

pub use ooxml_contract::*;
pub use package_graph::*;
pub use perf::*;
pub use xlsx_test_contracts::*;
