//! Names domain — defined names (workbook and sheet scope).

pub mod read;
pub mod types;

mod read_element;
mod read_section;
mod xml_decode;

pub use types::{BuiltInName, DefinedName, DefinedNames};
