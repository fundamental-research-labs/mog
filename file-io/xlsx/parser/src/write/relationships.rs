//! Relationship Manager for XLSX files
//!
//! This module manages OPC (Open Packaging Conventions) relationships used in XLSX files.
//! Relationships define how parts of the package are connected to each other.
//!
//! # XLSX Relationship Structure
//!
//! XLSX files contain multiple `.rels` files:
//! - `_rels/.rels` - Root relationships (workbook, core properties)
//! - `xl/_rels/workbook.xml.rels` - Workbook relationships (sheets, styles, theme)
//! - `xl/worksheets/_rels/sheet1.xml.rels` - Sheet relationships (comments, drawings)
//!
//! # Example XML Output
//!
//! ```xml
//! <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
//! <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
//!   <Relationship Id="rId1" Type="http://...worksheet" Target="worksheets/sheet1.xml"/>
//!   <Relationship Id="rId2" Type="http://...styles" Target="styles.xml"/>
//! </Relationships>
//! ```

mod factories;
mod manager;
mod types;
mod xml;

#[cfg(test)]
mod tests;

pub use crate::infra::opc::{
    REL_CALC_CHAIN, REL_CHART, REL_CHART_EX, REL_COMMENTS, REL_CORE_PROPERTIES,
    REL_CUSTOM_PROPERTIES, REL_DIAGRAM_COLORS, REL_DIAGRAM_DATA, REL_DIAGRAM_DRAWING,
    REL_DIAGRAM_LAYOUT, REL_DIAGRAM_QUICK_STYLE, REL_DRAWING, REL_EXTENDED_PROPERTIES,
    REL_EXTERNAL_LINK, REL_HYPERLINK, REL_METADATA, REL_OFFICE_DOCUMENT, REL_OLE_OBJECT,
    REL_PERSON, REL_PIVOT_CACHE, REL_PIVOT_TABLE, REL_PRINTER_SETTINGS, REL_SHARED_STRINGS,
    REL_SLICER, REL_SLICER_CACHE, REL_STYLES, REL_TABLE, REL_TABLE_SINGLE_CELLS, REL_THEME,
    REL_THREADED_COMMENT, REL_VML_DRAWING, REL_WORKSHEET, RELATIONSHIPS_NS,
};

pub use factories::{
    create_root_rels, create_root_rels_full, create_root_rels_full_with_custom, create_sheet_rels,
    create_workbook_rels,
};
pub use manager::RelationshipManager;
pub use types::Relationship;
