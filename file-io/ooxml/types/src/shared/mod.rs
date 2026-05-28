//! Shared common simple types from ECMA-376 Part 4 (shared-commonSimpleTypes.xsd).
//!
//! These types are used across multiple OOXML namespaces (SpreadsheetML, WordprocessingML,
//! DrawingML) and represent fundamental value types defined in the shared schema.

mod alignment;
mod booleans;
mod crypto;
mod document;
mod opc;
mod percentages;
mod string_types;
mod text;

#[cfg(test)]
mod tests;

#[doc(inline)]
pub use alignment::{XAlign, YAlign};
#[doc(inline)]
pub use booleans::{OnOff, OnOff1, TrueFalse, TrueFalseBlank};
#[doc(inline)]
pub use crypto::{AlgClass, AlgType, CryptProv};
#[doc(inline)]
pub use document::ConformanceClass;
#[doc(inline)]
pub use opc::OpcRelationship;
#[doc(inline)]
pub use percentages::{FixedPercentage, Percentage, PositiveFixedPercentage, PositivePercentage};
#[doc(inline)]
pub use string_types::{Guid, HexColorRgb};
#[doc(inline)]
pub use text::VerticalAlignRun;
