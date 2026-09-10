use ooxml_types::charts::{
    CatDataSource, ChartSeries, ChartType, DataLabelOptions, DataPointOverride, Marker, NumData,
    NumDataSource, PictureOptions, StrData,
};
use quick_xml::{Reader, events::Event};

use super::series::emit_series;
use crate::write::xml_writer::XmlWriter;

// Ordered CT_*Ser particles, verified against the official Open XML SDK schema:
// https://github.com/dotnet/Open-XML-SDK/blob/main/data/schemas/schemas_openxmlformats_org_drawingml_2006_chart.json
#[test]
fn chart_series_children_follow_all_eight_schema_sequences() {
    use ChartType::*;
    for (types, expected) in [
        (
            vec![Bar, Bar3D],
            vec![
                "idx",
                "order",
                "invertIfNegative",
                "pictureOptions",
                "dPt",
                "dLbls",
                "cat",
                "val",
                "extLst",
            ],
        ),
        (
            vec![Line, Line3D, Stock],
            vec![
                "idx",
                "order",
                "marker",
                "pictureOptions",
                "dPt",
                "dLbls",
                "cat",
                "val",
                "smooth",
                "extLst",
            ],
        ),
        (
            vec![Pie, Pie3D, Doughnut, OfPie],
            vec![
                "idx",
                "order",
                "pictureOptions",
                "explosion",
                "dPt",
                "dLbls",
                "cat",
                "val",
                "extLst",
            ],
        ),
        (
            vec![Area, Area3D],
            vec![
                "idx",
                "order",
                "pictureOptions",
                "dPt",
                "dLbls",
                "cat",
                "val",
                "extLst",
            ],
        ),
        (
            vec![Radar],
            vec![
                "idx",
                "order",
                "pictureOptions",
                "marker",
                "dPt",
                "dLbls",
                "cat",
                "val",
                "extLst",
            ],
        ),
        (
            vec![Surface, Surface3D],
            vec![
                "idx",
                "order",
                "pictureOptions",
                "cat",
                "val",
                "bubble3D",
                "extLst",
            ],
        ),
        (
            vec![Scatter],
            vec![
                "idx", "order", "marker", "dPt", "dLbls", "xVal", "yVal", "smooth", "extLst",
            ],
        ),
        (
            vec![Bubble],
            vec![
                "idx",
                "order",
                "pictureOptions",
                "invertIfNegative",
                "dPt",
                "dLbls",
                "xVal",
                "yVal",
                "bubbleSize",
                "bubble3D",
                "extLst",
            ],
        ),
    ] {
        for chart_type in types {
            let mut series = ChartSeries {
                has_empty_ext_lst: true,
                ..Default::default()
            };
            if expected.contains(&"pictureOptions") {
                series.picture_options = Some(PictureOptions::default());
            }
            if expected.contains(&"invertIfNegative") {
                series.invert_if_negative = Some(true);
            }
            if expected.contains(&"marker") {
                series.marker = Some(Marker::default());
            }
            if expected.contains(&"explosion") {
                series.explosion = Some(25);
            }
            if expected.contains(&"dPt") {
                series.d_pt = vec![DataPointOverride::default()];
            }
            if expected.contains(&"dLbls") {
                series.d_lbls = Some(DataLabelOptions::default());
            }
            if expected.contains(&"cat") {
                series.cat = Some(CatDataSource::StrLit(StrData::default()));
            }
            if expected.contains(&"val") {
                series.val = Some(NumDataSource::Lit(NumData::default()));
            }
            if expected.contains(&"xVal") {
                series.x_val = Some(CatDataSource::NumLit(NumData::default()));
            }
            if expected.contains(&"yVal") {
                series.y_val = Some(NumDataSource::Lit(NumData::default()));
            }
            if expected.contains(&"bubbleSize") {
                series.bubble_size = Some(NumDataSource::Lit(NumData::default()));
            }
            if expected.contains(&"bubble3D") {
                series.bubble_3d = Some(true);
            }
            if expected.contains(&"smooth") {
                series.smooth = Some(true);
            }
            let mut writer = XmlWriter::new();
            emit_series(&mut writer, &series, chart_type);
            let bytes = writer.finish();
            assert_eq!(
                direct_children(&bytes),
                expected,
                "{chart_type:?}: {}",
                String::from_utf8_lossy(&bytes)
            );
        }
    }
}

fn direct_children(xml: &[u8]) -> Vec<String> {
    let mut reader = Reader::from_reader(xml);
    let mut depth = 0;
    let mut names = Vec::new();
    loop {
        match reader.read_event().unwrap() {
            Event::Start(tag) => {
                if depth == 1 {
                    names.push(String::from_utf8_lossy(tag.local_name().as_ref()).into_owned());
                }
                depth += 1;
            }
            Event::Empty(tag) if depth == 1 => {
                names.push(String::from_utf8_lossy(tag.local_name().as_ref()).into_owned())
            }
            Event::End(_) => depth -= 1,
            Event::Eof => break,
            _ => {}
        }
    }
    names
}
