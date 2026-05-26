//! Round-trip tests for the ParseOutput pipeline.
//!
//! Tests the full cycle: ParseOutput -> write_xlsx -> parse -> ParseOutput -> compare.
//!
//! This validates that the unified pipeline preserves data through:
//! 1. `write_xlsx_from_parse_output()` (domain-types -> XLSX bytes)
//! 2. `parse_xlsx_to_output()` (XLSX bytes -> ParseOutput)

mod helpers;

mod auto_filter;
mod cell_values;
mod comments;
mod conditional_formats;
mod data_validations;
mod field_independence;
mod hyperlinks;
mod integration;
mod layout;
mod outline_groups;
mod page_breaks;
mod print_settings;
mod sheet_protection;
mod sparklines;
mod styles;
mod tables;
mod theme;
mod workbook_metadata;
