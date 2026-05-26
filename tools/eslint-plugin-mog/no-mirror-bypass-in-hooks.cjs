/**
 * ESLint rule: no-mirror-bypass-in-hooks
 *
 * Kernel state mirror guard.
 *
 * Blocks the AST anti-pattern of:
 *
 *   const [x, setX] = useState(<literal | arrow returning literal>);
 *   useEffect(() => {
 *     // either:
 *     ws.<namespace>.<getter>(...).then(setX);
 *     // or:
 *     (async () => { const v = await ws.<namespace>.<getter>(...); setX(v); })();
 *   }, [...]);
 *
 * inside any function whose name starts with `use` (i.e. a custom hook). The
 * shape reintroduces the first-paint race that the kernel state mirror exists
 * to eliminate: the literal default flashes before the async fetch resolves.
 *
 * The guard is intentionally narrow:
 *
 *   - Only fires when the `ws.<x>.<getter>()` corresponds to a getter that the
 *     mirror also exposes (curated list MIRROR_BACKED_WS_GETTERS below). New
 *     mirror surface should be added here as it lands.
 *   - Honors a file-level escape hatch comment: `// mirror-bypass: <reason>`.
 *     The comment must include a reason (anything after the colon). Files that
 *     legitimately need async ws.* reads (per-click queries, unbounded scans)
 *     should add this near the top.
 *   - Hardcoded allowlist of files that have already been audited as legitimate
 *     async-read sites. These are skipped silently (in addition to the comment
 *     marker, so existing audited files don't have to take a comment update).
 *
 * Class-B hooks that need richer projections (charts, pivot tables, slicers,
 * timeline-slicer, filter-actions, grouping-state, grouping-actions,
 * formula-autocomplete) are intentionally NOT in the curated `ws.*` getter
 * list — the rule never fires on them because their `ws.*` reads don't have
 * a mirror equivalent yet. When/if those projections land in the mirror, add
 * the corresponding `ws.<ns>.<getter>` entries to MIRROR_BACKED_WS_GETTERS.
 *
 */

'use strict';

/**
 * Curated map of ws-namespace -> getters that have a mirror equivalent.
 *
 * Mirror surface (kernel/src/document/state-mirror.ts) covers:
 *   getFrozenPanes, getSheetSettings, getViewOptions, getPageBreaks,
 *   getPrintArea, getPrintTitles, getPrintSettings, getSplitConfig,
 *   getScrollPosition, getSheetMeta, getWorkbookSettings, getCulture,
 *   getSelectedSheetIds, getSheetIds.
 *
 * The corresponding ws.* surfaces:
 *   ws.view.getFrozenPanes / getViewOptions / getSplitConfig / getScrollPosition
 *   ws.print.getPageBreaks / getArea / getTitles / getSettings
 *   ws.sheets.getSettings / getMeta
 *   ws.workbook.getSettings / getCulture / getSelectedSheetIds / getSheetIds
 *
 * Only the getter shapes below trigger the rule. Anything else (including
 * `ws.*.get*` calls that are not yet mirrored) is intentionally permitted.
 */
const MIRROR_BACKED_WS_GETTERS = {
  view: new Set(['getFrozenPanes', 'getViewOptions', 'getSplitConfig', 'getScrollPosition']),
  print: new Set(['getPageBreaks', 'getArea', 'getTitles', 'getSettings']),
  sheets: new Set(['getSettings', 'getMeta']),
  workbook: new Set(['getSettings', 'getCulture', 'getSelectedSheetIds', 'getSheetIds']),
};

/**
 * Map from ws namespace + getter to the matching mirror getter — used in the
 * error message so the developer immediately knows the replacement.
 */
const MIRROR_REPLACEMENT = {
  'view.getFrozenPanes': 'wb.mirror.getFrozenPanes(sheetId)',
  'view.getViewOptions': 'wb.mirror.getViewOptions(sheetId)',
  'view.getSplitConfig': 'wb.mirror.getSplitConfig(sheetId)',
  'view.getScrollPosition': 'wb.mirror.getScrollPosition(sheetId)',
  'print.getPageBreaks': 'wb.mirror.getPageBreaks(sheetId)',
  'print.getArea': 'wb.mirror.getPrintArea(sheetId)',
  'print.getTitles': 'wb.mirror.getPrintTitles(sheetId)',
  'print.getSettings': 'wb.mirror.getPrintSettings(sheetId)',
  'sheets.getSettings': 'wb.mirror.getSheetSettings(sheetId)',
  'sheets.getMeta': 'wb.mirror.getSheetMeta(sheetId)',
  'workbook.getSettings': 'wb.mirror.getWorkbookSettings()',
  'workbook.getCulture': 'wb.mirror.getCulture()',
  'workbook.getSelectedSheetIds': 'wb.mirror.getSelectedSheetIds()',
  'workbook.getSheetIds': 'wb.mirror.getSheetIds()',
};

/**
 * Hardcoded allowlist of audited hook files. Paths are matched as suffixes
 * against the source file path (so they work regardless of cwd).
 *
 * Class A — legitimately async (per-click queries, unbounded scans):
 *   - view/use-trace-arrows.ts (per-click formula auditing)
 *   - data/use-hyperlinks.ts (URL not in binary record; per-click fetch)
 *   - editing/use-column-values-autocomplete.ts (column scan; can be unbounded)
 *   - data/use-table-layout-cache.ts (cached layout; not snapshot state)
 *   - data/use-filter-header-cache.ts (cached filter headers; not snapshot)
 *   - view/use-interactive-element-positions.ts (per-render position cache)
 *
 * Class C — known migration debt, NOT legitimately async, but moving them
 * to the mirror is separate follow-up work (the
 * canonical mirror-backed hook already exists; the bypass is a duplicate
 * state in another hook):
 *   - toolbar/use-context-menu-actions.ts duplicates `pageBreaks` state
 *     that `view/use-page-breaks.ts` already maintains via the mirror.
 *     Allowlisted to keep the lint green; should be refactored to consume
 *     `useSheetPageBreaks()` instead of fetching its own snapshot.
 */
const ALLOWLIST_SUFFIXES = [
  // Class A — legitimately async.
  // Audited file (lives at view/ in current tree, not data/).
  '/apps/spreadsheet/src/hooks/view/use-trace-arrows.ts',
  '/apps/spreadsheet/src/hooks/data/use-hyperlinks.ts',
  '/apps/spreadsheet/src/hooks/editing/use-column-values-autocomplete.ts',
  '/apps/spreadsheet/src/hooks/data/use-table-layout-cache.ts',
  '/apps/spreadsheet/src/hooks/data/use-filter-header-cache.ts',
  // Audited file (lives at view/ in current tree, not grid/).
  '/apps/spreadsheet/src/hooks/view/use-interactive-element-positions.ts',

  // Class C — known migration debt; mirror-backed equivalent already exists.
  '/apps/spreadsheet/src/hooks/toolbar/use-context-menu-actions.ts',
];

const BYPASS_COMMENT_RE = /mirror-bypass\s*:\s*\S/;

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

function isHookFunction(node) {
  // Function declarations: function useFoo() {}
  if (node.type === 'FunctionDeclaration' && node.id && /^use[A-Z]/.test(node.id.name)) {
    return true;
  }
  // Variable declarations: const useFoo = () => {} | function () {}
  if (
    (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') &&
    node.parent &&
    node.parent.type === 'VariableDeclarator' &&
    node.parent.id &&
    node.parent.id.type === 'Identifier' &&
    /^use[A-Z]/.test(node.parent.id.name)
  ) {
    return true;
  }
  return false;
}

function isCallTo(node, name) {
  if (!node || node.type !== 'CallExpression') return false;
  const callee = node.callee;
  if (!callee) return false;
  // Bare identifier: useState(...)
  if (callee.type === 'Identifier') return callee.name === name;
  // Namespaced (rare): React.useState(...)
  if (
    callee.type === 'MemberExpression' &&
    callee.property &&
    callee.property.type === 'Identifier'
  ) {
    return callee.property.name === name;
  }
  return false;
}

/**
 * Returns true if the expression is a "literal-shaped default" — i.e. the
 * value is statically known and does NOT involve a sync mirror read.
 *
 * Considered literal-shaped:
 *   - Literal nodes (numbers, strings, booleans, null)
 *   - Identifiers like `undefined`
 *   - Object/array expressions whose values are themselves literal-shaped
 *   - Arrow / function expressions whose body is one of the above
 *   - TemplateLiterals with no expressions
 *
 * Importantly NOT literal-shaped:
 *   - CallExpression (which would include `wb.mirror.getX(sheetId)` etc.)
 *   - MemberExpression (e.g. `someStore.value`)
 */
function isLiteralShaped(node) {
  if (!node) return false;
  switch (node.type) {
    case 'Literal':
      return true;
    case 'TemplateLiteral':
      return node.expressions.length === 0;
    case 'Identifier':
      return node.name === 'undefined';
    case 'UnaryExpression':
      // -1, +1, !true, void 0
      return isLiteralShaped(node.argument);
    case 'ObjectExpression':
      return node.properties.every(
        (p) => p.type === 'Property' && !p.computed && isLiteralShaped(p.value),
      );
    case 'ArrayExpression':
      return node.elements.every((el) => el === null || isLiteralShaped(el));
    case 'TSAsExpression':
    case 'TSTypeAssertion':
      return isLiteralShaped(node.expression);
    case 'ArrowFunctionExpression':
    case 'FunctionExpression': {
      // () => <literal> | () => { return <literal>; }
      if (node.body.type === 'BlockStatement') {
        const body = node.body.body;
        // Single return statement with a literal-shaped argument
        if (body.length === 1 && body[0].type === 'ReturnStatement') {
          return isLiteralShaped(body[0].argument);
        }
        // Empty body — defaults to undefined, treat as literal default
        if (body.length === 0) return true;
        return false;
      }
      return isLiteralShaped(node.body);
    }
    default:
      return false;
  }
}

/**
 * Walk down a chain of MemberExpressions / CallExpressions and return
 *   { namespace, getter }
 * if the expression resolves to `<obj>.<namespace>.<getter>(...)` where
 * <namespace> + <getter> is in MIRROR_BACKED_WS_GETTERS, and <obj> is a
 * plain identifier (typically `ws` or anything aliased to it via a cast).
 *
 * Casts like `(ws as any).view.getX()` are deliberately treated identically
 * to the un-cast call — TSAsExpression is unwrapped — so the cast escape
 * hatch is closed.
 */
function unwrapCast(node) {
  while (
    node &&
    (node.type === 'TSAsExpression' ||
      node.type === 'TSTypeAssertion' ||
      node.type === 'TSNonNullExpression' ||
      node.type === 'ParenthesizedExpression')
  ) {
    node = node.expression;
  }
  return node;
}

function matchMirroredWsCall(callExpr) {
  // callExpr should be: <object>.<namespace>.<getter>(...)
  if (!callExpr || callExpr.type !== 'CallExpression') return null;
  const callee = unwrapCast(callExpr.callee);
  if (!callee || callee.type !== 'MemberExpression') return null;
  // .getter
  const getterProp = callee.property;
  if (!getterProp || getterProp.type !== 'Identifier') return null;
  const getterName = getterProp.name;
  // .<namespace>
  const objectExpr = unwrapCast(callee.object);
  if (!objectExpr || objectExpr.type !== 'MemberExpression') return null;
  const namespaceProp = objectExpr.property;
  if (!namespaceProp || namespaceProp.type !== 'Identifier') return null;
  const namespaceName = namespaceProp.name;
  // The base — must be an identifier (e.g. ws). After unwrapping casts.
  const baseExpr = unwrapCast(objectExpr.object);
  if (!baseExpr || baseExpr.type !== 'Identifier') return null;

  const getters = MIRROR_BACKED_WS_GETTERS[namespaceName];
  if (!getters || !getters.has(getterName)) return null;

  return {
    base: baseExpr.name,
    namespace: namespaceName,
    getter: getterName,
  };
}

function isPromiseThenSetter(callExpr, setterName) {
  // ws.x.y(...).then(setX)
  if (!callExpr || callExpr.type !== 'CallExpression') return null;
  const callee = unwrapCast(callExpr.callee);
  if (!callee || callee.type !== 'MemberExpression') return null;
  if (!callee.property || callee.property.type !== 'Identifier') return null;
  if (callee.property.name !== 'then') return null;
  // The thing that .then is called on
  const obj = unwrapCast(callee.object);
  const wsMatch = matchMirroredWsCall(obj);
  if (!wsMatch) return null;
  // .then(<arg>) — accept either the setter identifier directly,
  // or an arrow `(v) => setX(v)` / `(v) => setX(...transform)`.
  const arg = callExpr.arguments[0];
  if (!arg) return null;
  if (arg.type === 'Identifier' && arg.name === setterName) return wsMatch;
  if (arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression') {
    const body = arg.body.type === 'BlockStatement' ? arg.body.body : [arg.body];
    if (callsSetter(body, setterName)) return wsMatch;
  }
  return null;
}

/**
 * Walk a list of statements/expressions checking whether any of them
 * (recursively) is a call to `setterName(...)`.
 */
function callsSetter(nodes, setterName) {
  let found = false;
  function visit(n) {
    if (!n || found) return;
    if (Array.isArray(n)) {
      for (const child of n) visit(child);
      return;
    }
    if (typeof n !== 'object') return;
    if (n.type === 'CallExpression') {
      const callee = unwrapCast(n.callee);
      if (callee && callee.type === 'Identifier' && callee.name === setterName) {
        found = true;
        return;
      }
    }
    for (const key of Object.keys(n)) {
      if (key === 'parent' || key === 'loc' || key === 'range' || key.startsWith('_')) continue;
      const v = n[key];
      if (v && (Array.isArray(v) || (typeof v === 'object' && v.type))) visit(v);
    }
  }
  visit(nodes);
  return found;
}

/**
 * Walk a node looking for an awaited mirrored ws.* call followed by a call
 * to `setterName`. We don't strictly enforce "followed by" ordering —
 * presence of both inside the same effect body is enough.
 *
 * Returns the {base, namespace, getter} match if found, else null.
 */
function findAwaitedMirroredWsCall(node) {
  let match = null;
  function visit(n) {
    if (!n || match) return;
    if (Array.isArray(n)) {
      for (const child of n) visit(child);
      return;
    }
    if (typeof n !== 'object') return;
    if (n.type === 'AwaitExpression') {
      const m = matchMirroredWsCall(unwrapCast(n.argument));
      if (m) {
        match = m;
        return;
      }
    }
    for (const key of Object.keys(n)) {
      if (key === 'parent' || key === 'loc' || key === 'range' || key.startsWith('_')) continue;
      const v = n[key];
      if (v && (Array.isArray(v) || (typeof v === 'object' && v.type))) visit(v);
    }
  }
  visit(node);
  return match;
}

/**
 * Walk a node looking for a `.then(setterName)` style chain on a mirrored
 * ws.* call. Returns the match or null.
 */
function findThenSetterMirroredWsCall(node, setterName) {
  let match = null;
  function visit(n) {
    if (!n || match) return;
    if (Array.isArray(n)) {
      for (const child of n) visit(child);
      return;
    }
    if (typeof n !== 'object') return;
    if (n.type === 'CallExpression') {
      const m = isPromiseThenSetter(n, setterName);
      if (m) {
        match = m;
        return;
      }
    }
    for (const key of Object.keys(n)) {
      if (key === 'parent' || key === 'loc' || key === 'range' || key.startsWith('_')) continue;
      const v = n[key];
      if (v && (Array.isArray(v) || (typeof v === 'object' && v.type))) visit(v);
    }
  }
  visit(node);
  return match;
}

// ---------------------------------------------------------------------------
// Rule
// ---------------------------------------------------------------------------

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow useState(<literal default>) + useEffect(async ws.*) for state that the kernel state mirror exposes synchronously.',
      recommended: false,
    },
    schema: [],
    messages: {
      mirrorBypass:
        'This hook reads `ws.{{namespace}}.{{getter}}()` async — use `{{replacement}}` for sync init.\n' +
        'If this read genuinely cannot use the mirror (e.g., per-click query, unbounded scan), add `// mirror-bypass: <reason>` at the top of the file.',
    },
  },

  create(context) {
    const filename = context.getFilename().replace(/\\/g, '/');

    // Allowlisted by file path — silent skip.
    if (ALLOWLIST_SUFFIXES.some((suffix) => filename.endsWith(suffix))) {
      return {};
    }

    // File-level escape hatch: `// mirror-bypass: <reason>` in the file's
    // FIRST comment node (i.e. the leading docstring). Scoping the marker to
    // the first comment prevents an unrelated comment that quotes the marker
    // (e.g. `// the mirror-bypass: comment escape hatch is documented in...`)
    // from silencing the whole file. Single-line escapes should use the
    // standard `// eslint-disable-next-line mog/no-mirror-bypass-in-hooks`
    // mechanism instead.
    const sourceCode = context.getSourceCode();
    const allComments = sourceCode.getAllComments();
    const firstComment = allComments[0];
    const hasBypassComment = !!firstComment && BYPASS_COMMENT_RE.test(firstComment.value);
    if (hasBypassComment) return {};

    // Track useState + setState pairs per hook scope, plus useEffect calls
    // collected inside that same hook. We process at hook-exit time.
    const hookStack = [];

    function enterHook(node) {
      hookStack.push({
        node,
        // Map from setter-name -> useState callExpr that defined it (with
        // a literal-shaped default).
        literalSetters: new Map(),
        // List of useEffect call AST nodes seen inside this hook.
        effects: [],
      });
    }

    function exitHook() {
      const ctx = hookStack.pop();
      if (!ctx) return;
      if (ctx.literalSetters.size === 0) return;
      if (ctx.effects.length === 0) return;

      for (const [setterName, useStateCall] of ctx.literalSetters) {
        for (const effectCall of ctx.effects) {
          const effectFn = effectCall.arguments[0];
          if (!effectFn) continue;

          // Look for `.then(setX)` form
          let match = findThenSetterMirroredWsCall(effectFn, setterName);

          // Otherwise look for awaited form, but only count it if the
          // setter is also called somewhere in the same effect.
          if (!match) {
            const awaitedMatch = findAwaitedMirroredWsCall(effectFn);
            if (awaitedMatch) {
              const body =
                effectFn.body && effectFn.body.type === 'BlockStatement'
                  ? effectFn.body.body
                  : effectFn.body;
              if (callsSetter(body, setterName)) {
                match = awaitedMatch;
              }
            }
          }

          if (match) {
            const key = match.namespace + '.' + match.getter;
            const replacement = MIRROR_REPLACEMENT[key] || 'wb.mirror.*';
            context.report({
              node: useStateCall,
              messageId: 'mirrorBypass',
              data: {
                namespace: match.namespace,
                getter: match.getter,
                replacement,
              },
            });
            // Don't double-report against the same useState in this hook.
            break;
          }
        }
      }
    }

    function topHook() {
      return hookStack.length ? hookStack[hookStack.length - 1] : null;
    }

    function maybeEnterHook(node) {
      if (isHookFunction(node)) enterHook(node);
    }
    function maybeExitHook(node) {
      const top = topHook();
      if (top && top.node === node) exitHook();
    }

    return {
      FunctionDeclaration: maybeEnterHook,
      'FunctionDeclaration:exit': maybeExitHook,
      ArrowFunctionExpression: maybeEnterHook,
      'ArrowFunctionExpression:exit': maybeExitHook,
      FunctionExpression: maybeEnterHook,
      'FunctionExpression:exit': maybeExitHook,

      // const [x, setX] = useState(<default>)
      VariableDeclarator(node) {
        const top = topHook();
        if (!top) return;
        const init = node.init;
        if (!init || !isCallTo(init, 'useState')) return;
        // Must destructure into [value, setter]
        if (!node.id || node.id.type !== 'ArrayPattern') return;
        const elements = node.id.elements;
        if (elements.length < 2) return;
        const setter = elements[1];
        if (!setter || setter.type !== 'Identifier') return;
        // Default arg present and literal-shaped (no arg => default is undefined,
        // which is also literal-shaped).
        const defaultArg = init.arguments[0];
        if (defaultArg !== undefined && !isLiteralShaped(defaultArg)) return;

        top.literalSetters.set(setter.name, init);
      },

      // useEffect(...) calls
      CallExpression(node) {
        const top = topHook();
        if (!top) return;
        if (!isCallTo(node, 'useEffect')) return;
        top.effects.push(node);
      },
    };
  },
};
