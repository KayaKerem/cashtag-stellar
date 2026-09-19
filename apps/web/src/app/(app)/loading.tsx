import { Skeleton } from "@/components/common/EmptyState";

export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Yükleniyor">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-5 w-1/2" />
      <Skeleton className="h-48" />
      <Skeleton className="h-64" />
    </div>
  );
}
