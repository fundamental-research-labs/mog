use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::principal::PrincipalTag;

/// Classification of a tag pattern. Secondary sort dimension in the
/// resolution algorithm (SG-2): exact > prefix-glob > wildcard.
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TagSpecificity {
    Wildcard = 0,
    PrefixGlob = 1,
    Exact = 2,
}

/// Compiled tag pattern. Parsing happens once at construction; matching
/// is O(tag.len) with no regex dependency.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(from = "String", into = "String")]
pub struct TagMatcher {
    pattern: Arc<str>,
    specificity: TagSpecificity,
}

impl TagMatcher {
    #[must_use]
    pub fn parse(pattern: &str) -> Self {
        let specificity = if pattern == "*" {
            TagSpecificity::Wildcard
        } else if pattern.ends_with('*') {
            TagSpecificity::PrefixGlob
        } else {
            TagSpecificity::Exact
        };
        Self {
            pattern: Arc::from(pattern),
            specificity,
        }
    }

    #[must_use]
    pub fn pattern(&self) -> &str {
        &self.pattern
    }

    #[must_use]
    pub fn specificity(&self) -> TagSpecificity {
        self.specificity
    }

    #[must_use]
    pub fn matches(&self, tag: &PrincipalTag) -> bool {
        match self.specificity {
            TagSpecificity::Wildcard => true,
            TagSpecificity::PrefixGlob => {
                // Slice off the trailing '*'; matches any tag starting with the prefix.
                let prefix = &self.pattern[..self.pattern.len() - 1];
                tag.as_str().starts_with(prefix)
            }
            TagSpecificity::Exact => &*self.pattern == tag.as_str(),
        }
    }
}

impl From<String> for TagMatcher {
    fn from(s: String) -> Self {
        Self::parse(&s)
    }
}

impl From<&str> for TagMatcher {
    fn from(s: &str) -> Self {
        Self::parse(s)
    }
}

impl From<TagMatcher> for String {
    fn from(m: TagMatcher) -> Self {
        m.pattern.as_ref().to_owned()
    }
}
