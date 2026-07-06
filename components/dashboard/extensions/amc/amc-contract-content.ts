export interface ScopeSectionContent {
  serviceId: string;
  sectionNumber: string;
  title: string;
  intro?: string;
  bullets: string[];
}

export const FOOTER_TEXT =
  "Office 102, Commercial Bank of Dubai (Al Quoz Branch), Dubai, UAE Tel. +971 800 7373328 / 800-PERFECT.";

export const CLAUSE_1_OPERATION = {
  title: "1- Operation",
  sections: [
    {
      title: "1.1 Helpdesk and Scheduling",
      paragraphs: [
        "Toll free No. 800-PERFECT (7373328).",
        "Dedicated account manager for direct coordination.",
        "All calls will be attended or call-back will be arranged within maximum 90 minutes.",
        "Unlimited emergency call-outs (as per definition of emergency on Clause No 3.1)",
        "Unlimited non-emergency call-outs (as per definition of non-emergency on Clause No 3.2)",
        "Planned Preventive Maintenance (PPM) to be scheduled (proposal to be shared 15 days after signing of AMC).",
      ],
      listItems: [
        "Call 800-PERFECT (7373328) for any maintenance inquiry, alternatively contact (Call/WhatsApp) dedicated account manager 24/7 for any emergency/non-emergency inquiries.",
        "Direct contact No. 05X XXX XXX – NAME / 05X XXX XXX – NAME.",
      ],
      listType: "letter" as const,
    },
    {
      title: "1.2 Maintenance team",
      bullets: [
        "YALLA FIX IT ONE PERSON COMPANY LLC technicians are trained, certified and provided with continued training year around. They are supervised, uniformed and provide their work with the highest professional standards, tools, equipment and methods.",
        "All standard tools and equipment's (Maintenance toolbox) will be provided by YALLA FIX IT, if due to complexity of the task uncommon special equipment is required, standard rental cost will be invoiced to the customer (in the form of quotation for approval). e.g. Heavy duty RIDGID Auger machine, Pipe threading machine, Aluminum scaffolding, cherry picker, crane, etc.",
        "Dedicated account manager who is going to be the direct link between company and customer to ensuring the inquiries are accurately communicated and fulfilled and be the point of contact for day to day follow up.",
        "Job sheet/Job completion report for all visits including inspection for identification, preventive maintenance schedules and quotation base jobs will be shared with the customer/customer representative within 48 hours from the date of the visit (two working days)",
      ],
    },
    {
      title: "1.3 Working hours",
      paragraphs: [
        "Regular Call-out: From Saturday to Thursday from 9:00 AM to 6:00 PM.",
        "Emergency Call-out: Friday, public holidays and non-working hours (from 6:00 PM to 9:00 AM)",
      ],
    },
  ],
};

export const CLAUSE_2_INTRO = [
  "2- Scope of Works:",
  "YALLA FIX IT ONE PERSON COMPANY LLC will respond to maintenance requests and schedule the Planned Preventive Maintenance for the originally installed MEP services in the property (as per the coverage of the selected package).",
  "(Building Management Systems (BMS) are not covered in this contract. See Clause No.5 for full list)",
];

export const SCOPE_SECTIONS: ScopeSectionContent[] = [
  {
    serviceId: "ac-ppm",
    sectionNumber: "2.1",
    title: "Air Condition Service and Maintenance (PPM):",
    bullets: [
      "Checking and cleaning air filters (indoor units).",
      "Checking and cleaning diffusers/grills.",
      "Checking and cleaning condensation pan and flush drain line (CDP).",
      "Checking and cleaning of the condenser coil (outdoor unit).",
      "Check actuator motor/valve operation/functionality.",
      "Check thermostat manual operation/functionality.",
      "Check the condition of drain pump (if exist) and report any abnormality.",
      "Check airflow and balance manually (if accessible) & report for any abnormality.",
      "Check evaporator coil condition (if accessible) and report if cleaning is required (to be quoted).",
      "Check air ducts condition and report if cleaning is required (to be quoted).",
      "Check the Fan/Fan belt condition, lubricate if needed, & report for any abnormality.",
      "Check the related electrical components, MCB, ELCB, cotactor, electronic relay, Timers.",
    ],
  },
  {
    serviceId: "electrical-ppm",
    sectionNumber: "2.2",
    title: "Electrical Service and Maintenance (PPM):",
    bullets: [
      "Check the operations and physical condition of the light control switches.",
      "Check the operation and physical condition of power sockets and DP switches.",
      "Check the glowing of light bulbs. Inside and outside (if applicable)",
      "Check the functionality and physical condition water heater (if consuming the amps).",
      "Check all power sockets & cable gland for correct earth connection.",
      "Test Exhaust fans connection and functionality.",
      "Check the DB and tighten loose cables & bus bar fasteners and connected MCBs, ELCBs and main incomers.",
      "Check the physical condition and connection of power isolators.",
    ],
  },
  {
    serviceId: "plumbing-ppm",
    sectionNumber: "2.3",
    title: "Plumbing Service and Maintenance:",
    bullets: [
      "Visional inspection of the water heater in/out connections and the combination safety release valve.",
      "Check W/C, physical condition, water supply connections.",
      "Check operation of flush W/C mechanism.",
      "Check Bidet, physical condition, water supply connections.",
      "Check washbasin, faucet.",
      "Check and clean floor trap.",
      "Check shower head, hand shower, etc.",
      "Check and clean bottle trap, and report if replacement is needed",
      "Check the physical condition and functionality of angle valves and flexible hoses.",
      "Check the shut-off valve/set condition and report if replacement is needed.",
      "Check for any visible water leakage any dampness on the wall/ceiling that potentially could be sign of the leakage.",
    ],
  },
  {
    serviceId: "water-pump",
    sectionNumber: "2.4",
    title: "Water Pump Maintenance: (if applicable):",
    bullets: [
      "Ensure pump is working without any unusual noise and report any abnormality.",
      "Check the pressure kit, pressure switch functionality and report any abnormality.",
      "Check the pressure vessel tank physical appearance and functionality and report any abnormality.",
      "Check mechanical seals condition and report if replacement is needed.",
      "Check couplings, joints and physical condition of the exposed pipelines.",
      "Check pump room exhaust (if applicable) and ensure it's in working condition.",
      "Check the Floating switch inside the water tank (where it's accessible (removable via union), if not accessible, to be done during the water tank cleaning, when the tank is empty.",
      "Check the floating ball valve inside the water tank.",
      "Check the overall condition and cleanness of the water tank and report (with photos)",
    ],
  },
  {
    serviceId: "roof-drain",
    sectionNumber: "2.5",
    title: "Roof Drain cleaning",
    bullets: [
      "Roof/balcony drain cleaning will be carried out once a year.",
      "Visually check the condition of roof/balcony drain cover/dome and remove the debris and any obstacle that potentially could block the flow of water, Use the brush to remove any light debris that might be stuck to the side.",
      "Cleaning of the drain line using the pressure washer, run water through each drain point to make sure it's draining easily and freely. Use the brush to remove any light debris that might be stuck to the side.",
      "Visually checking the roof/balcony rain water drain points in the ground level to ensure free flow of water.",
      "Visually checking the condition of roof waterproofing (if exposed) and report any abnormality.",
    ],
  },
  {
    serviceId: "water-tank",
    sectionNumber: "2.6",
    title: "Water tank cleaning",
    bullets: [
      "Water tank cleaning service will be carried out twice a year.",
      "YALLA FIX IT ONE PERSON COMPANY LLC water tank cleaning technicians are trained and certified by DM approved third party institution.",
      "During the water tank cleaning potential water supply interruptions to be communicated with the client and both parties to agree on time/date (working days/hours 9:00 am to 6:00 pm only)",
      "Visually inspect internal walls of tank for signs of scale deposition, corrosion and report any abnormality.",
      "Visually inspect tank and associated valves/pipework for signs of corrosion and leaks.",
      "Visually inspect that the ball valve opens and closes correctly and report any abnormality.",
      "Visually inspect the floating valve and foot valve to ensure functioning properly and report any abnormality.",
      "Existing water to be drained via submersible pump to the nearest drainage and/or the main supply valve to be closed prior to the schedule to reduce the water level in the water tank.",
      "Cleaning the interior walls of the water tank with power wash using disinfectant chemical, approved for water tank cleaning by Dubai municipality, in order to remove the slime and dirt build up on the floor, sides and corners of the water tank.",
      "Refilling of the water after the cleaning process to be done by DEWA line.",
      "Test and commissioning of the water supply pressure and factuality of the water pumps after refilling the tank.",
      "Laboratory water test report is not included in this package, if required to be provided upon approval of the quotation.",
    ],
  },
  {
    serviceId: "duct-cleaning",
    sectionNumber: "2.7",
    title: "Duct cleaning",
    bullets: [
      "Air duct cleaning/sanitation to be carried out once a year.",
      "Covering and protection of floor, furniture using drop sheet and polyethylene sheet to protect the surrounding area from the dust.",
      "Check the functionality of the air-conditioning unit (thermoset setting and grill temperature and running noise level to be checked) and report any abnormality.",
      "Removal of the A/C diffuser/grill and clean/wash with water and cleaning agent and installation of the same after drying, including new white/clear silicon filler for the gap between the wall and diffuser/grill outer body.",
      "Cleaning of Air handling unit accessible air Duct Interior walls by using professional high-pressure vacuum machine with rotational brush head. (Rotobrush)",
      "Cleaning of the AC filter and Drain pan/pipe.",
      "Sanitizing the interior surface of the Airducts, using antibacterial chemical (eco-friendly, odorless) and ensue the antibacterial chemical effectively covering all accessible surfaces, using ULV fogging machine.",
      "If performing duct cleaning for one or multiple units required creation of temporary celling access and/or PI/GI duct access, due to the length of the duct, VCD or branches shape, proceeding with the inaccessible area is subject to approval of the quotation for creation of access (ceiling/duct) and related works. Alternatively, inaccessible ducts will be kept untouched.",
      "if the unit/ diffuser/grill height is not reachable safely by standard ladder for one or multiple units and scaffolding is required, additional charge for supply, delivery, assembly of scaffolding will be applicable. Alternatively, inaccessible grill/diffusers will be kept untouched.",
    ],
  },
  {
    serviceId: "coil-cleaning",
    sectionNumber: "2.8",
    title: "Coil cleaning:",
    bullets: [
      "Evaporator coil cleaning/sanitation to be carried out once a year.",
      "Check the functionality of the air-conditioning unit (thermoset setting and grill temperature and running noise level to be checked) and report any abnormality.",
      "Covering and protection of floor using drop sheet and polyethylene sheet to protect the surrounding area from the dust, dirt and water.",
      "Deep cleaning of the accessible evaporator coil, using pressure washer and Dubai municipality approved coil cleaning chemical to remove the dirt and scale build-up, to allow free circulation of air in the coil and maximize the efficiency of the air-conditioning by proper heat exchange in evaporator coil.",
      "Cleaning of the AC filter and Drain pan/pipe.",
      "Removal and cleaning of accessible fan motor and fan blower and reinstallation of the same after drying.",
      "Check the performance of the air-conditioning unit after the completion of the task and report any abnormality.",
      "If performing coil cleaning for one or multiple units required creation of temporary celling access, proceeding with the coil cleaning task for the inaccessible unit is subject to approval of the quotation for creation of the access and related works. Alternatively, inaccessible ducts will be kept untouched.",
    ],
  },
  {
    serviceId: "handyman",
    sectionNumber: "2.9",
    title: "Free Handyman service (If applicable)",
    intro:
      "Based on the selected AMC package, limited hours of handyman service to be delivered to the customer, upon request (to be scheduled at least 48 hours ahead of time).\nHandyman is defined as team of two (one technician and one helper) with all necessary standard tools and basic consumables (supply materials and spare parts is not part of the handyman service)\nBelow will be considered as handyman service:",
    bullets: [
      "Repair of the fly screen, aluminum/wooden door adjustment/alignments.",
      "Repair and adjustment of hinges, drawer rails, cabinet/cupboard catches, lock cylinder.",
      "Assembly/installation of the furniture (where two persons are enough for assembly)",
      "Hanging of photo frames and art works (on standard height) installation of shelves.",
      "Minor paint touch ups and wall/ceiling rectification/painting (accessible height with standard ladder), painting material to be provided by customer.",
      "Installation of standard size chandelier, wall light and minor electrical and plumbing works (where new electricity/water supply line or control/valve is not needed)",
      "Mirror masonry works such as grouting, and fixing of single isolated tile and Sealant (silicon) work.",
      "Housekeeping, arrangement of the storage. (where two persons are enough for moving the items)",
    ],
  },
];

export const HANDYMAN_CONTINUATION_BULLETS = [
  "Installation of standard size chandelier, wall light and minor electrical and plumbing works (where new electricity/water supply line or control/valve is not needed)",
  "Mirror masonry works such as grouting, and fixing of single isolated tile and Sealant (silicon) work.",
  "Housekeeping, arrangement of the storage. (where two persons are enough for moving the items)",
];

export const CLAUSE_3_EMERGENCY = {
  title: "3- Emergency, Non-emergency call out:",
  sections: [
    {
      title: "3.1 Emergency call-out",
      bullets: [
        "All calls, out of standard working hours (9:00 am to 6:00 pm), Fridays and holidays will be considered as Emergency call",
        "Emergency Call-outs are limited to below listed:",
        "Complete failure of air conditioning system.",
        "Complete failure of electrical power, power outage or any failure that could be considered as fire hazard.",
        "Complete failure of water system. (Major plumbing failures, i.e. heavy leaks)",
        "Complete failure of drainage system. (major blockage and overflowing)",
        "Emergency calls to be logged within 60 minutes from the initial call/message (WhatsApp/SMS) and to be attended free of charge within 120 minutes from the recorded logging, considering traffic conditions and/or potential community access restrictions and availability.",
        "An emergency teams will be assigned to \"manage the disaster condition\" and \"control the source\" that potentially could cause damage to the property and/or makes the property unserviceable for the customer, however to proceed with the rectification work, when parts, specific tools/profession and/or extensive time is required, to be scheduled for the next available slot (during the working hours, with priority). And might be subject to quotation based on required materials and necessary manpower. Customer's written approval is mandatory prior to scheduling.",
        "Misuse of emergency call out will be charged the client.",
      ],
    },
    {
      title: "3.2 Non-Emergency call-out",
      bullets: [
        "Non-Emergency call outs are the inquiries that are not covered under the Planned preventive maintenance, Emergency call-out and handyman definition.",
        "If physical visit is required, schedule of non-emergency visit to be agreed as per available slots and customer request, within 48 hours from the logging the inquiry.",
        "Non-Emergency visits are designed for inspection and identification of the root cause of the reported issue and/or minor adjustments, rectifications that not required any material replacement and can be done maximum within 2 hours. (number of free non-emergency visits per year to be defined as per the selected AMC package terms and conditions)",
        "Where replacement of parts and/or extensive time (more than 2 hours) is required, the quotation, based on estimated material + handling fee and required manpower/hours, along with the job sheet to be shared with the customer for review and approval, within 24 hours from the site visit. Customer's written approval is mandatory prior to scheduling.",
      ],
    },
  ],
};

export const CLAUSE_4_MATERIALS = {
  title: "4- Materials, spare parts, consumables and Labor",
  paragraphs: [
    "All Consumable are covered in this contract:",
    "Consumables are general minor items such as PVC solvent, electric insulation tape, electric connector, polyethylene sheet for covering the work area, garbage bag, PPE (personal protective equipment), mask and shoes cover, Basic cleaning chemicals that is going be used in A/C cleaning service, water tank cleaning, A/C duct cleaning and coil cleaning.",
    "All Materials and spare parts are not covered in this contract:",
    "Spare parts are classified as minor parts, required for repair and fix of the maintenance issues, covered, such as UPVC connections (Elbow, socket, T joint), CP connections (Elbow, socket, T joint, extension, reducer), electric 3 pin plug, light bulbs, capacitor, standard GI screw, nut and washer, standard flexible hose, etc. spare parts to be quoted as lumpsum along with the estimated manpower for the specific scope of work.",
    "Materials are classified as major parts, such as A/C fan moto/blower, A/C compressor, kitchen faucet, hand spray, etc. Only appropriate materials of equal or better quality than those originally installed will be used to rectify the problem for any damaged parts that has been reported from the inspection and will be charged to client. Any materials replacement will be invoiced separately with 20% handling fee upon approval of the Client. Additional works and services will be charged to the Client in the form of quotation, Customer's written approval is mandatory prior to scheduling.",
    "YALLA FIX IT ONE PERSON COMPANY LLC will outsource the materials. hence, not liable if materials are not available in UAE market. An equivalent part can be suggested with approval of the Client before purchase/installation.",
    "YALLA FIX IT ONE PERSON COMPANY LLC will not offer any warranty on any materials or parts apart from manufacturer warranty.",
  ],
};

export const CLAUSE_5_EXCLUDED = {
  title: "5- Services Excluded",
  intro: "The following services are expressively excluded from the scope of this contract",
  bullets: [
    "Electricity, water, chilled water, drainage, telephone, internet connections (being the responsibility of the related local authorities) and troubleshooting where the source is out of property perimeter.",
    "Air duct cleaning, Chilled water strainer cleaning, evaporator coil flush and evaporator coil cleaning, water tank cleaning and drain line jetting, if the service is not specifically selected to be covered under AMC package.",
    "Gate Barriers, Garage Doors, Automatic Doors repair and maintenance.",
    "Swimming Pools maintenance and cleaning, Garden light, Irrigation Systems and garden, maintenance.",
    "Structural faults/repair to building including failure of roof/foundation waterproofing and structural cracks.",
    "Replacement and repair of any broken window, facade glass, door, skylight roof.",
    "Carpet, Sofa, Curtain, mattress and any upholstery cleaning/shampooing, glass cleaning, roof cleaning, disposal of waste, deep cleaning, if the service is not specifically selected to be covered under AMC package.",
    "Building Management Systems (BMS).",
    "Any service out of the property limit perimeter with is considered as common area or covered by authorities. However, some of above services can be rendered (to be quoted upon request).",
  ],
  footerParagraphs: [
    "YALLA FIX IT ONE PERSON COMPANY LLC, being part of TPH GROUP OF COMPANIES is please to deliver wide range of services with special discount (based on the selected package) upon request. e.g.",
    "Air duct cleaning, coil cleaning/flushing, Chilled water strainer cleaning, water tank cleaning, drain line jetting, etc.",
    "All kind of upholstery cleaning/shampooing (Dry and Wet), Glass cleaning, façade cleaning, deep cleaning.",
    "Disinfection and sanitization for COVID-19 (preventive and active case) listed as per DM and DHA regulations.",
    "Soft cleaning, housekeeping, house maid and hurly babysitter and elderly care. Trained and certified personnel under TPH group for domestic workers.",
    "Any work and services not expressively covered in this contract scope of work (Clause 6.1) will be charged separately according to price list (Clause 6.2).",
  ],
};

export const CLAUSE_6_3_HANDYMAN = {
  title: "6.3 Any handyman works exceeded from the given limited free handyman hours in the contract (non-quoted jobs) will be charged as below fix rate. (for a team of one technician and one helper with basic tools and equipment), materials to be provided by customer.",
  rates: [
    { label: "A.", text: "First Hour – 199.00 AED + VAT" },
    { label: "B.", text: "Succeeding Hours – 99.00 AED + VAT" },
  ],
};

export const CLAUSE_6_2_INTRO = [
  "6.2 Supply and installation price list.",
  "The prices of the following items are predefined but subject to customer approval. The purpose of this list is to reduce the process steps and decrease the resolution lead-time for the customer satisfaction.",
  "Prices for other areas/items are and per term and condition of the contract and quotation-based.",
  "Below pricelist is exclusive to this property and cannot be used as reference rate for any other location.",
];

export const PRICE_LIST_ROWS = [
  { no: "1", category: "XXX", description: "XXX", brand: "XXX", price: "XXX" },
  { no: "2", category: "XXX", description: "XXX", brand: "XXX", price: "XXX" },
  { no: "3", category: "XXX", description: "XXX", brand: "XXX", price: "XXX" },
];

export const BANK_DETAILS = [
  { label: "ACCOUNT NAME", value: "YALLA FIX IT ONE PERSON COMPANY LLC" },
  { label: "BANK NAME", value: "ABU DHABI COMMERCIAL BANK" },
  { label: "CID NUMBER", value: "11214542" },
  { label: "ACCOUNT NUMBER", value: "11214542920001" },
  { label: "IBAN NUMBER", value: "AE360030011214542920001" },
  { label: "BRANCH", value: "SHEIKH ZAYED ROAD" },
  { label: "SWIFT CODE", value: "ADCBAEAA" },
];

export const CLAUSE_7_TERMS = [
  "7.1 Water and electricity required to perform the maintenance job to be provided by customer.",
  "7.2 All access pass/entry permit to be arranged by customer. ALL necessary documentations, valid trade license, valid identification papers for the personnel, etc. provided by YALLA FIX IT ONE PERSON COMPANY LLC.",
  "7.3 Authority approval/NOC to be provided by customer (if applicable).",
  "7.4 Any works outside the agreed scope and work of this maintenance contract will be subject for Quotation. written approval of customer or official representative of the customer is mandatory prior to purchasing the materials (if needed) and scheduling for the work.",
  "7.5 Trained technicians employed by YALLA FIX IT ONE PERSON COMPANY LLC. And/or sub-contracted will be supervised by YALLA FIX IT ONE PERSON COMPANY LLC and performed the services as per the terms and condition of this Contract.",
  "7.6 This contract shall apply only on the property registered and, in any case, cannot be transferred to another property.",
  "7.7 YALLA FIX IT ONE PERSON COMPANY LLC is not considered liable for loss/damage to client property or tenant's belongings during the annual maintenance service cover.",
  "7.8 YALLA FIX IT ONE PERSON COMPANY LLC is not responsible of claims that cannot be proven. This includes but not limited to, theft, damages to tenant valuables, damages due to equipment failures, Fire and/or any other values the client might have lost.",
  "7.9 Contract renewal should commence two months prior to expiration date.",
  "7.10 YALLA FIX IT ONE PERSON COMPANY LLC is under no obligated to attend to damages caused by nature or changes in political landscape such as earthquakes, floods, war, storms, etc.",
  "7.11 For all confirmed/booked PPM schedules that cancelled/No-show without 24 hours advance notification from the customer, for two consecutive appointments, PPM will be treated as 'consumed'. Written prove to be provided.",
  "7.12 YALLA FIX IT ONE PERSON COMPANY LLC technicians will at all time be well dressed, professional, speak English and always think of their hygiene and mostly be respectful to the customer/customer representatives and under no circumstances behave unprofessionally.",
  "7.13 Each Party including its employees and servants undertakes to keep and treat as confidential and not disclose to any third party any information of a proprietary or confidential nature concerning the operations, plans, know-how, trade secrets, business transactions and affairs of the other Party received or acquired by the other in the course of performing this Agreement.",
  "7.14 YALLA FIX IT ONE PERSON COMPANY LLC strongly recommends that a home/property insurance plan is in place to cover any damage caused to the property through water leakage, fire, and/or malfunctioning equipment/system, and will support the customer with repair/remediation quotations.",
  "7.15 Neither Party shall be liable to the other for any failure to perform its obligations hereunder to the extent that such failure results from acts of God, war (whether declared or not), sabotage, riot, explosion, government control, restrictions or prohibitions or any other Government act or omission whether local, national, or within the region known as the Middle East, fire, accident, earthquake, storm, flood, epidemic, pandemic, drought, or other natural catastrophes, strikes, lockouts, except where such strikes or lockouts are caused directly by YALLA FIX IT ONE PERSON COMPANY LLC, or any other cause beyond the control of that Party. Any Party, which is prevented by reason of such unforeseen circumstances aforesaid, shall notify the other immediately thereof and shall use all reasonable endeavors to mitigate the effects thereof. During the period of any such Force Majeure failure the client will be entitled to use a Third Party to provide the service if YALLA FIX IT ONE PERSON COMPANY LLC is unable to do so as a result of Force Majeure, but not at the expense of YALLA FIX IT ONE PERSON COMPANY LLC. In these circumstances the client is entitled to reduce his payments to YALLA FIX IT ONE PERSON COMPANY LLC during the period that YALLA FIX IT ONE PERSON COMPANY LLC is unable to perform the relevant services.",
  "If an event of Force Majeure lasts for more than three months, or when it becomes reasonably apparent that an event of Force Majeure will last for more than three months, either Party may, following consultation with the other, give one month's notice of termination.",
  "7.16 Moods of payment (cash, cheque or bank transfer)",
];

export const CLAUSE_8_TERMINATION = {
  title: "8- Termination",
  paragraphs: [
    "Either party may terminate this contract by giving 30 days written notice to the other party. (via email)",
    "The remaining balance amount won't be refundable in case the contract is terminated by the customer without valid reason (non-performance/ disqualified) or if the property would be sold to a new owner and the new owner would not wish to continue the maintenance contract.",
    "Non-performance/ disqualified claim to be documented, communicated written via email or WhatsApp.",
    "Remaining payment to be refunded on PRO-RATA basis (full refund of any unearned duration).",
    "e.g. if the total value of the contract is 10'000.00 AED and the contract is cancelled after 6 months, on a PRO-RATA basis the remaining amount of 5'000.00 AED (minus the VAT paid value) will be refundable.",
    "This contract is not transferrable to any other property.",
  ],
  confirmation:
    "I hereby confirm that I agree to the above scope of work, term and condition of this contract",
};

export const SCOPE_SERVICE_IDS = SCOPE_SECTIONS.map((section) => section.serviceId);

export function getSelectedScopeSections(selectedServiceIds: string[]) {
  const selected = new Set(selectedServiceIds);
  return SCOPE_SECTIONS.filter((section) => selected.has(section.serviceId));
}

export const TOTAL_PAGES = 8;
