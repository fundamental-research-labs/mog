//! Cross-cutting infrastructure for the xlsx parser.
//! XML scanning, error handling, arena allocation, JSON utilities, and cell reference utilities.

pub mod a1;
pub mod arena;
pub mod error;
pub mod imported_parts;
pub mod json;
pub mod opc;
pub mod opc_inventory;
pub mod package_integrity;
pub mod scanner;
pub mod xml;
pub mod xml_fragment;
pub mod xml_namespaces;
