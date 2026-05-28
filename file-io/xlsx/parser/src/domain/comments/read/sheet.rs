use super::legacy::parse_comments;
use crate::domain::comments::types::{Comment, CommentRun};
use crate::output::results::{CommentOutput, CommentRunOutput};

fn extract_comments_path_for_sheet(sheet_num: usize, rels_xml: &[u8]) -> Option<String> {
    let relationships = crate::infra::opc::parse_owned_relationships(
        crate::infra::opc::PackageOwner::Worksheet {
            sheet_index: sheet_num,
            path: format!("xl/worksheets/sheet{}.xml", sheet_num),
        },
        rels_xml,
    );
    crate::infra::opc::WorksheetRelationships::new(&relationships)
        .comments()
        .into_iter()
        .next()
        .and_then(|rel| rel.target.path().map(ToOwned::to_owned))
}

/// Parse comments for a specific sheet.
///
/// Uses the sheet relationship file (`xl/worksheets/_rels/sheet{N}.xml.rels`)
/// to discover the actual comments file path. Absent that relationship, the
/// sheet has no comments.
pub fn parse_comments_for_sheet(
    archive: &crate::zip::XlsxArchive,
    sheet_num: usize,
) -> (
    Vec<CommentOutput>,
    Vec<String>,
    Vec<(String, String)>,
    Option<String>,
) {
    let comments_path = {
        let rels_path = format!("xl/worksheets/_rels/sheet{}.xml.rels", sheet_num);
        match archive.read_file(&rels_path) {
            Ok(rels_xml) => match extract_comments_path_for_sheet(sheet_num, &rels_xml) {
                Some(path) => path,
                None => return (Vec::new(), Vec::new(), Vec::new(), None),
            },
            Err(_) => return (Vec::new(), Vec::new(), Vec::new(), None),
        }
    };

    if let Ok(comments_xml) = archive.read_file(&comments_path) {
        let comments_result = parse_comments(&comments_xml);
        let authors = comments_result.authors.clone();
        let root_ns_attrs = comments_result.root_namespace_attrs.clone();
        let ext_lst_xml = comments_result.ext_lst_xml.clone();
        let comments = comments_result
            .comments
            .iter()
            .map(comment_to_output)
            .collect();
        (comments, authors, root_ns_attrs, ext_lst_xml)
    } else {
        (Vec::new(), Vec::new(), Vec::new(), None)
    }
}

fn comment_to_output(comment: &Comment) -> CommentOutput {
    CommentOutput {
        cell_ref: comment.cell_ref.clone(),
        author_id: comment.author_id as usize,
        text: comment.text(),
        runs: comment.rich_text.iter().map(run_to_output).collect(),
        shape_id: comment.shape_id,
        xr_uid: comment.xr_uid.clone(),
        comment_pr: comment.comment_pr.clone(),
    }
}

fn run_to_output(run: &CommentRun) -> CommentRunOutput {
    let (
        font_name,
        font_size,
        bold,
        italic,
        underline,
        strike,
        color,
        color_indexed,
        color_theme,
        color_tint,
        font_family,
        scheme,
        charset,
    ) = match &run.font {
        Some(f) => (
            f.name.clone(),
            f.size,
            f.bold,
            f.italic,
            f.underline,
            f.strike,
            f.color.clone(),
            f.color_indexed,
            f.color_theme,
            f.color_tint,
            f.family,
            f.scheme.clone(),
            f.charset,
        ),
        None => (
            None, None, false, false, false, false, None, None, None, None, None, None, None,
        ),
    };

    CommentRunOutput {
        text: run.text.clone(),
        font_name,
        font_size,
        bold,
        italic,
        underline,
        strike,
        color,
        color_indexed,
        color_theme,
        color_tint,
        font_family,
        scheme,
        charset,
        vert_align: None,
        preserve_space: run.preserve_space,
    }
}
