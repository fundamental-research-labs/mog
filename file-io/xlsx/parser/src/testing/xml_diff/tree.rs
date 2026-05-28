use super::api::ExpandedName;

#[derive(Clone, Debug)]
pub(super) struct Element {
    pub(super) name: ExpandedName,
    /// Attributes, stored unsorted during parse; sorted before comparison.
    pub(super) attrs: Vec<(ExpandedName, String)>,
    pub(super) children: Vec<Node>,
    /// Whether `xml:space="preserve"` is in scope for this element's direct
    /// text content. Inherited down the tree.
    pub(super) preserve_space: bool,
}

#[derive(Clone, Debug)]
pub(super) enum Node {
    Element(Element),
    /// Text or CDATA. For the comparison contract, CDATA is treated as text.
    Text(String),
}

#[derive(Clone, Debug)]
pub(super) struct Document {
    pub(super) root: Option<Element>,
}
