//! Content Types Manager for XLSX writing.
//!
//! This module handles the generation of `[Content_Types].xml`, which is the manifest
//! file at the root of every XLSX archive. It maps file extensions and specific paths
//! to their MIME types (content types).
//!
//! # XLSX Content Types Structure
//!
//! The `[Content_Types].xml` file contains two types of mappings:
//!
//! 1. **Default** - Maps file extensions to content types:
//!    ```xml
//!    <Default Extension="xml" ContentType="application/xml"/>
//!    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
//!    ```
//!
//! 2. **Override** - Maps specific paths to content types:
//!    ```xml
//!    <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
//!    <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
//!    ```

mod builders;
mod constants;
mod factory;
mod manager;
mod types;
mod xml;

#[cfg(test)]
mod tests;

pub use constants::*;
pub use factory::create_xlsx_content_types;
pub use manager::ContentTypesManager;
pub use types::{ContentTypeDefault, ContentTypeOverride};
