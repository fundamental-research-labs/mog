import React from 'react';

const MockSvg = React.forwardRef((props, ref) =>
  React.createElement('svg', { ...props, ref, 'data-testid': 'mock-svg' }),
);

export default MockSvg;
