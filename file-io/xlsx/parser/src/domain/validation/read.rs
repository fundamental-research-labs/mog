//! Compatibility facade for XLSX data validation read parsing.
//!
//! The read parser implementation is split across focused sibling modules for
//! shared model types, scanner support, legacy worksheet parsing, x14 extension
//! parsing, and summary projection. Public callers should continue to import
//! through this module.

pub use super::read_summary::parse_data_validations;
pub use super::read_x14::parse_x14_data_validations;
pub use super::types::{
    DataValidation, DataValidationErrorStyle, DataValidationOperator, DataValidationType,
    DataValidations, DataValidationsContainerAttrs, ImeMode,
};
