import VehicleDetailPageClient from "./vehicle-detail-page-client";

// Thin async Server Component wrapper -- see frontend AGENTS.md / the Phase 3
// note in docs/PROGRESS.md: calling use(params) directly inside a client page
// suspends forever under RTL in this workspace.
export default async function MobileVehicleDetailPage({
  params,
}: {
  params: Promise<{ vehicleId: string }>;
}) {
  const { vehicleId } = await params;
  return <VehicleDetailPageClient vehicleId={vehicleId} />;
}
