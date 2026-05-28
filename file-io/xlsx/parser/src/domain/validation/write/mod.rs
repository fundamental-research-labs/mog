//! Data Validation Writer for XLSX worksheets.
//!
//! This module generates `<dataValidations>` XML elements for worksheet files
//! according to ECMA-376 CT_DataValidation specification.

mod format;
mod from_domain;
mod rule;
#[cfg(test)]
mod tests;
mod types;
mod writer;
mod x14;

pub use from_domain::{validations_xml_from_domain, validations_xml_from_domain_with_opts};
pub use rule::DataValidation;
pub use types::{ErrorStyle, ValidationOperator, ValidationType};
pub use writer::DataValidationWriter;
pub use x14::x14_validations_ext_xml_from_domain_with_opts;
