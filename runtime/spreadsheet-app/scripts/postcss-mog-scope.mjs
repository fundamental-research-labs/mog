// postcss-mog-scope.mjs — PostCSS plugin that scopes all selectors to [data-mog-engine]
// Runs AFTER Tailwind on the compiled output.

const SCOPE = '[data-mog-engine]';

function isInsideLayer(node, layerName) {
  let current = node.parent;
  while (current) {
    if (current.type === 'atrule' && current.name === 'layer' && current.params === layerName) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/** @type {import('postcss').PluginCreator} */
const plugin = () => ({
  postcssPlugin: 'postcss-mog-scope',
  Rule(rule) {
    // Skip rules inside @keyframes
    if (rule.parent?.type === 'atrule' && rule.parent.name === 'keyframes') return;

    // Skip rules inside @font-face (font-face is an atrule not a rule, but guard anyway)
    if (rule.parent?.type === 'atrule' && rule.parent.name === 'font-face') return;

    // Skip rules inside @layer properties (Tailwind internal defaults)
    if (isInsideLayer(rule, 'properties')) return;

    // Process each selector in the rule
    rule.selectors = rule.selectors.map((selector) => {
      const trimmed = selector.trim();

      // Skip :root and :host selectors (token declarations)
      if (/^:root\b/.test(trimmed) || /^:host\b/.test(trimmed)) return selector;

      // Replace html/body with the scope selector itself
      if (/^html\b/.test(trimmed)) return selector.replace(/^html/, SCOPE);
      if (/^body\b/.test(trimmed)) return selector.replace(/^body/, SCOPE);

      // Prefix everything else
      return `${SCOPE} ${selector}`;
    });
  },
});

plugin.postcss = true;
export default plugin;
