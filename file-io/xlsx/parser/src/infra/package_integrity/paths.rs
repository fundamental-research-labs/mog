use crate::infra::opc::OpcTargetResolutionError;

pub(super) fn part_rels_path(part_path: &str) -> String {
    let (dir, file) = part_path.rsplit_once('/').unwrap_or(("", part_path));
    if dir.is_empty() {
        format!("_rels/{file}.rels")
    } else {
        format!("{dir}/_rels/{file}.rels")
    }
}

fn is_xml_part(path: &str) -> bool {
    path.ends_with(".xml") && path != "[Content_Types].xml" && !is_relationship_part(path)
}

pub(super) fn is_relationship_reference_part(path: &str) -> bool {
    is_xml_part(path) || path.ends_with(".vml")
}

pub(super) fn worksheet_rels_path(worksheet_path: &str) -> String {
    let (dir, file) = worksheet_path
        .rsplit_once('/')
        .unwrap_or(("", worksheet_path));
    if dir.is_empty() {
        format!("_rels/{file}.rels")
    } else {
        format!("{dir}/_rels/{file}.rels")
    }
}

pub(super) fn is_relationship_part(path: &str) -> bool {
    path == "_rels/.rels" || (path.contains("/_rels/") && path.ends_with(".rels"))
}

pub(super) fn is_worksheet_part(path: &str) -> bool {
    path.starts_with("xl/worksheets/sheet") && path.ends_with(".xml")
}

pub(super) fn is_table_part(path: &str) -> bool {
    path.starts_with("xl/tables/table") && path.ends_with(".xml")
}

pub(super) fn is_comment_part(path: &str) -> bool {
    path.starts_with("xl/comments") && path.ends_with(".xml")
}

pub(super) fn is_threaded_comment_part(path: &str) -> bool {
    path.starts_with("xl/threadedComments/threadedComment") && path.ends_with(".xml")
}

pub(super) fn is_drawing_part(path: &str) -> bool {
    path.starts_with("xl/drawings/drawing") && path.ends_with(".xml")
}

pub(super) fn is_vml_part(path: &str) -> bool {
    path.starts_with("xl/drawings/vmlDrawing") && path.ends_with(".vml")
}

pub(super) fn is_chart_part(path: &str) -> bool {
    path.starts_with("xl/charts/chart")
        && !path.starts_with("xl/charts/chartEx")
        && path.ends_with(".xml")
}

pub(super) fn is_chart_ex_part(path: &str) -> bool {
    path.starts_with("xl/charts/chartEx") && path.ends_with(".xml")
}

pub(super) fn relationship_target_part(target: &str) -> Option<&str> {
    let part = target.split_once('#').map_or(target, |(part, _)| part);
    (!part.is_empty()).then_some(part)
}

pub(super) fn format_resolution_error(err: OpcTargetResolutionError) -> String {
    match err {
        OpcTargetResolutionError::EmptyTarget => "empty internal target".to_string(),
        OpcTargetResolutionError::BackslashTarget => {
            "internal target contains backslash separators".to_string()
        }
        OpcTargetResolutionError::EscapesPackageRoot => {
            "internal target escapes package root".to_string()
        }
        OpcTargetResolutionError::InvalidSegment => {
            "internal target contains an invalid path segment".to_string()
        }
    }
}

pub(super) fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}
