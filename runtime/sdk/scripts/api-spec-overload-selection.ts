import * as ts from 'typescript';

import type { InterfaceTypeElement } from './api-spec-interface-serialization';

export function pickApiSpecOverload(
  interfaceName: string,
  memberName: string,
  overloads: readonly InterfaceTypeElement[],
): InterfaceTypeElement {
  if (overloads.length === 0) {
    throw new Error('Cannot choose an overload from an empty overload set.');
  }
  if (overloads.length === 1) return overloads[0]!;
  if (usesBroadPublicRefOverload(interfaceName, memberName)) {
    return pickBroadestOverload(overloads);
  }

  return pickAgentFriendlyOverload(overloads);
}

function pickAgentFriendlyOverload(
  overloads: readonly InterfaceTypeElement[],
): InterfaceTypeElement {
  const nonGenericOverload = overloads.find(
    ({ member }) => ts.isMethodSignature(member) && !member.typeParameters?.length,
  );
  if (nonGenericOverload) return nonGenericOverload;

  for (const overload of overloads) {
    if (ts.isMethodSignature(overload.member) && overload.member.parameters.length > 0) {
      const firstParam = overload.member.parameters[0];
      const typeText = firstParam.type?.getText(overload.sourceFile) ?? '';
      if (typeText === 'string') return overload;
    }
  }
  return overloads[0]!;
}

function pickBroadestOverload(overloads: readonly InterfaceTypeElement[]): InterfaceTypeElement {
  return overloads.reduce((best, candidate) =>
    overloadGeneralityScore(candidate) > overloadGeneralityScore(best) ? candidate : best,
  );
}

function usesBroadPublicRefOverload(interfaceName: string, memberName: string): boolean {
  return (
    interfaceName === 'WorkbookVersion' && (memberName === 'readRef' || memberName === 'getRef')
  );
}

function overloadGeneralityScore(overload: InterfaceTypeElement): number {
  const { member, sourceFile } = overload;
  if (!ts.isMethodSignature(member)) return 0;

  let score = member.typeParameters?.length ? 0 : 100;
  for (const parameter of member.parameters) {
    const typeText = parameter.type?.getText(sourceFile) ?? '';
    score += parameterTypeGeneralityScore(typeText);
  }
  return score;
}

function parameterTypeGeneralityScore(typeText: string): number {
  const compact = compactTypeText(typeText);
  if (!compact) return 0;
  if (/^(['"`]).*\1$/.test(compact)) return 1;

  let score = Math.min(compact.length, 80);
  if (compact === 'string' || compact === 'unknown') score += 80;
  if (compact.includes('VersionRefSelector')) score += 80;
  if (compact.includes('VersionCommitish')) score += 80;
  if (compact.includes('|')) score += 20 + compact.split('|').length * 10;
  if (compact.includes('{') || compact.includes('Record<')) score += 20;
  return score;
}

function compactTypeText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}()[\]<>,:;|&=])\s*/g, '$1')
    .trim();
}
