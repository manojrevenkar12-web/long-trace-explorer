import { TraceExplorer } from "@/src/features/explorer/TraceExplorer";

export default function Page({ params }: { params: { traceId: string } }) {
  return <TraceExplorer traceId={params.traceId} />;
}
