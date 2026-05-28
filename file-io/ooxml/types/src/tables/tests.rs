use super::*;

#[test]
fn facade_exports_representative_table_types() {
    use crate::tables::*;

    let _: Table = Table::default();
    let _: TableColumn = TableColumn::default();
    let _: AutoFilter = AutoFilter::default();
    let _: FilterColumn = FilterColumn::default();
    let _: TableFormula = TableFormula::new("SUM([Column1])");
    let _: XmlColumnPr = XmlColumnPr::default();
    let _: TableStyleInfo = TableStyleInfo::new("TableStyleMedium9");
    let _: TableStyleType = TableStyleType::WholeTable;
    let _: TotalsRowFunction = TotalsRowFunction::Sum;
    let _: DynamicFilterType = DynamicFilterType::Today;
    let _: FilterOperator = FilterOperator::Equal;
    let _: SortBy = SortBy::Value;
    let _: SortOrder = SortOrder::Ascending;
    let _: SortState = SortState::default();
    let _: SortCondition = SortCondition::default();
}

// --- TotalsRowFunction ---

#[test]
fn totals_row_function_roundtrip() {
    let variants = [
        TotalsRowFunction::None,
        TotalsRowFunction::Average,
        TotalsRowFunction::Count,
        TotalsRowFunction::CountNums,
        TotalsRowFunction::Max,
        TotalsRowFunction::Min,
        TotalsRowFunction::StdDev,
        TotalsRowFunction::Sum,
        TotalsRowFunction::Var,
        TotalsRowFunction::Custom,
    ];
    for v in &variants {
        assert_eq!(TotalsRowFunction::from_ooxml(v.to_ooxml()), *v);
        assert_eq!(TotalsRowFunction::from_bytes(v.to_ooxml().as_bytes()), *v);
    }
}

#[test]
fn totals_row_function_unknown_defaults_to_none() {
    assert_eq!(
        TotalsRowFunction::from_ooxml("bogus"),
        TotalsRowFunction::None
    );
    assert_eq!(
        TotalsRowFunction::from_bytes(b"bogus"),
        TotalsRowFunction::None
    );
}

// --- FilterOperator ---

#[test]
fn filter_operator_roundtrip() {
    let variants = [
        FilterOperator::Equal,
        FilterOperator::LessThan,
        FilterOperator::LessThanOrEqual,
        FilterOperator::NotEqual,
        FilterOperator::GreaterThanOrEqual,
        FilterOperator::GreaterThan,
    ];
    for v in &variants {
        assert_eq!(FilterOperator::from_ooxml(v.to_ooxml()), *v);
        assert_eq!(FilterOperator::from_bytes(v.to_ooxml().as_bytes()), *v);
    }
}

#[test]
fn filter_operator_unknown_defaults_to_equal() {
    assert_eq!(FilterOperator::from_ooxml("bogus"), FilterOperator::Equal);
}

// --- DynamicFilterType ---

#[test]
fn dynamic_filter_type_roundtrip() {
    let variants = [
        DynamicFilterType::Null,
        DynamicFilterType::AboveAverage,
        DynamicFilterType::BelowAverage,
        DynamicFilterType::Tomorrow,
        DynamicFilterType::Today,
        DynamicFilterType::Yesterday,
        DynamicFilterType::NextWeek,
        DynamicFilterType::ThisWeek,
        DynamicFilterType::LastWeek,
        DynamicFilterType::NextMonth,
        DynamicFilterType::ThisMonth,
        DynamicFilterType::LastMonth,
        DynamicFilterType::NextQuarter,
        DynamicFilterType::ThisQuarter,
        DynamicFilterType::LastQuarter,
        DynamicFilterType::NextYear,
        DynamicFilterType::ThisYear,
        DynamicFilterType::LastYear,
        DynamicFilterType::YearToDate,
        DynamicFilterType::Q1,
        DynamicFilterType::Q2,
        DynamicFilterType::Q3,
        DynamicFilterType::Q4,
        DynamicFilterType::M1,
        DynamicFilterType::M2,
        DynamicFilterType::M3,
        DynamicFilterType::M4,
        DynamicFilterType::M5,
        DynamicFilterType::M6,
        DynamicFilterType::M7,
        DynamicFilterType::M8,
        DynamicFilterType::M9,
        DynamicFilterType::M10,
        DynamicFilterType::M11,
        DynamicFilterType::M12,
    ];
    for v in &variants {
        assert_eq!(DynamicFilterType::from_ooxml(v.to_ooxml()), *v);
        assert_eq!(DynamicFilterType::from_bytes(v.to_ooxml().as_bytes()), *v);
    }
}

#[test]
fn dynamic_filter_type_unknown_defaults_to_null() {
    assert_eq!(
        DynamicFilterType::from_ooxml("bogus"),
        DynamicFilterType::Null
    );
    assert_eq!(
        DynamicFilterType::from_bytes(b"bogus"),
        DynamicFilterType::Null
    );
}

// --- TableType ---

#[test]
fn table_type_roundtrip() {
    let variants = [TableType::Worksheet, TableType::Xml, TableType::QueryTable];
    for v in &variants {
        assert_eq!(TableType::from_ooxml(v.to_ooxml()), *v);
        assert_eq!(TableType::from_bytes(v.to_ooxml().as_bytes()), *v);
    }
}

#[test]
fn table_type_unknown_defaults_to_worksheet() {
    assert_eq!(TableType::from_ooxml("bogus"), TableType::Worksheet);
    assert_eq!(TableType::from_bytes(b"bogus"), TableType::Worksheet);
}

// --- SortOrder ---

#[test]
fn sort_order_roundtrip() {
    let variants = [SortOrder::None, SortOrder::Ascending, SortOrder::Descending];
    for v in &variants {
        assert_eq!(SortOrder::from_ooxml(v.to_ooxml()), *v);
        assert_eq!(SortOrder::from_bytes(v.to_ooxml().as_bytes()), *v);
    }
}

#[test]
fn sort_order_shorthand() {
    assert_eq!(SortOrder::from_ooxml("asc"), SortOrder::Ascending);
    assert_eq!(SortOrder::from_ooxml("desc"), SortOrder::Descending);
    assert_eq!(SortOrder::from_bytes(b"asc"), SortOrder::Ascending);
    assert_eq!(SortOrder::from_bytes(b"desc"), SortOrder::Descending);
}

#[test]
fn sort_order_unknown_defaults_to_none() {
    assert_eq!(SortOrder::from_ooxml("bogus"), SortOrder::None);
    assert_eq!(SortOrder::from_bytes(b"bogus"), SortOrder::None);
}

// --- SortBy ---

#[test]
fn sort_by_roundtrip() {
    let variants = [
        SortBy::Value,
        SortBy::CellColor,
        SortBy::FontColor,
        SortBy::Icon,
    ];
    for v in &variants {
        assert_eq!(SortBy::from_ooxml(v.to_ooxml()), *v);
        assert_eq!(SortBy::from_bytes(v.to_ooxml().as_bytes()), *v);
    }
}

#[test]
fn sort_by_unknown_defaults_to_value() {
    assert_eq!(SortBy::from_ooxml("unknown"), SortBy::Value);
    assert_eq!(SortBy::from_bytes(b"unknown"), SortBy::Value);
}

// --- TableStyleInfo ---

#[test]
fn table_style_info_new_defaults() {
    let style = TableStyleInfo::new("TableStyleMedium9");
    assert_eq!(style.name, Some("TableStyleMedium9".to_string()));
    assert!(!style.show_first_column);
    assert!(!style.show_last_column);
    assert!(style.show_row_stripes);
    assert!(!style.show_column_stripes);
}

#[test]
fn table_style_info_default_trait() {
    let style = TableStyleInfo::default();
    assert_eq!(style.name, None);
    assert!(!style.show_first_column);
    assert!(!style.show_row_stripes); // Default trait gives false for all bools
}

// --- DateTimeGrouping ---

#[test]
fn date_time_grouping_roundtrip() {
    let variants = [
        DateTimeGrouping::Year,
        DateTimeGrouping::Month,
        DateTimeGrouping::Day,
        DateTimeGrouping::Hour,
        DateTimeGrouping::Minute,
        DateTimeGrouping::Second,
    ];
    for v in &variants {
        assert_eq!(DateTimeGrouping::from_ooxml(v.to_ooxml()), *v);
        assert_eq!(DateTimeGrouping::from_bytes(v.to_ooxml().as_bytes()), *v);
    }
    // Unknown defaults to Year
    assert_eq!(
        DateTimeGrouping::from_ooxml("bogus"),
        DateTimeGrouping::Year
    );
    assert_eq!(
        DateTimeGrouping::from_bytes(b"bogus"),
        DateTimeGrouping::Year
    );
}

// --- Table ---

#[test]
fn table_default() {
    let t = Table::default();
    assert_eq!(t.header_row_count, 1);
    assert_eq!(t.totals_row_count, 0);
    assert!(t.totals_row_shown);
    assert!(!t.insert_row);
    assert!(!t.insert_row_shift);
    assert!(!t.published);
    assert_eq!(t.table_type, TableType::Worksheet);
    assert!(t.auto_filter.is_none());
    assert!(t.sort_state.is_none());
    assert!(t.table_columns.is_empty());
    assert!(t.table_style_info.is_none());
}

// --- TableColumn ---

#[test]
fn table_column_default() {
    let col = TableColumn::default();
    assert_eq!(col.totals_row_function, TotalsRowFunction::None);
    assert_eq!(col.id, 0);
    assert_eq!(col.name, "");
    assert!(col.unique_name.is_none());
    assert!(col.totals_row_label.is_none());
    assert!(col.calculated_column_formula.is_none());
    assert!(col.totals_row_formula.is_none());
}

// --- AutoFilter ---

#[test]
fn auto_filter_default() {
    let af = AutoFilter::default();
    assert!(af.r#ref.is_none());
    assert!(af.filter_columns.is_empty());
    assert!(af.sort_state.is_none());
}

// --- FilterColumn ---

#[test]
fn filter_column_defaults() {
    let fc = FilterColumn::default();
    assert!(!fc.hidden_button);
    assert!(fc.show_button);
    assert!(fc.filter.is_none());
    assert_eq!(fc.col_id, 0);
}

// --- Top10Filter ---

#[test]
fn top10_filter_defaults() {
    let f = Top10Filter::default();
    assert!(f.top);
    assert!(!f.percent);
    assert_eq!(f.val, 0.0);
    assert!(f.filter_val.is_none());
}

// --- CustomFilters ---

#[test]
fn custom_filters_default() {
    let cf = CustomFilters::default();
    assert!(!cf.and);
    assert!(cf.custom_filter.is_empty());
}

// --- ColorFilter ---

#[test]
fn color_filter_default() {
    let cf = ColorFilter::default();
    assert!(cf.cell_color);
    assert!(cf.dxf_id.is_none());
}

// --- SortState ---

#[test]
fn sort_state_default() {
    let ss = SortState::default();
    assert!(!ss.column_sort);
    assert!(!ss.case_sensitive);
    assert_eq!(ss.sort_method, crate::worksheet::filter::SortMethod::None);
    assert_eq!(ss.ref_range, "");
    assert!(ss.sort_condition.is_empty());
}

// --- TableStyleType ---

#[test]
fn table_style_type_roundtrip() {
    let variants = [
        (TableStyleType::WholeTable, "wholeTable"),
        (TableStyleType::HeaderRow, "headerRow"),
        (TableStyleType::TotalRow, "totalRow"),
        (TableStyleType::FirstColumn, "firstColumn"),
        (TableStyleType::LastColumn, "lastColumn"),
        (TableStyleType::FirstRowStripe, "firstRowStripe"),
        (TableStyleType::SecondRowStripe, "secondRowStripe"),
        (TableStyleType::FirstColumnStripe, "firstColumnStripe"),
        (TableStyleType::SecondColumnStripe, "secondColumnStripe"),
        (TableStyleType::FirstHeaderCell, "firstHeaderCell"),
        (TableStyleType::LastHeaderCell, "lastHeaderCell"),
        (TableStyleType::FirstTotalCell, "firstTotalCell"),
        (TableStyleType::LastTotalCell, "lastTotalCell"),
        (TableStyleType::FirstSubtotalColumn, "firstSubtotalColumn"),
        (TableStyleType::SecondSubtotalColumn, "secondSubtotalColumn"),
        (TableStyleType::ThirdSubtotalColumn, "thirdSubtotalColumn"),
        (TableStyleType::FirstSubtotalRow, "firstSubtotalRow"),
        (TableStyleType::SecondSubtotalRow, "secondSubtotalRow"),
        (TableStyleType::ThirdSubtotalRow, "thirdSubtotalRow"),
        (TableStyleType::BlankRow, "blankRow"),
        (
            TableStyleType::FirstColumnSubheading,
            "firstColumnSubheading",
        ),
        (
            TableStyleType::SecondColumnSubheading,
            "secondColumnSubheading",
        ),
        (
            TableStyleType::ThirdColumnSubheading,
            "thirdColumnSubheading",
        ),
        (TableStyleType::FirstRowSubheading, "firstRowSubheading"),
        (TableStyleType::SecondRowSubheading, "secondRowSubheading"),
        (TableStyleType::ThirdRowSubheading, "thirdRowSubheading"),
        (TableStyleType::PageFieldLabels, "pageFieldLabels"),
        (TableStyleType::PageFieldValues, "pageFieldValues"),
    ];
    for (variant, s) in &variants {
        assert_eq!(TableStyleType::from_ooxml(s), *variant, "from_ooxml({s})");
        assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
        assert_eq!(
            TableStyleType::from_bytes(s.as_bytes()),
            *variant,
            "from_bytes({s})"
        );
    }
}

#[test]
fn table_style_type_unknown_defaults_to_whole_table() {
    assert_eq!(
        TableStyleType::from_ooxml("bogus"),
        TableStyleType::WholeTable
    );
    assert_eq!(
        TableStyleType::from_bytes(b"bogus"),
        TableStyleType::WholeTable
    );
}

// --- SortCondition ---

#[test]
fn sort_condition_default() {
    let sc = SortCondition::default();
    assert!(!sc.descending);
    assert_eq!(sc.sort_by, SortBy::Value);
    assert_eq!(sc.ref_range, "");
    assert!(sc.custom_list.is_none());
    assert!(sc.dxf_id.is_none());
    assert!(sc.icon_set.is_none());
    assert!(sc.icon_id.is_none());
}
