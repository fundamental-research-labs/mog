//! Parser-local external links collection.

use domain_types::domain::external_link::ExternalLink;

/// External links collection parsed from all externalLink files.
#[derive(Debug, Default)]
pub struct ExternalLinks {
    /// All external links in the workbook.
    pub links: Vec<ExternalLink>,
}

impl ExternalLinks {
    /// Create a new empty collection.
    pub fn new() -> Self {
        Self { links: Vec::new() }
    }

    /// Add an external link to the collection.
    pub fn add_link(&mut self, link: ExternalLink) {
        self.links.push(link);
    }

    /// Get an external link by ID.
    pub fn get_link(&self, id: &str) -> Option<&ExternalLink> {
        self.links.iter().find(|link| link.id == id)
    }

    /// Get the number of external links.
    pub fn len(&self) -> usize {
        self.links.len()
    }

    /// Check if there are no external links.
    pub fn is_empty(&self) -> bool {
        self.links.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_links_new() {
        let links = ExternalLinks::new();
        assert!(links.is_empty());
        assert_eq!(links.len(), 0);
    }

    #[test]
    fn external_links_add_and_get() {
        let mut links = ExternalLinks::new();
        links.add_link(ExternalLink::new("1".to_string()));
        links.add_link(ExternalLink::new("2".to_string()));

        assert_eq!(links.len(), 2);
        assert!(!links.is_empty());
        assert_eq!(links.get_link("1").unwrap().id, "1");
        assert!(links.get_link("3").is_none());
    }
}
