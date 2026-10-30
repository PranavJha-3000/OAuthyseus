import type { Duration } from "@/lib/types";
import { formatDuration, routeScale, toHours } from "@/lib/duration";

// Longest route in the library (~16 weeks) anchors the scale so bars are comparable across guides.
const SCALE_MAX = routeScale(24 * 7 * 16);

/**
 * The route from "nothing" to "users can connect": your hands-on work (solid)
 * followed by time waiting on the provider (hatched). Log-scaled so minutes and weeks share a bar.
 */
export function RouteBar({
  active,
  wait,
  compact = false,
  label,
}: {
  active: Duration;
  wait: Duration | null;
  compact?: boolean;
  label?: string;
}) {
  const a = routeScale(toHours(active));
  const w = wait ? routeScale(toHours(wait)) : 0;
  const aPct = Math.max(3, (a / SCALE_MAX) * 100);
  const wPct = wait ? Math.max(4, (w / SCALE_MAX) * 100) : 0;
  const total = Math.min(100, aPct + wPct);
  const desc = `${label ? `${label}: ` : ""}${formatDuration(active)} of your work, ${wait ? `then ${formatDuration(wait)} waiting on the provider` : "no provider wait"}`;

  if (compact) {
    return (
      <div className="w-full" role="img" aria-label={desc}>
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-sunken">
          <div className="h-full bg-sea" style={{ width: `${(aPct / 100) * 100}%` }} />
          {wait && <div className="hatch-wait h-full" style={{ width: `${(wPct / 100) * 100}%` }} />}
        </div>
      </div>
    );
  }

  return (
    <div role="img" aria-label={desc}>
      <div className="relative flex h-9 w-full items-stretch">
        <div className="flex h-full overflow-hidden rounded-md" style={{ width: `${total}%` }}>
          <div className="flex h-full items-center bg-sea px-2 text-xs font-medium text-white" style={{ width: `${(aPct / total) * 100}%` }} />
          {wait && <div className="hatch-wait h-full" style={{ width: `${(wPct / total) * 100}%` }} />}
        </div>
        <div className="ml-1 flex items-center">
          <span className="h-3 w-3 rounded-full border-2 border-ink bg-surface" title="Users can connect" />
        </div>
        <div className="flex-1 border-t border-dashed border-line self-center" />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-4 rounded-sm bg-sea" aria-hidden />
          Your work: <strong className="font-semibold">{formatDuration(active)}</strong>
        </span>
        <span className="inline-flex items-center gap-2">
          <span className={`h-2.5 w-4 rounded-sm ${wait ? "hatch-wait" : "border border-line"}`} aria-hidden />
          Waiting on provider: <strong className="font-semibold">{wait ? formatDuration(wait) : "none"}</strong>
        </span>
        <span className="inline-flex items-center gap-2 text-muted">
          <span className="h-3 w-3 rounded-full border-2 border-ink" aria-hidden />
          Users can connect
        </span>
      </div>
    </div>
  );
}
