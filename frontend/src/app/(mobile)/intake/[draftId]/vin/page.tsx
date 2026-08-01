import VinPageClient from "./vin-page-client";

export default async function VinPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;
  return <VinPageClient draftId={draftId} />;
}
