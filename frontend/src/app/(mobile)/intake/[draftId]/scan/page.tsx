import ScanPageClient from "./scan-page-client";

export default async function ScanPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;
  return <ScanPageClient draftId={draftId} />;
}
