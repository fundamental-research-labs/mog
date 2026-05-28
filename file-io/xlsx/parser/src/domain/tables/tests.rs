//! Unit tests for the tables module.

#[cfg(test)]
mod tests {
    use crate::domain::tables::filter::{
        AutoFilter, ColorFilter, DynamicFilterType, FilterOperator, Filters, IconFilter,
    };
    use crate::domain::tables::sort::SortState;
    use crate::domain::tables::style::parse_table_style_info;
    use crate::domain::tables::types::{
        SortOrder, Table, TableColumn, TableFormula, TableType, TotalsRowFunction,
    };
    use crate::infra::xml::{
        decode_xml_entities, parse_bool_attr_opt, parse_f64_attr, parse_string_attr, parse_u32_attr,
    };
    use ooxml_types::cond_format::IconSetType;

    // -------------------------------------------------------------------------
    // Enum tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_sort_order_from_bytes() {
        assert_eq!(SortOrder::from_bytes(b"ascending"), SortOrder::Ascending);
        assert_eq!(SortOrder::from_bytes(b"descending"), SortOrder::Descending);
        assert_eq!(SortOrder::from_bytes(b"asc"), SortOrder::Ascending);
        assert_eq!(SortOrder::from_bytes(b"desc"), SortOrder::Descending);
        assert_eq!(SortOrder::from_bytes(b"unknown"), SortOrder::None);
    }

    #[test]
    fn test_filter_operator_from_bytes() {
        assert_eq!(FilterOperator::from_bytes(b"equal"), FilterOperator::Equal);
        assert_eq!(
            FilterOperator::from_bytes(b"lessThan"),
            FilterOperator::LessThan
        );
        assert_eq!(
            FilterOperator::from_bytes(b"lessThanOrEqual"),
            FilterOperator::LessThanOrEqual
        );
        assert_eq!(
            FilterOperator::from_bytes(b"notEqual"),
            FilterOperator::NotEqual
        );
        assert_eq!(
            FilterOperator::from_bytes(b"greaterThanOrEqual"),
            FilterOperator::GreaterThanOrEqual
        );
        assert_eq!(
            FilterOperator::from_bytes(b"greaterThan"),
            FilterOperator::GreaterThan
        );
        assert_eq!(
            FilterOperator::from_bytes(b"unknown"),
            FilterOperator::Equal
        );
    }

    #[test]
    fn test_totals_row_function_from_bytes() {
        assert_eq!(
            TotalsRowFunction::from_bytes(b"none"),
            TotalsRowFunction::None
        );
        assert_eq!(
            TotalsRowFunction::from_bytes(b"average"),
            TotalsRowFunction::Average
        );
        assert_eq!(
            TotalsRowFunction::from_bytes(b"count"),
            TotalsRowFunction::Count
        );
        assert_eq!(
            TotalsRowFunction::from_bytes(b"countNums"),
            TotalsRowFunction::CountNums
        );
        assert_eq!(
            TotalsRowFunction::from_bytes(b"max"),
            TotalsRowFunction::Max
        );
        assert_eq!(
            TotalsRowFunction::from_bytes(b"min"),
            TotalsRowFunction::Min
        );
        assert_eq!(
            TotalsRowFunction::from_bytes(b"stdDev"),
            TotalsRowFunction::StdDev
        );
        assert_eq!(
            TotalsRowFunction::from_bytes(b"sum"),
            TotalsRowFunction::Sum
        );
        assert_eq!(
            TotalsRowFunction::from_bytes(b"var"),
            TotalsRowFunction::Var
        );
        assert_eq!(
            TotalsRowFunction::from_bytes(b"custom"),
            TotalsRowFunction::Custom
        );
    }

    #[test]
    fn test_table_type_from_bytes() {
        assert_eq!(TableType::from_bytes(b"worksheet"), TableType::Worksheet);
        assert_eq!(TableType::from_bytes(b"xml"), TableType::Xml);
        assert_eq!(TableType::from_bytes(b"queryTable"), TableType::QueryTable);
        assert_eq!(TableType::from_bytes(b"unknown"), TableType::Worksheet);
    }

    #[test]
    fn test_dynamic_filter_type_from_bytes() {
        assert_eq!(
            DynamicFilterType::from_bytes(b"today"),
            DynamicFilterType::Today
        );
        assert_eq!(
            DynamicFilterType::from_bytes(b"yesterday"),
            DynamicFilterType::Yesterday
        );
        assert_eq!(
            DynamicFilterType::from_bytes(b"tomorrow"),
            DynamicFilterType::Tomorrow
        );
        assert_eq!(
            DynamicFilterType::from_bytes(b"thisMonth"),
            DynamicFilterType::ThisMonth
        );
        assert_eq!(
            DynamicFilterType::from_bytes(b"lastMonth"),
            DynamicFilterType::LastMonth
        );
        assert_eq!(
            DynamicFilterType::from_bytes(b"nextMonth"),
            DynamicFilterType::NextMonth
        );
        assert_eq!(
            DynamicFilterType::from_bytes(b"aboveAverage"),
            DynamicFilterType::AboveAverage
        );
        assert_eq!(
            DynamicFilterType::from_bytes(b"belowAverage"),
            DynamicFilterType::BelowAverage
        );
        assert_eq!(DynamicFilterType::from_bytes(b"Q1"), DynamicFilterType::Q1);
        assert_eq!(
            DynamicFilterType::from_bytes(b"M12"),
            DynamicFilterType::M12
        );
    }

    // -------------------------------------------------------------------------
    // Helper function tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_bool_attr_opt() {
        let xml = b"<element attr1=\"1\" attr2=\"true\" attr3=\"0\" attr4=\"false\">";
        assert_eq!(parse_bool_attr_opt(xml, b"attr1=\""), Some(true));
        assert_eq!(parse_bool_attr_opt(xml, b"attr2=\""), Some(true));
        assert_eq!(parse_bool_attr_opt(xml, b"attr3=\""), Some(false));
        assert_eq!(parse_bool_attr_opt(xml, b"attr4=\""), Some(false));
        assert_eq!(parse_bool_attr_opt(xml, b"notfound=\""), None);
    }

    #[test]
    fn test_parse_u32_attr() {
        let xml = b"<element id=\"42\" count=\"0\" large=\"1000000\">";
        assert_eq!(parse_u32_attr(xml, b"id=\""), Some(42));
        assert_eq!(parse_u32_attr(xml, b"count=\""), Some(0));
        assert_eq!(parse_u32_attr(xml, b"large=\""), Some(1000000));
        assert_eq!(parse_u32_attr(xml, b"notfound=\""), None);
    }

    #[test]
    fn test_parse_f64_attr() {
        let xml = b"<element val=\"3.14\" int=\"42\" neg=\"-1.5\">";
        let val = parse_f64_attr(xml, b"val=\"");
        assert!(val.is_some());
        assert!((val.unwrap() - 3.14).abs() < 0.001);

        let int_val = parse_f64_attr(xml, b"int=\"");
        assert!(int_val.is_some());
        assert!((int_val.unwrap() - 42.0).abs() < 0.001);
    }

    #[test]
    fn test_parse_string_attr() {
        let xml = b"<element name=\"hello\" msg=\"&lt;test&gt;\" empty=\"\">";
        assert_eq!(
            parse_string_attr(xml, b"name=\""),
            Some("hello".to_string())
        );
        assert_eq!(
            parse_string_attr(xml, b"msg=\""),
            Some("<test>".to_string())
        );
        assert_eq!(parse_string_attr(xml, b"empty=\""), Some("".to_string()));
        assert_eq!(parse_string_attr(xml, b"notfound=\""), None);
    }

    #[test]
    fn test_decode_xml_entities() {
        assert_eq!(decode_xml_entities(b"hello"), "hello");
        assert_eq!(decode_xml_entities(b"&lt;tag&gt;"), "<tag>");
        assert_eq!(decode_xml_entities(b"&amp;"), "&");
        assert_eq!(decode_xml_entities(b"&quot;text&quot;"), "\"text\"");
        assert_eq!(decode_xml_entities(b"&apos;"), "'");
        // Note: numeric character references (&#65; &#x41;) are not supported in xml_utils
    }

    // -------------------------------------------------------------------------
    // TableColumn tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_table_column_simple() {
        let xml = b"<tableColumn id=\"1\" name=\"Column1\"/>";
        let col = TableColumn::parse(xml).unwrap();
        assert_eq!(col.id, 1);
        assert_eq!(col.name, "Column1");
        assert_eq!(col.totals_row_function, TotalsRowFunction::None);
    }

    #[test]
    fn test_parse_table_column_with_totals() {
        let xml = b"<tableColumn id=\"2\" name=\"Amount\" totalsRowFunction=\"sum\"/>";
        let col = TableColumn::parse(xml).unwrap();
        assert_eq!(col.id, 2);
        assert_eq!(col.name, "Amount");
        assert_eq!(col.totals_row_function, TotalsRowFunction::Sum);
    }

    #[test]
    fn test_parse_table_column_with_formula() {
        let xml = br#"<tableColumn id="3" name="Total">
            <calculatedColumnFormula>[@Quantity]*[@Price]</calculatedColumnFormula>
        </tableColumn>"#;
        let col = TableColumn::parse(xml).unwrap();
        assert_eq!(col.id, 3);
        assert_eq!(col.name, "Total");
        assert_eq!(
            col.calculated_column_formula,
            Some(TableFormula::new("[@Quantity]*[@Price]"))
        );
    }

    #[test]
    fn test_parse_table_column_with_styles() {
        let xml = b"<tableColumn id=\"1\" name=\"Col\" headerRowDxfId=\"0\" dataDxfId=\"1\" totalsRowDxfId=\"2\"/>";
        let col = TableColumn::parse(xml).unwrap();
        assert_eq!(col.header_row_dxf_id, Some(0));
        assert_eq!(col.data_dxf_id, Some(1));
        assert_eq!(col.totals_row_dxf_id, Some(2));
    }

    // -------------------------------------------------------------------------
    // TableStyleInfo tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_table_style_info() {
        let xml = br#"<tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/>"#;
        let style = parse_table_style_info(xml).unwrap();
        assert_eq!(style.name, Some("TableStyleMedium2".to_string()));
        assert!(!style.show_first_column);
        assert!(!style.show_last_column);
        assert!(style.show_row_stripes);
        assert!(!style.show_column_stripes);
    }

    #[test]
    fn test_parse_table_style_info_all_true() {
        let xml = br#"<tableStyleInfo name="CustomStyle" showFirstColumn="1" showLastColumn="1" showRowStripes="1" showColumnStripes="1"/>"#;
        let style = parse_table_style_info(xml).unwrap();
        assert!(style.show_first_column);
        assert!(style.show_last_column);
        assert!(style.show_row_stripes);
        assert!(style.show_column_stripes);
    }

    // -------------------------------------------------------------------------
    // AutoFilter tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_auto_filter_simple() {
        let xml = br#"<autoFilter ref="A1:E10"/>"#;
        let af = AutoFilter::parse(xml).unwrap();
        assert_eq!(af.ref_range, "A1:E10");
        assert!(af.filter_columns.is_empty());
    }

    #[test]
    fn test_parse_auto_filter_with_filter_column() {
        let xml = br#"<autoFilter ref="A1:E10">
            <filterColumn colId="0">
                <filters>
                    <filter val="Active"/>
                    <filter val="Pending"/>
                </filters>
            </filterColumn>
        </autoFilter>"#;
        let af = AutoFilter::parse(xml).unwrap();
        assert_eq!(af.ref_range, "A1:E10");
        assert_eq!(af.filter_columns.len(), 1);
        assert_eq!(af.filter_columns[0].col_id, 0);

        let filters = af.filter_columns[0].filters.as_ref().unwrap();
        assert_eq!(filters.values.len(), 2);
        assert!(filters.values.contains(&"Active".to_string()));
        assert!(filters.values.contains(&"Pending".to_string()));
    }

    #[test]
    fn test_parse_auto_filter_with_custom_filters() {
        let xml = br#"<autoFilter ref="A1:E10">
            <filterColumn colId="1">
                <customFilters and="1">
                    <customFilter operator="greaterThanOrEqual" val="100"/>
                    <customFilter operator="lessThan" val="500"/>
                </customFilters>
            </filterColumn>
        </autoFilter>"#;
        let af = AutoFilter::parse(xml).unwrap();
        let fc = &af.filter_columns[0];
        assert_eq!(fc.col_id, 1);

        let cf = fc.custom_filters.as_ref().unwrap();
        assert!(cf.and);
        assert_eq!(cf.filters.len(), 2);
        assert_eq!(cf.filters[0].operator, FilterOperator::GreaterThanOrEqual);
        assert_eq!(cf.filters[0].val, "100");
        assert_eq!(cf.filters[1].operator, FilterOperator::LessThan);
        assert_eq!(cf.filters[1].val, "500");
    }

    #[test]
    fn test_parse_auto_filter_with_top10() {
        let xml = br#"<autoFilter ref="A1:E10">
            <filterColumn colId="2">
                <top10 top="1" percent="0" val="10"/>
            </filterColumn>
        </autoFilter>"#;
        let af = AutoFilter::parse(xml).unwrap();
        let fc = &af.filter_columns[0];
        let top10 = fc.top10.as_ref().unwrap();
        assert!(top10.top);
        assert!(!top10.percent);
        assert!((top10.val - 10.0).abs() < 0.001);
    }

    #[test]
    fn test_parse_auto_filter_with_dynamic_filter() {
        let xml = br#"<autoFilter ref="A1:E10">
            <filterColumn colId="3">
                <dynamicFilter type="thisMonth"/>
            </filterColumn>
        </autoFilter>"#;
        let af = AutoFilter::parse(xml).unwrap();
        let fc = &af.filter_columns[0];
        let df = fc.dynamic_filter.as_ref().unwrap();
        assert_eq!(df.filter_type, DynamicFilterType::ThisMonth);
    }

    // -------------------------------------------------------------------------
    // Filter types tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_filters_with_blank() {
        let xml = br#"<filters blank="1">
            <filter val="Value1"/>
        </filters>"#;
        let f = Filters::parse(xml).unwrap();
        assert!(f.blank);
        assert_eq!(f.values.len(), 1);
    }

    #[test]
    fn test_parse_color_filter() {
        let xml = br#"<colorFilter dxfId="5" cellColor="1"/>"#;
        let cf = ColorFilter::parse(xml).unwrap();
        assert_eq!(cf.dxf_id, Some(5));
        assert!(cf.cell_color);
    }

    #[test]
    fn test_parse_icon_filter() {
        let xml = br#"<iconFilter iconSet="3Arrows" iconId="2"/>"#;
        let icon_f = IconFilter::parse(xml).unwrap();
        assert_eq!(icon_f.icon_set, IconSetType::ThreeArrows);
        assert_eq!(icon_f.icon_id, Some(2));
    }

    // -------------------------------------------------------------------------
    // Sort state tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_sort_state() {
        let xml = br#"<sortState ref="A2:E100" columnSort="1" caseSensitive="0" sortMethod="pinYin">
            <sortCondition ref="B2:B100" descending="1" sortBy="icon" customList="High,Medium,Low" dxfId="7" iconSet="3TrafficLights1" iconId="2"/>
        </sortState>"#;
        let ss = SortState::parse(xml).unwrap();
        assert_eq!(ss.ref_range, "A2:E100");
        assert!(ss.column_sort);
        assert!(!ss.case_sensitive);
        assert_eq!(ss.sort_method, domain_types::SortMethod::PinYin);
        assert_eq!(ss.sort_conditions.len(), 1);
        assert_eq!(ss.sort_conditions[0].ref_range, "B2:B100");
        assert!(ss.sort_conditions[0].descending);
        assert_eq!(
            ss.sort_conditions[0].sort_by,
            ooxml_types::tables::SortBy::Icon
        );
        assert_eq!(
            ss.sort_conditions[0].custom_list.as_deref(),
            Some("High,Medium,Low")
        );
        assert_eq!(ss.sort_conditions[0].dxf_id, Some(7));
        assert_eq!(
            ss.sort_conditions[0].icon_set,
            Some(IconSetType::ThreeTrafficLights1)
        );
        assert_eq!(ss.sort_conditions[0].icon_id, Some(2));
    }

    // -------------------------------------------------------------------------
    // Table tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_simple_table() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
       id="1" name="Table1" displayName="Table1" ref="A1:C10"
       totalsRowShown="0" headerRowCount="1">
    <autoFilter ref="A1:C10"/>
    <tableColumns count="3">
        <tableColumn id="1" name="Name"/>
        <tableColumn id="2" name="Age"/>
        <tableColumn id="3" name="City"/>
    </tableColumns>
    <tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0"
                    showRowStripes="1" showColumnStripes="0"/>
</table>"#;

        let table = Table::parse(xml).unwrap();
        assert_eq!(table.id, 1);
        assert_eq!(table.name, "Table1");
        assert_eq!(table.display_name, "Table1");
        // Typed range refs: ref_range is typed Option<RangeRef>.
        assert_eq!(
            table.ref_range.as_ref().map(|r| r.to_a1_string()),
            Some("A1:C10".to_string())
        );
        assert_eq!(table.header_row_count, 1);
        assert_eq!(table.totals_row_shown, Some(false));

        // Check columns
        assert_eq!(table.columns.len(), 3);
        assert_eq!(table.columns[0].name, "Name");
        assert_eq!(table.columns[1].name, "Age");
        assert_eq!(table.columns[2].name, "City");

        // Check auto filter
        let af = table.auto_filter.as_ref().unwrap();
        assert_eq!(af.ref_range, "A1:C10");

        // Check style info
        let style = table.table_style_info.as_ref().unwrap();
        assert_eq!(style.name, Some("TableStyleMedium2".to_string()));
        assert!(style.show_row_stripes);
    }

    #[test]
    fn test_parse_table_with_totals() {
        let xml = br#"<table id="2" name="SalesTable" displayName="SalesTable"
       ref="A1:D20" totalsRowShown="1" totalsRowCount="1" headerRowCount="1">
    <tableColumns count="4">
        <tableColumn id="1" name="Product"/>
        <tableColumn id="2" name="Quantity" totalsRowFunction="sum"/>
        <tableColumn id="3" name="Price" totalsRowFunction="average"/>
        <tableColumn id="4" name="Total" totalsRowFunction="sum">
            <calculatedColumnFormula>[@Quantity]*[@Price]</calculatedColumnFormula>
        </tableColumn>
    </tableColumns>
</table>"#;

        let table = Table::parse(xml).unwrap();
        assert_eq!(table.id, 2);
        assert_eq!(table.totals_row_shown, Some(true));
        assert_eq!(table.totals_row_count, 1);
        assert!(table.has_totals());
        assert!(table.has_header());

        assert_eq!(table.columns.len(), 4);
        assert_eq!(table.columns[1].totals_row_function, TotalsRowFunction::Sum);
        assert_eq!(
            table.columns[2].totals_row_function,
            TotalsRowFunction::Average
        );
        assert_eq!(
            table.columns[3].calculated_column_formula,
            Some(TableFormula::new("[@Quantity]*[@Price]"))
        );
    }

    #[test]
    fn test_parse_table_with_filters() {
        let xml = br#"<table id="3" name="FilteredTable" displayName="FilteredTable" ref="A1:E50">
    <autoFilter ref="A1:E50">
        <filterColumn colId="0">
            <filters>
                <filter val="Active"/>
            </filters>
        </filterColumn>
        <filterColumn colId="2">
            <customFilters>
                <customFilter operator="greaterThan" val="100"/>
            </customFilters>
        </filterColumn>
    </autoFilter>
    <tableColumns count="5">
        <tableColumn id="1" name="Status"/>
        <tableColumn id="2" name="Name"/>
        <tableColumn id="3" name="Amount"/>
        <tableColumn id="4" name="Date"/>
        <tableColumn id="5" name="Category"/>
    </tableColumns>
</table>"#;

        let table = Table::parse(xml).unwrap();
        let af = table.auto_filter.as_ref().unwrap();
        assert_eq!(af.filter_columns.len(), 2);

        // First filter column has value filters
        assert_eq!(af.filter_columns[0].col_id, 0);
        assert!(af.filter_columns[0].filters.is_some());

        // Second filter column has custom filters
        assert_eq!(af.filter_columns[1].col_id, 2);
        let cf = af.filter_columns[1].custom_filters.as_ref().unwrap();
        assert_eq!(cf.filters[0].operator, FilterOperator::GreaterThan);
    }

    #[test]
    fn test_parse_table_with_xml_entities() {
        let xml = br#"<table id="4" name="Table&amp;Name" displayName="Table &lt;Special&gt;" ref="A1:B5">
    <tableColumns count="2">
        <tableColumn id="1" name="Column &quot;1&quot;"/>
        <tableColumn id="2" name="Column&apos;s 2"/>
    </tableColumns>
</table>"#;

        let table = Table::parse(xml).unwrap();
        assert_eq!(table.name, "Table&Name");
        assert_eq!(table.display_name, "Table <Special>");
        assert_eq!(table.columns[0].name, "Column \"1\"");
        assert_eq!(table.columns[1].name, "Column's 2");
    }

    #[test]
    fn test_parse_table_minimal() {
        let xml = br#"<table id="1" ref="A1:A1"/>"#;
        let table = Table::parse(xml).unwrap();
        assert_eq!(table.id, 1);
        // Canonical 1×1-range form after W4.a: "A1", not "A1:A1"
        assert_eq!(
            table.ref_range.as_ref().map(|r| r.to_a1_string()),
            Some("A1".to_string())
        );
        assert!(table.columns.is_empty());
        assert!(table.auto_filter.is_none());
        assert!(table.table_style_info.is_none());
    }

    #[test]
    fn test_parse_table_with_all_attributes() {
        let xml = br#"<table id="5" name="CompleteTable" displayName="Complete Table"
       ref="A1:Z100" tableType="worksheet" headerRowCount="1" insertRow="1"
       insertRowShift="0" totalsRowCount="1" totalsRowShown="1" published="1"
       headerRowDxfId="0" dataDxfId="1" totalsRowDxfId="2"
       headerRowBorderDxfId="3" tableBorderDxfId="4" totalsRowBorderDxfId="5"
       headerRowCellStyle="Header" dataCellStyle="Data" totalsRowCellStyle="Total"
       connectionId="10" comment="Test table">
    <tableColumns count="1">
        <tableColumn id="1" name="Col1"/>
    </tableColumns>
</table>"#;

        let table = Table::parse(xml).unwrap();
        assert_eq!(table.id, 5);
        assert_eq!(table.name, "CompleteTable");
        assert_eq!(table.display_name, "Complete Table");
        assert_eq!(
            table.ref_range.as_ref().map(|r| r.to_a1_string()),
            Some("A1:Z100".to_string())
        );
        assert_eq!(table.table_type, TableType::Worksheet);
        assert_eq!(table.header_row_count, 1);
        assert!(table.insert_row);
        assert!(!table.insert_row_shift);
        assert_eq!(table.totals_row_count, 1);
        assert_eq!(table.totals_row_shown, Some(true));
        assert!(table.published);
        assert_eq!(table.header_row_dxf_id, Some(0));
        assert_eq!(table.data_dxf_id, Some(1));
        assert_eq!(table.totals_row_dxf_id, Some(2));
        assert_eq!(table.header_row_border_dxf_id, Some(3));
        assert_eq!(table.table_border_dxf_id, Some(4));
        assert_eq!(table.totals_row_border_dxf_id, Some(5));
        assert_eq!(table.header_row_cell_style, Some("Header".to_string()));
        assert_eq!(table.data_cell_style, Some("Data".to_string()));
        assert_eq!(table.totals_row_cell_style, Some("Total".to_string()));
        assert_eq!(table.connection_id, Some(10));
        assert_eq!(table.comment, Some("Test table".to_string()));
    }

    #[test]
    fn test_table_has_header() {
        let table_with_header = Table {
            header_row_count: 1,
            ..Default::default()
        };
        assert!(table_with_header.has_header());

        let table_no_header = Table {
            header_row_count: 0,
            ..Default::default()
        };
        assert!(!table_no_header.has_header());
    }

    #[test]
    fn test_table_has_totals() {
        let table_with_totals_count = Table {
            totals_row_count: 1,
            ..Default::default()
        };
        assert!(table_with_totals_count.has_totals());

        let table_with_totals_shown = Table {
            totals_row_shown: Some(true),
            ..Default::default()
        };
        assert!(table_with_totals_shown.has_totals());

        let table_no_totals = Table::default();
        assert!(!table_no_totals.has_totals());
    }

    // -------------------------------------------------------------------------
    // Integration/realistic tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_realistic_table() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
       xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
       mc:Ignorable="xr xr3"
       xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision"
       xmlns:xr3="http://schemas.microsoft.com/office/spreadsheetml/2016/revision3"
       id="1" name="SalesData" displayName="SalesData" ref="A1:F101"
       totalsRowCount="1" headerRowDxfId="6" dataDxfId="5" totalsRowDxfId="4">
    <autoFilter ref="A1:F100">
        <filterColumn colId="1">
            <filters>
                <filter val="Electronics"/>
                <filter val="Clothing"/>
            </filters>
        </filterColumn>
        <filterColumn colId="4">
            <customFilters and="1">
                <customFilter operator="greaterThanOrEqual" val="2024-01-01"/>
                <customFilter operator="lessThan" val="2025-01-01"/>
            </customFilters>
        </filterColumn>
        <sortState ref="A2:F100">
            <sortCondition descending="1" ref="E2:E100"/>
        </sortState>
    </autoFilter>
    <tableColumns count="6">
        <tableColumn id="1" name="ID" totalsRowLabel="Total"/>
        <tableColumn id="2" name="Category"/>
        <tableColumn id="3" name="Product"/>
        <tableColumn id="4" name="Quantity" totalsRowFunction="sum"/>
        <tableColumn id="5" name="Date"/>
        <tableColumn id="6" name="Revenue" totalsRowFunction="sum">
            <calculatedColumnFormula>[@Quantity]*[@UnitPrice]</calculatedColumnFormula>
        </tableColumn>
    </tableColumns>
    <tableStyleInfo name="TableStyleMedium9" showFirstColumn="0" showLastColumn="0"
                    showRowStripes="1" showColumnStripes="0"/>
</table>"#;

        let table = Table::parse(xml).unwrap();

        // Basic attributes
        assert_eq!(table.id, 1);
        assert_eq!(table.name, "SalesData");
        assert_eq!(table.display_name, "SalesData");
        assert_eq!(
            table.ref_range.as_ref().map(|r| r.to_a1_string()),
            Some("A1:F101".to_string())
        );
        assert_eq!(table.totals_row_count, 1);
        assert!(table.has_totals());

        // Differential format IDs
        assert_eq!(table.header_row_dxf_id, Some(6));
        assert_eq!(table.data_dxf_id, Some(5));
        assert_eq!(table.totals_row_dxf_id, Some(4));

        // AutoFilter
        let af = table.auto_filter.as_ref().unwrap();
        assert_eq!(af.ref_range, "A1:F100");
        assert_eq!(af.filter_columns.len(), 2);

        // First filter column (value filter)
        let fc1 = &af.filter_columns[0];
        assert_eq!(fc1.col_id, 1);
        let filters = fc1.filters.as_ref().unwrap();
        assert_eq!(filters.values.len(), 2);

        // Second filter column (custom date range)
        let fc2 = &af.filter_columns[1];
        assert_eq!(fc2.col_id, 4);
        let cf = fc2.custom_filters.as_ref().unwrap();
        assert!(cf.and);
        assert_eq!(cf.filters.len(), 2);

        // Sort state
        let ss = af.sort_state.as_ref().unwrap();
        assert_eq!(ss.ref_range, "A2:F100");
        assert_eq!(ss.sort_conditions.len(), 1);
        assert!(ss.sort_conditions[0].descending);

        // Columns
        assert_eq!(table.columns.len(), 6);
        assert_eq!(table.columns[0].name, "ID");
        assert_eq!(table.columns[0].totals_row_label, Some("Total".to_string()));
        assert_eq!(table.columns[3].totals_row_function, TotalsRowFunction::Sum);
        assert_eq!(
            table.columns[5].calculated_column_formula,
            Some(TableFormula::new("[@Quantity]*[@UnitPrice]"))
        );

        // Style info
        let style = table.table_style_info.as_ref().unwrap();
        assert_eq!(style.name, Some("TableStyleMedium9".to_string()));
        assert!(style.show_row_stripes);
        assert!(!style.show_column_stripes);
    }

    #[test]
    fn test_parse_malformed_xml() {
        // Missing closing tag - should not panic
        let xml = b"<table id=\"1\" ref=\"A1:A1\">";
        let result = Table::parse(xml);
        // Result depends on implementation, but should not panic
        let _ = result;
    }

    #[test]
    fn test_parse_empty_input() {
        let xml = b"";
        let result = Table::parse(xml);
        assert!(result.is_none());
    }

    #[test]
    fn test_parse_invalid_xml() {
        let xml = b"not xml at all";
        let result = Table::parse(xml);
        assert!(result.is_none());
    }

    // ─────────────────────────────────────────────────────────────────────
    // Typed range refs: — regression tests (Boundary 1.10)
    // ─────────────────────────────────────────────────────────────────────

    #[test]
    fn w4c_table_ref_range_absolute_markers_round_trip() {
        // Absolute markers (`$`) in the range attribute are carried on the
        // typed `RangeRef.abs_start` / `abs_end` flags. Canonical re-
        // emission preserves them.
        let xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
       id="1" name="T" displayName="T" ref="$A$1:$C$10">
  <tableColumns count="0"/>
</table>"#;
        let table = Table::parse(xml).expect("parse");
        assert_eq!(
            table.ref_range.as_ref().map(|r| r.to_a1_string()),
            Some("$A$1:$C$10".to_string())
        );
    }

    #[test]
    fn w4c_table_ref_range_missing_yields_none() {
        // An absent `ref` attribute → `None`, not an empty-string sentinel.
        let xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
       id="1" name="T" displayName="T">
  <tableColumns count="0"/>
</table>"#;
        let table = Table::parse(xml).expect("parse");
        assert!(table.ref_range.is_none());
    }

    #[test]
    fn w4c_table_ref_range_malformed_no_panic() {
        // UTF-8 boundary UTF-8-boundary class: malformed input must not panic.
        // The `μμμμμμ` bytes are embedded via hex escape since byte string
        // literals can't carry non-ASCII directly.
        //
        // `\xCE\xBC` = U+03BC GREEK SMALL LETTER MU.
        let xml: &[u8] = b"<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
<table xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" \
       id=\"1\" name=\"T\" displayName=\"T\" \
       ref=\"\xCE\xBC\xCE\xBC\xCE\xBC\xCE\xBC\xCE\xBC\xCE\xBC\">\n\
  <tableColumns count=\"0\"/>\n\
</table>";
        let table = Table::parse(xml).expect("parse");
        // Invalid range → `None`. No panic on non-ASCII byte-boundary math.
        assert!(table.ref_range.is_none());
    }
}
