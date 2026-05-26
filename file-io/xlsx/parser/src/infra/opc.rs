/// Convert an OPC relationship target to a ZIP archive path.
///
/// OPC targets can be relative (`../drawings/drawing1.xml`) or absolute
/// (`/xl/drawings/drawing1.xml`). This normalizes both forms into a ZIP
/// path like `xl/drawings/drawing1.xml`.
///
/// `base_dir` is the directory of the part that owns the relationship
/// (e.g. `"xl/worksheets"` for sheet-level rels, `"xl"` for workbook rels).
/// It is only used when the target is relative.
pub fn opc_target_to_zip_path(target: &str, base_dir: &str) -> String {
    if let Some(stripped) = target.strip_prefix('/') {
        stripped.to_string()
    } else if let Some(rest) = target.strip_prefix("../") {
        // Walk up one level from base_dir, then append the rest.
        let parent = base_dir.rsplit_once('/').map(|(p, _)| p).unwrap_or("");
        if parent.is_empty() {
            rest.to_string()
        } else {
            format!("{}/{}", parent, rest)
        }
    } else {
        format!("{}/{}", base_dir, target)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpcTargetResolutionError {
    EmptyTarget,
    BackslashTarget,
    EscapesPackageRoot,
    InvalidSegment,
}

/// Convert a relationship part path to its owner part.
///
/// `_rels/.rels` is the package-root relationship part and has no owner part.
/// `xl/worksheets/_rels/sheet1.xml.rels` owns `xl/worksheets/sheet1.xml`.
pub fn relationship_owner_from_rels_path(rels_path: &str) -> Option<String> {
    if rels_path == "_rels/.rels" {
        return None;
    }

    let (dir, file) = rels_path.rsplit_once('/')?;
    let owner_file = file.strip_suffix(".rels")?;
    let owner_dir = dir.strip_suffix("/_rels")?;
    if owner_dir.is_empty() {
        Some(owner_file.to_string())
    } else {
        Some(format!("{owner_dir}/{owner_file}"))
    }
}

/// Resolve an internal relationship target against its owner part.
///
/// `owner_part == None` represents the package-root relationship part.
pub fn resolve_relationship_target(
    owner_part: Option<&str>,
    target: &str,
) -> Result<String, OpcTargetResolutionError> {
    if target.is_empty() {
        return Err(OpcTargetResolutionError::EmptyTarget);
    }
    if target.contains('\\') {
        return Err(OpcTargetResolutionError::BackslashTarget);
    }

    let mut segments: Vec<&str> = Vec::new();
    if target.starts_with('/') {
        push_normalized_segments(&mut segments, target.trim_start_matches('/'))?;
    } else {
        if let Some(owner) = owner_part
            && let Some((dir, _)) = owner.rsplit_once('/')
        {
            push_normalized_segments(&mut segments, dir)?;
        }
        push_normalized_segments(&mut segments, target)?;
    }

    if segments.is_empty() {
        return Err(OpcTargetResolutionError::EmptyTarget);
    }
    Ok(segments.join("/"))
}

fn push_normalized_segments<'a>(
    segments: &mut Vec<&'a str>,
    path: &'a str,
) -> Result<(), OpcTargetResolutionError> {
    for segment in path.split('/') {
        match segment {
            "" => return Err(OpcTargetResolutionError::InvalidSegment),
            "." => {}
            ".." => {
                if segments.pop().is_none() {
                    return Err(OpcTargetResolutionError::EscapesPackageRoot);
                }
            }
            s => segments.push(s),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absolute_path() {
        assert_eq!(
            opc_target_to_zip_path("/xl/drawings/drawing1.xml", "xl/worksheets"),
            "xl/drawings/drawing1.xml"
        );
    }

    #[test]
    fn relative_path_from_worksheets() {
        assert_eq!(
            opc_target_to_zip_path("../drawings/drawing1.xml", "xl/worksheets"),
            "xl/drawings/drawing1.xml"
        );
    }

    #[test]
    fn relative_path_from_xl() {
        assert_eq!(
            opc_target_to_zip_path("../comments1.xml", "xl/worksheets"),
            "xl/comments1.xml"
        );
    }

    #[test]
    fn same_directory_reference() {
        assert_eq!(
            opc_target_to_zip_path("chart1.xml", "xl/charts"),
            "xl/charts/chart1.xml"
        );
    }

    #[test]
    fn relationship_owner_paths() {
        assert_eq!(relationship_owner_from_rels_path("_rels/.rels"), None);
        assert_eq!(
            relationship_owner_from_rels_path("xl/_rels/workbook.xml.rels").as_deref(),
            Some("xl/workbook.xml")
        );
        assert_eq!(
            relationship_owner_from_rels_path("xl/worksheets/_rels/sheet1.xml.rels").as_deref(),
            Some("xl/worksheets/sheet1.xml")
        );
    }

    #[test]
    fn resolve_relationship_targets() {
        assert_eq!(
            resolve_relationship_target(
                Some("xl/worksheets/sheet1.xml"),
                "../drawings/drawing1.xml"
            )
            .unwrap(),
            "xl/drawings/drawing1.xml"
        );
        assert_eq!(
            resolve_relationship_target(Some("xl/workbook.xml"), "worksheets/sheet1.xml").unwrap(),
            "xl/worksheets/sheet1.xml"
        );
        assert_eq!(
            resolve_relationship_target(None, "xl/workbook.xml").unwrap(),
            "xl/workbook.xml"
        );
        assert_eq!(
            resolve_relationship_target(
                Some("xl/worksheets/sheet1.xml"),
                "/xl/drawings/drawing1.xml"
            )
            .unwrap(),
            "xl/drawings/drawing1.xml"
        );
        assert_eq!(
            resolve_relationship_target(Some("xl/workbook.xml"), "../../evil.xml"),
            Err(OpcTargetResolutionError::EscapesPackageRoot)
        );
    }
}
