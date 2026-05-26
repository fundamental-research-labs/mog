//! Cross-cutting infrastructure for the xlsx parser.
//! XML scanning, error handling, arena allocation, JSON utilities, and cell reference utilities.

pub mod a1;
pub mod arena;
pub mod error;
pub mod json;
pub mod opc;
pub mod package_integrity;
pub mod scanner;
pub mod xml;
