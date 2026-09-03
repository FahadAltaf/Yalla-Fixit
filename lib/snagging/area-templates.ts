import type { SnaggingPropertyType } from "@/types/types";

/** A room the job starts with, and the catalogue it draws defects from. */
export type AreaChoice = { name: string; code: string };

/**
 * Rooms each property-type template seeds, with the catalogue area code
 * each draws its defect list from. The code rides with the area so the
 * inspector's capture sheet offers the right elements in each room.
 */
/**
 * Builds the starting room list from the property type and bedroom count.
 * The area list is only a starting point; the coordinator edits it and the
 * inspector can add rooms on site (Action Point H1).
 */
export function templateFor(type: SnaggingPropertyType, bedrooms: number | null): AreaChoice[] {
  const rooms: AreaChoice[] = [];
  const add = (name: string, code: string) => rooms.push({ name, code });

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
    add("Master bedroom", "MBR");
    add("Master bathroom", "MBA");
    for (let i = 2; i <= bed; i += 1) {
      add(`Bedroom ${i}`, "BED");
      add(`Bathroom ${i}`, "BTH");
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
