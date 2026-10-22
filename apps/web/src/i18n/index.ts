import { en } from './en';

export type MessageKey = keyof typeof en;
type Params = Record<string, string | number>;

/**
 * Every user-facing string goes through here, from one English catalog (D-015). `{name}` in a
 * message is filled from `params`; a whole sentence is one key, never joined from fragments.
 */
export function t(key: MessageKey, params?: Params): string {
  const message: string = en[key];
  if (!params) return message;
  return message.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
