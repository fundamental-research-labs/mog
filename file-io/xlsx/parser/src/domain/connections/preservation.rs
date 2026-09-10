//! Source-owned XML preservation for workbook connections.

use super::write_connections_xml;
use domain_types::domain::connections::*;
use quick_xml::events::{BytesStart, Event};
use quick_xml::name::{Namespace, ResolveResult};
use quick_xml::reader::NsReader;

const MAIN_NS: &[u8] = b"http://schemas.openxmlformats.org/spreadsheetml/2006/main";

mod parameters;

pub(super) fn write_connection_set_xml(set: &WorkbookConnectionSet) -> Vec<u8> {
    let Some(raw) = set.raw_xml.as_deref() else {
        return write_canonical_connection_set(&set.connections);
    };
    // Source ownership is established by the import fingerprint. A raw XML
    // string supplied without that marker is data, not an authorized replay
    // source, and therefore uses the canonical typed writer.
    if set.raw_connections_fingerprint.is_none() {
        return write_canonical_connection_set(&set.connections);
    }
    let Some(source) = parse_document(raw.as_bytes()) else {
        return write_canonical_connection_set(&set.connections);
    };
    if set.raw_xml_if_current() == Some(raw) {
        return raw.as_bytes().to_vec();
    }
    overlay_document(&source, &set.connections)
        .unwrap_or_else(|| write_canonical_connection_set(&set.connections))
}

/// Keep the legacy `oledb_pr` projection available to callers while refusing
/// to synthesize `<oledbPr>`. It is not a child of SpreadsheetML CT_Connection;
/// imported instances remain source-owned opaque XML in the overlay tree.
fn write_canonical_connection_set(connections: &[WorkbookConnection]) -> Vec<u8> {
    write_connections_xml(&without_unsupported_projections(connections))
}
fn without_unsupported_projections(connections: &[WorkbookConnection]) -> Vec<WorkbookConnection> {
    connections
        .iter()
        .cloned()
        .map(|mut connection| {
            connection.oledb_pr = None;
            connection
        })
        .collect()
}

#[derive(Clone)]
struct Document {
    before: Vec<Item>,
    root: Node,
    after: Vec<Item>,
}

#[derive(Clone)]
enum Item {
    Node(Node),
    Raw(Vec<u8>),
}

#[derive(Clone)]
struct Node {
    name: Vec<u8>,
    local: Vec<u8>,
    namespace: Option<Vec<u8>>,
    start: Vec<u8>,
    end: Option<Vec<u8>>,
    empty: bool,
    children: Vec<Item>,
}

impl Node {
    fn main(&self) -> bool {
        self.namespace.as_deref() == Some(MAIN_NS)
    }
}

fn parse_document(xml: &[u8]) -> Option<Document> {
    let mut reader = NsReader::from_reader(xml);
    reader.config_mut().trim_text(false);
    reader.config_mut().expand_empty_elements = false;
    let mut buf = Vec::new();
    let mut stack = Vec::<Node>::new();
    let mut before = Vec::new();
    let mut root = None;
    let mut after = Vec::new();

    loop {
        let (ns, event) = reader.read_resolved_event_into(&mut buf).ok()?;
        match event {
            Event::Start(start) => {
                let namespace = namespace(&ns)?;
                if !valid_attrs(&reader, &start) {
                    return None;
                }
                stack.push(Node {
                    name: start.name().as_ref().to_vec(),
                    local: start.local_name().as_ref().to_vec(),
                    namespace,
                    start: (&*start).to_vec(),
                    end: None,
                    empty: false,
                    children: Vec::new(),
                });
            }
            Event::Empty(start) => {
                let namespace = namespace(&ns)?;
                if !valid_attrs(&reader, &start) {
                    return None;
                }
                append(
                    Item::Node(Node {
                        name: start.name().as_ref().to_vec(),
                        local: start.local_name().as_ref().to_vec(),
                        namespace,
                        start: (&*start).to_vec(),
                        end: None,
                        empty: true,
                        children: Vec::new(),
                    }),
                    &mut stack,
                    &mut root,
                    &mut before,
                    &mut after,
                )?;
            }
            Event::End(end) => {
                namespace(&ns)?;
                let mut node = stack.pop()?;
                node.end = Some((&*end).to_vec());
                append(
                    Item::Node(node),
                    &mut stack,
                    &mut root,
                    &mut before,
                    &mut after,
                )?;
            }
            Event::Eof => break,
            other => append(
                Item::Raw(raw_event(&other)),
                &mut stack,
                &mut root,
                &mut before,
                &mut after,
            )?,
        }
        buf.clear();
    }

    if !stack.is_empty() {
        return None;
    }
    let root = root?;
    (root.local == b"connections" && root.main()).then_some(Document {
        before,
        root,
        after,
    })
}

fn namespace(ns: &ResolveResult<'_>) -> Option<Option<Vec<u8>>> {
    match ns {
        ResolveResult::Bound(Namespace(uri)) => Some(Some(uri.to_vec())),
        ResolveResult::Unbound => Some(None),
        ResolveResult::Unknown(_) => None,
    }
}

fn valid_attrs<R: std::io::BufRead>(reader: &NsReader<R>, start: &BytesStart<'_>) -> bool {
    start.attributes().all(|result| {
        let Ok(attribute) = result else {
            return false;
        };
        let key = attribute.key.as_ref();
        if key == b"xmlns" || key.starts_with(b"xmlns:") {
            return true;
        }
        !matches!(
            reader.resolve_attribute(attribute.key).0,
            ResolveResult::Unknown(_)
        )
    })
}

fn append(
    item: Item,
    stack: &mut [Node],
    root: &mut Option<Node>,
    before: &mut Vec<Item>,
    after: &mut Vec<Item>,
) -> Option<()> {
    if let Some(parent) = stack.last_mut() {
        parent.children.push(item);
        return Some(());
    }
    if root.is_none() {
        match item {
            Item::Node(node) => *root = Some(node),
            Item::Raw(raw) => before.push(Item::Raw(raw)),
        }
        return Some(());
    }
    if matches!(item, Item::Node(_)) {
        return None;
    }
    after.push(item);
    Some(())
}

fn raw_event(event: &Event<'_>) -> Vec<u8> {
    let mut raw = Vec::new();
    match event {
        Event::Text(value) => raw.extend_from_slice(value.as_ref()),
        Event::Comment(value) => {
            raw.extend_from_slice(b"<!--");
            raw.extend_from_slice(value.as_ref());
            raw.extend_from_slice(b"-->");
        }
        Event::CData(value) => {
            raw.extend_from_slice(b"<![CDATA[");
            raw.extend_from_slice(value.as_ref());
            raw.extend_from_slice(b"]]>");
        }
        Event::Decl(value) => {
            raw.extend_from_slice(b"<?");
            raw.extend_from_slice(value.as_ref());
            raw.extend_from_slice(b"?>");
        }
        Event::PI(value) => {
            raw.extend_from_slice(b"<?");
            raw.extend_from_slice(value.as_ref());
            raw.extend_from_slice(b"?>");
        }
        Event::DocType(value) => {
            raw.extend_from_slice(b"<!DOCTYPE ");
            raw.extend_from_slice(value.as_ref());
            raw.push(b'>');
        }
        Event::Start(value) | Event::Empty(value) => {
            raw.push(b'<');
            raw.extend_from_slice(value.as_ref());
            raw.push(b'>');
        }
        Event::End(value) => {
            raw.extend_from_slice(b"</");
            raw.extend_from_slice(value.as_ref());
            raw.push(b'>');
        }
        Event::Eof => {}
    }
    raw
}

fn overlay_document(source: &Document, connections: &[WorkbookConnection]) -> Option<Vec<u8>> {
    let generated_xml = generated_connections_xml(connections, &source.root);
    let generated = parse_document(&generated_xml)?;
    let source_nodes = main_children(&source.root, b"connection");
    let generated_nodes = main_children(&generated.root, b"connection");
    if generated_nodes.len() != connections.len() {
        return None;
    }

    // Source ordinals travel with the typed rows. They remain stable when an
    // OOXML id is edited, and keep each row's unknown authored metadata with
    // that row when callers reorder, insert, or delete connections.
    let mut used_source_nodes = vec![false; source_nodes.len()];
    let inherited_default_main = explicit_default_main(&source.root.start).unwrap_or(false);
    let mut rendered_connections = Vec::with_capacity(connections.len());
    for (connection, generated_node) in connections.iter().zip(generated_nodes.iter()) {
        let mut rendered = Vec::new();
        if let Some(source_index) = connection.raw_source_index {
            let source_node = source_nodes.get(source_index)?;
            if used_source_nodes[source_index] {
                return None;
            }
            used_source_nodes[source_index] = true;
            overlay_node(
                source_node,
                generated_node,
                &mut rendered,
                inherited_default_main,
                Some(&connection.parameters),
            );
        } else {
            render_generated_node(generated_node, inherited_default_main, &mut rendered);
        }
        rendered_connections.push(rendered);
    }

    let mut output = Vec::new();
    for item in &source.before {
        render_exact(item, &mut output);
    }
    render_root_with_connections(&source.root, &rendered_connections, &mut output);
    for item in &source.after {
        render_exact(item, &mut output);
    }
    Some(output)
}

fn generated_connections_xml(connections: &[WorkbookConnection], source_root: &Node) -> Vec<u8> {
    let connections = without_unsupported_projections(connections);
    let mut generated = write_connections_xml(&connections);
    let Some(root_start) = generated
        .windows(b"<connections".len())
        .position(|window| window == b"<connections")
    else {
        return generated;
    };
    let Some(root_end_offset) = generated[root_start..]
        .iter()
        .position(|byte| *byte == b'>')
    else {
        return generated;
    };
    let root_end = root_start + root_end_offset;
    let (_, generated_attrs) = start_attrs(&generated[root_start + 1..root_end]);
    let mut generated_namespace_names = generated_attrs
        .iter()
        .filter(|attribute| attribute.name.starts_with(b"xmlns:"))
        .map(|attribute| attribute.name.clone())
        .collect::<Vec<_>>();
    let mut source_namespace_attrs = Vec::new();
    collect_prefixed_namespace_attrs(source_root, &mut source_namespace_attrs);
    if source_namespace_attrs.is_empty() {
        return generated;
    }

    let mut declarations = Vec::new();
    for attribute in source_namespace_attrs {
        if generated_namespace_names
            .iter()
            .any(|name| name == &attribute.name)
        {
            continue;
        }
        generated_namespace_names.push(attribute.name.clone());
        declarations.push(attribute.token);
    }
    if declarations.is_empty() {
        return generated;
    }
    let mut with_namespaces = Vec::with_capacity(generated.len());
    with_namespaces.extend_from_slice(&generated[..root_end]);
    for declaration in declarations {
        with_namespaces.extend_from_slice(&declaration);
    }
    with_namespaces.extend_from_slice(&generated[root_end..]);
    generated = with_namespaces;
    generated
}

fn collect_prefixed_namespace_attrs(node: &Node, output: &mut Vec<Attribute>) {
    let (_, attrs) = start_attrs(&node.start);
    output.extend(
        attrs
            .into_iter()
            .filter(|attribute| attribute.name.starts_with(b"xmlns:")),
    );
    for item in &node.children {
        if let Item::Node(child) = item {
            collect_prefixed_namespace_attrs(child, output);
        }
    }
}

fn main_children<'a>(node: &'a Node, local: &[u8]) -> Vec<&'a Node> {
    node.children
        .iter()
        .filter_map(|item| match item {
            Item::Node(child) if child.main() && child.local == local => Some(child),
            _ => None,
        })
        .collect()
}

fn overlay_node(
    source: &Node,
    generated: &Node,
    output: &mut Vec<u8>,
    inherited_default_main: bool,
    parameter_owners: Option<&[ConnectionParameter]>,
) {
    // extLst is itself a raw typed field. The typed projection owns the
    // current fragment, while every other modeled node is merged recursively.
    if source.main() && source.local == b"extLst" {
        render_generated_node(generated, inherited_default_main, output);
        return;
    }
    if source.main() && source.local == b"parameters" {
        if let Some(owners) = parameter_owners {
            parameters::overlay_parameters_node(
                source,
                generated,
                output,
                inherited_default_main,
                owners,
            );
            return;
        }
    }

    let known_children = known_children(source.local.as_slice());
    let typed_attrs = typed_attrs(source.local.as_slice());
    let mut used = vec![false; generated.children.len()];
    let current_default_main = explicit_default_main(&source.start)
        .unwrap_or(inherited_default_main && source.name.iter().all(|byte| *byte != b':'));
    let mut children = Vec::<RenderedChild>::new();
    for source_item in &source.children {
        let Item::Node(source_child) = source_item else {
            children.push(RenderedChild::raw(rendered(source_item)));
            continue;
        };
        let known = known_children
            .iter()
            .any(|name| *name == source_child.local.as_slice());
        if !source_child.main() || !known {
            children.push(RenderedChild::element(rendered(source_item), None));
            continue;
        }
        let match_index = generated
            .children
            .iter()
            .enumerate()
            .find_map(|(index, item)| {
                if used[index] {
                    return None;
                }
                let Item::Node(generated_child) = item else {
                    return None;
                };
                (generated_child.main() && generated_child.local == source_child.local)
                    .then_some(index)
            })
            .filter(|index| !used[*index]);
        if let Some(index) = match_index {
            used[index] = true;
            let Item::Node(generated_child) = &generated.children[index] else {
                unreachable!();
            };
            let mut merged = Vec::new();
            overlay_node(
                source_child,
                generated_child,
                &mut merged,
                current_default_main,
                if source_child.local == b"parameters" {
                    parameter_owners
                } else {
                    None
                },
            );
            let order = schema_order(known_children, source_child.local.as_slice());
            children.push(RenderedChild::element(merged, order));
        } else if source_child.main()
            && source_child.local == b"extLst"
            && source_child.name.contains(&b':')
        {
            // The fast typed connection parser only projects the unprefixed
            // extLst form. A prefixed main-namespace extLst is still authored
            // metadata; retain it when a scalar edit invalidates the replay.
            let order = schema_order(known_children, source_child.local.as_slice());
            children.push(RenderedChild::element(rendered(source_item), order));
        } else if source_child.main()
            && source_child.local == b"parameters"
            && parameter_owners.is_some()
            && has_opaque_parameter_metadata(source_child)
        {
            // A connection may retain future attributes/elements in the
            // parameters container after its last modeled parameter is
            // deleted. Overlay against an empty generated container so only
            // owned parameter rows disappear while that metadata remains.
            let empty_generated = empty_parameters_node(source_child);
            let mut merged = Vec::new();
            overlay_node(
                source_child,
                &empty_generated,
                &mut merged,
                current_default_main,
                parameter_owners,
            );
            let order = schema_order(known_children, source_child.local.as_slice());
            children.push(RenderedChild::element(merged, order));
        }
    }
    for (index, item) in generated.children.iter().enumerate() {
        if used[index] {
            continue;
        }
        let Item::Node(node) = item else {
            continue;
        };
        if node.main() {
            if let Some(order) = schema_order(known_children, node.local.as_slice()) {
                let mut rendered = Vec::new();
                render_generated_node(node, current_default_main, &mut rendered);
                insert_schema_ordered(&mut children, RenderedChild::element(rendered, Some(order)));
            }
        }
    }

    let empty = source.empty && children.is_empty();
    let start = merged_start(source, generated, typed_attrs, empty);
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
fn has_opaque_parameter_metadata(node: &Node) -> bool {
    let (_, attrs) = start_attrs(&node.start);
    if attrs
        .iter()
        .any(|attribute| !is_typed(&attribute.name, COUNT))
    {
        return true;
    }
    node.children.iter().any(|item| match item {
        Item::Node(child) => !(child.main() && child.local == b"parameter"),
        Item::Raw(raw) => !raw.iter().all(u8::is_ascii_whitespace),
    })
}
fn empty_parameters_node(source: &Node) -> Node {
    let mut start = Vec::with_capacity(source.name.len() + 14);
    start.extend_from_slice(b"<");
    start.extend_from_slice(&source.name);
    start.extend_from_slice(b" count=\"0\">");
    let mut end = Vec::with_capacity(source.name.len() + 3);
    end.extend_from_slice(b"</");
    end.extend_from_slice(&source.name);
    end.push(b'>');
    Node {
        name: source.name.clone(),
        local: source.local.clone(),
        namespace: source.namespace.clone(),
        start,
        end: Some(end),
        empty: false,
        children: Vec::new(),
    }
}

#[derive(Clone)]
struct RenderedChild {
    order: Option<usize>,
    is_element: bool,
    bytes: Vec<u8>,
}

impl RenderedChild {
    fn raw(bytes: Vec<u8>) -> Self {
        Self {
            order: None,
            is_element: false,
            bytes,
        }
    }

    fn element(bytes: Vec<u8>, order: Option<usize>) -> Self {
        Self {
            order,
            is_element: true,
            bytes,
        }
    }
}

fn schema_order(known: &[&[u8]], local: &[u8]) -> Option<usize> {
    known.iter().position(|name| *name == local)
}

fn insert_schema_ordered(children: &mut Vec<RenderedChild>, child: RenderedChild) {
    let Some(order) = child.order else {
        children.push(child);
        return;
    };

    if let Some(index) = children.iter().position(|existing| {
        existing
            .order
            .is_some_and(|existing_order| existing_order > order)
    }) {
        children.insert(index, child);
        return;
    }
    if let Some(index) = children.iter().rposition(|existing| {
        existing
            .order
            .is_some_and(|existing_order| existing_order < order)
    }) {
        children.insert(index + 1, child);
        return;
    }
    if let Some(index) = children.iter().position(|existing| existing.is_element) {
        children.insert(index, child);
    } else {
        children.push(child);
    }
}

fn render_root_with_connections(
    source: &Node,
    rendered_connections: &[Vec<u8>],
    output: &mut Vec<u8>,
) {
    if source.empty && rendered_connections.is_empty() {
        render_exact(&Item::Node(source.clone()), output);
        return;
    }

    output.push(b'<');
    output.extend_from_slice(&source.start);
    output.push(b'>');
    let mut inserted = false;
    for item in &source.children {
        let is_connection = matches!(
            item,
            Item::Node(node) if node.main() && node.local == b"connection"
        );
        if is_connection {
            if !inserted {
                for rendered in rendered_connections {
                    output.extend_from_slice(rendered);
                }
                inserted = true;
            }
            continue;
        }
        render_exact(item, output);
    }
    if !inserted {
        for rendered in rendered_connections {
            output.extend_from_slice(rendered);
        }
    }
    output.extend_from_slice(b"</");
    output.extend_from_slice(source.end.as_deref().unwrap_or(&source.name));
    output.push(b'>');
}

fn render_generated_node(node: &Node, inherited_default_main: bool, output: &mut Vec<u8>) {
    let explicit_default = explicit_default_main(&node.start);
    let add_default_namespace = node.main()
        && !inherited_default_main
        && explicit_default.is_none()
        && !node.name.contains(&b':');
    let start = if add_default_namespace {
        with_default_namespace(&node.start)
    } else {
        node.start.clone()
    };
    output.push(b'<');
    output.extend_from_slice(&start);
    if node.empty {
        output.push(b'/');
    }
    output.push(b'>');
    if !node.empty {
        let child_default_main =
            inherited_default_main || add_default_namespace || explicit_default == Some(true);
        for child in &node.children {
            match child {
                Item::Raw(raw) => output.extend_from_slice(raw),
                Item::Node(child) => render_generated_node(child, child_default_main, output),
            }
        }
        output.extend_from_slice(b"</");
        output.extend_from_slice(node.end.as_deref().unwrap_or(&node.name));
        output.push(b'>');
    }
}

fn with_default_namespace(start: &[u8]) -> Vec<u8> {
    let mut output = start.to_vec();
    output.extend_from_slice(b" xmlns=\"");
    output.extend_from_slice(MAIN_NS);
    output.extend_from_slice(b"\"");
    output
}

fn rendered(item: &Item) -> Vec<u8> {
    let mut output = Vec::new();
    render_exact(item, &mut output);
    output
}

fn render_exact(item: &Item, output: &mut Vec<u8>) {
    match item {
        Item::Raw(raw) => output.extend_from_slice(raw),
        Item::Node(node) => {
            output.push(b'<');
            output.extend_from_slice(&node.start);
            if node.empty {
                output.push(b'/');
            }
            output.push(b'>');
            if !node.empty {
                for child in &node.children {
                    render_exact(child, output);
                }
                output.extend_from_slice(b"</");
                output.extend_from_slice(node.end.as_deref().unwrap_or(&node.name));
                output.push(b'>');
            }
        }
    }
}

const CONNECTION: &[&str] = &[
    "id",
    "name",
    "description",
    "type",
    "refreshedVersion",
    "minRefreshableVersion",
    "saveData",
    "credentials",
    "singleSignOnId",
    "background",
    "deleted",
    "keepAlive",
    "new",
    "odcFile",
    "onlyUseConnectionFile",
    "reconnectionMethod",
    "refreshOnLoad",
    "savePassword",
    "sourceFile",
    "interval",
];
const DB_PR: &[&str] = &["connection", "command", "serverCommand", "commandType"];
const OLAP_PR: &[&str] = &[
    "local",
    "localConnection",
    "localRefresh",
    "sendLocale",
    "rowDrillCount",
    "serverFill",
    "serverNumberFormat",
    "serverFont",
    "serverFontColor",
];
const WEB_PR: &[&str] = &[
    "xml",
    "sourceData",
    "parsePre",
    "consecutive",
    "firstRow",
    "xl97",
    "textDates",
    "xl2000",
    "url",
    "post",
    "htmlTables",
    "htmlFormat",
    "editPage",
];
const TEXT_PR: &[&str] = &[
    "prompt",
    "fileType",
    "codePage",
    "characterSet",
    "firstRow",
    "sourceFile",
    "delimited",
    "delimiter",
    "decimal",
    "thousands",
    "tab",
    "space",
    "comma",
    "semicolon",
    "consecutive",
    "qualifier",
];
const COUNT: &[&str] = &["count"];
const VALUE: &[&str] = &["v"];
const TEXT_FIELD: &[&str] = &["type", "position"];
const PARAMETER: &[&str] = &[
    "name",
    "sqlType",
    "parameterType",
    "refreshOnChange",
    "prompt",
    "boolean",
    "double",
    "integer",
    "string",
    "cell",
];

fn typed_attrs(local: &[u8]) -> &'static [&'static str] {
    match local {
        b"connection" => CONNECTION,
        b"dbPr" => DB_PR,
        b"olapPr" => OLAP_PR,
        b"webPr" => WEB_PR,
        b"textPr" => TEXT_PR,
        b"tables" | b"textFields" | b"parameters" => COUNT,
        b"m" | b"s" | b"x" => VALUE,
        b"textField" => TEXT_FIELD,
        b"parameter" => PARAMETER,
        _ => &[],
    }
}

fn known_children(local: &[u8]) -> &'static [&'static [u8]] {
    match local {
        b"connections" => &[b"connection"],
        b"connection" => &[
            b"dbPr",
            b"olapPr",
            b"webPr",
            b"textPr",
            b"parameters",
            b"extLst",
        ],
        b"webPr" => &[b"tables"],
        b"textPr" => &[b"textFields"],
        b"tables" => &[b"m", b"s", b"x"],
        b"textFields" => &[b"textField"],
        b"parameters" => &[b"parameter"],
        _ => &[],
    }
}

#[derive(Clone)]
struct Attribute {
    name: Vec<u8>,
    token: Vec<u8>,
}

fn merged_start(source: &Node, generated: &Node, typed: &[&str], empty: bool) -> Vec<u8> {
    let (name_end, source_attrs) = start_attrs(&source.start);
    let (_, generated_attrs) = start_attrs(&generated.start);
    let mut output = source.start[..name_end].to_vec();
    if typed.is_empty() {
        for attribute in source_attrs {
            output.extend_from_slice(&attribute.token);
        }
    } else {
        let mut emitted = Vec::<Vec<u8>>::new();
        for source_attr in source_attrs {
            if is_typed(&source_attr.name, typed) {
                if let Some(generated_attr) = generated_attrs
                    .iter()
                    .find(|attribute| attribute.name == source_attr.name)
                {
                    output.extend_from_slice(&generated_attr.token);
                    emitted.push(generated_attr.name.clone());
                }
            } else {
                output.extend_from_slice(&source_attr.token);
            }
        }
        for generated_attr in generated_attrs {
            if is_typed(&generated_attr.name, typed)
                && !emitted.iter().any(|name| name == &generated_attr.name)
            {
                output.extend_from_slice(&generated_attr.token);
            }
        }
    }
    if empty {
        output.push(b'/');
    }
    output
}

fn is_typed(name: &[u8], typed: &[&str]) -> bool {
    !name.contains(&b':') && typed.iter().any(|candidate| name == candidate.as_bytes())
}

fn start_attrs(start: &[u8]) -> (usize, Vec<Attribute>) {
    let name_end = start
        .iter()
        .position(|byte| matches!(byte, b' ' | b'\t' | b'\r' | b'\n' | b'/'))
        .unwrap_or(start.len());
    let mut attrs = Vec::new();
    let mut pos = name_end;
    while pos < start.len() {
        while pos < start.len() && start[pos].is_ascii_whitespace() {
            pos += 1;
        }
        if pos >= start.len() || start[pos] == b'/' {
            break;
        }
        let token_start = pos.saturating_sub(1);
        let name_start = pos;
        while pos < start.len() && !matches!(start[pos], b'=' | b' ' | b'\t' | b'\r' | b'\n' | b'/')
        {
            pos += 1;
        }
        let name = start[name_start..pos].to_vec();
        while pos < start.len() && start[pos].is_ascii_whitespace() {
            pos += 1;
        }
        if pos >= start.len() || start[pos] != b'=' {
            break;
        }
        pos += 1;
        while pos < start.len() && start[pos].is_ascii_whitespace() {
            pos += 1;
        }
        if pos >= start.len() || !matches!(start[pos], b'"' | b'\'') {
            break;
        }
        let quote = start[pos];
        pos += 1;
        while pos < start.len() && start[pos] != quote {
            pos += 1;
        }
        if pos >= start.len() {
            break;
        }
        pos += 1;
        attrs.push(Attribute {
            name,
            token: start[token_start..pos].to_vec(),
        });
    }
    (name_end, attrs)
}

fn explicit_default_main(start: &[u8]) -> Option<bool> {
    let (name_end, _) = start_attrs(start);
    let content = std::str::from_utf8(start).ok()?;
    let parsed = BytesStart::from_content(content, name_end);
    let attribute = parsed
        .attributes()
        .filter_map(Result::ok)
        .find(|attribute| attribute.key.as_ref() == b"xmlns")?;
    let value = attribute.unescape_value().ok()?;
    Some(value.as_bytes() == MAIN_NS)
}
