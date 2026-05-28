//! Round-trip tests for the ParseOutput pipeline (parser-only, no Yrs).
//!
//! Tests the cycle: ParseOutput -> write_xlsx_from_parse_output -> parse_xlsx_to_output -> compare.

#[path = "roundtrip_parse_output/cells.rs"]
mod cells;
#[path = "fixtures.rs"]
mod fixtures;
#[path = "roundtrip_parse_output/helpers.rs"]
mod helpers;
#[path = "roundtrip_parse_output/layout.rs"]
mod layout;
#[path = "roundtrip_parse_output/partial_domains.rs"]
mod partial_domains;
#[path = "roundtrip_parse_output/shared_strings.rs"]
mod shared_strings;
#[path = "roundtrip_parse_output/styles.rs"]
mod styles;
#[path = "roundtrip_parse_output/utf8.rs"]
mod utf8;
#[path = "roundtrip_parse_output/workbook.rs"]
mod workbook;
