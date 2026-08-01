import "reflect-metadata";
import { AppDataSource } from "../data-source";
import { PartTaxonomy } from "../entities";

/**
 * Common salvage part taxonomy, precached client-side for instant offline
 * search (DESIGN_SPEC.md §3.5). The 8 flagged `isQuickPick` populate the
 * Quick Pick grid on the Part Selection screen.
 */
const TAXONOMY: Array<{ name: string; category: string; isQuickPick?: boolean }> = [
  { name: "Alternator", category: "Engine", isQuickPick: true },
  { name: "Starter Motor", category: "Engine", isQuickPick: true },
  { name: "Engine (Complete)", category: "Engine" },
  { name: "Transmission", category: "Drivetrain" },
  { name: "Radiator", category: "Cooling", isQuickPick: true },
  { name: "Bumper (Front)", category: "Body", isQuickPick: true },
  { name: "Bumper (Rear)", category: "Body" },
  { name: "Door (Driver Front)", category: "Body", isQuickPick: true },
  { name: "Door (Passenger Front)", category: "Body" },
  { name: "Hood", category: "Body", isQuickPick: true },
  { name: "Trunk Lid", category: "Body" },
  { name: "Fender (Left)", category: "Body" },
  { name: "Fender (Right)", category: "Body" },
  { name: "Headlight (Left)", category: "Lighting", isQuickPick: true },
  { name: "Headlight (Right)", category: "Lighting", isQuickPick: true },
  { name: "Taillight (Left)", category: "Lighting" },
  { name: "Taillight (Right)", category: "Lighting" },
  { name: "Mirror (Left)", category: "Body" },
  { name: "Mirror (Right)", category: "Body" },
  { name: "Wheel/Rim", category: "Wheels & Tires" },
  { name: "Seat (Driver)", category: "Interior" },
  { name: "Seat (Passenger)", category: "Interior" },
];

export async function seedTaxonomy(): Promise<void> {
  const dataSource = AppDataSource.isInitialized
    ? AppDataSource
    : await AppDataSource.initialize();
  const repo = dataSource.getRepository(PartTaxonomy);

  for (const item of TAXONOMY) {
    const existing = await repo.findOne({ where: { name: item.name } });
    if (!existing) {
      await repo.save(repo.create({ ...item, isQuickPick: item.isQuickPick ?? false }));
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
