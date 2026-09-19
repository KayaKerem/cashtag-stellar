import { isCliprailError } from "@cliprail/client";
import { userMessage } from "@cliprail/shared";

/** Her hatayı gösterilebilir Türkçe mesaja çevirir (INTERFACES §2.3 + cüzdan/ağ hataları). */
export function errorMessage(err: unknown): string {
  if (isCliprailError(err)) return err.message;
  return userMessage(err);
}
