import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowRightIcon, XIcon } from "lucide-react";

import { buildVersionedUrl, getBackendVersionFromResponse, readJsonResponse } from "@/app/app-utils";
import { getSearchCardMetricDefinitions, isValidSearchCardMetricNumber } from "@/app/searchCardMetricDisplay";
import { getDramaMetricsGridColumns } from "@/app/dramaMetricsLayout";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

function useDesktopPreview() {
  const [desktop, setDesktop] = useState(() => !window.matchMedia || window.matchMedia("(min-width: 640px)").matches);
  useEffect(() => {
    const query = window.matchMedia?.("(min-width: 640px)");
    if (!query) return undefined;
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return desktop;
}

function PreviewContent({
  platform, id, name, item = {}, paymentLabel, contentTypeLabel, source,
  frontendVersion, handleVersionResponse, onEnterStatistics, onClose, titleId, desktop,
}) {
  const [snapshot, setSnapshot] = useState({ metrics: null, cardPatch: {}, updatedAt: null, loading: true, error: "" });
  const [entering, setEntering] = useState(false);
  const [columnWidths, setColumnWidths] = useState([0]);
  const gridRef = useRef(null);
  const requestRef = useRef(null);
  const enterLockRef = useRef(false);
  const mountedRef = useRef(false);
  const openLoggedRef = useRef(false);
  const optionsRef = useRef(null);
  optionsRef.current = { handleVersionResponse, name, source };
  const soundId = platform === "missevan" ? item.sound_id : undefined;

  const logAction = useCallback((action) => {
    const options = optionsRef.current;
    fetch(buildVersionedUrl("/usage-log", frontendVersion), {
      method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
      body: JSON.stringify({ action, platform, dramaId: String(id), dramaName: options.name, source: options.source, success: true }),
    }).catch((error) => console.error("Failed to log drama preview action", error));
  }, [frontendVersion, id, platform]);

  const loadMetrics = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setSnapshot((current) => ({ ...current, loading: true, error: "" }));
    try {
      const response = await fetch(buildVersionedUrl("/search-card-metrics", frontendVersion), {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ platform, id, ...(soundId ? { soundId } : {}) }), signal: controller.signal,
      });
      const data = await readJsonResponse(response);
      if (controller.signal.aborted) return;
      optionsRef.current.handleVersionResponse?.({ ...data, frontendVersion, backendVersion: getBackendVersionFromResponse(response, data) });
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || "指标获取失败，请稍后重新打开。");
      }
      setSnapshot({ metrics: data.metrics || {}, cardPatch: data.card_patch || {}, updatedAt: new Date(), loading: false, error: "" });
    } catch (error) {
      if (controller.signal.aborted) return;
      setSnapshot((current) => ({ ...current, loading: false, error: error.message || "指标获取失败，请稍后重新打开。" }));
    }
  }, [frontendVersion, id, platform, soundId]);

  useEffect(() => {
    mountedRef.current = true;
    if (!openLoggedRef.current) {
      openLoggedRef.current = true;
      logAction("drama_preview_open");
    }
    void loadMetrics();
    return () => {
      mountedRef.current = false;
      requestRef.current?.abort();
    };
  }, [loadMetrics, logAction]);

  const definitions = getSearchCardMetricDefinitions(platform, { ...item, ...snapshot.cardPatch });
  const isAudienceMetric = (field) => field === "pay_count" || field === "member_listen_count";
  const orderedDefinitions = [...definitions.filter(({ field }) => !isAudienceMetric(field)), ...definitions.filter(({ field }) => isAudienceMetric(field))];
  const metrics = orderedDefinitions.flatMap(({ field, label }) => {
    const value = snapshot.metrics?.[field];
    if (platform === "manbo" && isAudienceMetric(field) && isValidSearchCardMetricNumber(value) && Number(value) === 0) return [];
    return [{
      field, label,
      value: snapshot.metrics === null
        ? snapshot.loading ? "正在获取" : "获取失败"
        : isValidSearchCardMetricNumber(value)
          ? Math.trunc(Number(value)).toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 0 })
          : "获取失败",
    }];
  });
  const metricText = metrics.map((metric) => `${metric.label}:${metric.value}`).join("|");

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return undefined;
    const measure = () => {
      if (!grid.clientWidth) return;
      const scale = grid.getBoundingClientRect().width / grid.clientWidth || 1;
      const widths = Array.from(grid.querySelectorAll("[data-preview-cell]")).map((cell) => Math.max(
        ...["[data-preview-label]", "[data-preview-number]"].map((selector) => {
          const node = cell.querySelector(selector);
          return Math.ceil(Math.max(node.scrollWidth, node.getBoundingClientRect().width / scale));
        })
      ));
      // Portaled content may not have measurable text until the next frame.
      if (widths.some((width) => width === 0)) return;
      const nextColumns = getDramaMetricsGridColumns(widths, grid.clientWidth);
      setColumnWidths((current) => current.length === nextColumns.length && current.every((width, index) => width === nextColumns[index]) ? current : nextColumns);
    };
    measure();
    const frame = window.requestAnimationFrame(measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(grid);
    let cancelled = false;
    document.fonts?.ready.then(() => { if (!cancelled) measure(); });
    return () => { cancelled = true; window.cancelAnimationFrame(frame); observer?.disconnect(); };
  }, [metricText]);

  async function enterStatistics() {
    if (enterLockRef.current) return;
    enterLockRef.current = true;
    setEntering(true);
    logAction("drama_preview_enter_statistics");
    try {
      const opened = await onEnterStatistics();
      if (mountedRef.current && opened === true) onClose();
    } catch (error) {
      if (mountedRef.current) setSnapshot((current) => ({ ...current, error: "打开搜索结果失败，请稍后重试。" }));
      console.error("Failed to enter statistics from preview", error);
    } finally {
      enterLockRef.current = false;
      if (mountedRef.current) setEntering(false);
    }
  }

  const Title = desktop ? "h2" : SheetTitle;
  const updatedText = snapshot.updatedAt
    ? `数据获取于：${snapshot.updatedAt.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
    : snapshot.loading ? "正在获取数据" : "数据获取失败";
  const resolvedPayment = snapshot.cardPatch.payment_label || paymentLabel;
  const resolvedContentType = snapshot.cardPatch.content_type_label || contentTypeLabel;

  return (
    <div className="drama-metrics-preview flex min-w-0 flex-col gap-5">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <Title id={titleId} className="break-words text-base font-semibold leading-6">{name}</Title>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {[platform === "manbo" ? "漫播" : "猫耳", resolvedPayment, resolvedContentType].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭数据速览" onClick={onClose}><XIcon /></Button>
      </div>
      <dl ref={gridRef} data-preview-metrics data-columns={columnWidths.length} className="grid min-w-0 gap-4 overflow-x-auto" style={{ gridTemplateColumns: columnWidths.map((width) => `minmax(${width}px, 1fr)`).join(" ") }} aria-busy={snapshot.loading}>
        {metrics.map((metric) => (
          <div key={metric.field} data-preview-cell className="min-w-0">
            <dt className="text-xs leading-5 text-muted-foreground"><span data-preview-label className="inline-block whitespace-nowrap">{metric.label}</span></dt>
            <dd className="mt-1 text-base font-medium leading-6 tabular-nums"><span data-preview-number className="inline-block whitespace-nowrap">{metric.value}</span></dd>
          </div>
        ))}
      </dl>
      {snapshot.error ? <p role="status" className="text-xs leading-5 text-destructive">{snapshot.error}</p> : null}
      <div data-preview-footer className="flex min-w-0 items-center justify-between gap-2 border-t border-border pt-3">
        <span aria-live="polite" className="shrink-0 whitespace-nowrap text-[0.6875rem] tabular-nums text-muted-foreground">{updatedText}</span>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <Button type="button" size="sm" data-touch="compact" className="relative w-fit text-xs after:absolute after:inset-x-0 after:-inset-y-1.5" disabled={entering} onClick={enterStatistics}>
            <ArrowRightIcon data-icon="inline-start" />{entering ? "正在进入" : "进入统计"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function DramaMetricsPreview({ children, ...props }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const desktop = useDesktopPreview();
  const titleId = useId();
  function restoreTitleFocus(event) {
    event.preventDefault();
    // A newly opened dialog owns focus when switching directly between previews.
    if (document.activeElement?.closest('[role="dialog"][data-state="open"]')) return;
    triggerRef.current?.focus({ preventScroll: true });
  }
  const content = open ? <PreviewContent key={`${props.platform}:${props.id}`} {...props} desktop={desktop} titleId={titleId} onClose={() => setOpen(false)} /> : null;
  if (desktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger ref={triggerRef} asChild>{children}</PopoverTrigger>
        <PopoverContent data-drama-preview align="start" side="bottom" sideOffset={8} collisionPadding={12} aria-labelledby={titleId} onCloseAutoFocus={restoreTitleFocus} className="w-[380px] max-w-[calc(100vw-1.5rem)] bg-card p-4 text-card-foreground shadow-[var(--shadow-panel)] motion-reduce:animate-none">
          {content}
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger ref={triggerRef} asChild>{children}</SheetTrigger>
      <SheetContent side="bottom" data-drama-preview showCloseButton={false} aria-labelledby={titleId} onCloseAutoFocus={restoreTitleFocus} className="max-h-[80dvh] rounded-t-xl bg-card p-4 text-card-foreground pb-[max(1rem,env(safe-area-inset-bottom))] motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:slide-in-from-bottom-4 motion-reduce:animate-none">
        <SheetDescription className="sr-only">查看作品最新指标，可进入统计。</SheetDescription>
        {content}
      </SheetContent>
    </Sheet>
  );
}
