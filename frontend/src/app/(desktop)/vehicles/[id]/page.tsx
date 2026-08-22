import VehicleDetailPageClient from "./vehicle-detail-page-client";

export default async function VehicleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <VehicleDetailPageClient vehicleId={id} />;
}
