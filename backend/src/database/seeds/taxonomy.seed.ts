import 'reflect-metadata';
import { AppDataSource } from '../data-source';
import { PartTaxonomy } from '../entities';

/**
 * Common salvage part taxonomy, precached client-side for instant offline
 * search (DESIGN_SPEC.md §3.5). The 8 flagged `isQuickPick` populate the
 * Quick Pick grid on the Part Selection screen.
 */
const TAXONOMY: Array<{
  name: string;
  category: string;
  isQuickPick?: boolean;
}> = [
  { name: 'Alternator', category: 'Engine', isQuickPick: true },
  { name: 'Starter Motor', category: 'Engine', isQuickPick: true },
  { name: 'Engine (Complete)', category: 'Engine' },
  { name: 'Transmission', category: 'Drivetrain' },
  { name: 'Radiator', category: 'Cooling', isQuickPick: true },
  { name: 'Bumper (Front)', category: 'Body', isQuickPick: true },
  { name: 'Bumper (Rear)', category: 'Body' },
  { name: 'Door (Driver Front)', category: 'Body', isQuickPick: true },
  { name: 'Door (Passenger Front)', category: 'Body' },
  { name: 'Hood', category: 'Body', isQuickPick: true },
  { name: 'Trunk Lid', category: 'Body' },
  { name: 'Fender (Left)', category: 'Body' },
  { name: 'Fender (Right)', category: 'Body' },
  { name: 'Headlight (Left)', category: 'Lighting', isQuickPick: true },
  { name: 'Headlight (Right)', category: 'Lighting', isQuickPick: true },
  { name: 'Taillight (Left)', category: 'Lighting' },
  { name: 'Taillight (Right)', category: 'Lighting' },
  { name: 'Mirror (Left)', category: 'Body' },
  { name: 'Mirror (Right)', category: 'Body' },
  { name: 'Wheel/Rim', category: 'Wheels & Tires' },
  { name: 'Seat (Driver)', category: 'Interior' },
  { name: 'Seat (Passenger)', category: 'Interior' },

  // Added 2026-08-08 for full exterior coverage, left and right. Every one
  // of these is a part the scene-detection prompt genuinely returns on real
  // walkaround photos and which previously had nowhere to go -- it came
  // back "unmapped" and could not be filed at all. Rear doors were the
  // worst of them: the taxonomy had front doors only, so every 4-door
  // vehicle had two doors that could not be recorded.
  //
  // Naming deliberately follows the existing split conventions rather than
  // unifying them: Driver/Passenger for doors, Left/Right for panels and
  // lighting. TaxonomyMatcher's SIDE_ALIASES already bridges the two.
  { name: 'Door (Driver Rear)', category: 'Body' },
  { name: 'Door (Passenger Rear)', category: 'Body' },
  { name: 'Quarter Panel (Left)', category: 'Body' },
  { name: 'Quarter Panel (Right)', category: 'Body' },
  { name: 'Rocker Panel (Left)', category: 'Body' },
  { name: 'Rocker Panel (Right)', category: 'Body' },
  { name: 'Grille', category: 'Body' },
  { name: 'Liftgate/Tailgate', category: 'Body' },
  { name: 'Windshield', category: 'Glass' },
  { name: 'Rear Window', category: 'Glass' },
  { name: 'Sunroof', category: 'Glass' },
];

export async function seedTaxonomy(): Promise<void> {
  const dataSource = AppDataSource.isInitialized
    ? AppDataSource
    : await AppDataSource.initialize();
  const repo = dataSource.getRepository(PartTaxonomy);

  for (const item of TAXONOMY) {
    const existing = await repo.findOne({ where: { name: item.name } });
    if (!existing) {
      await repo.save(
        repo.create({ ...item, isQuickPick: item.isQuickPick ?? false }),
      );
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
