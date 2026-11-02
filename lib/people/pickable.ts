/**
 * Who a people picker offers (DEV-458).
 *
 * An account hidden from lists is never offered as a new choice. One that
 * is already chosen stays, so opening an existing record and saving it
 * does not silently drop a hidden assignee.
 */
export function pickableOptions<T extends { id: string; hidden_from_lists?: boolean | null }>(
  people: T[],
  selectedIds: Iterable<string> = [],
): T[] {
  const keep = new Set(selectedIds);
  return people.filter((person) => person.hidden_from_lists !== true || keep.has(person.id));
}

/**
 * A technician the schedule offers and shows a row for: active in FSM and
 * not hidden from lists. The board treats a hidden technician exactly as it
 * treats an inactive one.
 */
export function isListedTechnician(technician: { is_active: boolean; hidden_from_lists?: boolean | null }): boolean {
  return technician.is_active && technician.hidden_from_lists !== true;
}
