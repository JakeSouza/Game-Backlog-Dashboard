// Skeletons — shaped placeholders that match the real content's layout, so
// the page doesn't reflow when data lands.

export function SkeletonCard() {
  return (
    <div className="game-card rounded-lg overflow-hidden">
      <div className="skeleton" style={{ height: '9rem' }} />
      <div className="p-2 sm:p-3">
        <div className="skeleton skeleton-line" style={{ width: '80%', height: 14 }} />
        <div className="skeleton skeleton-line" style={{ width: '45%', height: 10, marginTop: 8 }} />
        <div className="flex gap-1 mt-2">
          <div className="skeleton skeleton-line" style={{ width: 44, height: 14, borderRadius: 999 }} />
          <div className="skeleton skeleton-line" style={{ width: 36, height: 14, borderRadius: 999 }} />
        </div>
      </div>
    </div>
  );
}

export function SkeletonGrid({ count = 10 }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
      {Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}

export function SkeletonHome() {
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="hud-card p-4">
            <div className="skeleton skeleton-line" style={{ width: '55%', height: 10 }} />
            <div className="skeleton skeleton-line" style={{ width: '40%', height: 26, marginTop: 10 }} />
          </div>
        ))}
      </div>
      <div className="skeleton skeleton-line mb-3" style={{ width: 140, height: 13 }} />
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 sm:gap-4 mb-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i}>
            <div className="skeleton" style={{ aspectRatio: '3/4', borderRadius: 'var(--radius-sm)' }} />
            <div className="skeleton skeleton-line" style={{ width: '85%', height: 12, marginTop: 8 }} />
            <div className="skeleton skeleton-line" style={{ width: '50%', height: 10, marginTop: 5 }} />
          </div>
        ))}
      </div>
    </>
  );
}
