use ooxml_types::charts::{ChartText, Title};
use ooxml_types::drawings::{RunProperties, TextBody, TextBodyProperties, TextRunContent};

pub(super) fn preserve_imported_title_text_properties(
    title: &mut Title,
    imported_title: Option<&Title>,
) {
    let Some(imported_title) = imported_title else {
        return;
    };
    let Some(ChartText::Rich(target_body)) = title.tx.as_mut() else {
        return;
    };
    let Some(ChartText::Rich(imported_body)) = imported_title.tx.as_ref() else {
        return;
    };
    if text_body_visible_text(target_body) != text_body_visible_text(imported_body) {
        return;
    }

    merge_missing_text_body_properties(target_body, imported_body);
}

pub(super) fn preserve_imported_text_body_properties(
    target: &mut Option<TextBody>,
    imported: Option<&TextBody>,
) {
    match (target, imported) {
        (Some(target), Some(imported)) => merge_missing_text_body_properties(target, imported),
        (target @ None, Some(imported)) => *target = Some(imported.clone()),
        _ => {}
    }
}

fn merge_missing_text_body_properties(target: &mut TextBody, imported: &TextBody) {
    merge_missing_body_properties(&mut target.body_props, &imported.body_props);
    fill_missing(&mut target.list_style, &imported.list_style);
    merge_missing_text_body_run_properties(target, imported);
}

fn merge_missing_body_properties(target: &mut TextBodyProperties, imported: &TextBodyProperties) {
    fill_missing(&mut target.rot, &imported.rot);
    fill_missing(&mut target.anchor, &imported.anchor);
    fill_missing(&mut target.wrap, &imported.wrap);
    fill_missing(&mut target.l_ins, &imported.l_ins);
    fill_missing(&mut target.t_ins, &imported.t_ins);
    fill_missing(&mut target.r_ins, &imported.r_ins);
    fill_missing(&mut target.b_ins, &imported.b_ins);
    fill_missing(&mut target.vert, &imported.vert);
    fill_missing(&mut target.vert_overflow, &imported.vert_overflow);
    fill_missing(&mut target.horz_overflow, &imported.horz_overflow);
    fill_missing(&mut target.anchor_ctr, &imported.anchor_ctr);
    fill_missing(&mut target.rtl_col, &imported.rtl_col);
    fill_missing(
        &mut target.spc_first_last_para,
        &imported.spc_first_last_para,
    );
    fill_missing(&mut target.num_col, &imported.num_col);
    fill_missing(&mut target.spc_col, &imported.spc_col);
    fill_missing(&mut target.upright, &imported.upright);
    fill_missing(&mut target.compat_ln_spc, &imported.compat_ln_spc);
    fill_missing(&mut target.force_aa, &imported.force_aa);
    fill_missing(&mut target.from_word_art, &imported.from_word_art);
    fill_missing(&mut target.autofit, &imported.autofit);
    fill_missing(&mut target.ext_lst, &imported.ext_lst);
    fill_missing(&mut target.prst_tx_warp, &imported.prst_tx_warp);
    fill_missing(&mut target.scene3d, &imported.scene3d);
    fill_missing(&mut target.sp3d, &imported.sp3d);
    fill_missing(&mut target.flat_tx, &imported.flat_tx);
}

fn merge_missing_text_body_run_properties(target: &mut TextBody, imported: &TextBody) {
    for (target_paragraph, imported_paragraph) in
        target.paragraphs.iter_mut().zip(imported.paragraphs.iter())
    {
        merge_missing_boxed_run_properties(
            &mut target_paragraph.props.def_run_props,
            &imported_paragraph.props.def_run_props,
        );
        merge_missing_optional_run_properties(
            &mut target_paragraph.end_para_rpr,
            imported_paragraph.end_para_rpr.as_ref(),
        );

        for (target_run, imported_run) in target_paragraph
            .runs
            .iter_mut()
            .zip(imported_paragraph.runs.iter())
        {
            merge_missing_run_content_properties(target_run, imported_run);
        }
    }
}

fn merge_missing_run_content_properties(target: &mut TextRunContent, imported: &TextRunContent) {
    if run_content_visible_text(target) != run_content_visible_text(imported) {
        return;
    }

    match target {
        TextRunContent::Run(target_run) => {
            if let Some(imported_props) = run_content_properties(imported) {
                merge_missing_run_properties(&mut target_run.props, imported_props);
            }
        }
        TextRunContent::LineBreak { props } => {
            merge_missing_optional_run_properties(props, run_content_properties(imported));
        }
        TextRunContent::Field { run_props, .. } => {
            merge_missing_optional_run_properties(run_props, run_content_properties(imported));
        }
    }
}

fn run_content_properties(content: &TextRunContent) -> Option<&RunProperties> {
    match content {
        TextRunContent::Run(run) => Some(&run.props),
        TextRunContent::LineBreak { props } => props.as_ref(),
        TextRunContent::Field { run_props, .. } => run_props.as_ref(),
    }
}

fn merge_missing_boxed_run_properties(
    target: &mut Option<Box<RunProperties>>,
    imported: &Option<Box<RunProperties>>,
) {
    match (target, imported) {
        (Some(target), Some(imported)) => merge_missing_run_properties(target, imported),
        (target @ None, Some(imported)) => *target = Some(imported.clone()),
        _ => {}
    }
}

fn merge_missing_optional_run_properties(
    target: &mut Option<RunProperties>,
    imported: Option<&RunProperties>,
) {
    match (target, imported) {
        (Some(target), Some(imported)) => merge_missing_run_properties(target, imported),
        (target @ None, Some(imported)) => *target = Some(imported.clone()),
        _ => {}
    }
}

fn merge_missing_run_properties(target: &mut RunProperties, imported: &RunProperties) {
    fill_missing(&mut target.size, &imported.size);
    fill_missing(&mut target.bold, &imported.bold);
    fill_missing(&mut target.italic, &imported.italic);
    fill_missing(&mut target.underline, &imported.underline);
    fill_missing(&mut target.strike, &imported.strike);
    fill_missing(&mut target.latin, &imported.latin);
    fill_missing(&mut target.ea, &imported.ea);
    fill_missing(&mut target.cs, &imported.cs);
    fill_missing(&mut target.sym, &imported.sym);
    fill_missing(&mut target.color, &imported.color);
    fill_missing(&mut target.lang, &imported.lang);
    fill_missing(&mut target.alt_lang, &imported.alt_lang);
    fill_missing(&mut target.kern, &imported.kern);
    fill_missing(&mut target.cap, &imported.cap);
    fill_missing(&mut target.spacing, &imported.spacing);
    fill_missing(&mut target.baseline, &imported.baseline);
    fill_missing(&mut target.highlight, &imported.highlight);
    fill_missing(&mut target.hlink_click, &imported.hlink_click);
    fill_missing(&mut target.hlink_mouse_over, &imported.hlink_mouse_over);
    fill_missing(&mut target.text_fill, &imported.text_fill);
    fill_missing(&mut target.text_outline, &imported.text_outline);
    fill_missing(&mut target.effects, &imported.effects);
    fill_missing(&mut target.underline_line, &imported.underline_line);
    fill_missing(&mut target.underline_fill, &imported.underline_fill);
    fill_missing(&mut target.kumimoji, &imported.kumimoji);
    fill_missing(&mut target.normalize_h, &imported.normalize_h);
    fill_missing(&mut target.no_proof, &imported.no_proof);
    fill_missing(&mut target.dirty, &imported.dirty);
    fill_missing(&mut target.err, &imported.err);
    fill_missing(&mut target.smt_clean, &imported.smt_clean);
    fill_missing(&mut target.smt_id, &imported.smt_id);
    fill_missing(&mut target.bmk, &imported.bmk);
    fill_missing(&mut target.rtl, &imported.rtl);
    fill_missing(&mut target.ext_lst, &imported.ext_lst);
}

fn fill_missing<T: Clone>(target: &mut Option<T>, imported: &Option<T>) {
    if target.is_none() {
        *target = imported.clone();
    }
}

fn text_body_visible_text(body: &TextBody) -> String {
    let mut text = String::new();
    for (index, paragraph) in body.paragraphs.iter().enumerate() {
        if index > 0 {
            text.push('\n');
        }
        for run in &paragraph.runs {
            text.push_str(&run_content_visible_text(run));
        }
    }
    text
}

fn run_content_visible_text(content: &TextRunContent) -> String {
    match content {
        TextRunContent::Run(run) => run.text.clone(),
        TextRunContent::LineBreak { .. } => "\n".to_string(),
        TextRunContent::Field { text, .. } => text.clone().unwrap_or_default(),
    }
}
