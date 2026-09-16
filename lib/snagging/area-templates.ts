import type { SnaggingPropertyType } from "@/types/types";

/**
 * A room a template offers, and the catalogue it draws defects from.
 *
 * `suggested` is what separates "this job probably has one of these" from
 * "this job might have one of these". Both are shown; only the suggested
 * rooms start ticked (BA change 7).
 */
export type AreaChoice = {
  name: string;
  code: string;
  suggested: boolean;
};

/**
 * Builds the room list a job starts from, out of the property type and the
 * bedroom count. The list is only a starting point; the coordinator ticks
 * and unticks it, and the inspector can add rooms on site (Action Point H1).
 *
 * Bedrooms are numbered rather than named by role, so a three bedroom unit
 * reads Bedroom 1, Bedroom 2, Bedroom 3 (BA change 7). Bedroom 1 keeps the
 * master catalogue code, because in every YFI template the first bedroom is
 * the master and that code is what decides which defects the capture sheet
 * offers in the room.
 */
export function templateFor(
  type: SnaggingPropertyType,
  bedrooms: number | null,
): AreaChoice[] {
  const rooms: AreaChoice[] = [];
  const add = (name: string, code: string, suggested = true) =>
    rooms.push({ name, code, suggested });

  if (type === "commercial") {
    add("Reception", "ENT");
    add("Open office", "LIV");
    add("Meeting room", "DIN");
    add("Pantry", "KIT");
    add("Guest WC", "WC");
    add("Storage", "STO");
    add("Corridor", "COR");
    return rooms;
  }

  const bed = bedrooms ?? 0;
  add("Entrance", "ENT");
  add(bed === 0 ? "Living / sleeping area" : "Living room", "LIV");
  if (bed >= 2) add("Dining room", "DIN");
  if (bed >= 4) add("Family room", "FAM");
  add("Kitchen", "KIT");

  if (bed === 0) {
    add("Bathroom", "BTH");
  } else {
    for (let i = 1; i <= bed; i += 1) {
      add(`Bedroom ${i}`, i === 1 ? "MBR" : "BED");
    }

    /*
      One bathroom is suggested, not one per bedroom (BA change 7).

      The old template paired every bedroom with its own bathroom, which
      invented rooms that do not exist in most apartments and left the
      coordinator unticking half the list. The extra bathrooms are still
      offered, up to the bedroom count, they just start unticked.
    */
    add("Bathroom 1", "MBA");
    for (let i = 2; i <= bed; i += 1) {
      add(`Bathroom ${i}`, "BTH", false);
    }
    add("Guest WC", "WC");
  }

  add("Laundry", "LDY");
  if (bed >= 2) add("Store", "STO");

  if (type === "villa" || type === "townhouse") {
    add("Staircase", "STA");
    if (bed >= 3) add("Maid room", "MRM");
    add("Terrace", "TER");
    add("Garden", "GDN");
    add("Garage", "GAR");
    if (type === "villa") add("Roof", "ROF");
  } else {
    add("Balcony", "BAL");
  }

  return rooms;
}

/** The rooms a fresh job starts with ticked. */
export function suggestedFor(
  type: SnaggingPropertyType,
  bedrooms: number | null,
): AreaChoice[] {
  return templateFor(type, bedrooms).filter((room) => room.suggested);
}
