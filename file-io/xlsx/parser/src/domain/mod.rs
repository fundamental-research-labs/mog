//! Domain modules for all OOXML features.
//!
//! Each domain owns its types, read logic, write logic, and tests.
//! This replaces the old split across `read/` + root-level + `write/`.

pub mod auto_filter;
pub mod calc;
pub mod cells;
pub mod charts;
pub mod comments;
pub mod cond_format;
pub mod connections;
pub mod content_types;
pub mod controls;
pub mod drawings;
pub mod external;
pub mod feature_property_bags;
pub mod hyperlinks;
pub mod metadata;
pub mod names;
pub mod pivot;
pub mod print;
pub mod protection;
pub mod rich_text;
pub mod slicers;
pub mod sparklines;
pub mod strings;
pub mod styles;
pub mod tables;
pub mod themes;
pub mod timelines;
pub mod validation;
pub mod vba;
pub mod web_extensions;
pub mod workbook;
pub mod worksheet;
