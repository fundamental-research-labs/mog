use super::extract_chart_spec_from_chart_space;
use ooxml_types::charts::{
    BarChartConfig, Chart as OoxmlChart, ChartGroup, ChartSpace, ChartType, ChartTypeConfig,
    DataTableConfig, PlotArea,
};

fn chart_anchor() -> crate::domain::charts::read::xml_parsing::ChartRefInfo {
    crate::domain::charts::read::xml_parsing::ChartRefInfo {
        target: "charts/chart1.xml".to_string(),
        from_row: 0,
        from_col: 0,
        from_col_off: 0,
        from_row_off: 0,
        absolute_x: None,
        absolute_y: None,
        to_row: None,
        to_col: None,
        to_col_off: None,
        to_row_off: None,
        cx: 600 * 9525,
        cy: 400 * 9525,
        xfrm_off_x: 0,
        xfrm_off_y: 0,
        xfrm_ext_cx: 600 * 9525,
        xfrm_ext_cy: 400 * 9525,
        cnv_pr_name: Some("Chart 1".to_string()),
        cnv_pr_id: Some(1),
        cnv_pr_descr: None,
        cnv_pr_title: None,
        cnv_pr_hidden: false,
        no_change_aspect: None,
        has_graphic_frame_locks: false,
        cnv_pr_ext_lst: None,
        anchor_edit_as: None,
        macro_name: None,
        client_data_locks_with_sheet: None,
        client_data_prints_with_sheet: None,
        anchor_index: Some(0),
    }
}

fn chart_group(chart_type: ChartType, config: ChartTypeConfig) -> ChartGroup {
    ChartGroup {
        chart_type,
        config,
        series: Vec::new(),
        d_lbls: None,
        ax_id: Vec::new(),
        raw_chart_type_attr: None,
        raw_chart_element_name: None,
        raw_chart_group_xml: None,
    }
}

#[test]
fn data_table_presence_extracts_visible_and_legend_key_alias() {
    let cs = ChartSpace {
        chart: OoxmlChart {
            plot_area: PlotArea {
                chart_groups: vec![chart_group(
                    ChartType::Bar,
                    ChartTypeConfig::Bar(BarChartConfig::default()),
                )],
                d_table: Some(DataTableConfig {
                    show_keys: Some(true),
                    ..Default::default()
                }),
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    };

    let spec = extract_chart_spec_from_chart_space(&cs, &chart_anchor());
    let data_table = spec.data_table.expect("expected data table");

    assert_eq!(data_table.visible, Some(true));
    assert_eq!(data_table.show_keys, Some(true));
    assert_eq!(data_table.show_legend_key, Some(true));
}
