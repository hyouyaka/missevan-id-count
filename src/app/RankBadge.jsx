import { CrownIcon } from "lucide-react";

const topRankBadgeClassNames = {
  1: "border-[rgba(245,158,11,0.36)] bg-[rgba(245,158,11,0.16)] text-[rgb(180,109,5)]",
  2: "border-[rgba(100,116,139,0.30)] bg-[rgba(100,116,139,0.13)] text-[rgb(71,85,105)]",
  3: "border-[rgba(180,83,9,0.32)] bg-[rgba(180,83,9,0.13)] text-[rgb(146,64,14)]",
};

const fallbackRankBadgeClassName = "border-border/80 bg-background text-foreground";

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
          <span className="pointer-events-none relative z-20 translate-y-[0.12rem] text-[0.7rem] font-black leading-none text-white/90 drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]">
            {rank}
          </span>
        </>
      ) : (
        rank
      )}
    </div>
  );
}
