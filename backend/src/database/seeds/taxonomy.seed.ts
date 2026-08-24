import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../data-source';
import { PartTaxonomy } from '../entities';

/**
 * Real salvage-yard parts taxonomy (~600 entries), provided directly by the
 * user to replace the original 22-item placeholder list. Comma-separated,
 * as given -- category and isExteriorVisual are derived below via
 * classify(), not hand-annotated (impractical at this size, and more
 * consistent than manual tagging).
 */
const RAW_NAMES = `A Pillar, A Pillar Trim, A/C Bracket, A/C Compressor, A/C Compressor Clutch Only, A/C Condenser, A/C Condenser Fan, A/C Control Computer, A/C Evaporator, A/C Evaporator Housing only, A/C Heater Control, A/C Hose, A/C Wiring Harness, Accelerator Cable, Accelerator Pedal, Adaptive Cruise Projector, Air Bag, Air Bag Clockspring, Air Bag Ctrl Module, Air Box/Air Cleaner, Air Cond./Heater Vents, Air Flow Meter, Air Pump, Air Ride Compressor, Air Shutter, Air Tube/Resonator, Alternator, Alternator Bracket, Amplifier/Radio, Antenna, Anti-Lock Brake Computer, Anti-Lock Brake Pump, Armrest, Ash Tray/Lighter, Audiovisual (A/V), Automatic Headlight Dimmer, Auto. Trans. Cooler, Axle Actuator (4WD), Axle Assy Fr, Axle Assy Rear, Axle Beam Front, Axle Beam Rear, Axle Flange, Axle Housing Only, Axle Shaft, B Pillar Trim, Back Door, Back Door Glass, Back Door Handle Inside, Back Door Handle Outside, Back Door Hinge, Back Door Moulding, Back Door Shell, Back Door Trim Panel, Back Glass, Back Glass Regulator, Back Glass Shock, Backing Plate Front, Backing Plate Rear, Backup Camera, Backup Light, Battery, Battery Cable, Battery Cooling Fan, Battery Terminal, Battery Tray, Bed Pickup, Bed Floor, Bed Front Panel, Bed Liner, Bed Side, Bell Housing, Belt Tensioner, Blind Spot Camera, Blower Motor, Blower Motor Resistor, Body Wiring Harness, Brake/Clutch Pedal, Brake Booster, Brake Proportioning Valve, Brake Rotor/Drum Front, Brake Rotor/Drum Rear, Brake Shoes/Pads, Brush Guard, Bug Screen, Bumper Assy Front, Bumper Assy Rear, Bumper Bracket, Bumper Cover Front, Bumper Cover Rear, Bumper End Cap, Bumper Energy Absorber Front, Bumper Energy Absorber Rear, Bumper Face Bar Front, Bumper Face Bar Rear, Bumper Filler Panel, Bumper Guard Front, Bumper Guard Rear, Bumper Impact Strip, Bumper Reinforcement Front, Bumper Reinforcement Rear, Bumper Shock, Bumper Step Pad, C Pillar Trim, Cab, Cab Back Panel, Cab Clip no cowl, Cab Corner, Cab Marker/Clearance Lamp, Cabin Air Filter, Cabin Fuse Box, Caliper, Camera Projector, Camshaft, Camshaft Housing, Carburetor, Cargo Cover/Shade, Cargo Lamp, Carpet, Carrier, Carrier Case, CD Player/Radio, Center Cap Wheel, Center Pillar, Charging Port Door Assembly, Chassis Control Computer, Clock, Clockspring, Clutch Cable, Clutch Disc, Clutch Fork, Clutch Master Cylinder, Coil/Air Spring, Coil/Igniter, Column Switch, Computer Box Engine, Computer Box Not Engine, Condenser, Condenser/Radiator mtd Cooling Fan, Connecting Rod Engine, Console Front, Console Rear, Console Lid, Control Arm Front Lower, Control Arm Front Upper, Control Arm Rear Lower, Control Arm Rear Upper, Convertible Top, Convertible Top Boot, Convertible Top Lift, Convertible Top Motor, Convertible Windscreen, Coolant Pump, Cooling Fan, Core Radiator Support, Cowl, Cowl Vent/Screen Panel, Crank Pulley, Crankshaft, Cruise Control Computer, Cruise Control Servo/Regulator, Cruise Speed Controller, Cylinder Head, D Pillar, Dash/Interior Switch, Dash Bezel, Dash Pad, Dash Panel, Dash Wiring Harness, Deck Lid Assembly, Deck Lid Latch, Deck Lid Lock, Deck Lid/Trunk Lid Shell, Diesel Particulate Filter, Differential Assembly, Differential Case Only, Differential Flange Only, Distributor, Distributor Cap, Door Back, Door Front, Door Handle Inside, Door Handle Outside, Door Lock Assembly, Door Lock Striker, Door Mirror Cover, Door Outer Repair Panel Back, Door Outer Repair Panel Front, Door Outer Repair Panel Rear, Door Rear, Door Shell Back, Door Shell Front, Door Shell Rear, Door Window Crank Handle, Drag Link, Drive-By-Wire, Drive Shaft Front, Drive Shaft Rear, Driving Lamp Bezel, EGR Valve, Electric Door Motor, Electric Window Motor, Electrical Part Misc, Electronic Transmission Shifter, Emblem, Emergency Brake, Engine, Engine Block, Engine Computer, Engine Core, Engine Cover, Engine Cradle, Engine Cylinder Head, Engine Fuse Box, Engine Mounts, Engine Oil Pan, Engine Wiring Harness, Exhaust Assembly, Exhaust Cross Pipe, Exhaust Fluid Pump, Exhaust Fluid Tank, Exhaust Heat Shield, Exhaust Lead Pipe, Exhaust Manifold, Exhaust Muffler, Exhaust Pipe, Exhaust Resonator, Exhaust Tail Pipe, Fan Blade, Fan Clutch, Fender, Fender Extension, Fender Flare, Fender Inner Panel, Fender Moulding, Fender Skirt, Fender/Wheelhouse Inner Liner, Flex Plate, Floor Mats, Floor Pan, Floor Shift Assembly, Flywheel, Fog Lamp, Fog Lamp Bezel, Fog Lamp Bracket, Fog Lamp Rear, Fog Lamp Switch, Frame, Frame Front Section Only, Frame Horn, Frame Upper & Lower Rails, Front Axle Assembly, Front Axle Beam, Front Axle Shaft, Front Bumper Assembly, Front Bumper Cover, Front Bumper Face Bar, Front Bumper Guard, Front Bumper Reinforcement, Front Console, Front Door, Front Door Glass, Front Door Handle Inside, Front Door Handle Outside, Front Door Hinge, Front Door Mirror, Front Door Mirror Glass, Front Door Moulding, Front Door Regulator, Front Door Shell, Front Door Switch, Front Door Trim Panel, Front Door Vent Glass, Front Door Vent Glass Regulator, Front Door Window Motor, Front Drive Shaft, Front End Assembly (Nose), Front Seat Belt Assembly, Front Inner Structure, Front Valance, Front Window Regulator, Fuel Cap, Fuel Cell, Fuel Cooler, Fuel Distributor, Fuel Filler Door, Fuel Filler Neck, Fuel Gauge, Fuel Injector, Fuel Injector Pump, Fuel Injector Rail, Fuel Line, Fuel Pump, Fuel Tank, Fuel Tank Sending Unit, Fuse Box Cabin, Fuse Box Engine, Fuse Box Cooling Fan, Gas Cap, Gas Pedal, Gas Tank, Gate Interior Trim Panel, Gate Window Regulator, Gate/Lid, Gauge Misc, Gear Shift Indicator, Generator, Glass Back, Glass Front Door, Glass Front Vent, Glass Quarter Window, Glass Rear Door, Glass Rear Vent, Glass Special, Glass Windshield, Glove Box, Glove Box Door, Glove Box Lock, GPS Screen, Grille, Grille Moulding, Grille Surround, Harmonic Balancer, Hatch/Trunk Lid, Head Cylinder, Header Panel, Headlight Assembly, Headlight Ballast, Headlight Bracket, Headlight Bucket, Headlight Bulb, Headlight Cover Plastic, Headlight Door, Headlight Housing, Headlight Igniter, Headlight Lens, Headlight Motor, Headlight Switch Column Mounted, Headlight Switch Dash Mounted, Headlight Washer Motor Only, Headlight Wiper Motor Only, Headliner, Headrest, Heads Up Display, Heat Pump Reversing Valve, Heater Assy, Heater Core, Heater Motor, Heater/AC Control, Hood, Hood Deflector, Hood Hinge, Hood Insulation Pad, Hood Latch, Hood Ornament, Hood Prop, Hood Release Cable, Hood Release Handle, Hood Scoop, Hood Shock, Horn, Hub, Hub Cap/Wheel Cover (w image), Hub Cap/Wheel Cover (w/o image), Hub Lockout 4WD, HVAC Actuator, Hybrid Converter/Inverter, Idler Arm, Ignition Module, Ignition Switch, Ignitor/Coil, Info Screen, Information Label, Inside Door Handle, Instrument Cluster, Instrument Cluster Bezel, Instrument Face Plate, Intake Manifold, Intercooler, Intercooler Pipe, Interior Complete, Interior Light, Interior Trim Panel Gate/Lid, Interior Trim Panel Quarter, Interior Trim Panel Door Back, Interior Trim Panel Door Front, Interior Trim Panel Door Rear, Inverter Cooler, Jack Assembly, Keys/Latches and Locks, Key Remote/Fob, Kick Panel, Knee Assembly, Lamp Wiring Harness, Latch Front Door, Latch Rear Door, Latch Back Door, Latches Misc, Leaf Spring Front, Leaf Spring Rear, License Lamp, License Plate Bracket, Lid/Gate, Lid Interior Trim Panel, Liftgate Assembly, Liftgate Latch, Liftgate Lock, Liftgate Shell, Lock Actuator, Lockout Hub 4X4, Locks Misc, Lug Wrench, Luggage Rack, Marker/Fog Light Front, Marker/Side Light Rear, Master Cylinder, Mirror Door, Mirror Rear View, Misc Electrical, Moulding Back Door, Moulding Fender, Moulding Front Door, Moulding Lid/Hatch/Gate, Moulding Quarter Panel/Bed Side, Moulding Rear Door, Moulding Rocker, Moulding Windshield, Mouldings Misc, Mud Flap, Neutral Safety Switch, Night Vision Camera, Nose (Front End Assembly), Oil Cooler Engine, Oil Cooler Transmission, Oil Filter Adapter, Oil Filter Housing, Oil Pan Engine, Oil Pan Transmission, Oil Pump Engine, Outside Door Handle, Overdrive Unit, Owners Manual, Paddle Shifter, Park/Fog Lamp Front, Parcel Shelf, Park Lamp Rear, Parking Assist Camera, Pickup Bed, Pickup Bed Floor, Pickup Bed Front Panel, Pickup Bed Side, Pickup Cap/Camper Shell, Piston, Pitman Arm, Power Brake Booster, Power Inverter Hybrid, Power Steering Assy, Power Steering Control Valve, Power Steering Cooler, Power Steering Motor, Power Steering Pressure Cyl, Power Steering Pressure Hose, Power Steering Pump, Power Steering Rack/Box/Gear, Power Steering Reservoir, Pressure Plate, Push Rod Engine, Quarter Interior Trim Panel, Quarter Moulding, Quarter Panel, Quarter Panel Extension, Quarter Repair Panel, Quarter Window, Quarter Window Latch, Quarter Window Motor, Quarter Window Regulator, Rack & Pinion, Radar Unit, Radiator, Radiator/Condenser mtd Cooling Fan, Radiator Air Shutter, Radiator Core Support, Radiator Cover Baffle, Radiator Fan Shroud, Radiator Overflow Bottle, Radio/CD, Radio Bezel Trim, Radio Face Plate, Radius Arm Front, Rag Joint, Rear Axle Assy, Rear Axle Beam, Rear Body Panel, Rear Bumper Assembly, Rear Bumper Cover, Rear Bumper Face Bar, Rear Bumper Guard, Rear Bumper Reinforcement/Misc, Rear Clip, Rear Console, Rear Crossmember, Rear Door, Rear Door Handle Inside, Rear Door Handle Outside, Rear Door Hinge, Rear Door Moulding, Rear Door Regulator, Rear Door Shell, Rear Door Switch, Rear Door Trim Panel, Rear Door Vent Glass, Rear Door Vent Glass Regulator, Rear Door Window, Rear Door Window Motor, Rear Door Window Regulator, Rear Drive Shaft, Rear Finish Panel, Rear Gate/Lid, Rear Gate Window Motor, Rear Knuckle/Stub Axle, Rear Lower Valance, Rear Seat Belt Assembly, Rear Suspension, Rear Suspension Locating Arm, Rear Suspension Trailing Arm, Rear Window Defogger, Rear Window Washer Motor, Receiver Dryer, Relay Misc, Ring and Pinion Only, Rocker Arm, Rocker Moulding, Rocker Panel, Roll Bar, Roll Bar Padding, Roof, Roof Glass Frame/Track, Roof Panel, Roof Rack, Running Boards, Running Board Motor, Satellite Receiver, Seat Back 3rd Row, Seat Back 4th Row, Seat Back 5th Row, Seat Front, Seat Rear 2nd Row, Seat Belt Front, Seat Belt Rear, Seat Belt Motor, Seat Belt Pretensioner, Seat Belt Track Electric, Seat Motor, Seat Switch, Seat Track Front Only, Sensor Body Misc, Sensor Chassis Misc, Sensor Drivetrain Misc, Shifter Assembly Floor, Shifter Cable, Shifter Linkage, Shock Absorber, Shock Mount, Short Block, Sill Plate, Skid Plate, Slave Cylinder, Smog Pump, Spare Tire Carrier, Spare Tire Cover, Spare Tire Hoist, Spark Plug Wire, Speaker, Special Glass, Speedometer, Speedometer Cable, Spindle, Spoiler Front, Spoiler Rear, Spring Hanger, Stabilizer Bar Only, Starter, Steering Column, Steering Column Shaft, Steering Coupler, Steering Knuckle, Steering Pump, Steering Rack/Box/Gear, Steering Wheel, Strut, Strut Tower Brace, Sub Frame Front, Sub Frame Rear, Sun Roof/T-Top, Sun Roof Motor, Sunvisor, Supercharger/Turbocharger, Tachometer, Tail Light, Tail Light Circuit Board, Tail Light Lens, Tailgate Cable, Tailgate/Trunk Lid, Tailgate Hinge, Tailgate Latch, Tailgate Lift Motor, Tailgate Lock, Tailgate Shell, Tailgate Window Regulator, Thermostat Housing, Third Brake Light, Throttle Body/Throttle Valve Housing, Throwout Bearing, Tie Rod, Timing Belt/Chain, Timing Cover, Timing Gears, Tire, Tonneau Cover, Torque Convertor, Torsion Bar, Tow Hook, Track/Watts Linkage, Trailer Brake Controller, Trailer Hitch, Trans OD Unit, Transaxle Housing Only, Transfer Case, Transfer Case Adapter, Transfer Case Core, Transfer Case Electric Motor, Transfer Case Switch, Transmission, Transmission Bellhousing Only, Transmission Clutch Actuator, Transmission Computer, Transmission Cooling Line, Transmission Core, Transmission Crossmember, Transmission Front Pump, Transmission Mount, Transmission Oil Cooler, Transmission Pan, Transmission Torque Converter, Transmission Valve Body, Transmission Wiring Harness, Trim Ring, Trunk Lid Pull Down Motor, Trunk Lid/Hatch, Trunk Lid/Hatch Hinge, Trunk Lid/Hatch Shock, Trunk Lid/Tailgate Moulding, T-Top/Sunroof, Turbo/Supercharger Core, Turbocharger/Supercharger, Turn Signal/Fog Lamp, TV Screen, Uniside, Utility Bed, Utility Box, Vacuum Pump, Vacuum Storage Tank, Valance Front, Valance Rear, Valve Cover, Vapor Canister, Voltage Regulator, Washer Nozzle, Water Pump, Water Separator, Weather Stripping, Wheel (w image), Wheel (w/o image), Wheel Bearing, Wheel Cover/Hubcap (w image), Wheel Cover/Hubcap (w/o image), Wheel Lug Nut, Wheel Opening Moulding, Wheelchair Lift, Wheelchair Ramp, Wheelhouse Rear, Winch, Window Motor, Window Regulator Front, Window Regulator Rear, Window Shade, Window Switch Front Door, Window Switch Rear Door, Window Washer Motor Rear, Windshield, Windshield Frame, Windshield Hinge, Windshield Washer Motor Front, Windshield Washer Reservoir, Wiper Arm, Wiper Linkage, Wiper Motor Front, Wiper Motor Rear, Wiring Harness Air Conditioning, Wiring Harness Body, Wiring Harness Dash, Wiring Harness Engine, Wiring Harness Lamp, Wiring Harness Misc, Wiring Harness Transmission, Yoke/U-Joint`;

/** Highest-demand exterior parts -- populate the Quick Pick grid, same role the old 8-item flag list played. */
const QUICK_PICK_NAMES = new Set([
  'Bumper Cover Front',
  'Bumper Cover Rear',
  'Fender',
  'Hood',
  'Front Door',
  'Rear Door',
  'Headlight Assembly',
  'Tail Light',
  'Mirror Door',
  'Grille',
  'Quarter Panel',
  'Windshield',
  'Wheel (w image)',
  'Alternator',
  'Starter',
  'Radiator',
]);

/** Category keyword rules, checked in order -- first match wins, so more specific rules go first. */
const CATEGORY_RULES: Array<{ category: string; pattern: RegExp }> = [
  {
    category: 'Lighting',
    pattern: /light|lamp|headlight|taillight|marker|turn signal/i,
  },
  {
    category: 'Glass',
    pattern: /glass|windshield|window(?!\s*(motor|switch|regulator))/i,
  },
  { category: 'Wheels & Tires', pattern: /wheel|tire|hub cap|hubcap|lug/i },
  { category: 'Brakes', pattern: /brake|caliper|rotor|drum/i },
  {
    category: 'Suspension & Steering',
    pattern:
      /suspension|steering|strut|shock|spring|control arm|sway|stabilizer|knuckle|spindle|tie rod|idler arm|pitman|torsion|radius arm|track\/watts/i,
  },
  {
    category: 'Cooling',
    pattern:
      /radiator|cooling fan|coolant|thermostat|fan blade|fan clutch|water pump|intercooler/i,
  },
  { category: 'HVAC', pattern: /a\/c |air cond|heater|blower|hvac|vent/i },
  {
    category: 'Exhaust',
    pattern: /exhaust|muffler|resonator|catalytic|diesel particulate/i,
  },
  {
    category: 'Fuel System',
    pattern: /fuel|gas cap|gas tank|gas pedal|carburetor/i,
  },
  {
    category: 'Transmission & Drivetrain',
    pattern:
      /transmission|transfer case|differential|axle|drive shaft|driveshaft|clutch|flywheel|flex plate|torque convert|overdrive|transaxle|ring and pinion|yoke|u-joint|4wd|4x4/i,
  },
  {
    category: 'Engine',
    pattern:
      /engine|camshaft|crankshaft|piston|cylinder|carburetor|throttle|intake manifold|timing|harmonic balancer|oil pan|oil pump|oil filter|oil cooler|egr|turbo|supercharger|distributor|ignition|ignitor|spark plug|belt tensioner|push rod|connecting rod|short block/i,
  },
  {
    category: 'Electrical',
    pattern:
      /wiring|harness|fuse|relay|sensor|computer|module|battery|alternator|generator|starter|voltage regulator|clockspring|switch|solenoid/i,
  },
  {
    category: 'Audio & Electronics',
    pattern:
      /radio|speaker|amplifier|antenna|cd player|gps|navigation|tv screen|satellite|camera|info screen|heads up display|night vision/i,
  },
  { category: 'Safety', pattern: /air bag|airbag|seat belt/i },
  {
    category: 'Body',
    pattern:
      /bumper|fender|door|hood|trunk|deck lid|hatch|liftgate|tailgate|quarter panel|panel|pillar|grille|moulding|rocker|cowl|valance|nose|clip|uniside|frame|chassis|rear clip|emblem|running board|roll bar|bed |pickup|cab |header panel|core support|crossmember|sub frame|skid plate|brush guard|tow hook|winch|spoiler|roof|luggage rack|mud flap|weather stripping|body panel/i,
  },
  {
    category: 'Interior',
    pattern:
      /seat|dash|console|carpet|headliner|armrest|visor|glove box|kick panel|floor mat|floor pan|parcel shelf|ash tray|owners manual|shifter|interior/i,
  },
];

function detectCategory(name: string): string {
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(name)) return rule.category;
  }
  return 'Misc';
}

/**
 * isExteriorVisual really means "identifiable from a plain walkaround
 * photo of the vehicle" -- the name is historical (it started exterior-
 * only) but now also covers interior parts a worker's photo would plainly
 * show: seats, dash, console, steering wheel, headliner, interior door
 * trim, instrument cluster. Renaming the column/flag would mean a
 * disruptive migration for a name-only change, so the doc comment carries
 * the real scope instead. Still excludes anything a walkaround photo
 * *wouldn't* realistically catch even if photographed in principle --
 * engine internals, wiring, sensors, drivetrain, brakes, suspension, HVAC
 * internals, fuel system, exhaust -- those stay manual-only, per the
 * user's own example: "the alternator will not be in the images... inside
 * the engine."
 */
const PHOTO_IDENTIFIABLE_PATTERN =
  /bumper|fender|headlight|tail ?light|marker\/(fog|side)|turn signal|fog lamp|park\/fog|back-?up light|license lamp|door(?!\s*(handle|lock|switch|window motor|regulator|hinge|latch|striker|crank))|hood|trunk lid|deck lid|hatch|liftgate|tailgate|quarter panel|grille|moulding|rocker panel|pillar|windshield|back glass|glass (front|rear|quarter|special)|mirror (door|rear view)|spoiler|^roof$|roof panel|roof rack|wheel \(|wheel cover|hub cap|hubcap|running boards?|luggage rack|mud flap|cowl|valance|nose \(front|rear clip|brush guard|antenna|emblem|weather stripping|convertible top|sun roof|t-top|charging port door|seat (front|rear|back)|dash (pad|panel|bezel)|console (front|rear|lid)|steering wheel|headliner|interior trim panel door|instrument cluster|armrest|sun ?visor/i;

function isExteriorVisual(name: string): boolean {
  return PHOTO_IDENTIFIABLE_PATTERN.test(name);
}

/**
 * True cosmetic sheet-metal/body panels -- the set ARA-style damage-unit
 * grading (see backend/src/ai/grading.service.ts) actually applies to.
 * Deliberately narrower than `category === 'Body'` (`CATEGORY_RULES`
 * above): that category also matches mouldings, grilles, emblems, and
 * weather stripping, none of which get damage-unit-graded the way an
 * actual fender/door/hood/quarter panel does. Built the same way as
 * `PHOTO_IDENTIFIABLE_PATTERN` above (an include pattern plus an explicit
 * exclude pattern for hardware/trim/glass words that would otherwise
 * false-positive on a bare substring match like "door" or "panel") --
 * verified against the real ~700-name list during development: 53 clean
 * matches, no hinges/latches/locks/handles/glass/regulators/mouldings
 * slipped in. Deliberately excludes frame/subframe/core-support/crossmember
 * (structural, not cosmetic sheet metal -- a different kind of inspection)
 * and ambiguous composite assemblies like "Nose (Front End Assembly)".
 */
const SHEET_METAL_INCLUDE_PATTERN =
  /^fender$|^fender extension$|^fender skirt$|^back door$|door (front|back|shell)|^front door$|^rear door$|door outer repair panel|^hood$|deck lid assembly|deck lid\/trunk lid shell|hatch\/trunk lid|trunk lid\/hatch|liftgate (shell|assembly)|tailgate shell|tailgate\/trunk lid|quarter panel|quarter repair panel|rear body panel|^rear clip$|rear finish panel|bumper (cover|assembly|face bar)|^roof$|^roof panel$|rocker panel|^cab$|cab corner|cab back panel|^bed side$|^bed front panel$|^bed floor$|pickup bed (side|front panel|floor)/i;
const SHEET_METAL_EXCLUDE_PATTERN =
  /interior trim|^moulding|hinge|shock$|lock|latch|handle|regulator|motor|switch|glass|window|cable|ornament|insulation|prop$|scoop$|deflector/i;

function isSheetMetal(name: string): boolean {
  return (
    SHEET_METAL_INCLUDE_PATTERN.test(name) &&
    !SHEET_METAL_EXCLUDE_PATTERN.test(name)
  );
}

function parseNames(raw: string): string[] {
  const names = raw
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  return [...new Set(names)];
}

export const TAXONOMY: Array<{
  name: string;
  category: string;
  isQuickPick: boolean;
  isExteriorVisual: boolean;
  isSheetMetal: boolean;
}> = parseNames(RAW_NAMES).map((name) => ({
  name,
  category: detectCategory(name),
  isQuickPick: QUICK_PICK_NAMES.has(name),
  isExteriorVisual: isExteriorVisual(name),
  isSheetMetal: isSheetMetal(name),
}));

/**
 * Removes taxonomy rows from the old 22-item placeholder list (different
 * naming convention from the real list above, e.g. "Bumper (Front)" vs.
 * "Bumper Assy Front" -- never matched by name, so the normal upsert loop
 * would just leave them sitting alongside the real list as confusing
 * duplicates), plus any exact-name duplicates found sitting in the table
 * already (confirmed live: e2e tests share this same dev Postgres and
 * don't all dedupe their own taxonomy fixtures on every run -- one found
 * "Fender" inserted 27 times). `parts` has RLS and this connects as the
 * non-superuser app role without any tenant context set, so a plain SELECT
 * can't see across tenants to check real usage -- instead this just
 * attempts each delete and relies on the real FK constraint: any row a
 * Part still actually references fails with a foreign-key-violation and is
 * safely skipped rather than pre-guessed at.
 */
async function pruneSupersededTaxonomy(dataSource: DataSource): Promise<void> {
  const currentNames = new Set(TAXONOMY.map((t) => t.name));
  const repo = dataSource.getRepository(PartTaxonomy);
  const candidates = await repo.find();

  const byName = new Map<string, PartTaxonomy[]>();
  for (const row of candidates) {
    const group = byName.get(row.name);
    if (group) group.push(row);
    else byName.set(row.name, [row]);
  }

  for (const [name, rows] of byName) {
    const toDelete = currentNames.has(name)
      ? rows.slice(1) // keep exactly one, drop any exact-name duplicates
      : rows; // whole name is superseded -- try to drop all of them
    for (const row of toDelete) {
      try {
        await repo.delete({ id: row.id });
      } catch {
        // Still referenced by a real Part somewhere -- leave it alone
        // rather than risk an FK error aborting the whole seed run.
      }
    }
  }
}

export async function seedTaxonomy(): Promise<void> {
  const dataSource = AppDataSource.isInitialized
    ? AppDataSource
    : await AppDataSource.initialize();
  const repo = dataSource.getRepository(PartTaxonomy);

  await pruneSupersededTaxonomy(dataSource);

  for (const item of TAXONOMY) {
    const existing = await repo.findOne({ where: { name: item.name } });
    if (existing) {
      // Re-running the seed (e.g. after adjusting a classification rule)
      // updates category/flags on an existing row instead of skipping it --
      // only a brand-new name needs a fresh insert.
      await repo.update(existing.id, {
        category: item.category,
        isQuickPick: item.isQuickPick,
        isExteriorVisual: item.isExteriorVisual,
        isSheetMetal: item.isSheetMetal,
      });
    } else {
      await repo.save(repo.create(item));
    }
  }
}

if (require.main === module) {
  seedTaxonomy()
    .then(() => {
      console.log(`Seeded ${TAXONOMY.length} part taxonomy entries.`);
      return AppDataSource.destroy();
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
