//! Parser-side adapters for shared XLSX file I/O test contracts.

pub mod fidelity;
pub mod ooxml_contract;
pub mod package_graph;
pub mod perf;
pub mod xml_diff;

pub use ooxml_contract::*;
pub use package_graph::*;
pub use perf::*;
pub use xlsx_test_contracts::*;
