import PartCameraPageClient from "./part-camera-page-client";

export default async function PartCameraPage({
  params,
}: {
  params: Promise<{ draftId: string; partId: string }>;
}) {
  const { draftId, partId } = await params;
  return <PartCameraPageClient draftId={draftId} partId={partId} />;
}
