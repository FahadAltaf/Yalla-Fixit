/*
  The AMC Standard Scope of Works Library, Rev. 01, October 2026.

  GENERATED from AMC_Scope_of_Works_Library.xlsx (the Service Summary,
  Scope Library and General Conditions sheets). Change the workbook and
  regenerate rather than editing the wording here by hand.

  The workbook's bracketed fields are filled per proposal: {{qty}} is the
  units entered for the service and {{frequency}} its frequency. A fixed
  figure in brackets ([8] hours) prints as the figure, and an either/or
  ([included / charged at cost]) takes the chargeable side unless the
  proposal says otherwise. Any clause can be reworded on one proposal.
*/

export type AmcLibraryFrequencyType = "ppm" | "fixed" | "handyman" | "unlimited" | "weekly" | "manpower";

export interface AmcLibraryService {
  /** The workbook's reference, A1 to G6. */
  ref: string;
  id: string;
  category: string;
  /** How it reads in the service table and the frequency table (Service Summary). */
  label: string;
  /** Its clause heading in the contract (Scope Library). */
  title: string;
  unitOfMeasure: string;
  defaultFrequency: string;
  objective: string;
  included: string[];
  exclusions: string;
  basis: string;
  deliverables: string;
  frequencyType: AmcLibraryFrequencyType;
  frequencyPerYear?: number;
  /** Printed after the frequency: " + call-backs", " (quarterly)". */
  frequencySuffix?: string;
  unitTypes?: Array<"villa" | "apartment" | "office">;
}

export const AMC_SCOPE_LIBRARY: AmcLibraryService[] = [
  {
    "ref": "A1",
    "id": "ac-ppm",
    "category": "HVAC & Ventilation Services",
    "label": "AC Service (PPM)",
    "title": "AC Service (Planned Preventive Maintenance)",
    "unitOfMeasure": "Per AC unit per visit",
    "defaultFrequency": "3 times per year",
    "objective": "Keep each AC unit running efficiently, hygienically and without water leaks through scheduled preventive servicing.",
    "included": [
      "Remove, wash, dry and refit indoor unit return-air filters.",
      "Clean supply diffusers and return grilles.",
      "Clean the condensate drain pan and flush the condensate drain line (CDP); apply anti-algae treatment where needed.",
      "Check the condensate drain pump (where installed) and float switch operation.",
      "Check thermostat operation, set-point response and display.",
      "Check motorised valve and actuator operation (chilled water / district cooling FCUs).",
      "Check fan motor, blower wheel and fan belt condition (where accessible); lubricate where applicable.",
      "Visually inspect the evaporator coil and report if deep cleaning is required.",
      "Check airflow at outlets and report any imbalance, abnormal noise or vibration.",
      "Check related electrical components: isolator, MCB, contactor, relays, timers and terminations.",
      "DX split units: clean the outdoor coil face with a low-pressure wash, check fan operation and record running current.",
      "Record supply and return air temperatures (delta-T) per unit."
    ],
    "exclusions": "Coil chemical deep cleaning (see A4); duct cleaning (see A3); refrigerant top-up or recharge; leak detection and brazing; compressor and fan motor replacement; chiller, cooling tower and central plant equipment; units not listed in the asset register.",
    "basis": "{{qty}} units x {{frequency}} visits per year. Additional cleaning or de-clogging visits beyond the contracted frequency are chargeable.",
    "deliverables": "Service checklist per unit with delta-T readings, filter condition and recommended remedial works.",
    "frequencyType": "ppm",
    "frequencyPerYear": 3
  },
  {
    "ref": "A2",
    "id": "ac-y-strainer",
    "category": "HVAC & Ventilation Services",
    "label": "AC Y-Strainer Cleaning",
    "title": "AC Y-Strainer Cleaning",
    "unitOfMeasure": "Per strainer per visit",
    "defaultFrequency": "1-2 times per year",
    "objective": "Maintain chilled water flow to each fan coil unit by removing debris from the Y-strainers on the chilled water supply.",
    "included": [
      "Locate and tag each FCU Y-strainer on the chilled water supply line.",
      "Isolate the FCU using the existing isolation valves.",
      "Place a drip tray and absorbent sheet to protect the ceiling and floor.",
      "Remove the strainer cap and screen; clean the screen and housing of sludge and debris.",
      "Inspect the screen mesh for damage and the cap gasket for wear.",
      "Refit the screen and cap, re-open the valves and check for leaks.",
      "Bleed air from the FCU coil where an air vent is fitted.",
      "Confirm cooling performance after reinstatement."
    ],
    "exclusions": "Replacement of strainer screens, gaskets or caps; replacement of seized or passing isolation valves; chemical flushing of the chilled water system; opening false ceilings where no access panel exists.",
    "basis": "{{qty}} strainers x {{frequency}} times per year. Applies to chilled water / district cooling systems only.",
    "deliverables": "Strainer log noting debris level, valve condition and any defects requiring replacement.",
    "frequencyType": "fixed",
    "frequencyPerYear": 1
  },
  {
    "ref": "A3",
    "id": "duct-cleaning",
    "category": "HVAC & Ventilation Services",
    "label": "AC Duct Cleaning",
    "title": "AC Duct Cleaning",
    "unitOfMeasure": "Per property or per AC unit",
    "defaultFrequency": "Once per year",
    "objective": "Remove accumulated dust, debris and microbial growth from supply and return ductwork to improve indoor air quality.",
    "included": [
      "Pre-cleaning inspection of accessible duct runs, with photos where possible.",
      "Cover furniture and floors with polythene sheeting and seal off the work area.",
      "Remove modular false-ceiling tiles only where needed to access the duct network.",
      "Clean internal duct surfaces with rotary brushes and agitation tools.",
      "Extract dislodged debris with a negative-pressure vacuum unit fitted with HEPA filtration.",
      "Remove, wash and refit supply diffusers, return grilles and plenum boxes.",
      "Wash, dry and refit associated filters.",
      "Apply an approved anti-bacterial sanitiser to cleaned duct surfaces.",
      "Reinstate ceiling tiles and clean the work area.",
      "Post-cleaning inspection and photos."
    ],
    "exclusions": "Cutting new duct access doors or gypsum ceiling openings and making good; duct insulation or lining repair; fresh air handling units and exhaust ducts unless listed; kitchen exhaust ducts (see C1).",
    "basis": "Lump sum per property (based on number of AC units / outlets) or per AC unit. {{frequency}} time per year.",
    "deliverables": "Before-and-after photo report and duct condition summary.",
    "frequencyType": "fixed",
    "frequencyPerYear": 1
  },
  {
    "ref": "A4",
    "id": "coil-cleaning",
    "category": "HVAC & Ventilation Services",
    "label": "AC Coil Cleaning",
    "title": "AC Coil Cleaning",
    "unitOfMeasure": "Per AC unit",
    "defaultFrequency": "Once per year",
    "objective": "Restore cooling capacity and reduce energy use by deep cleaning the evaporator coil and blower assembly.",
    "included": [
      "Transport equipment to the unit without damage to the building; protect lifts and corridors where required.",
      "Cover furniture and floors with polythene sheeting; move and safeguard sensitive items.",
      "Isolate power to the unit.",
      "Dismantle the fan motor and blower assembly; clean the blower wheel and housing.",
      "Apply an approved non-acidic coil cleaning chemical.",
      "Pressure wash the evaporator coil and rinse thoroughly.",
      "Clean the drain pan and flush the condensate line.",
      "Reassemble, restore power and test cooling and airflow."
    ],
    "exclusions": "Creating ceiling access where none exists; repair of corroded or leaking coils; refrigerant work; outdoor condenser coil chemical cleaning unless specified.",
    "basis": "{{qty}} units x {{frequency}} time per year.",
    "deliverables": "Job sheet per unit with before-and-after photos and post-clean delta-T reading.",
    "frequencyType": "fixed",
    "frequencyPerYear": 1
  },
  {
    "ref": "A5",
    "id": "exhaust-fan",
    "category": "HVAC & Ventilation Services",
    "label": "Exhaust Fan & Duct Cleaning",
    "title": "Exhaust Fan & Duct Cleaning",
    "unitOfMeasure": "Per exhaust fan (incl. its duct run)",
    "defaultFrequency": "Twice per year",
    "objective": "Maintain effective extraction of moisture, odours and stale air from bathrooms, kitchens, laundry and utility rooms by cleaning the exhaust fans and their duct runs.",
    "included": [
      "Isolate power to each exhaust fan.",
      "Remove and wash the fan grille or cover.",
      "Clean dust and grease from fan blades, impeller, motor housing and casing.",
      "Clean the connected exhaust duct (flexible and rigid) through the grille opening and existing access points using rotary brush and HEPA vacuum, up to the external louvre or shaft connection where accessible.",
      "Clean the external louvre or wall cap where safely reachable.",
      "Check that the backdraft damper or shutter opens and closes freely.",
      "Check fan mounting, fixings and vibration.",
      "Check wiring termination and switch, timer or humidistat operation.",
      "Refit the grille, restore power and test extraction (paper / airflow test).",
      "Report noisy, weak or failed fans and damaged or disconnected ducts."
    ],
    "exclusions": "Fan motor or complete unit replacement (materials chargeable); duct repair or replacement; duct sections inside common shafts or beyond reach; central or roof-mounted building exhaust fans; kitchen hood and grease ducts (see C1); creating ceiling or duct access openings.",
    "basis": "{{qty}} fans and duct runs x {{frequency}} times per year. Can be combined with AC Service visits.",
    "deliverables": "Checklist per fan with condition and airflow result, before-and-after photos of ducts, and recommended replacements.",
    "frequencyType": "fixed",
    "frequencyPerYear": 2
  },
  {
    "ref": "B1",
    "id": "electrical-ppm",
    "category": "MEP Preventive Maintenance",
    "label": "Electrical PPM",
    "title": "Electrical PPM",
    "unitOfMeasure": "Per property per visit",
    "defaultFrequency": "3 times per year",
    "objective": "Keep the property's low-voltage electrical installation safe and functional, and identify faults before they cause failure or fire risk.",
    "included": [
      "Distribution boards: visual and thermal-touch inspection; tighten terminations, busbar fasteners, MCBs, RCDs/ELCBs and main incomers.",
      "Test RCD/ELCB trip function using the test button and record the result.",
      "Check that circuit labelling in each DB is legible; report missing labels.",
      "Check operation and condition of light switches, dimmers, DP switches and isolators.",
      "Check power sockets for operation, damage, overheating marks and correct earth connection (socket tester).",
      "Check internal and external light fittings; report failed lamps and drivers.",
      "Check the water heater electrical supply, isolator and current draw.",
      "Test exhaust fan operation and connections.",
      "Check doorbell, intercom power supply and outdoor fittings (where applicable).",
      "Report overloaded circuits, exposed wiring, burnt components and non-compliant installations."
    ],
    "exclusions": "Rewiring, new circuits or additional points; DEWA supply-side faults; replacement of lamps, drivers, switches, sockets, breakers or fittings (materials chargeable); fire alarm and life safety systems (see Section G); CCTV, data and BMS systems; formal insulation-resistance testing and certification unless specified.",
    "basis": "Per property, {{frequency}} visits per year.",
    "deliverables": "Electrical checklist with RCD test results, defect list and photos.",
    "frequencyType": "ppm",
    "frequencyPerYear": 3
  },
  {
    "ref": "B2",
    "id": "plumbing-ppm",
    "category": "MEP Preventive Maintenance",
    "label": "Plumbing PPM",
    "title": "Plumbing PPM",
    "unitOfMeasure": "Per property per visit",
    "defaultFrequency": "3 times per year",
    "objective": "Prevent leaks, blockages and water damage by inspecting and maintaining water supply and drainage fixtures within the property.",
    "included": [
      "Water heater: inspect inlet and outlet connections and test the pressure / temperature relief valve.",
      "WCs: check condition, supply connection, flush mechanism, fill valve and seal; adjust where needed.",
      "Washbasins, sinks and bidets: check mixers, faucets, angle valves and flexible hoses for leaks and wear.",
      "Showers and bathtubs: check shower heads, hand showers, mixers and diverters.",
      "Shattaf (hand spray): check spray head, hose and shut-off valve.",
      "Clean bottle traps and floor traps; test drain flow.",
      "Operate and check main and zone isolation valves.",
      "Check visible pipework, under-sink areas and adjacent walls and ceilings for leaks or dampness.",
      "Check silicone seals at wet areas and report deterioration.",
      "Report low pressure, slow drains and recurring blockages."
    ],
    "exclusions": "Concealed pipe leak detection (thermal or acoustic); drain line jetting; replacement of mixers, hoses, valves, flush mechanisms or heater elements (materials chargeable); building riser, common drainage and community supply faults; water tank and pump servicing (see B3, C4).",
    "basis": "Per property, {{frequency}} visits per year.",
    "deliverables": "Plumbing checklist per wet area with defect list and photos.",
    "frequencyType": "ppm",
    "frequencyPerYear": 3
  },
  {
    "ref": "B3",
    "id": "water-pump",
    "category": "MEP Preventive Maintenance",
    "label": "Water Pump Servicing",
    "title": "Water Pump Servicing",
    "unitOfMeasure": "Per pump set per visit",
    "defaultFrequency": "2-4 times per year",
    "objective": "Maintain reliable water supply and pressure by servicing transfer, booster and pressure pumps.",
    "included": [
      "Inspect pump, motor, base and mounting for corrosion and leaks.",
      "Check mechanical seal and gland for leakage.",
      "Check motor bearings for abnormal noise, vibration and overheating.",
      "Record running current and compare with the nameplate rating.",
      "Check and clean the suction strainer and foot valve (where accessible).",
      "Check pressure switch, pressure gauge and cut-in / cut-out settings.",
      "Check pressure vessel pre-charge and recharge with air where required.",
      "Check non-return valve and isolation valve operation.",
      "Check control panel, contactor, overload relay, float switch and level controls.",
      "Tighten electrical terminations and check earthing.",
      "Test-run in auto and manual modes and record discharge pressure."
    ],
    "exclusions": "Pump or motor overhaul and rewinding; replacement of seals, bearings, pressure vessels, switches or controllers (materials chargeable); pumps in common areas or owned by building management.",
    "basis": "{{qty}} pumps x {{frequency}} visits per year.",
    "deliverables": "Pump service sheet with current and pressure readings and recommendations.",
    "frequencyType": "fixed",
    "frequencyPerYear": 2,
    "unitTypes": [
      "villa"
    ]
  },
  {
    "ref": "C1",
    "id": "kitchen-exhaust",
    "category": "Cleaning & Hygiene Services",
    "label": "Kitchen Exhaust Cleaning",
    "title": "Kitchen Exhaust Cleaning",
    "unitOfMeasure": "Per hood (+ duct metres, commercial)",
    "defaultFrequency": "Twice per year",
    "objective": "Remove grease build-up from the kitchen exhaust system to reduce fire risk and maintain extraction performance.",
    "included": [
      "Cover cooking appliances, counters and floors with protective sheeting.",
      "Isolate power to the hood and exhaust fan.",
      "Remove grease filters and degrease them by soaking and washing.",
      "Degrease the hood canopy internally and externally.",
      "Clean accessible exhaust duct sections through existing access points.",
      "Clean exhaust fan blades, housing and grease drip tray (where accessible).",
      "Refit filters, restore power and test extraction.",
      "Clean the work area on completion."
    ],
    "exclusions": "Creating new duct access panels; duct sections in shafts or on the roof not reachable from the property; fan motor and belt replacement; kitchen hood fire suppression systems (see G5); grease trap cleaning (see C2).",
    "basis": "Residential: {{qty}} hoods x {{frequency}} times per year. Commercial: per hood plus duct length in metres; frequency set by cooking volume.",
    "deliverables": "Before-and-after photos and a service sticker on the hood showing the next due date.",
    "frequencyType": "fixed",
    "frequencyPerYear": 2
  },
  {
    "ref": "C2",
    "id": "grease-trap",
    "category": "Cleaning & Hygiene Services",
    "label": "Grease Trap Cleaning",
    "title": "Grease Trap Cleaning",
    "unitOfMeasure": "Per grease trap (capacity stated)",
    "defaultFrequency": "4 times per year",
    "objective": "Prevent kitchen drain blockages and odours, and meet Dubai Municipality requirements, by removing fats, oils, grease (FOG) and solids from the grease trap.",
    "included": [
      "Open the grease trap cover and inspect its condition.",
      "Pump out or manually remove FOG and settled solids.",
      "Scrape and clean internal walls, baffles, inlet and outlet.",
      "Flush the inlet and outlet pipes and confirm free flow.",
      "Check baffles, gasket and cover; reseal the cover.",
      "Clean the surrounding area and apply deodoriser.",
      "Record the FOG level found.",
      "Transport and dispose of collected waste through a Dubai Municipality-approved waste carrier (commercial traps)."
    ],
    "exclusions": "Grease trap repair, replacement or new installation; drain line jetting beyond the trap (quoted separately); large-volume tanker disposal fees unless quoted; enzyme or bio-dosing systems unless specified.",
    "basis": "{{qty}} grease traps x {{frequency}} times per year for residential kitchens. Commercial kitchens: monthly or as required by Dubai Municipality.",
    "deliverables": "Service report with FOG level and photos; waste disposal manifest for commercial traps.",
    "frequencyType": "fixed",
    "frequencyPerYear": 4
  },
  {
    "ref": "C3",
    "id": "kitchen-floor-drain",
    "category": "Cleaning & Hygiene Services",
    "label": "Kitchen Floor Drain Cleaning",
    "title": "Kitchen Floor Drain Cleaning",
    "unitOfMeasure": "Per floor drain",
    "defaultFrequency": "4 times per year",
    "objective": "Keep kitchen floor drains and gullies flowing freely and free of odours.",
    "included": [
      "Remove and clean the floor drain grating.",
      "Remove debris, grease and sludge from the trap or gully.",
      "Clean the drain body with degreaser and brush.",
      "Flush with water and test the flow.",
      "Check that the water seal is kept to prevent odours.",
      "Check the grating, frame and surrounding tiles and silicone; report damage.",
      "Apply enzyme or odour treatment."
    ],
    "exclusions": "Drain line jetting or rodding beyond the trap; CCTV drain survey; replacement of gratings or traps; breaking tiles to access drains.",
    "basis": "{{qty}} drains x {{frequency}} times per year. Can be combined with Plumbing PPM visits.",
    "deliverables": "Checklist per drain with flow test result and photos.",
    "frequencyType": "fixed",
    "frequencyPerYear": 4
  },
  {
    "ref": "C4",
    "id": "water-tank",
    "category": "Cleaning & Hygiene Services",
    "label": "Water Tank Cleaning",
    "title": "Water Tank Cleaning",
    "unitOfMeasure": "Per tank (capacity stated)",
    "defaultFrequency": "Twice per year",
    "objective": "Keep stored potable water clean and safe in line with Dubai Municipality public health requirements.",
    "included": [
      "Notify occupants and agree the shutdown window with the client.",
      "Isolate the inlet and drain the tank.",
      "Remove sludge, sediment and debris manually.",
      "Scrub internal walls, floor and roof with approved equipment.",
      "Disinfect with an approved chlorine solution at the specified concentration and contact time.",
      "Rinse thoroughly and drain the disinfectant solution.",
      "Inspect tank structure, lid, overflow, vent, float valve and ladder; report defects.",
      "Refill the tank and test residual chlorine.",
      "Collect a water sample for laboratory testing if specified."
    ],
    "exclusions": "Tank repair, re-lining, coating or waterproofing; replacement of float valves, lids or fittings; laboratory analysis fees unless quoted; underground tanks needing confined-space equipment beyond standard, unless quoted; water for refilling.",
    "basis": "{{qty}} tanks (state capacity in gallons or m3) x {{frequency}} times per year. Carried out by Dubai Municipality-approved personnel.",
    "deliverables": "Cleaning certificate, before-and-after photos and residual chlorine reading.",
    "frequencyType": "fixed",
    "frequencyPerYear": 2,
    "unitTypes": [
      "villa"
    ]
  },
  {
    "ref": "C5",
    "id": "garbage-chute",
    "category": "Cleaning & Hygiene Services",
    "label": "Garbage Chute Cleaning",
    "title": "Garbage Chute Cleaning",
    "unitOfMeasure": "Per chute (number of floors stated)",
    "defaultFrequency": "Monthly (12 times per year)",
    "objective": "Keep the building garbage chute hygienic, odour-free and free of blockages and pests.",
    "included": [
      "Coordinate with building management and lock off hopper doors during cleaning.",
      "Inspect the chute, hopper doors and bin room.",
      "Clean the chute internally from top to bottom with a rotary brush or high-pressure wash head lowered from the top access.",
      "Apply degreaser and an approved disinfectant and deodoriser.",
      "Clean hopper doors, frames and seals on every floor.",
      "Clean the discharge end, shutter and bin room floor and walls.",
      "Visually check hopper door closers and the discharge fire shutter; report defects.",
      "Clear minor blockages found during cleaning."
    ],
    "exclusions": "Repair of hopper doors, closers, fire shutters or sprinklers; major blockages requiring dismantling; waste collection and disposal; pest control (see C9) unless combined.",
    "basis": "{{qty}} chutes (floors as listed) x {{frequency}} times per year. Residential and commercial buildings only.",
    "deliverables": "Before-and-after photos and service report per chute.",
    "frequencyType": "fixed",
    "frequencyPerYear": 12,
    "unitTypes": [
      "apartment",
      "office"
    ]
  },
  {
    "ref": "C6",
    "id": "facade-window",
    "category": "Cleaning & Hygiene Services",
    "label": "Facade / Window Cleaning",
    "title": "Facade / Window Cleaning",
    "unitOfMeasure": "Per property (windows or m2)",
    "defaultFrequency": "4 times per year",
    "objective": "Clean external glazing and frames to keep the property presentable and prevent dust and salt build-up.",
    "included": [
      "Pre-clean inspection and risk assessment.",
      "Remove dust and loose dirt from glass and frames.",
      "Wash glass using a purified-water or squeegee method with non-abrasive, glass-safe detergent.",
      "Clean window frames, sills and tracks.",
      "Remove light stains, bird droppings and water marks.",
      "Final squeegee, detailing and edge wipe.",
      "Clean the internal side of external windows where specified."
    ],
    "exclusions": "Rope access, BMU, cherry picker or scaffolding work unless quoted; removal of cement, paint, sealant or hard-water etching; glass polishing and scratch removal; repair or replacement of broken glass, seals or frames; common area and tower facades managed by the building.",
    "basis": "Per property (number of windows / glass area in m2) for works reachable from ground, balcony or standard ladder. {{frequency}} times per year.",
    "deliverables": "Completion sheet with before-and-after photos.",
    "frequencyType": "fixed",
    "frequencyPerYear": 4
  },
  {
    "ref": "C7",
    "id": "balcony-cleaning",
    "category": "Cleaning & Hygiene Services",
    "label": "Balcony Cleaning",
    "title": "Balcony Cleaning",
    "unitOfMeasure": "Per balcony / terrace",
    "defaultFrequency": "4 times per year",
    "objective": "Keep balconies and terraces clean, drained and free of dust, debris and stains.",
    "included": [
      "Remove loose debris, sand and dust.",
      "Move and replace light furniture and planters (two-person lift).",
      "Scrub and wash floor tiles using a suitable detergent.",
      "Clean balustrades, glass railings and handrails.",
      "Clean the balcony door glass and frame (balcony side).",
      "Clear and flush the balcony floor drain.",
      "Clean light fittings and wall surfaces up to standard-ladder reach.",
      "Dry the floor and leave the area tidy."
    ],
    "exclusions": "Pressure washing where restricted by the building; stone polishing or tile sealing; bird netting installation and heavy pigeon guano removal (quoted separately); disposal of bulky items.",
    "basis": "{{qty}} balconies (state area in m2) x {{frequency}} times per year.",
    "deliverables": "Completion sheet with before-and-after photos.",
    "frequencyType": "fixed",
    "frequencyPerYear": 4
  },
  {
    "ref": "C8",
    "id": "roof-drain",
    "category": "Cleaning & Hygiene Services",
    "label": "Roof Drain Cleaning",
    "title": "Roof Drain Cleaning",
    "unitOfMeasure": "Per drain",
    "defaultFrequency": "Twice per year",
    "objective": "Keep roof drains and gullies clear to prevent water ponding, leaks and damage during rain.",
    "included": [
      "Inspect the roof surface, drains, gullies and outlets.",
      "Remove leaves, sand, debris and bird nests from drains and grates.",
      "Clean and refit drain grates and leaf guards.",
      "Flush each drain with water and confirm free flow to the downpipe.",
      "Clear sand and debris from the roof surface around drains.",
      "Report damaged grates, blocked downpipes, cracked waterproofing and ponding areas."
    ],
    "exclusions": "High-pressure jetting or rodding of downpipes and underground lines (quoted separately); roof waterproofing repair; roofs without safe permanent access; common building roofs.",
    "basis": "{{qty}} drains x {{frequency}} times per year, scheduled before the rainy season (October-November) and mid-season.",
    "deliverables": "Inspection sheet with photos of each drain and any roof defects found.",
    "frequencyType": "fixed",
    "frequencyPerYear": 2,
    "unitTypes": [
      "villa"
    ]
  },
  {
    "ref": "C9",
    "id": "pest-control",
    "category": "Cleaning & Hygiene Services",
    "label": "Pest Control",
    "title": "Pest Control",
    "unitOfMeasure": "Per property",
    "defaultFrequency": "4 times per year + call-backs",
    "objective": "Prevent and control common household pests through scheduled treatment by Dubai Municipality-approved personnel using approved chemicals.",
    "included": [
      "Inspection to identify pest activity, harbourage and entry points.",
      "General treatment against cockroaches, ants, spiders and crawling insects (gel baiting, crack-and-crevice and residual spray).",
      "Rodent control: bait stations and monitoring at perimeter and entry points (villas and ground-floor units).",
      "Flying insect treatment where required.",
      "Treatment of kitchens, bathrooms, drains, storage and utility areas.",
      "Hygiene and proofing advice to the client.",
      "Free call-back treatment between scheduled visits for covered pests."
    ],
    "exclusions": "Termite treatment (pre- or post-construction); bed bug treatment; fumigation; bird control; snake and wildlife removal; proofing works (sealing gaps, mesh installation).",
    "basis": "Per property, {{frequency}} times per year (quarterly) plus call-backs.",
    "deliverables": "Treatment report listing pests found, areas treated and chemicals used, with safety and re-entry instructions.",
    "frequencyType": "fixed",
    "frequencyPerYear": 4,
    "frequencySuffix": " + call-backs"
  },
  {
    "ref": "C10",
    "id": "disinfection",
    "category": "Cleaning & Hygiene Services",
    "label": "Disinfection",
    "title": "Disinfection",
    "unitOfMeasure": "Per property (area stated)",
    "defaultFrequency": "As agreed / on demand",
    "objective": "Reduce bacteria, viruses and fungi on surfaces through approved disinfection, in line with Dubai Municipality and DHA guidance.",
    "included": [
      "Pre-treatment walkthrough and agreement on areas to treat.",
      "Client removes or covers food, pet items and sensitive electronics before treatment.",
      "Cold fogging or ULV misting of rooms with a DM-approved disinfectant.",
      "Manual wipe-down of high-touch surfaces: handles, switches, taps, counters and remotes.",
      "Treatment of bathrooms, kitchen and AC return-air grilles.",
      "Observe the product's contact time and re-entry period."
    ],
    "exclusions": "Deep cleaning; mould remediation; upholstery and carpet shampooing; active-case medical decontamination unless specified.",
    "basis": "Per property (state area in sq ft or number of bedrooms). {{frequency}} times per year, or on demand.",
    "deliverables": "Disinfection certificate with chemical name, dilution and re-entry time.",
    "frequencyType": "fixed",
    "frequencyPerYear": 1,
    "frequencySuffix": ", or on demand"
  },
  {
    "ref": "C11",
    "id": "deep-cleaning",
    "category": "Cleaning & Hygiene Services",
    "label": "Deep Cleaning",
    "title": "Deep Cleaning",
    "unitOfMeasure": "Per property (size stated)",
    "defaultFrequency": "Twice per year",
    "objective": "Thoroughly clean the whole property, beyond regular cleaning, to restore hygiene and presentation.",
    "included": [
      "Dust and wipe ceilings, walls, light fittings and AC grilles up to standard-ladder reach.",
      "Clean inside and outside cabinets, wardrobes and drawers (when emptied by the client).",
      "Kitchen: degrease hob, hood exterior, splashback and sink; clean inside fridge, oven and microwave (switched off and empty).",
      "Bathrooms: descale and disinfect tiles, grout, WCs, basins, showers, glass screens and fittings.",
      "Clean windows (internal side), frames, tracks and sills, plus doors, frames and skirting.",
      "Machine scrub and mop hard floors; vacuum carpets.",
      "Clean balconies and terraces.",
      "Disinfect high-touch surfaces.",
      "Remove all cleaning waste."
    ],
    "exclusions": "Carpet, sofa, mattress and curtain shampooing (quoted separately); facade and work above standard-ladder height; removal of paint, cement or construction debris; moving heavy furniture beyond a two-person lift; pest control.",
    "basis": "Per property (state bedrooms or area in sq ft) x {{frequency}} times per year. Extra visits (e.g. move-in / move-out) charged per visit.",
    "deliverables": "Completion checklist with before-and-after photos.",
    "frequencyType": "fixed",
    "frequencyPerYear": 2
  },
  {
    "ref": "D1",
    "id": "handyman",
    "category": "Reactive & Labour Services",
    "label": "Handyman Hours",
    "title": "Handyman Hours",
    "unitOfMeasure": "Per team-hour (2 persons)",
    "defaultFrequency": "6 hours per year",
    "objective": "Provide a bank of skilled labour hours for minor repairs, adjustments and installations not covered by PPM.",
    "included": [
      "One handyman hour = one hour of a two-person team (1 technician + 1 helper) with standard tools and basic consumables.",
      "Adjust and repair doors, hinges, locks, cylinders, drawer runners, cabinets and wardrobes.",
      "Repair fly screens; adjust aluminium and wooden doors and windows.",
      "Assemble flat-pack furniture where two people are sufficient.",
      "Hang pictures, mirrors, curtain rails, blinds, TV brackets and shelves at standard height.",
      "Minor paint touch-ups at standard-ladder height (paint and materials by client or quoted).",
      "Install standard light fittings and chandeliers; replace like-for-like taps and accessories where no new supply line is needed.",
      "Minor masonry: re-grouting, refixing single loose tiles and silicone sealing.",
      "Light furniture moving and storage arrangement."
    ],
    "exclusions": "Supply of materials and spare parts; work needing a licensed specialist trade; work above standard-ladder height; extra technicians beyond the two-person team (charged per person-hour).",
    "basis": "Per team-hour, minimum 1 hour per visit. {{frequency}} free hours per year; additional hours at the agreed hourly rate. Book 48 hours in advance. Unused hours do not carry over.",
    "deliverables": "Job sheet recording tasks completed, hours used and remaining hour balance.",
    "frequencyType": "handyman",
    "frequencyPerYear": 6
  },
  {
    "ref": "D2",
    "id": "emergency",
    "category": "Reactive & Labour Services",
    "label": "Emergency Call-out",
    "title": "Emergency Call-out",
    "unitOfMeasure": "Per call-out",
    "defaultFrequency": "Unlimited",
    "objective": "Provide rapid response, 24 hours a day, 7 days a week, to failures that make the property unsafe or unusable.",
    "included": [
      "Covered emergencies: complete AC failure; complete power failure or any electrical fault posing a fire risk; major water leak or burst pipe; major drainage blockage or overflow.",
      "Call logged within 60 minutes; technician on site within 120 minutes of logging, subject to traffic and community access.",
      "Make safe, isolate the source and contain damage.",
      "Carry out minor rectification on the spot where no parts and little time are needed.",
      "Where parts, specialist trades or extended time are needed, quote and schedule the repair as a priority after written approval."
    ],
    "exclusions": "Materials and parts; repair beyond make-safe; failures caused by DEWA supply, the building's central systems or common areas; non-emergency issues logged as emergencies (misuse is chargeable).",
    "basis": "Unlimited call-outs per year. Calls outside working hours (6:00 PM-9:00 AM), on Sundays and on public holidays are emergency calls.",
    "deliverables": "Incident report with cause, actions taken, photos and any quotation for follow-up repair.",
    "frequencyType": "unlimited"
  },
  {
    "ref": "D3",
    "id": "non-emergency",
    "category": "Reactive & Labour Services",
    "label": "Non-Emergency Call-out",
    "title": "Non-Emergency Call-out",
    "unitOfMeasure": "Per visit",
    "defaultFrequency": "Unlimited",
    "objective": "Inspect and resolve reported defects that are not emergencies and are not covered by PPM or handyman hours.",
    "included": [
      "Log the request and agree a visit slot within 48 hours, during working hours (Monday-Saturday, 9:00 AM-6:00 PM).",
      "Inspect and diagnose the root cause of the reported issue.",
      "Carry out minor adjustments and rectification needing no material replacement, up to 2 hours on site.",
      "Where parts or more than 2 hours are needed, issue a quotation with the job sheet within 24 hours of the visit; work starts after written approval."
    ],
    "exclusions": "Materials and parts; work exceeding 2 hours (quoted); tasks falling under handyman hours or PPM.",
    "basis": "Unlimited visits per year.",
    "deliverables": "Job sheet with diagnosis, work done and quotation for any further repair.",
    "frequencyType": "unlimited"
  },
  {
    "ref": "E1",
    "id": "pool-maintenance",
    "category": "Pool Services",
    "label": "Swimming Pool Maintenance",
    "title": "Swimming Pool Maintenance",
    "unitOfMeasure": "Per pool per visit",
    "defaultFrequency": "3 visits per week",
    "objective": "Keep the pool water clean, clear, balanced and safe to use in line with Dubai Municipality requirements.",
    "included": [
      "Skim floating debris and empty skimmer and pump baskets.",
      "Brush walls, floor, steps and waterline.",
      "Vacuum the pool floor.",
      "Test and record free chlorine, pH and total alkalinity each visit; stabiliser and calcium hardness monthly.",
      "Dose water treatment chemicals to keep readings within the recommended range.",
      "Backwash or clean the filter as required.",
      "Check pump, filter, valves, heater or chiller and pool lights; report faults.",
      "Check the water level and top up.",
      "Clean the tile line and pool edge.",
      "Shock treatment and algaecide when required."
    ],
    "exclusions": "Repair or replacement of pumps, motors, filter media, heaters or lights (materials chargeable); resurfacing, re-tiling and leak detection; draining and refilling; water supply; lifeguard services.",
    "basis": "{{qty}} pools x {{frequency}} visits per week. Standard pool chemicals charged at cost unless included in the proposal.",
    "deliverables": "Pool log sheet per visit with chemical readings and dosing, and a monthly summary.",
    "frequencyType": "weekly",
    "frequencyPerYear": 3
  },
  {
    "ref": "F1",
    "id": "office-cleaner",
    "category": "Manpower Deployment Services",
    "label": "Office Cleaner",
    "title": "Office Cleaner Deployment",
    "unitOfMeasure": "Per cleaner per month (full-time) or per hour (part-time)",
    "defaultFrequency": "Daily (6 days per week)",
    "objective": "Provide trained cleaners stationed at the client's office for daily cleaning of workspaces, washrooms and pantries.",
    "included": [
      "Deploy {{qty}} trained, uniformed office cleaner(s), 8 hours per day, {{frequency}} days per week, at agreed shift times.",
      "Sweep, mop and vacuum office floors, carpets and reception.",
      "Dust and wipe desks, workstations, meeting tables, partitions and fixtures without moving client papers or equipment.",
      "Clean and sanitise washrooms; refill client-supplied soap, tissue and hand towels.",
      "Clean pantry counters, sink and appliance exteriors; wash dishes.",
      "Empty bins and shredder bags and take waste to the building collection point.",
      "Clean internal glass, partitions, mirrors and entrance doors at reachable height.",
      "Disinfect high-touch points: door handles, switches, lift buttons and phones.",
      "Daily cleaning checklist signed by the client's representative.",
      "Staff visa, salary, accommodation, transport, uniform, PPE and medical insurance provided by the provider.",
      "Relief staff provided for annual leave, sickness and absence; replacement within 48 hours if the client requests a change.",
      "Supervisor site visits and quality inspections weekly."
    ],
    "exclusions": "Deep cleaning (see C11); carpet and upholstery shampooing; facade and work at height; cleaning consumables and pantry supplies unless quoted; handling confidential documents, cash or IT equipment; work outside agreed hours (overtime at the agreed rate).",
    "basis": "Full-time: {{qty}} cleaner(s) x 8 hours x {{frequency}} days per week, charged monthly. Part-time: hours per visit and visits per week as agreed, charged per hour.",
    "deliverables": "Daily attendance sheet, signed cleaning checklist and monthly supervisor inspection report.",
    "frequencyType": "manpower",
    "frequencyPerYear": 6,
    "unitTypes": [
      "office"
    ]
  },
  {
    "ref": "F2",
    "id": "home-cleaner",
    "category": "Manpower Deployment Services",
    "label": "Home & Villa Cleaner",
    "title": "Home & Villa Cleaner Deployment",
    "unitOfMeasure": "Per cleaner per hour (part-time) or per month (full-time)",
    "defaultFrequency": "Daily / as agreed",
    "objective": "Provide trained live-out cleaners for regular housekeeping of apartments, homes and villas on a full-time or part-time basis.",
    "included": [
      "Deploy {{qty}} trained, uniformed cleaner(s) on a full-time or part-time schedule, with hours per visit and visits per week as agreed.",
      "Sweep, mop and vacuum all floors and rugs.",
      "Dust and wipe furniture, surfaces, fixtures, switches and door handles.",
      "Clean and sanitise bathrooms, WCs, basins and showers.",
      "Clean kitchen counters, sink, hob and appliance exteriors; wash dishes.",
      "Make beds and change linen (client-supplied).",
      "Laundry and ironing if agreed.",
      "Empty bins and take waste to the collection point.",
      "Clean internal windows, mirrors and balcony floors at reachable height.",
      "Tidy and organise rooms as directed by the client.",
      "Staff visa, salary, accommodation, transport, uniform, PPE and medical insurance provided by the provider.",
      "Relief staff provided for annual leave, sickness and absence; replacement within 48 hours if the client requests a change.",
      "Supervisor site visits and quality inspections weekly."
    ],
    "exclusions": "Deep cleaning (see C11); childcare, elderly care and cooking unless separately agreed; live-in arrangements; cleaning products and equipment by the client unless included in the proposal; work at height or outside agreed hours; handling of valuables.",
    "basis": "Part-time: hours per visit and visits per week as agreed, charged per hour (minimum 2 hours per visit). Full-time: 8 hours x {{frequency}} days per week, charged monthly.",
    "deliverables": "Visit log signed by the client and a monthly attendance summary.",
    "frequencyType": "manpower",
    "frequencyPerYear": 6,
    "unitTypes": [
      "villa",
      "apartment"
    ]
  },
  {
    "ref": "F3",
    "id": "office-boy",
    "category": "Manpower Deployment Services",
    "label": "Office Boy / Tea Boy",
    "title": "Office Boy / Tea Boy Deployment",
    "unitOfMeasure": "Per office boy per month",
    "defaultFrequency": "Daily (6 days per week)",
    "objective": "Provide a dedicated office boy for pantry service, refreshments and light office support during working hours.",
    "included": [
      "Deploy {{qty}} trained, uniformed office boy(s), 8 hours per day, {{frequency}} days per week.",
      "Prepare and serve tea, coffee and water to staff and visitors, including meeting rooms.",
      "Keep the pantry clean and organised; wash cups, dishes and appliances.",
      "Monitor pantry stock and report items to reorder.",
      "Set up and clear meeting rooms.",
      "Deliver internal documents, mail and parcels within the building.",
      "Photocopying, scanning and filing support as directed.",
      "Light cleaning of reception and pantry areas.",
      "Local errands on foot or with client-provided transport or allowance.",
      "Staff visa, salary, accommodation, transport, uniform, PPE and medical insurance provided by the provider.",
      "Relief staff provided for annual leave, sickness and absence; replacement within 48 hours if the client requests a change.",
      "Supervisor site visits and quality inspections weekly."
    ],
    "exclusions": "Tea, coffee, sugar, milk, water and pantry consumables (supplied by the client unless quoted); driving duties; handling cash beyond petty amounts; handling confidential documents; work outside agreed hours (overtime at the agreed rate).",
    "basis": "{{qty}} office boy(s) x 8 hours x {{frequency}} days per week, charged monthly.",
    "deliverables": "Daily attendance sheet and monthly performance report.",
    "frequencyType": "manpower",
    "frequencyPerYear": 6,
    "unitTypes": [
      "office"
    ]
  },
  {
    "ref": "F4",
    "id": "building-cleaner",
    "category": "Manpower Deployment Services",
    "label": "Building / Common Area Cleaner",
    "title": "Building & Common Area Cleaner Deployment",
    "unitOfMeasure": "Per cleaner per month",
    "defaultFrequency": "Daily (6-7 days per week)",
    "objective": "Provide cleaners stationed at a residential or commercial building to keep lobbies, corridors and shared facilities clean.",
    "included": [
      "Deploy {{qty}} trained, uniformed cleaner(s), 8 hours per shift, {{frequency}} days per week, on a day or night shift pattern.",
      "Clean lobbies, reception, corridors, staircases and lift cabins.",
      "Clean common washrooms and prayer rooms.",
      "Clean gym, pool deck and amenity areas (cleaning only).",
      "Empty common-area bins and keep the bin room tidy.",
      "Clean entrance glass doors and mirrors at reachable height.",
      "Sweep car park ramps and walkways manually.",
      "Report damage, leaks and maintenance issues to the building manager.",
      "Staff visa, salary, accommodation, transport, uniform, PPE and medical insurance provided by the provider.",
      "Relief staff provided for annual leave, sickness and absence; replacement within 48 hours if the client requests a change.",
      "Supervisor site visits and quality inspections weekly."
    ],
    "exclusions": "Garbage chute cleaning (see C5); facade cleaning (see C6); car park machine scrubbing and pressure washing unless quoted; pool water maintenance (see E1); consumables unless quoted.",
    "basis": "{{qty}} cleaner(s) x 8 hours x {{frequency}} days per week, charged monthly.",
    "deliverables": "Daily attendance sheet, area cleaning checklist and monthly inspection report.",
    "frequencyType": "manpower",
    "frequencyPerYear": 6
  },
  {
    "ref": "G1",
    "id": "fire-alarm",
    "category": "Fire & Life Safety Services",
    "label": "Fire Alarm System",
    "title": "Fire Alarm System Maintenance",
    "unitOfMeasure": "Per system (number of devices stated)",
    "defaultFrequency": "4 times per year (quarterly)",
    "objective": "Keep the fire detection and alarm system fully operational so that a fire is detected early and occupants are alerted, in line with the UAE Fire & Life Safety Code and DCD requirements.",
    "included": [
      "Work carried out by Dubai Civil Defence (DCD)-approved fire technicians, directly or through an approved subcontractor.",
      "Inspect the fire alarm control panel; check power supply, standby batteries, charger, fault and event log.",
      "Test smoke and heat detectors with approved test equipment (rotational sample per visit, all detectors within the year).",
      "Test manual call points, sounders, bells and strobe lights.",
      "Check zone indication and clear any faults or disablements.",
      "Test interfaces: AC / fan shutdown, lift homing, door release and access control (where connected).",
      "Check the remote monitoring connection to the monitoring centre (where installed).",
      "Clean detector heads and check for obstruction, paint or damage.",
      "Check the zone chart and log book are up to date.",
      "Restore the system to normal and confirm with the client or building manager."
    ],
    "exclusions": "Replacement detectors, call points, sounders, batteries and panel parts (materials chargeable); Dubai Civil Defence inspection, certificate and penalty fees; system design, upgrades or modifications to meet new code requirements; false alarm fines caused by occupants; new installations.",
    "basis": "Per system (detectors and devices as listed) x {{frequency}} visits per year. Emergency fault call-outs as per D2.",
    "deliverables": "Signed maintenance report per visit with device test record and defect list; maintenance certificate issued for DCD submission where required.",
    "frequencyType": "fixed",
    "frequencyPerYear": 4,
    "frequencySuffix": " (quarterly)"
  },
  {
    "ref": "G2",
    "id": "fire-fighting",
    "category": "Fire & Life Safety Services",
    "label": "Fire Fighting System",
    "title": "Fire Fighting System Maintenance",
    "unitOfMeasure": "Per system (property or building)",
    "defaultFrequency": "4 times per year (quarterly)",
    "objective": "Keep sprinklers, hose reels and fire pumps ready to deliver water at the right pressure in a fire emergency.",
    "included": [
      "Work carried out by Dubai Civil Defence (DCD)-approved fire technicians, directly or through an approved subcontractor.",
      "Inspect sprinkler heads for damage, paint, corrosion and obstruction.",
      "Check installation control valves, flow switches, tamper switches and pressure gauges.",
      "Carry out the inspector's test and drain test; confirm alarm signal to the fire panel.",
      "Inspect and test fire hose reels, landing valves and cabinets; check hose condition and nozzles.",
      "Test-run fire pumps (main, standby and jockey) and record start pressures and running data.",
      "Check pump controller, power supply, diesel engine (where fitted), fuel level and batteries.",
      "Check fire water tank level and make-up supply (where within the property).",
      "Exercise valves and check that all valves are in the correct open position and secured.",
      "Report leaks, low pressure and defects."
    ],
    "exclusions": "Replacement of sprinkler heads, valves, hoses, pumps or parts (materials chargeable); pipework repair, draining and refilling of the system; fire water tank cleaning (see C4 if required); Dubai Civil Defence inspection, certificate and penalty fees; system design, upgrades or modifications to meet new code requirements; common building systems managed by the building.",
    "basis": "Per system x {{frequency}} visits per year. Annual full flow test quoted separately unless included in the proposal.",
    "deliverables": "Signed maintenance report with pump and pressure readings, valve status and defect list; maintenance certificate for DCD submission where required.",
    "frequencyType": "fixed",
    "frequencyPerYear": 4,
    "frequencySuffix": " (quarterly)"
  },
  {
    "ref": "G3",
    "id": "fire-extinguishers",
    "category": "Fire & Life Safety Services",
    "label": "Fire Extinguishers & Blankets",
    "title": "Fire Extinguisher & Fire Blanket Servicing",
    "unitOfMeasure": "Per extinguisher / blanket",
    "defaultFrequency": "Once per year (annual service and tagging)",
    "objective": "Make sure every fire extinguisher and fire blanket is present, charged, accessible and in date.",
    "included": [
      "Work carried out by Dubai Civil Defence (DCD)-approved fire technicians, directly or through an approved subcontractor.",
      "Inspect each extinguisher for location, access, signage, damage and corrosion.",
      "Check pressure gauge, safety pin, tamper seal, hose and nozzle.",
      "Weigh CO2 extinguishers and record the weight.",
      "Check the manufacture date, hydrostatic test due date and service history.",
      "Inspect fire blankets for presence, condition and easy release.",
      "Update the service tag / label with the service date and next due date.",
      "Keep an extinguisher register with location, type, size and status.",
      "Advise on missing or wrongly placed extinguishers for the risk."
    ],
    "exclusions": "Refilling, recharging, hydrostatic testing and replacement of extinguishers or blankets (charged per unit); supply of new extinguishers; Dubai Civil Defence inspection, certificate and penalty fees; system design, upgrades or modifications to meet new code requirements.",
    "basis": "{{qty}} extinguishers and blankets x {{frequency}} service per year. Monthly visual checks by the client or building staff.",
    "deliverables": "Updated extinguisher register and service tags, with a list of units needing refill or replacement.",
    "frequencyType": "fixed",
    "frequencyPerYear": 1,
    "frequencySuffix": " (annual service and tagging)"
  },
  {
    "ref": "G4",
    "id": "emergency-lighting",
    "category": "Fire & Life Safety Services",
    "label": "Emergency & Exit Lighting",
    "title": "Emergency & Exit Lighting Testing",
    "unitOfMeasure": "Per property (number of fittings stated)",
    "defaultFrequency": "4 times per year + annual duration test",
    "objective": "Make sure emergency lights and exit signs work and last long enough to guide people out during a power failure.",
    "included": [
      "Functional test of each emergency light and exit sign by simulating mains failure.",
      "Annual full-duration test (3 hours or as rated) for self-contained fittings.",
      "Check battery condition, charging indicators and lamp / LED operation.",
      "Check that exit signs are visible, correctly directed and not obstructed.",
      "Clean diffusers and check fixings.",
      "Check central battery system and changeover (where installed).",
      "Record results in the emergency lighting log book."
    ],
    "exclusions": "Replacement batteries, lamps, LED modules, fittings or signs (materials chargeable); new circuits or additional fittings; Dubai Civil Defence inspection, certificate and penalty fees; system design, upgrades or modifications to meet new code requirements.",
    "basis": "Listed fittings x {{frequency}} functional tests per year, including 1 full-duration test.",
    "deliverables": "Test record per fitting, updated log book and list of failed fittings.",
    "frequencyType": "fixed",
    "frequencyPerYear": 4,
    "frequencySuffix": " + annual duration test"
  },
  {
    "ref": "G5",
    "id": "kitchen-fire-suppression",
    "category": "Fire & Life Safety Services",
    "label": "Kitchen Fire Suppression",
    "title": "Kitchen Hood Fire Suppression System Servicing",
    "unitOfMeasure": "Per system (per hood)",
    "defaultFrequency": "Twice per year",
    "objective": "Keep the wet chemical fire suppression system over commercial cooking equipment ready to discharge automatically or manually.",
    "included": [
      "Work carried out by Dubai Civil Defence (DCD)-approved fire technicians, directly or through an approved subcontractor.",
      "Inspect the agent cylinder, pressure gauge and seals; weigh cartridges where applicable.",
      "Inspect discharge nozzles and blow-off caps; clean grease from nozzles.",
      "Check detection line, fusible links and pull station; replace fusible links as recommended.",
      "Test the manual release and the automatic gas or power shut-off interlock (without discharging the agent).",
      "Check the alarm interface with the fire panel (where connected).",
      "Check nozzle positions match the cooking appliance layout.",
      "Update the service tag and record."
    ],
    "exclusions": "Agent refill after discharge, cylinder hydrostatic testing and replacement parts (materials chargeable; fusible links charged unless included in the proposal); redesign after kitchen layout changes; hood and duct cleaning (see C1); Dubai Civil Defence inspection, certificate and penalty fees; system design, upgrades or modifications to meet new code requirements.",
    "basis": "{{qty}} systems x {{frequency}} services per year. Commercial kitchens only.",
    "deliverables": "Service report and tag per system, with defect list.",
    "frequencyType": "fixed",
    "frequencyPerYear": 2,
    "unitTypes": [
      "office"
    ]
  },
  {
    "ref": "G6",
    "id": "gas-leak-detection",
    "category": "Fire & Life Safety Services",
    "label": "Gas Leak Detection",
    "title": "Gas Leak Detection System Testing",
    "unitOfMeasure": "Per system (number of detectors stated)",
    "defaultFrequency": "Twice per year",
    "objective": "Make sure gas detectors and automatic shut-off valves detect an LPG or natural gas leak and stop the supply.",
    "included": [
      "Inspect gas detectors and the control unit; check power and fault indicators.",
      "Test each detector with calibrated test gas and confirm alarm response.",
      "Test the automatic solenoid shut-off valve and manual reset.",
      "Check the alarm interface with the fire panel or local sounder (where connected).",
      "Check detector positions for the gas type (LPG low level, natural gas high level).",
      "Visually inspect accessible gas pipework, flexible hoses and fittings at appliances for damage; carry out a soap leak test at appliance connections.",
      "Record results and detector replacement dates."
    ],
    "exclusions": "Repair or modification of gas pipework, regulators or meters (licensed gas contractor only); detector or valve replacement (materials chargeable); detector recalibration beyond manufacturer guidance; gas supply and cylinder refilling; Dubai Civil Defence inspection, certificate and penalty fees; system design, upgrades or modifications to meet new code requirements.",
    "basis": "Per system (detectors as listed) x {{frequency}} tests per year.",
    "deliverables": "Test report with detector and valve results and replacement recommendations.",
    "frequencyType": "fixed",
    "frequencyPerYear": 2
  }
];

/** The conditions that apply to every service in the AMC (General Conditions sheet). */
export const AMC_GENERAL_CONDITIONS: Array<{ title: string; description: string }> = [
  {
    "title": "Consumables included",
    "description": "Cleaning chemicals, PPE, polythene sheets, tapes, connectors, garbage bags and similar minor items are covered."
  },
  {
    "title": "Materials & spare parts",
    "description": "Not included. Supplied on approved quotation with a 20% handling fee; manufacturer warranty only."
  },
  {
    "title": "Access & permits",
    "description": "Client arranges community access passes, NOCs and authority permits. Provider supplies trade licence and staff IDs."
  },
  {
    "title": "Utilities",
    "description": "Client provides the water and electricity required to perform the work."
  },
  {
    "title": "Installed systems only",
    "description": "The AMC covers MEP installations as originally handed over. Client modifications are assessed before inclusion."
  },
  {
    "title": "Working at height",
    "description": "Work beyond safe standard-ladder reach (approx. 3.5 m) requires scaffolding, a mobile platform or rope access, quoted separately."
  },
  {
    "title": "Missed appointments",
    "description": "Two consecutive cancellations or no-shows without 24 hours' notice count as a consumed visit."
  },
  {
    "title": "Reporting",
    "description": "A job sheet with findings, photos where relevant and recommendations is issued within 48 hours (two working days) of each visit."
  },
  {
    "title": "Remedial works",
    "description": "Defects found during any visit are reported and quoted. Written client approval is required before work starts."
  }
];
