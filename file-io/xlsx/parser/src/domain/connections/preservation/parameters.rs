use super::{
    merged_start, overlay_node, render_generated_node, rendered, typed_attrs, Item, Node,
    RenderedChild,
};
use domain_types::domain::connections::ConnectionParameter;

pub(super) fn overlay_parameters_node(
    source: &Node,
    generated: &Node,
    output: &mut Vec<u8>,
    inherited_default_main: bool,
    owners: &[ConnectionParameter],
) {
    let source_parameters = source
        .children
        .iter()
        .filter_map(|item| match item {
            Item::Node(node) if node.main() && node.local == b"parameter" => Some(node),
            _ => None,
        })
        .collect::<Vec<_>>();
    let generated_parameters = generated
        .children
        .iter()
        .filter_map(|item| match item {
            Item::Node(node) if node.main() && node.local == b"parameter" => Some(node),
            _ => None,
        })
        .collect::<Vec<_>>();
    let positional_compatibility = owners
        .iter()
        .all(|parameter| parameter.raw_source_index.is_none());
    let current_default_main = super::explicit_default_main(&source.start)
        .unwrap_or(inherited_default_main && source.name.iter().all(|byte| *byte != b':'));
    let mut used_source_parameters = vec![false; source_parameters.len()];
    let mut generated_rows = Vec::with_capacity(generated_parameters.len());

    for (typed_index, generated_parameter) in generated_parameters.iter().enumerate() {
        let source_index = owners
            .get(typed_index)
            .and_then(|parameter| parameter.raw_source_index)
            .or_else(|| positional_compatibility.then_some(typed_index));
        let mut row = Vec::new();
        if let Some(source_index) = source_index {
            if let Some(source_parameter) = source_parameters.get(source_index) {
                if !used_source_parameters[source_index] {
                    used_source_parameters[source_index] = true;
                    overlay_node(
                        source_parameter,
                        generated_parameter,
                        &mut row,
                        current_default_main,
                        None,
                    );
                } else {
                    render_generated_node(generated_parameter, current_default_main, &mut row);
                }
            } else {
                render_generated_node(generated_parameter, current_default_main, &mut row);
            }
        } else {
            render_generated_node(generated_parameter, current_default_main, &mut row);
        }
        generated_rows.push(row);
    }

    let mut children = Vec::new();
    let mut inserted = false;
    for item in &source.children {
        let is_owned_parameter = matches!(
            item,
            Item::Node(node) if node.main() && node.local == b"parameter"
        );
        if is_owned_parameter {
            if !inserted {
                children.extend(
                    generated_rows
                        .iter()
                        .cloned()
                        .map(|row| RenderedChild::element(row, Some(0))),
                );
                inserted = true;
            }
            continue;
        }
        match item {
            Item::Raw(raw) => children.push(RenderedChild::raw(raw.clone())),
            Item::Node(_) => children.push(RenderedChild::element(rendered(item), None)),
        }
    }
    if !inserted {
        for row in generated_rows {
            super::insert_schema_ordered(&mut children, RenderedChild::element(row, Some(0)));
        }
    }

    let empty = source.empty && children.is_empty();
    let start = merged_start(
        source,
        generated,
        typed_attrs(source.local.as_slice()),
        empty,
    );
    output.push(b'<');
    output.extend_from_slice(&start);
    output.push(b'>');
    if !empty {
        for child in children {
            output.extend_from_slice(&child.bytes);
        }
        output.extend_from_slice(b"</");
        output.extend_from_slice(source.end.as_deref().unwrap_or(&source.name));
        output.push(b'>');
    }
}
