import PartsPageClient from "./parts-page-client";

export default async function PartsPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;
  return <PartsPageClient draftId={draftId} />;
}
