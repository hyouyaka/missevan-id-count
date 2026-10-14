import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDownIcon, ImageIcon, MicIcon, PlayCircleIcon } from "lucide-react";
import { formatCompactMetricValue } from "@/app/app-utils";
import { PlatformGlyph } from "@/app/platformTabLabel";
import { LazyImage } from "@/components/ui/lazy-image";

function subscribeColumns(callback) {
  const queries = [768, 1280].map((width) => window.matchMedia?.(`(min-width: ${width}px)`));
  queries.forEach((query) => query?.addEventListener("change", callback));
  return () => queries.forEach((query) => query?.removeEventListener("change", callback));
}

function getColumnsSnapshot() {
  if (window.matchMedia?.("(min-width: 1280px)").matches) return 3;
  return window.matchMedia?.("(min-width: 768px)").matches ? 2 : 1;
}

export function useCvSeriesColumns() {
  return useSyncExternalStore(subscribeColumns, getColumnsSnapshot, () => 1);
}

function SeriesCover({ work, title, compact }) {
  const src = String(work?.cover ?? "").trim();
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  return (
    <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/75 bg-muted/55 ${compact ? "size-16 sm:size-[4.5rem]" : "size-20 sm:size-24"}`}>
      {src && !failed ? (
        <LazyImage alt={`${title}系列封面`} className="size-full object-cover" src={`/image-proxy?url=${encodeURIComponent(src)}`} onError={() => setFailed(true)} />
      ) : <ImageIcon aria-hidden="true" className="size-6 text-muted-foreground" />}
    </div>
  );
}

export function CvSeriesGroup({ series, open = false, onOpenChange, cvName = "", compact = false, externalDetails = false, panelId, children }) {
  const generatedId = useId();
  const regionId = panelId || generatedId;
  const cardRef = useRef(null);
  const multiple = series.works.length > 1;
  const cvs = [...new Set(series.works.flatMap((work) => Array.isArray(work.mainCvs)
    ? work.mainCvs
    : [cvName, ...(work.partners || [])]).map((name) => String(name).trim()).filter(Boolean))];
  const cvText = cvs.join("、") || "暂无";
  const playbackText = Number.isFinite(series.playCount) ? formatCompactMetricValue(series.playCount) : "暂无数据";

  useEffect(() => {
    if (!open || !multiple) return undefined;
    function dismiss(event) {
      if (externalDetails || cardRef.current?.contains(event.target)) return;
      // Keep nested work menus and trend dialogs usable while the series is open.
      if (event.target.closest?.('[data-slot="popover-content"], [role="menu"], [role="dialog"]')) return;
      onOpenChange?.(false);
    }
    function escape(event) {
      if (event.key === "Escape" && !event.defaultPrevented) {
        onOpenChange?.(false);
        cardRef.current?.querySelector("button[aria-expanded]")?.focus();
      }
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open, externalDetails, multiple, onOpenChange]);

  const toggle = (
    <button
      type="button"
      className="ml-auto flex min-h-9 shrink-0 items-center gap-1 rounded-md px-2 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-expanded={open}
      aria-controls={open ? regionId : undefined}
      aria-label={`${open ? "收起" : "展开"}系列${series.title}`}
      onClick={() => onOpenChange?.(!open)}
    >
      {open ? "收起" : "展开"}
      <ChevronDownIcon aria-hidden="true" className={`size-4 shrink-0 ${open ? "rotate-180" : ""}`} />
    </button>
  );
  const card = (
    <section ref={cardRef} data-cv-series={series.id} className={`cv-series-card min-w-0 rounded-lg border bg-background ${open && externalDetails ? "border-primary ring-1 ring-primary/25" : "border-border/80"}`}>
      {multiple ? (
        <div className={`relative isolate grid min-w-0 items-center gap-3 p-3 sm:p-4 ${compact ? "grid-cols-[4rem_minmax(0,1fr)] sm:grid-cols-[4.5rem_minmax(0,1fr)]" : "grid-cols-[5rem_minmax(0,1fr)] sm:grid-cols-[6rem_minmax(0,1fr)]"}`}>
          <div className="relative z-10">
            <SeriesCover work={series.works[0]} title={series.title} compact={compact} />
          </div>
          <div className="relative z-10 min-w-0">
            <h4 className="break-words text-sm font-semibold leading-5 sm:text-base">{series.title}</h4>
            <div className={`mt-2 flex min-w-0 items-start gap-1.5 text-xs text-muted-foreground ${compact ? "sm:text-sm" : ""}`} title={`主役CV：${cvText}`}>
              <MicIcon aria-label="主役CV" className="mt-0.5 size-3.5 shrink-0" />
              <span className={`min-w-0 break-words ${compact ? "text-foreground" : ""}`}>{cvText}</span>
            </div>
            <div className={`mt-2 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs ${compact ? "sm:text-sm" : ""}`} aria-label={`系列总播放量：${playbackText}`}>
              <PlayCircleIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              <span className={`tabular-nums ${compact ? "font-medium text-foreground" : "shrink-0 whitespace-nowrap text-base font-semibold text-foreground"}`}>{playbackText}</span>
              {toggle}
            </div>
          </div>
          {!compact ? (
            <span aria-hidden="true" data-cv-series-watermark="true" className="cv-profile-platform-watermark pointer-events-none absolute right-3 top-3 z-0 inline-flex select-none">
              <PlatformGlyph platform={series.platform} tone="inherit" className="size-[4.75rem] sm:size-[5.5rem]" />
            </span>
          ) : null}
        </div>
      ) : children}
      {multiple && !externalDetails && open ? (
        <div id={regionId} data-cv-series-panel="inline" className="border-t border-border/70">{children}</div>
      ) : null}
    </section>
  );

  return card;
}
