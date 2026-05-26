import type { SpreadsheetActorSession } from './public-types';

export const SPREADSHEET_ACTOR_SESSION_BRAND: unique symbol = Symbol(
  'mog.spreadsheet-app.actor-session',
);

export type ActorSessionBrand = {
  readonly sessionId: string;
  readonly workbookSessionId: string;
  readonly workbookId: string;
  readonly epoch: number;
  readonly policyVersion: string;
};

export type InternalSpreadsheetActorSession = SpreadsheetActorSession & {
  readonly [SPREADSHEET_ACTOR_SESSION_BRAND]: ActorSessionBrand;
};
