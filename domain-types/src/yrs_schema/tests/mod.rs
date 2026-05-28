//! Aggregate Yrs boundary coverage for active `yrs_schema` adapters.
//!
//! Coverage ledger:
//! - `helpers`: support-only, exercised through adapter tests.
//! - `cell_format`: local-module-test.
//! - `cell_properties`: aggregate-child `cell_properties`.
//! - `comment`: local-module-test plus aggregate-child `comment`.
//! - `doc_properties`: aggregate-child `flat_maps`.
//! - `file_sharing`: aggregate-child `flat_maps`.
//! - `file_version`: aggregate-child `flat_maps`.
//! - `frozen_panes`: aggregate-child `flat_maps`.
//! - `hyperlink`: aggregate-child `flat_maps`.
//! - `merge`: aggregate-child `flat_maps`.
//! - `named_range`: aggregate-child `flat_maps`.
//! - `page_breaks`: aggregate-child `flat_maps`.
//! - `print`: aggregate-child `print`.
//! - `protection`: local-module-test plus aggregate-child `protection`.
//! - `sheet_properties`: local-module-test.
//! - `sheet_view`: aggregate-child `flat_maps`.
//! - `sparkline`: local-module-test.
//! - `web_publishing`: aggregate-child `flat_maps`.
//! - `workbook_properties`: aggregate-child `flat_maps`.
//! - `column_schema`: aggregate-child `cell_properties`.
//! - `conditional_format`: local-module-test.
//! - `pivot_cache_records`: aggregate-child `edge_adapters`.
//! - `table`: aggregate-child `table`.
//! - `validation`: local-module-test plus aggregate-child `validation`.
//! - `filter_sort_state`: aggregate-child `edge_adapters`.
//! - `auto_filter`: local-module-test plus aggregate-child `edge_adapters`.
//! - `sort_state`: local-module-test.
//! - `floating_object`: covered-by-nested-floating-object-suite plus aggregate-child `floating_object`.
//! - `slicer`: aggregate-child `edge_adapters`.
//!
//! Disabled stale inventory:
//! - `outline`: deferred-stale-disabled, production adapter was deleted.
//! - old `chart`, `connector`, `form_control`, `ole_object`, and SmartArt tests:
//!   mapped to the nested `floating_object` suite and the envelope smoke here.
//! - old `pivot` tests: deferred-stale-disabled, not the active
//!   `pivot_cache_records` adapter.

mod cell_properties;
mod comment;
mod edge_adapters;
mod flat_maps;
mod floating_object;
mod print;
mod protection;
mod support;
mod table;
mod validation;
