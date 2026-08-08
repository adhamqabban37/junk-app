import ManagerVehicleDetailPageClient from "./vehicle-detail-page-client";

// Thin async Server Component wrapper -- see frontend AGENTS.md / the Phase 3
// note in docs/PROGRESS.md: calling use(params) directly inside a client page
// suspends forever under RTL in this workspace.
//
// Route note: this resolves to /vehicles/[vehicleId]. The worker's equivalent
// deliberately lives at /previous-vehicles/[vehicleId], not (mobile)/vehicles,
// because route groups do NOT namespace URLs -- two groups both claiming
// /vehicles fails the build. See CLAUDE.md; it has bitten this project twice.
export default async function ManagerVehicleDetailPage({
  params,
}: {
  params: Promise<{ vehicleId: string }>;
}) {
  const { vehicleId } = await params;
  return <ManagerVehicleDetailPageClient vehicleId={vehicleId} />;
}
