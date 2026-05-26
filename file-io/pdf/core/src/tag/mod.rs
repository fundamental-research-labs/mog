//! Tagged PDF structure tree.
//!
//! Provides structure elements (StructElem) and ParentTree for accessible PDFs.
//! Used to generate PDF/UA-compatible tagged PDF documents with table structures,
//! figures with alt text, and proper reading order.

pub mod parent_tree;
pub mod structure;
