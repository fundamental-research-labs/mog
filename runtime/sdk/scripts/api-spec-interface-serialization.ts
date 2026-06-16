import * as ts from 'typescript';

export interface InterfaceResolution {
  node: ts.InterfaceDeclaration;
  sourceFile: ts.SourceFile;
}

export type ResolveInterfaceDeclaration = (interfaceName: string) => InterfaceResolution | null;

function getJSDocText(node: ts.Node): string {
  const fullText = node.getFullText();
  const nodeStart = node.getFullStart();
  const nodePos = node.getStart();
  const leadingTrivia = fullText.substring(0, nodePos - nodeStart);
  const match = leadingTrivia.match(/\/\*\*([\s\S]*?)\*\//);
  if (!match) return '';

  return match[1]
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trimEnd())
    .join('\n')
    .trim();
}

function getSignatureText(member: ts.TypeElement, sourceFile: ts.SourceFile): string {
  const text = member.getText(sourceFile);
  return text
    .replace(/^\/\*[\s\S]*?\*\/\s*/, '')
    .trim()
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/\n\s+\n/g, '\n');
}

function getMemberName(member: ts.TypeElement, sourceFile: ts.SourceFile): string | null {
  const name = (member as { name?: ts.PropertyName }).name;
  return name?.getText(sourceFile) ?? null;
}

function getHeritageInterfaceNames(
  node: ts.InterfaceDeclaration,
  sourceFile: ts.SourceFile,
): string[] {
  const names: string[] = [];
  for (const clause of node.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    for (const type of clause.types) {
      const expression = type.expression.getText(sourceFile);
      if (/^[A-Z][A-Za-z0-9]+$/.test(expression)) {
        names.push(expression);
      }
    }
  }
  return names;
}

function serializeInterfaceMember(member: ts.TypeElement, sourceFile: ts.SourceFile): string[] {
  if (ts.isPropertySignature(member)) {
    const propName = member.name?.getText(sourceFile) ?? '';
    const optional = member.questionToken ? '?' : '';
    const typeText = member.type?.getText(sourceFile) ?? 'unknown';
    const propDoc = getJSDocText(member);
    return [
      ...(propDoc ? [`  /** ${propDoc} */`] : []),
      `  ${propName}${optional}: ${typeText};`,
    ];
  }

  if (ts.isMethodSignature(member)) {
    const sig = getSignatureText(member, sourceFile);
    const methodDoc = getJSDocText(member);
    return [...(methodDoc ? [`  /** ${methodDoc} */`] : []), `  ${sig};`];
  }

  return [];
}

function collectInterfaceMembers(
  node: ts.InterfaceDeclaration,
  sourceFile: ts.SourceFile,
  resolveInterface: ResolveInterfaceDeclaration,
  visited: Set<string>,
): Map<string, string[]> {
  const key = `${sourceFile.fileName}::${node.name.text}`;
  if (visited.has(key)) return new Map();
  visited.add(key);

  const members = new Map<string, string[]>();
  for (const heritageName of getHeritageInterfaceNames(node, sourceFile)) {
    const heritage = resolveInterface(heritageName);
    if (!heritage) continue;
    for (const [name, lines] of collectInterfaceMembers(
      heritage.node,
      heritage.sourceFile,
      resolveInterface,
      visited,
    )) {
      members.set(name, lines);
    }
  }

  for (const member of node.members) {
    const name = getMemberName(member, sourceFile);
    if (!name) continue;
    members.set(name, serializeInterfaceMember(member, sourceFile));
  }

  return members;
}

export function serializeInterfaceDefinition(options: {
  node: ts.InterfaceDeclaration;
  sourceFile: ts.SourceFile;
  resolveInterface: ResolveInterfaceDeclaration;
}): string {
  const members = collectInterfaceMembers(
    options.node,
    options.sourceFile,
    options.resolveInterface,
    new Set(),
  );
  const parts = [...members.values()].flat();
  return parts.length > 0 ? `{\n${parts.join('\n')}\n}` : '{}';
}
