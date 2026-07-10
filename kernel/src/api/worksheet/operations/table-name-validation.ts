import type { DocumentContext } from '../../../context';
import { KernelError } from '../../../errors';

const TABLE_NAME_SUGGESTION =
  'Use a table name that starts with a letter or underscore, contains only letters, digits, and underscores, and does not parse as a cell reference such as A1, T1, or Q3.';

export async function assertValidTableName(
  ctx: DocumentContext,
  name: string,
  existingNames: string[],
  context: Record<string, unknown> = {},
): Promise<void> {
  const validation = await ctx.computeBridge.tableValidateTableName(name, existingNames);
  if (validation.valid) return;

  throw new KernelError('TABLE_INVALID_NAME', validation.reason ?? `Invalid table name: ${name}`, {
    context: { ...context, name, reason: validation.reason },
    path: ['name'],
    suggestion: TABLE_NAME_SUGGESTION,
  });
}
