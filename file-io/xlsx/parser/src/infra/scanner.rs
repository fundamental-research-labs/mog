//! Optimized XML byte scanner for high-performance parsing.
//!
//! This module provides fast byte scanning functions optimized for XML parsing,
//! using safe `memchr` search primitives where available with scalar fallbacks
//! for multi-byte predicates.
//!
//! Target throughput: ~1 GB/s for finding XML delimiters.
//!
//! # Usage
//!
//! There are two ways to use this module:
//!
//! 1. **Free functions** - For one-off searches:
//!    ```ignore
//!    use xlsx_parser::infra::scanner::{find_lt_simd, find_tag_simd};
//!
//!    let xml = b"<worksheet><sheetData>";
//!    let pos = find_lt_simd(xml, 0);
//!    ```
//!
//! 2. **XmlScanner struct** - For stateful parsing with position tracking:
//!    ```ignore
//!    use xlsx_parser::infra::scanner::XmlScanner;
//!
//!    let xml = b"<worksheet><sheetData>";
//!    let mut scanner = XmlScanner::new(xml);
//!    let tag_pos = scanner.find_tag(b"sheetData");
//!    ```

mod attributes;
mod cursor;
mod name;
mod primitives;
mod tags;

pub use attributes::{extract_quoted_value, find_attr_simd, matches_at};
pub use cursor::XmlScanner;
pub use primitives::{find_any_simd, find_gt_simd, find_lt_simd, skip_whitespace_simd};
pub use tags::{
    StartTagEnd, find_closing_tag, find_element_end, find_start_tag_end_quoted, find_tag_simd,
};

#[cfg(test)]
mod tests;
