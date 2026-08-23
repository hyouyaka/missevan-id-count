import { CrownIcon } from "lucide-react";

const topRankBadgeClassNames = {
  1: "border-[color-mix(in_oklch,var(--rank-gold)_38%,transparent)] bg-[color-mix(in_oklch,var(--rank-gold)_16%,transparent)] text-[var(--rank-gold)]",
  2: "border-[color-mix(in_oklch,var(--rank-silver)_34%,transparent)] bg-[color-mix(in_oklch,var(--rank-silver)_14%,transparent)] text-[var(--rank-silver)]",
  3: "border-[color-mix(in_oklch,var(--rank-bronze)_36%,transparent)] bg-[color-mix(in_oklch,var(--rank-bronze)_14%,transparent)] text-[var(--rank-bronze)]",
};

const fallbackRankBadgeClassName = "border-border/80 bg-background text-foreground";

const rankWatermarkClassNames = {
  1: "text-[var(--rank-gold)] opacity-[0.14]",
  2: "text-[var(--rank-silver)] opacity-[0.14]",
  3: "text-[var(--rank-bronze)] opacity-[0.14]",
};

export function RankWatermark({ rank, placement = "card", className = "" }) {
  const colorClassName = rankWatermarkClassNames[Number(rank)] || "text-foreground opacity-[0.055]";
  const placementClassName = placement === "row"
    ? "right-1 top-1/2 -translate-y-1/2 text-[3.75rem] sm:text-[3.75rem]"
    : "right-3 top-2 text-[4.75rem] sm:text-[5.5rem]";
  return (
    <>
      <span className="sr-only">第{rank}名</span>
      <span
        aria-hidden="true"
        className={`rank-watermark pointer-events-none absolute z-0 select-none font-bold leading-none tabular-nums ${placementClassName} ${colorClassName} ${className}`.trim()}
      >
        {rank}
      </span>
    </>
  );
}

export function RankBadge({ rank, className = "" }) {
  const numericRank = Number(rank);
  const isTopRank = [1, 2, 3].includes(numericRank);
  const colorClassName = topRankBadgeClassNames[numericRank] || fallbackRankBadgeClassName;

  return (
    <div
      aria-label={`第${rank}名`}
      title={`第${rank}名`}
      className={`relative flex size-7 shrink-0 items-center justify-center rounded-md border text-xs font-semibold tabular-nums ${colorClassName} ${className}`.trim()}
    >
      {isTopRank ? (
        <>
          <CrownIcon aria-hidden="true" className="pointer-events-none absolute left-1/2 top-0.5 z-0 size-6 -translate-x-1/2 fill-current stroke-current opacity-90" />
          <span className="pointer-events-none relative z-20 translate-y-[0.12rem] text-[0.7rem] font-black leading-none text-primary-foreground drop-shadow-[0_1px_1px_oklch(0.1_0_0/0.35)]">
            {rank}
          </span>
        </>
      ) : (
        rank
      )}
    </div>
  );
}
