/** Route loading skeleton: shimmering header + card grid. Decorative only; announced as busy to assistive tech. */
export default function AppLoading() {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="space-y-6">
      <div className="space-y-2">
        <div className="shimmer h-7 w-56 rounded-md bg-ivory-200" />
        <div className="shimmer h-4 w-80 max-w-full rounded-md bg-ivory-200" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="shimmer h-28 rounded-lg border border-line bg-ivory-100" style={{ animationDelay: `${i * 120}ms` }} />
        ))}
      </div>
      <div className="shimmer h-64 rounded-lg border border-line bg-ivory-100" />
    </div>
  );
}
