//! Unit tests for pivot table writer.

use super::types::format_number;
use super::*;
use crate::write::xml_writer::XmlWriter;

// -------------------------------------------------------------------------
// Enum tests
// -------------------------------------------------------------------------

#[test]
fn test_pivot_axis_as_str() {
    assert_eq!(PivotAxis::AxisRow.as_str(), "axisRow");
    assert_eq!(PivotAxis::AxisCol.as_str(), "axisCol");
    assert_eq!(PivotAxis::AxisPage.as_str(), "axisPage");
    assert_eq!(PivotAxis::AxisValues.as_str(), "axisValues");
}

#[test]
fn test_data_field_function_as_str() {
    assert_eq!(DataFieldFunction::Sum.as_str(), "sum");
    assert_eq!(DataFieldFunction::Count.as_str(), "count");
    assert_eq!(DataFieldFunction::Average.as_str(), "average");
    assert_eq!(DataFieldFunction::Max.as_str(), "max");
    assert_eq!(DataFieldFunction::Min.as_str(), "min");
    assert_eq!(DataFieldFunction::Product.as_str(), "product");
    assert_eq!(DataFieldFunction::CountNums.as_str(), "countNums");
    assert_eq!(DataFieldFunction::StdDev.as_str(), "stdDev");
    assert_eq!(DataFieldFunction::StdDevP.as_str(), "stdDevp");
    assert_eq!(DataFieldFunction::Var.as_str(), "var");
    assert_eq!(DataFieldFunction::VarP.as_str(), "varp");
}

#[test]
fn test_pivot_item_type_as_str() {
    assert_eq!(PivotItemType::Data.as_str(), "data");
    assert_eq!(PivotItemType::Default.as_str(), "default");
    assert_eq!(PivotItemType::Sum.as_str(), "sum");
    assert_eq!(PivotItemType::Grand.as_str(), "grand");
    assert_eq!(PivotItemType::Blank.as_str(), "blank");
}

#[test]
fn test_cache_source_type_as_str() {
    assert_eq!(CacheSourceType::Worksheet.as_str(), "worksheet");
    assert_eq!(CacheSourceType::External.as_str(), "external");
    assert_eq!(CacheSourceType::Consolidation.as_str(), "consolidation");
    assert_eq!(CacheSourceType::Scenario.as_str(), "scenario");
}

// -------------------------------------------------------------------------
// SharedItem tests
// -------------------------------------------------------------------------

#[test]
fn test_shared_item_default() {
    let item = SharedItem::default();
    assert!(matches!(item, SharedItem::Missing));
}

#[test]
fn test_shared_item_string_xml() {
    let mut w = XmlWriter::new();
    let item = SharedItem::String("Test".to_string());
    item.write_xml(&mut w);
    let xml = w.finish_string();
    assert_eq!(xml, r#"<s v="Test"/>"#);
}

#[test]
fn test_shared_item_number_xml() {
    let mut w = XmlWriter::new();
    let item = SharedItem::Number(42.5);
    item.write_xml(&mut w);
    let xml = w.finish_string();
    assert_eq!(xml, r#"<n v="42.5"/>"#);
}

#[test]
fn test_shared_item_number_integer_xml() {
    let mut w = XmlWriter::new();
    let item = SharedItem::Number(100.0);
    item.write_xml(&mut w);
    let xml = w.finish_string();
    assert_eq!(xml, r#"<n v="100"/>"#);
}

#[test]
fn test_shared_item_boolean_xml() {
    let mut w = XmlWriter::new();
    let item = SharedItem::Boolean(true);
    item.write_xml(&mut w);
    let xml = w.finish_string();
    assert_eq!(xml, r#"<b v="1"/>"#);
}

#[test]
fn test_shared_item_error_xml() {
    let mut w = XmlWriter::new();
    let item = SharedItem::Error("#N/A".to_string());
    item.write_xml(&mut w);
    let xml = w.finish_string();
    assert!(xml.contains("<e v=\"#N/A\"/>"));
}

#[test]
fn test_shared_item_missing_xml() {
    let mut w = XmlWriter::new();
    let item = SharedItem::Missing;
    item.write_xml(&mut w);
    let xml = w.finish_string();
    assert_eq!(xml, r#"<m/>"#);
}

// -------------------------------------------------------------------------
// PivotFieldItem tests
// -------------------------------------------------------------------------

#[test]
fn test_pivot_field_item_data() {
    let item = PivotFieldItem::data(0);
    assert_eq!(item.item_type, PivotItemType::Data);
    assert_eq!(item.value, Some(0));
    assert!(!item.hidden);
}

#[test]
fn test_pivot_field_item_default() {
    let item = PivotFieldItem::default_item();
    assert_eq!(item.item_type, PivotItemType::Default);
    assert!(item.value.is_none());
}

#[test]
fn test_pivot_field_item_grand() {
    let item = PivotFieldItem::grand();
    assert_eq!(item.item_type, PivotItemType::Grand);
}

#[test]
fn test_pivot_field_item_xml() {
    let mut w = XmlWriter::new();
    let item = PivotFieldItem::data(2);
    item.write_xml(&mut w);
    let xml = w.finish_string();
    assert_eq!(xml, r#"<item x="2"/>"#);
}

#[test]
fn test_pivot_field_item_default_xml() {
    let mut w = XmlWriter::new();
    let item = PivotFieldItem::default_item();
    item.write_xml(&mut w);
    let xml = w.finish_string();
    assert_eq!(xml, r#"<item t="default"/>"#);
}

// -------------------------------------------------------------------------
// DataFieldDef tests
// -------------------------------------------------------------------------

#[test]
fn test_data_field_def_sum() {
    let df = DataFieldDef::sum("Sum of Sales", 2);
    assert_eq!(df.name, "Sum of Sales");
    assert_eq!(df.field_index, 2);
    assert_eq!(df.function, DataFieldFunction::Sum);
}

#[test]
fn test_data_field_def_count() {
    let df = DataFieldDef::count("Count of Items", 3);
    assert_eq!(df.name, "Count of Items");
    assert_eq!(df.field_index, 3);
    assert_eq!(df.function, DataFieldFunction::Count);
}

#[test]
fn test_data_field_def_xml() {
    let mut w = XmlWriter::new();
    let df = DataFieldDef::sum("Sum of Sales", 2);
    df.write_xml(&mut w);
    let xml = w.finish_string();
    assert!(xml.contains(r#"name="Sum of Sales""#));
    assert!(xml.contains(r#"fld="2""#));
    assert!(xml.contains(r#"subtotal="sum""#));
}

// -------------------------------------------------------------------------
// CacheFieldDef tests
// -------------------------------------------------------------------------

#[test]
fn test_cache_field_def_new() {
    let field = CacheFieldDef::new("Category");
    assert_eq!(field.name, "Category");
    assert!(field.shared_items.is_empty());
}

#[test]
fn test_cache_field_def_with_strings_xml() {
    let mut w = XmlWriter::new();
    let mut field = CacheFieldDef::new("Category");
    field.shared_items = vec![
        SharedItem::String("Electronics".to_string()),
        SharedItem::String("Clothing".to_string()),
        SharedItem::String("Food".to_string()),
    ];
    field.write_xml(&mut w);
    let xml = w.finish_string();

    assert!(xml.contains(r#"name="Category""#));
    assert!(xml.contains(r#"<sharedItems count="3">"#));
    assert!(xml.contains(r#"<s v="Electronics"/>"#));
    assert!(xml.contains(r#"<s v="Clothing"/>"#));
    assert!(xml.contains(r#"<s v="Food"/>"#));
}

#[test]
fn test_cache_field_def_with_numbers_xml() {
    let mut w = XmlWriter::new();
    let mut field = CacheFieldDef::new("Amount");
    field.shared_items = vec![
        SharedItem::Number(100.0),
        SharedItem::Number(200.0),
        SharedItem::Number(300.0),
    ];
    field.write_xml(&mut w);
    let xml = w.finish_string();

    assert!(xml.contains(r#"name="Amount""#));
    assert!(xml.contains(r#"containsNumber="1""#));
    assert!(xml.contains(r#"containsInteger="1""#));
    assert!(xml.contains(r#"minValue="100""#));
    assert!(xml.contains(r#"maxValue="300""#));
}

// -------------------------------------------------------------------------
// CacheSource tests
// -------------------------------------------------------------------------

#[test]
fn test_cache_source_worksheet() {
    let source = CacheSource::worksheet("Data", "A1:D100");
    assert_eq!(source.source_type, CacheSourceType::Worksheet);
    let ws = source.worksheet_source.as_ref().unwrap();
    assert_eq!(ws.sheet_name, Some("Data".to_string()));
    assert_eq!(ws.range_ref, "A1:D100");
}

#[test]
fn test_cache_source_xml() {
    let mut w = XmlWriter::new();
    let source = CacheSource::worksheet("Data", "A1:D100");
    source.write_xml(&mut w);
    let xml = w.finish_string();

    assert!(xml.contains(r#"<cacheSource type="worksheet">"#));
    assert!(xml.contains(r#"<worksheetSource ref="A1:D100" sheet="Data"/>"#));
}

// -------------------------------------------------------------------------
// PivotLocation tests
// -------------------------------------------------------------------------

#[test]
fn test_pivot_location_new() {
    let loc = PivotLocation::new("A3:D10");
    assert_eq!(loc.ref_range, "A3:D10");
    assert_eq!(loc.first_header_row, 1);
    assert_eq!(loc.first_data_row, 2);
    assert_eq!(loc.first_data_col, 1);
}

#[test]
fn test_pivot_location_xml() {
    let mut w = XmlWriter::new();
    let loc = PivotLocation::new("A3:D10");
    loc.write_xml(&mut w);
    let xml = w.finish_string();

    assert!(xml.contains(r#"ref="A3:D10""#));
    assert!(xml.contains(r#"firstHeaderRow="1""#));
    assert!(xml.contains(r#"firstDataRow="2""#));
    assert!(xml.contains(r#"firstDataCol="1""#));
}

// -------------------------------------------------------------------------
// PivotStyle tests
// -------------------------------------------------------------------------

#[test]
fn test_pivot_style_default() {
    let style = PivotStyle::default();
    assert_eq!(style.name, "PivotStyleMedium9");
    assert!(style.show_row_headers);
    assert!(style.show_col_headers);
    assert!(!style.show_row_stripes);
    assert!(!style.show_col_stripes);
}

#[test]
fn test_pivot_style_xml() {
    let mut w = XmlWriter::new();
    let style = PivotStyle::new("PivotStyleLight16");
    style.write_xml(&mut w);
    let xml = w.finish_string();

    assert!(xml.contains(r#"name="PivotStyleLight16""#));
    assert!(xml.contains(r#"showRowHeaders="1""#));
    assert!(xml.contains(r#"showColHeaders="1""#));
}

// -------------------------------------------------------------------------
// PivotCacheWriter tests
// -------------------------------------------------------------------------

#[test]
fn test_pivot_cache_writer_new() {
    let cache = PivotCacheWriter::new(1);
    assert_eq!(cache.cache_id, 1);
    assert!(cache.fields.is_empty());
}

#[test]
fn test_pivot_cache_writer_set_source() {
    let mut cache = PivotCacheWriter::new(1);
    cache.set_source("Data", "A1:D100");

    let ws = cache.source.worksheet_source.as_ref().unwrap();
    assert_eq!(ws.sheet_name, Some("Data".to_string()));
    assert_eq!(ws.range_ref, "A1:D100");
}

#[test]
fn test_pivot_cache_writer_add_field() {
    let mut cache = PivotCacheWriter::new(1);
    cache.add_field(CacheFieldDef::new("Category"));
    cache.add_field(CacheFieldDef::new("Region"));

    assert_eq!(cache.fields.len(), 2);
    assert_eq!(cache.fields[0].name, "Category");
    assert_eq!(cache.fields[1].name, "Region");
}

#[test]
fn test_pivot_cache_definition_xml() {
    let mut cache = PivotCacheWriter::new(1);
    cache
        .set_source("Data", "A1:D100")
        .set_record_count(100)
        .add_field({
            let mut f = CacheFieldDef::new("Category");
            f.shared_items = vec![
                SharedItem::String("Electronics".to_string()),
                SharedItem::String("Clothing".to_string()),
                SharedItem::String("Food".to_string()),
            ];
            f
        })
        .add_field({
            let mut f = CacheFieldDef::new("Sales");
            f.shared_items = vec![SharedItem::Number(100.0), SharedItem::Number(200.0)];
            f
        });

    let xml = cache.to_definition_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<?xml version=\"1.0\""));
    assert!(xml_str.contains("<pivotCacheDefinition"));
    assert!(xml_str.contains("recordCount=\"100\""));
    assert!(xml_str.contains("<cacheSource type=\"worksheet\">"));
    assert!(xml_str.contains("<worksheetSource ref=\"A1:D100\" sheet=\"Data\"/>"));
    assert!(xml_str.contains("<cacheFields count=\"2\">"));
    assert!(xml_str.contains("name=\"Category\""));
    assert!(xml_str.contains("name=\"Sales\""));
    assert!(xml_str.contains("<s v=\"Electronics\"/>"));
    assert!(xml_str.contains("</pivotCacheDefinition>"));
}

#[test]
fn test_pivot_cache_records_xml() {
    let cache = PivotCacheWriter::new(1);

    let records = vec![
        vec![
            SharedItem::String("Electronics".to_string()),
            SharedItem::Number(100.5),
        ],
        vec![
            SharedItem::String("Clothing".to_string()),
            SharedItem::Number(200.75),
        ],
    ];

    let xml = cache.to_records_xml(&records);
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<?xml version=\"1.0\""));
    assert!(xml_str.contains("<pivotCacheRecords"));
    assert!(xml_str.contains("count=\"2\""));
    assert!(xml_str.contains("<r>"));
    assert!(xml_str.contains("<s v=\"Electronics\"/>"));
    assert!(xml_str.contains("<n v=\"100.5\"/>"));
    assert!(xml_str.contains("</pivotCacheRecords>"));
}

// -------------------------------------------------------------------------
// PivotTableWriter tests
// -------------------------------------------------------------------------

#[test]
fn test_pivot_table_writer_new() {
    let pivot = PivotTableWriter::new("PivotTable1", 1);
    assert_eq!(pivot.name, "PivotTable1");
    assert_eq!(pivot.cache_id, 1);
    assert!(pivot.fields.is_empty());
    assert!(pivot.row_fields.is_empty());
    assert!(pivot.col_fields.is_empty());
    assert!(pivot.data_fields.is_empty());
}

#[test]
fn test_pivot_table_writer_set_location() {
    let mut pivot = PivotTableWriter::new("PivotTable1", 1);
    pivot.set_location(PivotLocation::new("A3:C10"));

    assert_eq!(pivot.location.ref_range, "A3:C10");
}

#[test]
fn test_pivot_table_writer_add_fields() {
    let mut pivot = PivotTableWriter::new("PivotTable1", 1);
    pivot
        .add_row_field(0)
        .add_col_field(1)
        .add_page_field(2)
        .add_data_field(DataFieldDef::sum("Sum of Sales", 3));

    assert_eq!(pivot.row_fields, vec![0]);
    assert_eq!(pivot.col_fields, vec![1]);
    assert_eq!(
        pivot.page_fields,
        vec![PageFieldDef {
            field_index: 2,
            ..Default::default()
        }]
    );
    assert_eq!(pivot.data_fields.len(), 1);
}

#[test]
fn test_pivot_table_xml_basic() {
    let mut pivot = PivotTableWriter::new("PivotTable1", 1);
    pivot
        .set_location(PivotLocation::new("A3:C10"))
        .add_field(PivotFieldDef {
            axis: Some(PivotAxis::AxisRow),
            show_all: Some(false),
            items: vec![
                PivotFieldItem::data(0),
                PivotFieldItem::data(1),
                PivotFieldItem::data(2),
                PivotFieldItem::default_item(),
            ],
            ..Default::default()
        })
        .add_field(PivotFieldDef {
            data_field: true,
            show_all: Some(false),
            ..Default::default()
        })
        .add_row_field(0)
        .add_data_field(DataFieldDef::sum("Sum of Sales", 1))
        .set_style(PivotStyle::default());

    let xml = pivot.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<?xml version=\"1.0\""));
    assert!(xml_str.contains("<pivotTableDefinition"));
    assert!(xml_str.contains("name=\"PivotTable1\""));
    assert!(xml_str.contains("cacheId=\"1\""));
    assert!(xml_str.contains("<location ref=\"A3:C10\""));
    assert!(xml_str.contains("<pivotFields count=\"2\">"));
    assert!(xml_str.contains("axis=\"axisRow\""));
    assert!(xml_str.contains("<rowFields count=\"1\">"));
    assert!(xml_str.contains("<dataFields count=\"1\">"));
    assert!(xml_str.contains("name=\"Sum of Sales\""));
    assert!(xml_str.contains("subtotal=\"sum\""));
    assert!(xml_str.contains("<pivotTableStyleInfo"));
    assert!(xml_str.contains("</pivotTableDefinition>"));
}

#[test]
fn test_pivot_table_xml_with_row_col_items() {
    let mut pivot = PivotTableWriter::new("PivotTable1", 1);
    pivot
        .set_location(PivotLocation::new("A3:D10"))
        .add_field(PivotFieldDef {
            axis: Some(PivotAxis::AxisRow),
            show_all: Some(false),
            items: vec![
                PivotFieldItem::data(0),
                PivotFieldItem::data(1),
                PivotFieldItem::default_item(),
            ],
            ..Default::default()
        })
        .add_field(PivotFieldDef {
            axis: Some(PivotAxis::AxisCol),
            show_all: Some(false),
            items: vec![
                PivotFieldItem::data(0),
                PivotFieldItem::data(1),
                PivotFieldItem::default_item(),
            ],
            ..Default::default()
        })
        .add_row_field(0)
        .add_col_field(1)
        .add_row_item(RowColItem::data(vec![Some(0)]))
        .add_row_item(RowColItem::data(vec![Some(1)]))
        .add_row_item(RowColItem::grand())
        .add_col_item(RowColItem::data(vec![Some(0)]))
        .add_col_item(RowColItem::data(vec![Some(1)]))
        .add_col_item(RowColItem::grand());

    let xml = pivot.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<rowFields count=\"1\">"));
    assert!(xml_str.contains("<rowItems count=\"3\">"));
    assert!(xml_str.contains("<colFields count=\"1\">"));
    assert!(xml_str.contains("<colItems count=\"3\">"));
    assert!(xml_str.contains("<i t=\"grand\">"));
}

#[test]
fn test_pivot_table_xml_with_page_fields() {
    let mut pivot = PivotTableWriter::new("PivotTable1", 1);
    pivot
        .set_location(PivotLocation::new("A5:C10"))
        .add_page_field(0)
        .add_page_field(1);

    let xml = pivot.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<pageFields count=\"2\">"));
    assert!(xml_str.contains("<pageField fld=\"0\"/>"));
    assert!(xml_str.contains("<pageField fld=\"1\"/>"));
}

// -------------------------------------------------------------------------
// RowColItem tests
// -------------------------------------------------------------------------

#[test]
fn test_row_col_item_data() {
    let item = RowColItem::data(vec![Some(0), Some(1)]);
    assert!(item.item_type.is_none());
    assert_eq!(item.x_values.len(), 2);
}

#[test]
fn test_row_col_item_grand() {
    let item = RowColItem::grand();
    assert_eq!(item.item_type, Some(PivotItemType::Grand));
}

#[test]
fn test_row_col_item_xml() {
    let mut w = XmlWriter::new();
    let item = RowColItem::data(vec![Some(1)]);
    item.write_xml(&mut w);
    let xml = w.finish_string();
    assert!(xml.contains("<i>"));
    assert!(xml.contains("<x v=\"1\"/>"));
    assert!(xml.contains("</i>"));
}

#[test]
fn test_row_col_item_xml_preserves_middle_blank_refs() {
    let mut w = XmlWriter::new();
    let item = RowColItem::data(vec![Some(3), None, Some(75)]);
    item.write_xml(&mut w);
    let xml = w.finish_string();

    assert_eq!(xml, r#"<i><x v="3"/><x/><x v="75"/></i>"#);
}

#[test]
fn test_row_col_item_grand_xml() {
    let mut w = XmlWriter::new();
    let item = RowColItem::grand();
    item.write_xml(&mut w);
    let xml = w.finish_string();
    assert!(xml.contains("<i t=\"grand\">"));
    assert!(xml.contains("<x/>"));
}

// -------------------------------------------------------------------------
// PivotFieldDef tests
// -------------------------------------------------------------------------

#[test]
fn test_pivot_field_def_default() {
    let field = PivotFieldDef::default();
    assert!(field.name.is_none());
    assert!(field.axis.is_none());
    assert!(!field.data_field);
    assert!(!field.compact);
    assert!(!field.outline);
    assert_eq!(field.show_all, None);
}

#[test]
fn test_pivot_field_def_xml_empty() {
    let mut w = XmlWriter::new();
    let field = PivotFieldDef {
        show_all: Some(false),
        ..Default::default()
    };
    field.write_xml(&mut w);
    let xml = w.finish_string();
    assert!(xml.contains("<pivotField"));
    assert!(xml.contains("showAll=\"0\""));
    assert!(xml.contains("/>"));
}

#[test]
fn test_pivot_field_def_xml_with_items() {
    let mut w = XmlWriter::new();
    let field = PivotFieldDef {
        axis: Some(PivotAxis::AxisRow),
        show_all: Some(false),
        items: vec![PivotFieldItem::data(0), PivotFieldItem::default_item()],
        ..Default::default()
    };
    field.write_xml(&mut w);
    let xml = w.finish_string();
    assert!(xml.contains("axis=\"axisRow\""));
    assert!(xml.contains("<items count=\"2\">"));
    assert!(xml.contains("<item x=\"0\"/>"));
    assert!(xml.contains("<item t=\"default\"/>"));
    assert!(xml.contains("</pivotField>"));
}

#[test]
fn test_pivot_field_def_xml_with_subtotals() {
    let mut w = XmlWriter::new();
    let field = PivotFieldDef {
        axis: Some(PivotAxis::AxisRow),
        show_all: Some(false),
        subtotals: vec![DataFieldFunction::Sum, DataFieldFunction::Average],
        ..Default::default()
    };
    field.write_xml(&mut w);
    let xml = w.finish_string();
    assert!(xml.contains("sumSubtotal=\"1\""));
    assert!(xml.contains("avgSubtotal=\"1\""));
}

// -------------------------------------------------------------------------
// Helper function tests
// -------------------------------------------------------------------------

#[test]
fn test_format_number() {
    assert_eq!(format_number(42.0), "42");
    assert_eq!(format_number(42.5), "42.5");
    assert_eq!(format_number(-100.0), "-100");
    assert_eq!(format_number(0.0), "0");
}
