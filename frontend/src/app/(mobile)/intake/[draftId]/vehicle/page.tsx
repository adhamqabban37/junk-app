import VehiclePageClient from "./vehicle-page-client";

export default async function VehiclePage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;
  return <VehiclePageClient draftId={draftId} />;
}
