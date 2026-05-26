// Mock for SVG imports with ?react suffix (Vite syntax)
// Returns a React component that renders a div with the SVG filename
const React = require('react');

const MockSvg = React.forwardRef((props, ref) => {
  return React.createElement('svg', { ...props, ref, 'data-testid': 'mock-svg' });
});

module.exports = MockSvg;
module.exports.default = MockSvg;
