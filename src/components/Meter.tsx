export function Meter({ spent, cap, alertPercent }: { spent: number; cap: number; alertPercent: number }) {
  const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 100;
  const state = pct >= 100 ? "Drafting paused: cap reached" : pct >= alertPercent ? `Over ${alertPercent}%: watch spend` : "Within budget";
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-2xl font-bold">
          <span className="t2s-text">${spent.toFixed(2)}</span>
          <span className="text-base font-medium text-muted"> of ${cap.toFixed(0)} this month</span>
        </p>
        <p className={`text-sm font-medium ${pct >= alertPercent ? "text-danger" : "text-muted"}`}>{state}</p>
      </div>
      <div
        className="mt-3 h-3 w-full overflow-hidden rounded-full bg-warm"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-valuenow={Number(spent.toFixed(2))}
        aria-label="Monthly AI budget used"
      >
        <div className="t2s-gradient h-full rounded-full" style={{ width: `${Math.max(pct, 1.5)}%` }} />
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-muted">
        <span className="absolute -translate-x-1/2" style={{ left: `${alertPercent}%` }}>▲ {alertPercent}% alert</span>
      </div>
    </div>
  );
}
