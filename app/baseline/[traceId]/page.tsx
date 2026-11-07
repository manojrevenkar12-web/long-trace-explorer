import { FullTrace } from "@/src/features/baseline/FullTrace";

export default function Page({ params }: { params: { traceId: string } }) {
  return <FullTrace traceId={params.traceId} />;
}
