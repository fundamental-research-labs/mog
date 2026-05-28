use std::sync::Arc;

use yrs::types::map::MapRef;
use yrs::{Any, ReadTxn};

use crate::domain::floating_object::ChartData;
use crate::yrs_schema::helpers::{read_bool, read_number, read_string};

use super::codec_helpers::{option_sub_object, read_sub_object};

pub(super) fn append_chart_entries(entries: &mut Vec<(String, Any)>, d: &ChartData) {
    entries.push((
        "chartType".into(),
        Any::String(Arc::from(d.chart_type.as_str())),
    ));
    if let Some(ref v) = d.sub_type {
        entries.push(("subType".into(), Any::String(Arc::from(v.as_str()))));
    }
    if let Some(ref v) = d.series_orientation {
        entries.push((
            "seriesOrientation".into(),
            Any::String(Arc::from(v.as_str())),
        ));
    }
    if let Some(ref v) = d.data_range {
        entries.push(("dataRange".into(), Any::String(Arc::from(v.as_str()))));
    }
    if let Some(a) = option_sub_object(&d.data_range_identity) {
        entries.push(("dataRangeIdentity".into(), a));
    }
    if let Some(ref v) = d.series_range {
        entries.push(("seriesRange".into(), Any::String(Arc::from(v.as_str()))));
    }
    if let Some(a) = option_sub_object(&d.series_range_identity) {
        entries.push(("seriesRangeIdentity".into(), a));
    }
    if let Some(ref v) = d.category_range {
        entries.push(("categoryRange".into(), Any::String(Arc::from(v.as_str()))));
    }
    if let Some(a) = option_sub_object(&d.category_range_identity) {
        entries.push(("categoryRangeIdentity".into(), a));
    }
    if let Some(ref v) = d.title {
        entries.push(("title".into(), Any::String(Arc::from(v.as_str()))));
    }
    if let Some(ref v) = d.subtitle {
        entries.push(("subtitle".into(), Any::String(Arc::from(v.as_str()))));
    }
    if let Some(a) = option_sub_object(&d.legend) {
        entries.push(("legend".into(), a));
    }
    if let Some(a) = option_sub_object(&d.axis) {
        entries.push(("axis".into(), a));
    }
    if let Some(ref v) = d.colors {
        let json_val = serde_json::to_value(v).unwrap_or(serde_json::Value::Null);
        if let Some(a) = option_sub_object(&Some(json_val)) {
            entries.push(("colors".into(), a));
        }
    }
    if let Some(a) = option_sub_object(&d.series) {
        entries.push(("series".into(), a));
    }
    if let Some(a) = option_sub_object(&d.data_labels) {
        entries.push(("dataLabels".into(), a));
    }
    if let Some(a) = option_sub_object(&d.pie_slice) {
        entries.push(("pieSlice".into(), a));
    }
    if let Some(a) = option_sub_object(&d.trendline) {
        entries.push(("trendline".into(), a));
    }
    if let Some(v) = d.show_lines {
        entries.push(("showLines".into(), Any::Bool(v)));
    }
    if let Some(v) = d.smooth_lines {
        entries.push(("smoothLines".into(), Any::Bool(v)));
    }
    if let Some(v) = d.radar_filled {
        entries.push(("radarFilled".into(), Any::Bool(v)));
    }
    if let Some(v) = d.radar_markers {
        entries.push(("radarMarkers".into(), Any::Bool(v)));
    }
    if let Some(a) = option_sub_object(&d.waterfall) {
        entries.push(("waterfall".into(), a));
    }
    if let Some(ref v) = d.display_blanks_as {
        entries.push(("displayBlanksAs".into(), Any::String(Arc::from(v.as_str()))));
    }
    if let Some(v) = d.plot_visible_only {
        entries.push(("plotVisibleOnly".into(), Any::Bool(v)));
    }
    if let Some(v) = d.gap_width {
        entries.push(("gapWidth".into(), Any::Number(v as f64)));
    }
    if let Some(v) = d.overlap {
        entries.push(("overlap".into(), Any::Number(v as f64)));
    }
    if let Some(v) = d.doughnut_hole_size {
        entries.push(("doughnutHoleSize".into(), Any::Number(v as f64)));
    }
    if let Some(v) = d.first_slice_angle {
        entries.push(("firstSliceAngle".into(), Any::Number(v as f64)));
    }
    if let Some(v) = d.bubble_scale {
        entries.push(("bubbleScale".into(), Any::Number(v as f64)));
    }
    if let Some(ref v) = d.split_type {
        entries.push(("splitType".into(), Any::String(Arc::from(v.as_str()))));
    }
    if let Some(v) = d.split_value {
        entries.push(("splitValue".into(), Any::Number(v)));
    }
    if let Some(v) = d.category_label_level {
        entries.push(("categoryLabelLevel".into(), Any::Number(v as f64)));
    }
    if let Some(v) = d.series_name_level {
        entries.push(("seriesNameLevel".into(), Any::Number(v as f64)));
    }
    if let Some(v) = d.show_all_field_buttons {
        entries.push(("showAllFieldButtons".into(), Any::Bool(v)));
    }
    if let Some(v) = d.second_plot_size {
        entries.push(("secondPlotSize".into(), Any::Number(v as f64)));
    }
    if let Some(v) = d.vary_by_categories {
        entries.push(("varyByCategories".into(), Any::Bool(v)));
    }
    if let Some(ref v) = d.title_h_align {
        entries.push(("titleHAlign".into(), Any::String(Arc::from(v.as_str()))));
    }
    if let Some(ref v) = d.title_v_align {
        entries.push(("titleVAlign".into(), Any::String(Arc::from(v.as_str()))));
    }
    if let Some(v) = d.title_show_shadow {
        entries.push(("titleShowShadow".into(), Any::Bool(v)));
    }
    if let Some(a) = option_sub_object(&d.pivot_options) {
        entries.push(("pivotOptions".into(), a));
    }
    if let Some(ref v) = d.bar_shape {
        entries.push(("barShape".into(), Any::String(Arc::from(v.as_str()))));
    }
    if let Some(v) = d.bubble_3d_effect {
        entries.push(("bubble3dEffect".into(), Any::Bool(v)));
    }
    if let Some(v) = d.wireframe {
        entries.push(("wireframe".into(), Any::Bool(v)));
    }
    if let Some(v) = d.surface_top_view {
        entries.push(("surfaceTopView".into(), Any::Bool(v)));
    }
    if let Some(v) = d.color_scheme {
        entries.push(("colorScheme".into(), Any::Number(v as f64)));
    }
    if let Some(v) = d.height_pt {
        entries.push(("heightPt".into(), Any::Number(v)));
    }
    if let Some(v) = d.width_pt {
        entries.push(("widthPt".into(), Any::Number(v)));
    }
    if let Some(v) = d.left_pt {
        entries.push(("leftPt".into(), Any::Number(v)));
    }
    if let Some(v) = d.top_pt {
        entries.push(("topPt".into(), Any::Number(v)));
    }
    if let Some(v) = d.style {
        entries.push(("style".into(), Any::Number(v as f64)));
    }
    if let Some(v) = d.rounded_corners {
        entries.push(("roundedCorners".into(), Any::Bool(v)));
    }
    if let Some(v) = d.auto_title_deleted {
        entries.push(("autoTitleDeleted".into(), Any::Bool(v)));
    }
    if let Some(v) = d.show_data_labels_over_max {
        entries.push(("showDataLabelsOverMax".into(), Any::Bool(v)));
    }
    if let Some(a) = option_sub_object(&d.chart_format) {
        entries.push(("chartFormat".into(), a));
    }
    if let Some(a) = option_sub_object(&d.plot_format) {
        entries.push(("plotFormat".into(), a));
    }
    if let Some(a) = option_sub_object(&d.title_format) {
        entries.push(("titleFormat".into(), a));
    }
    if let Some(a) = option_sub_object(&d.title_rich_text) {
        entries.push(("titleRichText".into(), a));
    }
    if let Some(ref v) = d.title_formula {
        entries.push(("titleFormula".into(), Any::String(Arc::from(v.as_str()))));
    }
    if let Some(a) = option_sub_object(&d.data_table) {
        entries.push(("dataTable".into(), a));
    }
    if let Some(a) = option_sub_object(&d.view_3d) {
        entries.push(("view3d".into(), a));
    }
    if let Some(a) = option_sub_object(&d.floor_format) {
        entries.push(("floorFormat".into(), a));
    }
    if let Some(a) = option_sub_object(&d.side_wall_format) {
        entries.push(("sideWallFormat".into(), a));
    }
    if let Some(a) = option_sub_object(&d.back_wall_format) {
        entries.push(("backWallFormat".into(), a));
    }
    if let Some(ref v) = d.source_table_id {
        entries.push(("sourceTableId".into(), Any::String(Arc::from(v.as_str()))));
    }
    if let Some(ref v) = d.table_data_columns {
        let json_val = serde_json::to_value(v).unwrap_or(serde_json::Value::Null);
        if let Some(a) = option_sub_object(&Some(json_val)) {
            entries.push(("tableDataColumns".into(), a));
        }
    }
    if let Some(ref v) = d.table_category_column {
        entries.push((
            "tableCategoryColumn".into(),
            Any::String(Arc::from(v.as_str())),
        ));
    }
    if let Some(v) = d.use_table_column_names_as_labels {
        entries.push(("useTableColumnNamesAsLabels".into(), Any::Bool(v)));
    }
    if let Some(ref v) = d.table_column_names {
        let json_val = serde_json::to_value(v).unwrap_or(serde_json::Value::Null);
        if let Some(a) = option_sub_object(&Some(json_val)) {
            entries.push(("tableColumnNames".into(), a));
        }
    }
    if let Some(v) = d.width_cells {
        entries.push(("widthCells".into(), Any::Number(v)));
    }
    if let Some(v) = d.height_cells {
        entries.push(("heightCells".into(), Any::Number(v)));
    }
    if let Some(a) = option_sub_object(&d.ooxml) {
        entries.push(("ooxml".into(), a));
    }
}

pub(super) fn read_chart<R: ReadTxn>(map: &MapRef, txn: &R) -> ChartData {
    ChartData {
        chart_type: read_string(map, txn, "chartType")
            .and_then(|s| serde_json::from_value(serde_json::Value::String(s)).ok())
            .unwrap_or_default(),
        sub_type: read_string(map, txn, "subType")
            .and_then(|s| serde_json::from_value(serde_json::Value::String(s)).ok()),
        series_orientation: read_string(map, txn, "seriesOrientation")
            .and_then(|s| serde_json::from_value(serde_json::Value::String(s)).ok()),
        data_range: read_string(map, txn, "dataRange"),
        data_range_identity: read_sub_object(map, txn, "dataRangeIdentity"),
        series_range: read_string(map, txn, "seriesRange"),
        series_range_identity: read_sub_object(map, txn, "seriesRangeIdentity"),
        category_range: read_string(map, txn, "categoryRange"),
        category_range_identity: read_sub_object(map, txn, "categoryRangeIdentity"),
        title: read_string(map, txn, "title").filter(|s| s != "undefined" && !s.is_empty()),
        subtitle: read_string(map, txn, "subtitle").filter(|s| s != "undefined" && !s.is_empty()),
        legend: read_sub_object(map, txn, "legend"),
        axis: read_sub_object(map, txn, "axis"),
        colors: read_sub_object::<Vec<String>, _>(map, txn, "colors"),
        series: read_sub_object(map, txn, "series"),
        data_labels: read_sub_object(map, txn, "dataLabels"),
        pie_slice: read_sub_object(map, txn, "pieSlice"),
        trendline: read_sub_object(map, txn, "trendline"),
        show_lines: read_bool(map, txn, "showLines"),
        smooth_lines: read_bool(map, txn, "smoothLines"),
        radar_filled: read_bool(map, txn, "radarFilled"),
        radar_markers: read_bool(map, txn, "radarMarkers"),
        waterfall: read_sub_object(map, txn, "waterfall"),
        display_blanks_as: read_string(map, txn, "displayBlanksAs"),
        plot_visible_only: read_bool(map, txn, "plotVisibleOnly"),
        gap_width: read_number(map, txn, "gapWidth").map(|n| n as u32),
        overlap: read_number(map, txn, "overlap").map(|n| n as i32),
        doughnut_hole_size: read_number(map, txn, "doughnutHoleSize").map(|n| n as u32),
        first_slice_angle: read_number(map, txn, "firstSliceAngle").map(|n| n as u32),
        bubble_scale: read_number(map, txn, "bubbleScale").map(|n| n as u32),
        split_type: read_string(map, txn, "splitType"),
        split_value: read_number(map, txn, "splitValue"),
        category_label_level: read_number(map, txn, "categoryLabelLevel").map(|n| n as u32),
        series_name_level: read_number(map, txn, "seriesNameLevel").map(|n| n as u32),
        show_all_field_buttons: read_bool(map, txn, "showAllFieldButtons"),
        second_plot_size: read_number(map, txn, "secondPlotSize").map(|n| n as u32),
        vary_by_categories: read_bool(map, txn, "varyByCategories"),
        title_h_align: read_string(map, txn, "titleHAlign"),
        title_v_align: read_string(map, txn, "titleVAlign"),
        title_show_shadow: read_bool(map, txn, "titleShowShadow"),
        pivot_options: read_sub_object(map, txn, "pivotOptions"),
        bar_shape: read_string(map, txn, "barShape"),
        bubble_3d_effect: read_bool(map, txn, "bubble3dEffect"),
        wireframe: read_bool(map, txn, "wireframe"),
        surface_top_view: read_bool(map, txn, "surfaceTopView"),
        color_scheme: read_number(map, txn, "colorScheme").map(|n| n as u8),
        height_pt: read_number(map, txn, "heightPt"),
        width_pt: read_number(map, txn, "widthPt"),
        left_pt: read_number(map, txn, "leftPt"),
        top_pt: read_number(map, txn, "topPt"),
        style: read_number(map, txn, "style").map(|n| n as u8),
        rounded_corners: read_bool(map, txn, "roundedCorners"),
        auto_title_deleted: read_bool(map, txn, "autoTitleDeleted"),
        show_data_labels_over_max: read_bool(map, txn, "showDataLabelsOverMax"),
        chart_format: read_sub_object(map, txn, "chartFormat"),
        plot_format: read_sub_object(map, txn, "plotFormat"),
        title_format: read_sub_object(map, txn, "titleFormat"),
        title_rich_text: read_sub_object(map, txn, "titleRichText"),
        title_formula: read_string(map, txn, "titleFormula"),
        data_table: read_sub_object(map, txn, "dataTable"),
        view_3d: read_sub_object(map, txn, "view3d"),
        floor_format: read_sub_object(map, txn, "floorFormat"),
        side_wall_format: read_sub_object(map, txn, "sideWallFormat"),
        back_wall_format: read_sub_object(map, txn, "backWallFormat"),
        source_table_id: read_string(map, txn, "sourceTableId"),
        table_data_columns: read_sub_object::<Vec<String>, _>(map, txn, "tableDataColumns"),
        table_category_column: read_string(map, txn, "tableCategoryColumn"),
        use_table_column_names_as_labels: read_bool(map, txn, "useTableColumnNamesAsLabels"),
        table_column_names: read_sub_object::<Vec<String>, _>(map, txn, "tableColumnNames"),
        width_cells: read_number(map, txn, "widthCells"),
        height_cells: read_number(map, txn, "heightCells"),
        ooxml: read_sub_object(map, txn, "ooxml"),
    }
}
