import MyVehicleDetailPageClient from "./my-vehicle-detail-page-client";

export default async function MyVehicleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MyVehicleDetailPageClient vehicleId={id} />;
}
