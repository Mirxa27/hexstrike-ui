interface SkeletonProps {
  className?: string
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded bg-[#1a1a2e]/40 ${className ?? ''}`}
    />
  )
}

export function ToolCallSkeleton() {
  return (
    <div className="mt-2 rounded border border-[#1a1a2e] bg-[#0a0a0f] p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Skeleton className="w-2 h-2 rounded-full" />
        <Skeleton className="w-24 h-3 rounded" />
        <Skeleton className="w-16 h-3 ml-auto rounded" />
      </div>
      <div className="space-y-1.5 pt-1">
        <Skeleton className="w-full h-3 rounded" />
        <Skeleton className="w-3/4 h-3 rounded" />
      </div>
    </div>
  )
}

export function MessageSkeleton() {
  return (
    <div className="flex mb-4">
      <div className="max-w-[85%] flex flex-col">
        <div className="rounded-lg px-4 py-3 space-y-2 bg-[#0f0f1a] border border-[#1a1a2e]">
          <Skeleton className="w-3/4 h-3" />
          <Skeleton className="w-1/2 h-3" />
        </div>
      </div>
    </div>
  )
}
