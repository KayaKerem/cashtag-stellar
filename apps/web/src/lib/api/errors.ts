import { isCliprailError } from "@cliprail/client";
import { userMessage } from "@cliprail/shared";

/** Turns any error into a message we can show (INTERFACES §2.3 + wallet/network errors). */
export function errorMessage(err: unknown): string {
  if (isCliprailError(err)) return err.message;
  return userMessage(err);
}
