import { AiAnalysis } from "./entities/ai-analysis.entity";
import { Embedding } from "./entities/embedding.entity";
import { HumanCorrection } from "./entities/human-correction.entity";
import { Listing } from "./entities/listing.entity";
import { PartImage } from "./entities/part-image.entity";
import { PartTaxonomy } from "./entities/part-taxonomy.entity";
import { Part } from "./entities/part.entity";
import { PricingHistory } from "./entities/pricing-history.entity";
import { Tenant } from "./entities/tenant.entity";
import { User } from "./entities/user.entity";
import { VehicleImage } from "./entities/vehicle-image.entity";
import { Vehicle } from "./entities/vehicle.entity";

/** Entity classes only (the entities/index.ts barrel also re-exports enums, which TypeORM's `entities` array rejects). */
export const ENTITIES = [
  Tenant,
  User,
  Vehicle,
  VehicleImage,
  PartTaxonomy,
  Part,
  PartImage,
  AiAnalysis,
  HumanCorrection,
  Embedding,
  PricingHistory,
  Listing,
];
