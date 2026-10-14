import { Session } from './session';
import { LocalSession } from './local-session';
export const localMode = import.meta.env.VITE_APP_MODE !== 'cloud';
export type SessionController = Session | LocalSession;
export function createSession(
  options: ConstructorParameters<typeof Session>[0],
): SessionController {
  return localMode ? new LocalSession(options) : new Session(options);
}
