use super::*;

fn empty_axes() -> AxisData {
    AxisData {
        category_axis: None,
        value_axis: None,
        secondary_category_axis: None,
        secondary_value_axis: None,
        series_axis: None,
    }
}

fn titled_axis(title: &str) -> SingleAxisData {
    SingleAxisData {
        title: Some(title.to_string()),
        visible: true,
        ..Default::default()
    }
}

fn assert_crossing_axes_exist(axes: &[ChartAxis]) {
    for axis in axes {
        assert!(
            axes.iter().any(|partner| partner.ax_id == axis.cross_ax),
            "axis {} crosses missing axis {}: {axes:?}",
            axis.ax_id,
            axis.cross_ax,
        );
    }
}

#[test]
fn sparse_primary_axis_titles_keep_the_crossing_axis() {
    for chart_type in [
        DomainChartType::Column,
        DomainChartType::Bar,
        DomainChartType::Line,
        DomainChartType::Area,
        DomainChartType::Radar,
    ] {
        for edit_category in [true, false] {
            let mut spec = minimal_chart_spec(chart_type.clone(), Some("Sheet1!A1:B3"));
            let mut axes = empty_axes();
            if edit_category {
                axes.category_axis = Some(titled_axis("Month"));
            } else {
                axes.value_axis = Some(titled_axis("Units"));
            }
            spec.axes = Some(axes);
            let exported = reconstruct_chart_space(&spec).chart.plot_area.axes;
            assert_eq!(exported.len(), 2, "{chart_type:?}: {exported:?}");
            assert_crossing_axes_exist(&exported);
            let xml = chart_xml(&spec);
            assert!(
                xml.contains(if edit_category { ">Month<" } else { ">Units<" }),
                "{xml}"
            );
        }
    }
}

#[test]
fn empty_axis_metadata_keeps_the_default_chart_topology() {
    for chart_type in [
        DomainChartType::Scatter,
        DomainChartType::Bubble,
        DomainChartType::Column3D,
        DomainChartType::Pie,
        DomainChartType::Doughnut,
    ] {
        let mut spec = minimal_chart_spec(chart_type, Some("Sheet1!A1:B3"));
        let defaults = reconstruct_chart_space(&spec).chart.plot_area.axes;
        spec.axes = Some(empty_axes());
        let exported = reconstruct_chart_space(&spec).chart.plot_area.axes;
        assert_eq!(exported, defaults);
        assert_crossing_axes_exist(&exported);
    }
}

#[test]
fn sparse_hidden_axis_keeps_its_settings_and_crossing_partner() {
    let mut spec = minimal_chart_spec(DomainChartType::Column, Some("Sheet1!A1:B3"));
    let mut axes = empty_axes();
    axes.value_axis = Some(SingleAxisData {
        visible: false,
        visible_explicit: true,
        min: Some(2.0),
        max: Some(30.0),
        number_format: Some("0.00".to_string()),
        ..Default::default()
    });
    spec.axes = Some(axes);
    let exported = reconstruct_chart_space(&spec).chart.plot_area.axes;
    assert_eq!(exported.len(), 2);
    assert_crossing_axes_exist(&exported);
    let value = exported
        .iter()
        .find(|axis| axis.ax_id == 222222222)
        .unwrap();
    assert!(value.delete);
    assert_eq!(value.scaling.min, Some(2.0));
    assert_eq!(value.scaling.max, Some(30.0));
    assert_eq!(value.num_fmt.as_ref().unwrap().format_code, "0.00");
    assert!(
        !exported
            .iter()
            .find(|axis| axis.ax_id == 111111111)
            .unwrap()
            .delete
    );
}

#[test]
fn a_sparse_secondary_axis_keeps_both_crossing_pairs() {
    for edit_category in [true, false] {
        let mut spec = minimal_chart_spec(DomainChartType::Column, Some("Sheet1!A1:B3"));
        let mut axes = empty_axes();
        if edit_category {
            axes.secondary_category_axis = Some(titled_axis("Secondary Month"));
        } else {
            axes.secondary_value_axis = Some(titled_axis("Secondary Units"));
        }
        spec.axes = Some(axes);
        let exported = reconstruct_chart_space(&spec).chart.plot_area.axes;
        assert_eq!(exported.len(), 4);
        assert_crossing_axes_exist(&exported);
        let xml = chart_xml(&spec);
        assert!(
            xml.contains(if edit_category {
                ">Secondary Month<"
            } else {
                ">Secondary Units<"
            }),
            "{xml}"
        );
    }
}

#[test]
fn sparse_imported_axis_metadata_keeps_original_axis_ids() {
    let mut spec = minimal_chart_spec(DomainChartType::Column, Some("Sheet1!A1:B3"));
    let mut axes = empty_axes();
    axes.category_axis = Some(titled_axis("Month"));
    spec.axes = Some(axes);
    let spec = with_original_axes(
        spec,
        vec![
            ChartAxis {
                axis_type: AxisType::Category,
                ax_id: 10,
                cross_ax: 20,
                ..Default::default()
            },
            ChartAxis {
                axis_type: AxisType::Value,
                ax_id: 20,
                cross_ax: 10,
                ..Default::default()
            },
        ],
    );
    let exported = reconstruct_chart_space(&spec).chart.plot_area.axes;
    assert_eq!(exported.len(), 2);
    assert_eq!(exported[0].ax_id, 10);
    assert_eq!(exported[1].ax_id, 20);
    assert_crossing_axes_exist(&exported);
    assert!(chart_xml(&spec).contains(">Month<"));
}
