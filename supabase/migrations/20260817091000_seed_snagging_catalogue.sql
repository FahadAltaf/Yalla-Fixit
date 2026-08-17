-- =====================================================
-- Migration: Snag catalogue v1.0, area matrix, area templates
-- File: 20260817091000_seed_snagging_catalogue.sql
--
-- Seeds the controlled catalogue described in BRD §9 as the v1.0
-- skeleton that unblocks the mobile build. The BRD assigns authorship
-- to the YFI Operations Lead, so this is deliberately shaped for
-- editing rather than replacement: Ops add defect rows and flip
-- applicability, they do not have to invent the structure.
--
--   Level 1  Area              -> snagging_catalogue_areas
--   Level 1x2 applicability    -> snagging_catalogue_area_elements
--   Level 2  Element           -> element_code on each entry
--   Level 3  Defect Type       -> defect_code on each entry
--   Level 4  Severity guideline-> default_severity on each entry
--
-- A captured snag composes the full code at capture time:
-- LIV + WL-CRK = LIV-WL-CRK.
-- =====================================================

-- -----------------------------------------------------
-- Level 1 — areas
-- -----------------------------------------------------

INSERT INTO public.snagging_catalogue_areas (code, label, sort_order) VALUES
  ('ENT', 'Entrance',        10),
  ('LIV', 'Living Room',     20),
  ('DIN', 'Dining Room',     30),
  ('FAM', 'Family Room',     40),
  ('KIT', 'Kitchen',         50),
  ('MBR', 'Master Bedroom',  60),
  ('BED', 'Bedroom',         70),
  ('MBA', 'Master Bathroom', 80),
  ('BTH', 'Bathroom',        90),
  ('WC',  'Guest WC',       100),
  ('COR', 'Corridor',       110),
  ('STA', 'Staircase',      120),
  ('LDY', 'Laundry',        130),
  ('STO', 'Store',          140),
  ('MRM', 'Maid Room',      150),
  ('BAL', 'Balcony',        160),
  ('TER', 'Terrace',        170),
  ('GDN', 'Garden',         180),
  ('ROF', 'Roof',           190),
  ('GAR', 'Garage',         200)
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------
-- Levels 2-4 — element / defect / advisory severity
-- -----------------------------------------------------

INSERT INTO public.snagging_catalogue_entries (
  code, element_code, element_label, defect_code, defect_label,
  default_severity, catalogue_version, sort_order
)
SELECT
  v.element_code || '-' || v.defect_code,
  v.element_code, v.element_label, v.defect_code, v.defect_label,
  v.default_severity, 'v1.0', v.element_ord * 100 + v.defect_ord
FROM (VALUES
  -- Floor
  ('FL', 'Floor', 10, 'CRK', 'Cracked tile',                 'medium', 10),
  ('FL', 'Floor', 10, 'CHP', 'Chipped tile',                 'low',    20),
  ('FL', 'Floor', 10, 'SCR', 'Scratched floor finish',       'low',    30),
  ('FL', 'Floor', 10, 'HOL', 'Hollow tile',                  'medium', 40),
  ('FL', 'Floor', 10, 'GRT', 'Grout missing or uneven',      'low',    50),
  ('FL', 'Floor', 10, 'STN', 'Stained floor',                'low',    60),
  ('FL', 'Floor', 10, 'LVL', 'Uneven floor level',           'medium', 70),
  ('FL', 'Floor', 10, 'MIS', 'Missing tile',                 'high',   80),
  ('FL', 'Floor', 10, 'ALN', 'Tile misaligned',              'low',    90),
  -- Walls
  ('WL', 'Walls', 20, 'CRK', 'Crack in wall',                'high',   10),
  ('WL', 'Walls', 20, 'DMP', 'Damp patch',                   'high',   20),
  ('WL', 'Walls', 20, 'UEV', 'Uneven wall surface',          'medium', 30),
  ('WL', 'Walls', 20, 'HOL', 'Hole or dent',                 'medium', 40),
  ('WL', 'Walls', 20, 'STN', 'Stained wall',                 'low',    50),
  ('WL', 'Walls', 20, 'TIL', 'Wall tile defective',          'medium', 60),
  -- Ceiling
  ('CL', 'Ceiling', 30, 'CRK', 'Crack in ceiling',           'medium', 10),
  ('CL', 'Ceiling', 30, 'STN', 'Water mark on ceiling',      'high',   20),
  ('CL', 'Ceiling', 30, 'GAP', 'Gap at ceiling joint',       'medium', 30),
  ('CL', 'Ceiling', 30, 'SAG', 'Sagging ceiling panel',      'high',   40),
  ('CL', 'Ceiling', 30, 'ACC', 'Access panel not fitted',    'medium', 50),
  ('CL', 'Ceiling', 30, 'DBR', 'Debris above ceiling',       'medium', 60),
  -- Paint
  ('PT', 'Paint', 40, 'UEV', 'Uneven paint finish',          'low',    10),
  ('PT', 'Paint', 40, 'DRP', 'Paint drips or runs',          'low',    20),
  ('PT', 'Paint', 40, 'OVR', 'Overspray on adjacent finish', 'low',    30),
  ('PT', 'Paint', 40, 'TCH', 'Touch-up required',            'low',    40),
  ('PT', 'Paint', 40, 'MIS', 'Missing paint coat',           'medium', 50),
  -- Skirting
  ('SK', 'Skirting', 50, 'GAP', 'Gap between skirting and wall', 'low', 10),
  ('SK', 'Skirting', 50, 'DMG', 'Damaged skirting',          'low',    20),
  ('SK', 'Skirting', 50, 'ALN', 'Skirting misaligned',       'low',    30),
  ('SK', 'Skirting', 50, 'MIS', 'Skirting missing',          'medium', 40),
  -- Doors
  ('DR', 'Doors', 60, 'ALN', 'Door misaligned',              'medium', 10),
  ('DR', 'Doors', 60, 'HDL', 'Handle loose or faulty',       'low',    20),
  ('DR', 'Doors', 60, 'LCK', 'Lock faulty',                  'medium', 30),
  ('DR', 'Doors', 60, 'SCR', 'Door surface damaged',         'low',    40),
  ('DR', 'Doors', 60, 'GAP', 'Excessive gap around door',    'low',    50),
  ('DR', 'Doors', 60, 'STP', 'Door stopper missing',         'low',    60),
  ('DR', 'Doors', 60, 'CLS', 'Door does not close properly', 'medium', 70),
  ('DR', 'Doors', 60, 'SEL', 'Door seal missing',            'low',    80),
  -- Electrical
  ('EL', 'Electrical', 70, 'DED', 'Dead socket',             'high',   10),
  ('EL', 'Electrical', 70, 'SWT', 'Switch faulty',           'high',   20),
  ('EL', 'Electrical', 70, 'LGT', 'Light not working',       'medium', 30),
  ('EL', 'Electrical', 70, 'COV', 'Cover plate damaged',     'low',    40),
  ('EL', 'Electrical', 70, 'ALN', 'Fitting misaligned',      'low',    50),
  ('EL', 'Electrical', 70, 'EXP', 'Exposed wiring',          'high',   60),
  ('EL', 'Electrical', 70, 'DBD', 'Distribution board unlabelled', 'medium', 70),
  ('EL', 'Electrical', 70, 'ERT', 'Earthing not verified',   'high',   80),
  -- Windows
  ('WN', 'Windows', 80, 'SEL', 'Broken window seal',         'medium', 10),
  ('WN', 'Windows', 80, 'GLS', 'Glass scratched or chipped', 'medium', 20),
  ('WN', 'Windows', 80, 'OPR', 'Window does not operate',    'medium', 30),
  ('WN', 'Windows', 80, 'LCK', 'Window lock faulty',         'medium', 40),
  ('WN', 'Windows', 80, 'SIL', 'Poor silicone sealing',      'low',    50),
  ('WN', 'Windows', 80, 'DRN', 'Window drainage blocked',    'medium', 60),
  -- Plumbing
  ('PL', 'Plumbing', 90, 'LEK', 'Water leak',                'high',   10),
  ('PL', 'Plumbing', 90, 'DRN', 'Slow drainage',             'medium', 20),
  ('PL', 'Plumbing', 90, 'PRS', 'Low water pressure',        'medium', 30),
  ('PL', 'Plumbing', 90, 'TRP', 'Trap not sealed',           'medium', 40),
  ('PL', 'Plumbing', 90, 'HOT', 'No hot water',              'high',   50),
  ('PL', 'Plumbing', 90, 'VLV', 'Valve faulty',              'medium', 60),
  -- HVAC
  ('HV', 'HVAC', 100, 'NOI', 'AC noisy',                     'medium', 10),
  ('HV', 'HVAC', 100, 'CLG', 'AC not cooling',               'high',   20),
  ('HV', 'HVAC', 100, 'DRN', 'Condensate leak',              'high',   30),
  ('HV', 'HVAC', 100, 'GRL', 'Grille damaged or misaligned', 'low',    40),
  ('HV', 'HVAC', 100, 'SVC', 'Servicing required',           'medium', 50),
  ('HV', 'HVAC', 100, 'THM', 'Thermostat faulty',            'medium', 60),
  -- Joinery
  ('JN', 'Joinery', 110, 'CHP', 'Chipped cabinet edge',      'low',    10),
  ('JN', 'Joinery', 110, 'ALN', 'Door or drawer misaligned', 'low',    20),
  ('JN', 'Joinery', 110, 'HNG', 'Hinge faulty',              'medium', 30),
  ('JN', 'Joinery', 110, 'SFT', 'Soft-close not working',    'low',    40),
  ('JN', 'Joinery', 110, 'FIN', 'Poor joinery finish',       'low',    50),
  ('JN', 'Joinery', 110, 'GAP', 'Gap at joinery joint',      'low',    60),
  -- Sanitary
  ('SN', 'Sanitary', 120, 'SIL', 'Silicone sealing poor',    'low',    10),
  ('SN', 'Sanitary', 120, 'CHP', 'Chipped sanitaryware',     'medium', 20),
  ('SN', 'Sanitary', 120, 'FIX', 'Fixture loose',            'medium', 30),
  ('SN', 'Sanitary', 120, 'SEA', 'Seat or lid faulty',       'low',    40),
  ('SN', 'Sanitary', 120, 'MIR', 'Mirror damaged',           'low',    50),
  ('SN', 'Sanitary', 120, 'ACC', 'Accessory missing',        'low',    60),
  -- Balustrade
  ('BL', 'Balustrade', 130, 'LSE', 'Balustrade loose',       'high',   10),
  ('BL', 'Balustrade', 130, 'HGT', 'Balustrade height non-compliant', 'high', 20),
  ('BL', 'Balustrade', 130, 'FIN', 'Poor balustrade finish', 'low',    30),
  ('BL', 'Balustrade', 130, 'GAP', 'Balustrade spacing excessive', 'high', 40),
  -- Appliances
  ('AP', 'Appliances', 140, 'NWK', 'Appliance not working',  'high',   10),
  ('AP', 'Appliances', 140, 'DMG', 'Appliance damaged',      'medium', 20),
  ('AP', 'Appliances', 140, 'MIS', 'Appliance missing',      'high',   30),
  ('AP', 'Appliances', 140, 'INS', 'Appliance poorly installed', 'medium', 40),
  -- External / civil, mostly outdoor areas
  ('EX', 'External Works', 150, 'CRK', 'Cracked screed or paving', 'medium', 10),
  ('EX', 'External Works', 150, 'DRN', 'Standing water / poor fall', 'high', 20),
  ('EX', 'External Works', 150, 'WPF', 'Waterproofing defective', 'high',  30),
  ('EX', 'External Works', 150, 'FIN', 'Poor external finish',  'low',   40)
) AS v(element_code, element_label, element_ord, defect_code, defect_label, default_severity, defect_ord)
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------
-- Applicability matrix (level 1 x level 2)
--
-- NULL area list means the element exists in every area.
-- -----------------------------------------------------

WITH element_areas(element_code, element_ord, area_codes) AS (
  VALUES
    ('FL', 10, NULL::TEXT[]),
    ('WL', 20, NULL::TEXT[]),
    ('EL', 70, NULL::TEXT[]),
    ('CL', 30, ARRAY['ENT','LIV','DIN','FAM','KIT','MBR','BED','MBA','BTH','WC','COR','STA','LDY','STO','MRM','BAL','TER','GAR']),
    ('PT', 40, ARRAY['ENT','LIV','DIN','FAM','KIT','MBR','BED','MBA','BTH','WC','COR','STA','LDY','STO','MRM','BAL','TER','ROF','GAR']),
    ('SK', 50, ARRAY['ENT','LIV','DIN','FAM','KIT','MBR','BED','MBA','BTH','WC','COR','STA','LDY','STO','MRM']),
    ('DR', 60, ARRAY['ENT','LIV','DIN','FAM','KIT','MBR','BED','MBA','BTH','WC','COR','LDY','STO','MRM','BAL','TER','GAR']),
    ('WN', 80, ARRAY['LIV','DIN','FAM','KIT','MBR','BED','MBA','BTH','COR','STA','LDY','STO','MRM']),
    ('PL', 90, ARRAY['KIT','MBA','BTH','WC','LDY','BAL','TER','GDN','ROF','GAR']),
    ('HV',100, ARRAY['ENT','LIV','DIN','FAM','KIT','MBR','BED','MBA','BTH','WC','COR','STA','MRM']),
    ('JN',110, ARRAY['ENT','LIV','DIN','FAM','KIT','MBR','BED','MBA','BTH','WC','LDY','STO','MRM']),
    ('SN',120, ARRAY['MBA','BTH','WC','LDY']),
    ('BL',130, ARRAY['BAL','TER','STA','ROF']),
    ('AP',140, ARRAY['KIT','LDY']),
    ('EX',150, ARRAY['BAL','TER','GDN','ROF','GAR'])
)
INSERT INTO public.snagging_catalogue_area_elements (area_code, element_code, sort_order)
SELECT a.code, e.element_code, e.element_ord
FROM element_areas e
JOIN public.snagging_catalogue_areas a
  ON (e.area_codes IS NULL OR a.code = ANY (e.area_codes))
ON CONFLICT (area_code, element_code) DO NOTHING;

-- -----------------------------------------------------
-- Area templates (FR-1.03)
--
-- Preset checklists by property type, copied onto a task at creation
-- and editable per inspection from that point on. Each room carries the
-- catalogue area it draws its defect list from, so "Bedroom 3" and
-- "Master Bedroom" resolve without the labels having to match.
-- -----------------------------------------------------

INSERT INTO public.snagging_area_templates (property_type, name) VALUES
  ('studio',    'Studio'),
  ('1br',       '1 Bedroom Apartment'),
  ('2br',       '2 Bedroom Apartment'),
  ('3br',       '3 Bedroom Apartment'),
  ('4br',       '4 Bedroom Apartment'),
  ('villa',     'Villa'),
  ('townhouse', 'Townhouse')
ON CONFLICT (property_type) DO NOTHING;

WITH template_areas(property_type, name, catalogue_area_code, sort_order) AS (
  VALUES
    ('studio', 'Entrance',                'ENT',  10),
    ('studio', 'Living / Sleeping Area',  'LIV',  20),
    ('studio', 'Kitchen',                 'KIT',  30),
    ('studio', 'Bathroom',                'BTH',  40),
    ('studio', 'Balcony',                 'BAL',  50),

    ('1br', 'Entrance',        'ENT', 10),
    ('1br', 'Living Room',     'LIV', 20),
    ('1br', 'Kitchen',         'KIT', 30),
    ('1br', 'Master Bedroom',  'MBR', 40),
    ('1br', 'Master Bathroom', 'MBA', 50),
    ('1br', 'Guest WC',        'WC',  60),
    ('1br', 'Laundry',         'LDY', 70),
    ('1br', 'Balcony',         'BAL', 80),

    ('2br', 'Entrance',        'ENT',  10),
    ('2br', 'Living Room',     'LIV',  20),
    ('2br', 'Dining Room',     'DIN',  30),
    ('2br', 'Kitchen',         'KIT',  40),
    ('2br', 'Master Bedroom',  'MBR',  50),
    ('2br', 'Master Bathroom', 'MBA',  60),
    ('2br', 'Bedroom 2',       'BED',  70),
    ('2br', 'Bathroom 2',      'BTH',  80),
    ('2br', 'Guest WC',        'WC',   90),
    ('2br', 'Laundry',         'LDY', 100),
    ('2br', 'Store',           'STO', 110),
    ('2br', 'Balcony',         'BAL', 120),

    ('3br', 'Entrance',        'ENT',  10),
    ('3br', 'Living Room',     'LIV',  20),
    ('3br', 'Dining Room',     'DIN',  30),
    ('3br', 'Kitchen',         'KIT',  40),
    ('3br', 'Master Bedroom',  'MBR',  50),
    ('3br', 'Master Bathroom', 'MBA',  60),
    ('3br', 'Bedroom 2',       'BED',  70),
    ('3br', 'Bathroom 2',      'BTH',  80),
    ('3br', 'Bedroom 3',       'BED',  90),
    ('3br', 'Bathroom 3',      'BTH', 100),
    ('3br', 'Guest WC',        'WC',  110),
    ('3br', 'Corridor',        'COR', 120),
    ('3br', 'Laundry',         'LDY', 130),
    ('3br', 'Store',           'STO', 140),
    ('3br', 'Maid Room',       'MRM', 150),
    ('3br', 'Balcony',         'BAL', 160),

    ('4br', 'Entrance',        'ENT',  10),
    ('4br', 'Living Room',     'LIV',  20),
    ('4br', 'Dining Room',     'DIN',  30),
    ('4br', 'Family Room',     'FAM',  40),
    ('4br', 'Kitchen',         'KIT',  50),
    ('4br', 'Master Bedroom',  'MBR',  60),
    ('4br', 'Master Bathroom', 'MBA',  70),
    ('4br', 'Bedroom 2',       'BED',  80),
    ('4br', 'Bathroom 2',      'BTH',  90),
    ('4br', 'Bedroom 3',       'BED', 100),
    ('4br', 'Bathroom 3',      'BTH', 110),
    ('4br', 'Bedroom 4',       'BED', 120),
    ('4br', 'Bathroom 4',      'BTH', 130),
    ('4br', 'Guest WC',        'WC',  140),
    ('4br', 'Corridor',        'COR', 150),
    ('4br', 'Laundry',         'LDY', 160),
    ('4br', 'Store',           'STO', 170),
    ('4br', 'Maid Room',       'MRM', 180),
    ('4br', 'Balcony',         'BAL', 190),

    ('villa', 'Entrance',        'ENT',  10),
    ('villa', 'Living Room',     'LIV',  20),
    ('villa', 'Dining Room',     'DIN',  30),
    ('villa', 'Family Room',     'FAM',  40),
    ('villa', 'Kitchen',         'KIT',  50),
    ('villa', 'Guest WC',        'WC',   60),
    ('villa', 'Staircase',       'STA',  70),
    ('villa', 'Master Bedroom',  'MBR',  80),
    ('villa', 'Master Bathroom', 'MBA',  90),
    ('villa', 'Bedroom 2',       'BED', 100),
    ('villa', 'Bathroom 2',      'BTH', 110),
    ('villa', 'Bedroom 3',       'BED', 120),
    ('villa', 'Bathroom 3',      'BTH', 130),
    ('villa', 'Bedroom 4',       'BED', 140),
    ('villa', 'Bathroom 4',      'BTH', 150),
    ('villa', 'Corridor',        'COR', 160),
    ('villa', 'Laundry',         'LDY', 170),
    ('villa', 'Store',           'STO', 180),
    ('villa', 'Maid Room',       'MRM', 190),
    ('villa', 'Maid Bathroom',   'BTH', 200),
    ('villa', 'Terrace',         'TER', 210),
    ('villa', 'Garden',          'GDN', 220),
    ('villa', 'Roof',            'ROF', 230),
    ('villa', 'Garage',          'GAR', 240),

    ('townhouse', 'Entrance',        'ENT',  10),
    ('townhouse', 'Living Room',     'LIV',  20),
    ('townhouse', 'Dining Room',     'DIN',  30),
    ('townhouse', 'Kitchen',         'KIT',  40),
    ('townhouse', 'Guest WC',        'WC',   50),
    ('townhouse', 'Staircase',       'STA',  60),
    ('townhouse', 'Master Bedroom',  'MBR',  70),
    ('townhouse', 'Master Bathroom', 'MBA',  80),
    ('townhouse', 'Bedroom 2',       'BED',  90),
    ('townhouse', 'Bathroom 2',      'BTH', 100),
    ('townhouse', 'Bedroom 3',       'BED', 110),
    ('townhouse', 'Corridor',        'COR', 120),
    ('townhouse', 'Laundry',         'LDY', 130),
    ('townhouse', 'Store',           'STO', 140),
    ('townhouse', 'Terrace',         'TER', 150),
    ('townhouse', 'Garden',          'GDN', 160),
    ('townhouse', 'Garage',          'GAR', 170)
)
INSERT INTO public.snagging_area_template_items (template_id, name, catalogue_area_code, sort_order)
SELECT t.id, ta.name, ta.catalogue_area_code, ta.sort_order
FROM template_areas ta
JOIN public.snagging_area_templates t ON t.property_type = ta.property_type
ON CONFLICT (template_id, name) DO NOTHING;

DO $$
DECLARE
  v_entries INTEGER;
  v_pairs INTEGER;
  v_items INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_entries FROM public.snagging_catalogue_entries;
  SELECT COUNT(*) INTO v_pairs   FROM public.snagging_catalogue_area_elements;
  SELECT COUNT(*) INTO v_items   FROM public.snagging_area_template_items;
  RAISE NOTICE 'Snag catalogue v1.0 seeded: % defect entries, % area/element pairs, % template rooms.',
    v_entries, v_pairs, v_items;
END $$;
