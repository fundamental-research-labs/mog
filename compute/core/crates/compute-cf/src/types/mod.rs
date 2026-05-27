//! CF types — wire format (IPC) and internal representation.
//!
//! Two-layer design:
//! - **Wire format** (`CFRuleWire`): flat struct with `Deserialize` for IPC from TypeScript.
//! - **Internal types** (`CFRule` + `CFRuleKind`): proper Rust enum, prevents invalid states.
//! - **Output types** (`CellCFResult`, etc.): with `Serialize` for IPC back to TypeScript.

mod convert;
mod enums;
mod result;
mod rule;
mod value;
mod wire;

pub use convert::*;
pub use enums::*;
pub use result::*;
pub use rule::*;
pub use value::*;
pub use wire::*;

#[cfg(test)]
#[path = "../types_tests/mod.rs"]
mod tests;
