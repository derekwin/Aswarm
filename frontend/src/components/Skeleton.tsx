export default function Skeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div className="flex-1 flex flex-col gap-4 p-6 max-w-[820px] mx-auto w-full">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="flex gap-3" style={{ animationDelay: `${i * 0.1}s` }}>
          <div className="w-7 h-7 rounded-md bg-bg-surface animate-shimmer shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="animate-shimmer h-4 rounded bg-bg-surface" style={{ width: `${45 + (i % 3) * 15}%`, animationDelay: `${i * 0.1}s` }} />
            {i === 0 && (
              <>
                <div className="animate-shimmer h-3 rounded bg-bg-surface" style={{ width: '75%', animationDelay: '0.15s' }} />
                <div className="animate-shimmer h-3 rounded bg-bg-surface" style={{ width: '60%', animationDelay: '0.25s' }} />
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
