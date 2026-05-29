//! Conversion from parsed (read) pivot types to write types.
//!
//! These functions bridge the gap between `domain::pivot::read` types
//! (which capture everything parsed from XLSX) and `domain::pivot::write` types
//! (which drive XML generation).

use super::cache_writer::PivotCacheWriter;
use super::table_writer::PivotTableWriter;
use super::types::*;
use crate::domain::pivot::read;

// ============================================================================
// PivotTable (read) → PivotTableWriter (write)
// ============================================================================

/// Convert a parsed `PivotTable` into a `PivotTableWriter` ready for XML generation.
pub fn pivot_table_to_writer(pt: &read::PivotTable) -> PivotTableWriter {
    let mut writer = PivotTableWriter::new(&pt.name, pt.cache_id);

    // Location
    //
    // Typed range refs: `pt.location.ref_` is typed
    // (`Option<compute_parser::ast::RangeRef>`); the write-side `PivotLocation`
    // still carries `ref_range: String`, so canonicalize here via
    // `RangeRef::to_a1_string`. Absent typed ref → empty string (matching the
    // prior String-field "absent" behaviour).
    writer.set_location(PivotLocation {
        ref_range: pt
            .location
            .ref_
            .as_ref()
            .map(|r| r.to_a1_string())
            .unwrap_or_default(),
        first_header_row: pt.location.first_header_row,
        first_data_row: pt.location.first_data_row,
        first_data_col: pt.location.first_data_col,
        rows_per_page: if pt.location.rows_per_page > 0 {
            Some(pt.location.rows_per_page)
        } else {
            None
        },
        cols_per_page: if pt.location.cols_per_page > 0 {
            Some(pt.location.cols_per_page)
        } else {
            None
        },
    });

    writer.data_on_rows = pt.data_on_rows;
    writer.grand_total_caption = pt.grand_total_caption.clone();
    writer.row_header_caption = pt.row_header_caption.clone();
    writer.col_header_caption = pt.col_header_caption.clone();
    writer.row_grand_totals = pt.row_grand_totals;
    writer.col_grand_totals = pt.col_grand_totals;
    writer.grid_drop_zones = pt.grid_drop_zones;
    writer.error_caption = pt.error_caption.clone();
    writer.show_error = pt.show_error;
    writer.missing_caption = pt.missing_caption.clone();
    writer.show_missing = pt.show_missing;

    // Pivot fields
    for field in &pt.pivot_fields {
        writer.add_field(convert_pivot_field(field));
    }

    // Row fields
    for rf in &pt.row_fields {
        writer.row_fields.push(rf.x);
    }

    // Column fields
    for cf in &pt.col_fields {
        writer.col_fields.push(cf.x);
    }

    // Page fields
    for pf in &pt.page_fields {
        writer.add_page_field_def(convert_page_field(pf));
    }

    // Data fields
    for df in &pt.data_fields {
        writer.add_data_field(convert_data_field(df));
    }

    // Style
    if let Some(ref style) = pt.style_info {
        writer.set_style(PivotStyle {
            name: style
                .name
                .clone()
                .unwrap_or_else(|| "PivotStyleMedium9".to_string()),
            show_row_headers: style.show_row_headers,
            show_col_headers: style.show_col_headers,
            show_row_stripes: style.show_row_stripes,
            show_col_stripes: style.show_col_stripes,
            show_last_column: style.show_last_column,
        });
    }

    writer
}

fn convert_pivot_field(f: &read::PivotField) -> PivotFieldDef {
    PivotFieldDef {
        name: f.name.clone(),
        axis: f.axis.map(convert_axis),
        data_field: f.data_field,
        compact: f.compact,
        outline: f.outline,
        show_all: f.show_all,
        sort_type: f.sort_type.map(|st| match st {
            read::SortType::Manual => "manual".to_string(),
            read::SortType::Ascending => "ascending".to_string(),
            read::SortType::Descending => "descending".to_string(),
        }),
        auto_sort_data_field: f.auto_sort_data_field,
        subtotal_top: f.subtotal_top,
        default_subtotal: f.default_subtotal,
        subtotals: f.subtotals.iter().map(|s| convert_subtotal(*s)).collect(),
        items: f.items.iter().map(convert_pivot_item).collect(),
        preserved_attributes: Vec::new(),
        preserved_children: Vec::new(),
    }
}

fn convert_axis(a: read::PivotAxis) -> PivotAxis {
    match a {
        read::PivotAxis::Row => PivotAxis::AxisRow,
        read::PivotAxis::Col => PivotAxis::AxisCol,
        read::PivotAxis::Page => PivotAxis::AxisPage,
        read::PivotAxis::Values => PivotAxis::AxisValues,
    }
}

fn convert_pivot_item(item: &read::PivotItem) -> PivotFieldItem {
    PivotFieldItem {
        item_type: convert_item_type(item.item_type),
        value: item.x,
        hidden: item.hidden,
        show_details: item.show_details,
        s: item.s.clone(),
        preserved_attributes: Vec::new(),
    }
}

fn convert_item_type(t: read::PivotItemType) -> PivotItemType {
    match t {
        read::PivotItemType::Data => PivotItemType::Data,
        read::PivotItemType::Default => PivotItemType::Default,
        read::PivotItemType::Sum => PivotItemType::Sum,
        read::PivotItemType::CountA => PivotItemType::CountA,
        read::PivotItemType::Avg => PivotItemType::Avg,
        read::PivotItemType::Max => PivotItemType::Max,
        read::PivotItemType::Min => PivotItemType::Min,
        read::PivotItemType::Product => PivotItemType::Product,
        read::PivotItemType::Count => PivotItemType::Count,
        read::PivotItemType::Stddev => PivotItemType::StdDev,
        read::PivotItemType::StddevP => PivotItemType::StdDevP,
        read::PivotItemType::Var => PivotItemType::Var,
        read::PivotItemType::VarP => PivotItemType::VarP,
        read::PivotItemType::Grand => PivotItemType::Grand,
        read::PivotItemType::Blank => PivotItemType::Blank,
    }
}

fn convert_page_field(pf: &read::PageField) -> PageFieldDef {
    PageFieldDef {
        field_index: pf.field_index,
        item: pf.item,
        hierarchy: pf.hierarchy,
        name: pf.name.clone(),
        caption: pf.caption.clone(),
    }
}

fn convert_data_field(df: &read::DataField) -> DataFieldDef {
    DataFieldDef {
        name: df.name.clone().unwrap_or_default(),
        field_index: df.field_index,
        function: convert_subtotal(df.subtotal),
        number_format: None,
        num_fmt_id: df.num_fmt_id,
        base_field: df.base_field,
        base_item: df.base_item,
        show_data_as: df.show_data_as.clone(),
    }
}

fn convert_subtotal(s: read::Subtotal) -> DataFieldFunction {
    match s {
        read::Subtotal::Sum => DataFieldFunction::Sum,
        read::Subtotal::Count => DataFieldFunction::Count,
        read::Subtotal::Average => DataFieldFunction::Average,
        read::Subtotal::Max => DataFieldFunction::Max,
        read::Subtotal::Min => DataFieldFunction::Min,
        read::Subtotal::Product => DataFieldFunction::Product,
        read::Subtotal::CountNums => DataFieldFunction::CountNums,
        read::Subtotal::StdDev => DataFieldFunction::StdDev,
        read::Subtotal::StdDevP => DataFieldFunction::StdDevP,
        read::Subtotal::Var => DataFieldFunction::Var,
        read::Subtotal::VarP => DataFieldFunction::VarP,
    }
}

// ============================================================================
// PivotCache (read) → PivotCacheWriter (write)
// ============================================================================

/// Convert a parsed `PivotCache` into a `PivotCacheWriter` ready for XML generation.
pub fn pivot_cache_to_writer(cache: &read::PivotCache) -> PivotCacheWriter {
    let mut writer = PivotCacheWriter::new(cache.id);

    // Source
    let source_type = match cache.source_type {
        read::CacheSourceType::Worksheet => CacheSourceType::Worksheet,
        read::CacheSourceType::External => CacheSourceType::External,
        read::CacheSourceType::Consolidation => CacheSourceType::Consolidation,
        read::CacheSourceType::Scenario => CacheSourceType::Scenario,
    };

    writer.source = CacheSource {
        source_type,
        worksheet_source: if cache.source_ref.is_some()
            || cache.source_sheet.is_some()
            || cache.source_name.is_some()
            || cache.source_r_id.is_some()
        {
            Some(WorksheetSource {
                sheet_name: cache.source_sheet.clone(),
                source_name: cache.source_name.clone(),
                range_ref: cache.source_ref.clone().unwrap_or_default(),
                r_id: cache.source_r_id.clone(),
            })
        } else {
            None
        },
    };

    // Fields
    for field in &cache.fields {
        writer.add_field(convert_cache_field(field));
    }

    // Record count
    writer.record_count = cache.record_count;

    writer
}

fn convert_cache_field(f: &read::CacheField) -> CacheFieldDef {
    CacheFieldDef {
        name: f.name.clone(),
        shared_items: f.shared_items.iter().map(convert_shared_item).collect(),
        number_format: None,
        num_fmt_id: f.num_fmt_id,
        sql_type: f.sql_type,
        caption: f.caption.clone(),
    }
}

fn convert_shared_item(item: &read::SharedItem) -> SharedItem {
    match item {
        read::SharedItem::String(s) => SharedItem::String(s.clone()),
        read::SharedItem::Number(n) => SharedItem::Number(*n),
        read::SharedItem::Boolean(b) => SharedItem::Boolean(*b),
        read::SharedItem::Error(e) => SharedItem::Error(e.clone()),
        read::SharedItem::DateTime(d) => SharedItem::DateTime(d.clone()),
        read::SharedItem::Missing => SharedItem::Missing,
    }
}

/// Convert read CacheRecords to the format expected by `PivotCacheWriter::to_records_xml()`.
///
/// The writer expects `Vec<Vec<SharedItem>>` where each inner Vec is one record's values.
pub fn cache_records_to_write_format(records: &[read::CacheRecord]) -> Vec<Vec<SharedItem>> {
    records
        .iter()
        .map(|record| {
            record
                .values
                .iter()
                .map(|v| match v {
                    read::CacheRecordValue::Index(i) => SharedItem::Index(*i),
                    read::CacheRecordValue::Number(n) => SharedItem::Number(*n),
                    read::CacheRecordValue::String(s) => SharedItem::String(s.clone()),
                    read::CacheRecordValue::Boolean(b) => SharedItem::Boolean(*b),
                    read::CacheRecordValue::Error(e) => SharedItem::Error(e.clone()),
                    read::CacheRecordValue::DateTime(d) => SharedItem::DateTime(d.clone()),
                    read::CacheRecordValue::Missing => SharedItem::Missing,
                })
                .collect()
        })
        .collect()
}

// ============================================================================
// domain_types::PivotTableDef → PivotTableWriter
// ============================================================================

/// Convert a `domain_types::PivotTableDef` into a `PivotTableWriter` ready for XML generation.
pub fn pivot_table_def_to_writer(
    name: &str,
    cache_id: u32,
    def: &domain_types::PivotTableDef,
) -> PivotTableWriter {
    let mut writer = PivotTableWriter::new(name, cache_id);

    writer.set_location(PivotLocation {
        ref_range: def.location.ref_range.clone(),
        first_header_row: def.location.first_header_row,
        first_data_row: def.location.first_data_row,
        first_data_col: def.location.first_data_col,
        rows_per_page: def.location.rows_per_page,
        cols_per_page: def.location.cols_per_page,
    });

    writer.data_on_rows = def.data_on_rows;
    writer.grand_total_caption = def.grand_total_caption.clone();
    writer.row_header_caption = def.row_header_caption.clone();
    writer.col_header_caption = def.col_header_caption.clone();
    writer.row_grand_totals = def.row_grand_totals;
    writer.col_grand_totals = def.col_grand_totals;
    writer.grid_drop_zones = def.grid_drop_zones;
    writer.error_caption = def.error_caption.clone();
    writer.show_error = def.show_error;
    writer.missing_caption = def.missing_caption.clone();
    writer.show_missing = def.show_missing;
    writer.ooxml_preservation = def.ooxml_preservation.clone();

    for (idx, f) in def.fields.iter().enumerate() {
        let mut field = convert_domain_field(f);
        if let Some(preserved) = def.ooxml_preservation.fields.get(idx) {
            field.preserved_attributes = preserved.attributes.clone();
            field.preserved_children = preserved.children.clone();
            for (item_idx, item) in field.items.iter_mut().enumerate() {
                if let Some(attrs) = preserved.item_attributes.get(item_idx) {
                    item.preserved_attributes = attrs.clone();
                }
            }
        }
        writer.add_field(field);
    }

    writer.row_fields = def.row_fields.clone();
    writer.col_fields = def.col_fields.clone();

    for pf in &def.page_fields {
        writer.add_page_field_def(PageFieldDef {
            field_index: pf.field_index,
            item: pf.item,
            hierarchy: pf.hierarchy,
            name: pf.name.clone(),
            caption: pf.caption.clone(),
        });
    }

    for df in &def.data_fields {
        writer.add_data_field(DataFieldDef {
            name: df.name.clone(),
            field_index: df.field_index,
            function: convert_domain_function(df.function),
            number_format: None,
            num_fmt_id: df.num_fmt_id,
            base_field: df.base_field,
            base_item: df.base_item,
            show_data_as: df.show_data_as.clone(),
        });
    }

    // Row items / column items
    for (idx, ri) in def.row_items.iter().enumerate() {
        let mut item = convert_domain_row_col_item(ri);
        if let Some(attrs) = def.ooxml_preservation.row_item_attributes.get(idx) {
            item.preserved_attributes = attrs.clone();
        }
        writer.add_row_item(item);
    }
    for (idx, ci) in def.col_items.iter().enumerate() {
        let mut item = convert_domain_row_col_item(ci);
        if let Some(attrs) = def.ooxml_preservation.col_item_attributes.get(idx) {
            item.preserved_attributes = attrs.clone();
        }
        writer.add_col_item(item);
    }

    // Data caption
    if !def.data_caption.is_empty() {
        writer.set_data_caption(&def.data_caption);
    }

    if let Some(ref s) = def.style {
        writer.set_style(PivotStyle {
            name: s.name.clone(),
            show_row_headers: s.show_row_headers,
            show_col_headers: s.show_col_headers,
            show_row_stripes: s.show_row_stripes,
            show_col_stripes: s.show_col_stripes,
            show_last_column: s.show_last_column,
        });
    }

    writer
}

fn convert_domain_field(f: &domain_types::PivotFieldDef) -> PivotFieldDef {
    PivotFieldDef {
        name: f.name.clone(),
        axis: f.axis.map(|a| match a {
            domain_types::PivotAxis::Row => PivotAxis::AxisRow,
            domain_types::PivotAxis::Col => PivotAxis::AxisCol,
            domain_types::PivotAxis::Page => PivotAxis::AxisPage,
            domain_types::PivotAxis::Values => PivotAxis::AxisValues,
        }),
        data_field: f.data_field,
        compact: f.compact,
        outline: f.outline,
        show_all: f.show_all,
        sort_type: f.sort_type.clone(),
        auto_sort_data_field: f.auto_sort_data_field,
        subtotal_top: f.subtotal_top,
        default_subtotal: f.default_subtotal,
        subtotals: f
            .subtotals
            .iter()
            .map(|s| convert_domain_function(*s))
            .collect(),
        items: f
            .items
            .iter()
            .map(|item| PivotFieldItem {
                item_type: convert_domain_item_type(item.item_type),
                value: item.value,
                hidden: item.hidden,
                show_details: item.show_details,
                s: item.s.clone(),
                preserved_attributes: Vec::new(),
            })
            .collect(),
        preserved_attributes: Vec::new(),
        preserved_children: Vec::new(),
    }
}

fn convert_domain_function(f: domain_types::PivotFieldFunction) -> DataFieldFunction {
    match f {
        domain_types::PivotFieldFunction::Sum => DataFieldFunction::Sum,
        domain_types::PivotFieldFunction::Count => DataFieldFunction::Count,
        domain_types::PivotFieldFunction::Average => DataFieldFunction::Average,
        domain_types::PivotFieldFunction::Max => DataFieldFunction::Max,
        domain_types::PivotFieldFunction::Min => DataFieldFunction::Min,
        domain_types::PivotFieldFunction::Product => DataFieldFunction::Product,
        domain_types::PivotFieldFunction::CountNums => DataFieldFunction::CountNums,
        domain_types::PivotFieldFunction::StdDev => DataFieldFunction::StdDev,
        domain_types::PivotFieldFunction::StdDevP => DataFieldFunction::StdDevP,
        domain_types::PivotFieldFunction::Var => DataFieldFunction::Var,
        domain_types::PivotFieldFunction::VarP => DataFieldFunction::VarP,
    }
}

fn convert_domain_row_col_item(item: &domain_types::PivotRowColItem) -> RowColItem {
    RowColItem {
        item_type: item.item_type.map(convert_domain_item_type),
        x_values: item.x_values.clone(),
        preserved_attributes: Vec::new(),
    }
}

fn convert_domain_item_type(t: domain_types::PivotItemType) -> PivotItemType {
    match t {
        domain_types::PivotItemType::Data => PivotItemType::Data,
        domain_types::PivotItemType::Default => PivotItemType::Default,
        domain_types::PivotItemType::Sum => PivotItemType::Sum,
        domain_types::PivotItemType::CountA => PivotItemType::CountA,
        domain_types::PivotItemType::Avg => PivotItemType::Avg,
        domain_types::PivotItemType::Max => PivotItemType::Max,
        domain_types::PivotItemType::Min => PivotItemType::Min,
        domain_types::PivotItemType::Product => PivotItemType::Product,
        domain_types::PivotItemType::Count => PivotItemType::Count,
        domain_types::PivotItemType::StdDev => PivotItemType::StdDev,
        domain_types::PivotItemType::StdDevP => PivotItemType::StdDevP,
        domain_types::PivotItemType::Var => PivotItemType::Var,
        domain_types::PivotItemType::VarP => PivotItemType::VarP,
        domain_types::PivotItemType::Grand => PivotItemType::Grand,
        domain_types::PivotItemType::Blank => PivotItemType::Blank,
    }
}
