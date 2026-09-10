use crate::domain::comments::types::CommentShape;
use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::vml_presentation::parse_style_dimension;
use crate::infra::xml::{parse_string_attr, parse_string_attr_verbatim};

/// Parse VML shapes for comment positioning.
pub fn parse_vml_shapes(xml: &[u8]) -> Vec<CommentShape> {
    let mut shapes = Vec::new();
    let mut pos = 0;
    let document = std::str::from_utf8(xml)
        .ok()
        .and_then(crate::infra::vml_presentation::elements);

    while let Some(shape_start) = find_tag_simd(xml, b"v:shape", pos) {
        let shape_end = find_closing_tag(xml, b"v:shape", shape_start).unwrap_or(xml.len());
        let close_end = find_gt_simd(xml, shape_end).map_or(shape_end, |end| end + 1);

        if has_note_client_data(&xml[shape_start..shape_end]) {
            if let Some(mut shape) = parse_vml_shape(&xml[shape_start..shape_end]) {
                if let Some((root, children)) = &document {
                    shape.presentation = crate::infra::vml_presentation::capture_shape(
                        &xml[shape_start..close_end],
                        root,
                        children,
                        domain_types::VmlCellAnchor {
                            left_column: shape.left_column,
                            left_offset: i64::from(shape.left_offset),
                            top_row: shape.top_row,
                            top_offset: i64::from(shape.top_offset),
                            right_column: shape.right_column,
                            right_offset: i64::from(shape.right_offset),
                            bottom_row: shape.bottom_row,
                            bottom_offset: i64::from(shape.bottom_offset),
                        },
                        shape.visible,
                    );
                    if let Some(presentation) = &mut shape.presentation {
                        presentation.source_order = shapes.len() as u32;
                    }
                }
                shapes.push(shape);
            }
        }

        pos = shape_end + 1;
    }

    shapes
}

fn parse_vml_shape(xml: &[u8]) -> Option<CommentShape> {
    let mut shape = CommentShape::default();

    let tag_end = find_gt_simd(xml, 0)?;
    let tag = &xml[..tag_end + 1];
    shape.id = parse_string_attr_verbatim(tag, b"id=\"").unwrap_or_default();

    if let Some(style) = parse_string_attr(tag, b"style=\"") {
        shape.visible = !style.contains("visibility:hidden");
        shape.note_width_style = parse_style_dimension(&style, "width");
        shape.note_width = shape
            .note_width_style
            .as_ref()
            .and_then(|dimension| dimension.normalized_pt);
        shape.note_height_style = parse_style_dimension(&style, "height");
        shape.note_height = shape
            .note_height_style
            .as_ref()
            .and_then(|dimension| dimension.normalized_pt);
    }

    if let Some(cd_start) = find_tag_simd(xml, b"x:ClientData", 0) {
        let cd_end = find_closing_tag(xml, b"x:ClientData", cd_start).unwrap_or(xml.len());
        let cd_xml = &xml[cd_start..cd_end];

        if let Some(anchor_start) = find_tag_simd(cd_xml, b"x:Anchor", 0) {
            let content_start = find_gt_simd(cd_xml, anchor_start)
                .map(|p| p + 1)
                .unwrap_or(cd_xml.len());
            let anchor_end =
                find_closing_tag(cd_xml, b"x:Anchor", anchor_start).unwrap_or(cd_xml.len());

            if content_start < anchor_end {
                parse_anchor_values(&cd_xml[content_start..anchor_end], &mut shape);
            }
        }

        if let Some(row_start) = find_tag_simd(cd_xml, b"x:Row", 0) {
            let content_start = find_gt_simd(cd_xml, row_start)
                .map(|p| p + 1)
                .unwrap_or(cd_xml.len());
            let row_end = find_closing_tag(cd_xml, b"x:Row", row_start).unwrap_or(cd_xml.len());

            if content_start < row_end {
                if let Some(row) = parse_u32_content(&cd_xml[content_start..row_end]) {
                    if let Some(col_start) = find_tag_simd(cd_xml, b"x:Column", 0) {
                        let col_content_start = find_gt_simd(cd_xml, col_start)
                            .map(|p| p + 1)
                            .unwrap_or(cd_xml.len());
                        let col_end = find_closing_tag(cd_xml, b"x:Column", col_start)
                            .unwrap_or(cd_xml.len());

                        if col_content_start < col_end {
                            if let Some(col) =
                                parse_u32_content(&cd_xml[col_content_start..col_end])
                            {
                                shape.cell_ref = Some(column_to_ref(col, row));
                            }
                        }
                    }
                }
            }
        }
    }

    shape.image_relationship_ids = parse_imagedata_relationship_ids(xml);

    Some(shape)
}

fn parse_imagedata_relationship_ids(xml: &[u8]) -> Vec<String> {
    let mut rel_ids = Vec::new();
    let mut pos = 0;

    while let Some(imgdata_start) = find_tag_simd(xml, b"v:imagedata", pos) {
        let Some(imgdata_end) = find_gt_simd(xml, imgdata_start) else {
            break;
        };
        let imgdata_element = &xml[imgdata_start..=imgdata_end];
        if let Some(rel_id) = parse_string_attr(imgdata_element, b"o:relid=\"")
            .or_else(|| parse_string_attr(imgdata_element, b"r:id=\""))
        {
            rel_ids.push(rel_id);
        }
        pos = imgdata_end + 1;
    }

    rel_ids
}

fn has_note_client_data(xml: &[u8]) -> bool {
    let Some(cd_start) = find_tag_simd(xml, b"x:ClientData", 0) else {
        return false;
    };
    let Some(cd_tag_end) = find_gt_simd(xml, cd_start) else {
        return false;
    };
    let cd_tag = &xml[cd_start..=cd_tag_end];
    parse_string_attr(cd_tag, b"ObjectType")
        .map(|object_type| object_type.eq_ignore_ascii_case("Note"))
        .unwrap_or(false)
}

fn parse_anchor_values(anchor: &[u8], shape: &mut CommentShape) {
    let text = std::str::from_utf8(anchor).unwrap_or("");
    let parts: Vec<&str> = text.split(',').map(|s| s.trim()).collect();

    if parts.len() >= 8 {
        shape.left_column = parts[0].parse().unwrap_or(0);
        shape.left_offset = parts[1].parse().unwrap_or(0);
        shape.top_row = parts[2].parse().unwrap_or(0);
        shape.top_offset = parts[3].parse().unwrap_or(0);
        shape.right_column = parts[4].parse().unwrap_or(0);
        shape.right_offset = parts[5].parse().unwrap_or(0);
        shape.bottom_row = parts[6].parse().unwrap_or(0);
        shape.bottom_offset = parts[7].parse().unwrap_or(0);
    }
}

fn column_to_ref(col: u32, row: u32) -> String {
    let mut col_str = String::new();
    let mut c = col;

    loop {
        col_str.insert(0, (b'A' + (c % 26) as u8) as char);
        if c < 26 {
            break;
        }
        c = c / 26 - 1;
    }

    format!("{}{}", col_str, row + 1)
}

fn parse_u32_content(xml: &[u8]) -> Option<u32> {
    let s = std::str::from_utf8(xml).ok()?.trim();
    s.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_vml_shapes_empty() {
        let xml = b"<?xml version=\"1.0\"?><xml></xml>";
        let shapes = parse_vml_shapes(xml);
        assert!(shapes.is_empty());
    }

    #[test]
    fn test_parse_vml_shape_basic() {
        let xml = br#"<?xml version="1.0"?>
<xml>
    <v:shape id="_x0000_s1025" style="position:absolute">
        <x:ClientData ObjectType="Note">
            <x:Anchor>1, 15, 0, 2, 3, 15, 5, 14</x:Anchor>
            <x:Row>0</x:Row>
            <x:Column>0</x:Column>
        </x:ClientData>
    </v:shape>
</xml>"#;

        let shapes = parse_vml_shapes(xml);
        assert_eq!(shapes.len(), 1);
        assert_eq!(shapes[0].id, "_x0000_s1025");
        assert_eq!(shapes[0].left_column, 1);
        assert_eq!(shapes[0].left_offset, 15);
        assert_eq!(shapes[0].top_row, 0);
        assert_eq!(shapes[0].cell_ref, Some("A1".to_string()));
    }

    #[test]
    fn test_parse_vml_shape_hidden() {
        let xml = br#"<?xml version="1.0"?>
<xml>
    <v:shape id="s1" style="visibility:hidden">
        <x:ClientData ObjectType="Note">
            <x:Row>0</x:Row>
            <x:Column>0</x:Column>
        </x:ClientData>
    </v:shape>
</xml>"#;

        let shapes = parse_vml_shapes(xml);
        assert!(!shapes[0].visible);
    }

    #[test]
    fn test_column_to_ref() {
        assert_eq!(column_to_ref(0, 0), "A1");
        assert_eq!(column_to_ref(1, 0), "B1");
        assert_eq!(column_to_ref(25, 0), "Z1");
        assert_eq!(column_to_ref(26, 0), "AA1");
        assert_eq!(column_to_ref(27, 0), "AB1");
        assert_eq!(column_to_ref(0, 99), "A100");
    }

    #[test]
    fn test_parse_anchor_values() {
        let mut shape = CommentShape::default();
        parse_anchor_values(b"1, 15, 2, 10, 4, 20, 6, 30", &mut shape);

        assert_eq!(shape.left_column, 1);
        assert_eq!(shape.left_offset, 15);
        assert_eq!(shape.top_row, 2);
        assert_eq!(shape.top_offset, 10);
        assert_eq!(shape.right_column, 4);
        assert_eq!(shape.right_offset, 20);
        assert_eq!(shape.bottom_row, 6);
        assert_eq!(shape.bottom_offset, 30);
    }
}
