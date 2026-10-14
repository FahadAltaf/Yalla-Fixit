/**
 * A client's phone is required wherever a client is saved (D1, UAT SNG-008):
 * the quotation form, the Clients page and the job's Setup tab. Any country
 * code works; it only has to have enough digits to be dialled.
 */
export const CLIENT_PHONE_REQUIRED =
  "Enter the client's phone number. The team calls the client on it.";

export function isUsablePhone(value: unknown): boolean {
  return typeof value === "string" && value.replace(/[^0-9]/g, "").length >= 6;
}
