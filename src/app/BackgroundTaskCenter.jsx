import { useEffect, useRef, useState } from "react";
import { RefreshCwIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export function BackgroundTaskCenter({ task, isDesktopApp, onOpenResults, onDismiss }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const wasRunningRef = useRef(false);

  useEffect(() => {
    if (task?.isRunning && !wasRunningRef.current) {
      setDesktopCollapsed(false);
    }
    if (!task?.isRunning && wasRunningRef.current) {
      setDesktopCollapsed(true);
      setMobileOpen(false);
    }
    wasRunningRef.current = Boolean(task?.isRunning);
  }, [task?.isRunning]);

  if (!task?.isRunning && !task?.highlighted) {
    return null;
  }

  const title = task.title || (task.type === "favorites_refresh" ? "收藏刷新" : "后台任务");
  const action = task.action || task.description || (task.isRunning ? "运行中" : "已完成");
  const progress = Number(task.progress ?? 0) || 0;
  const statusText = task.isRunning ? "进行中" : task.status === "failed" ? "失败" : task.status === "cancelled" ? "已取消" : "已完成";

  function handleDesktopDismiss() {
    if (task?.isRunning) {
      setDesktopCollapsed(true);
      return;
    }
    onDismiss?.();
  }

  function renderDetail({ allowRunningDismiss = false } = {}) {
    return (
      <div className="grid min-w-0 w-full gap-2">
        <div className="flex min-w-0 w-full items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground">{title}</div>
            <div className="whitespace-normal break-words text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{action}</div>
          </div>
          <Badge variant={task.isRunning ? "default" : "secondary"} className="shrink-0">{statusText}</Badge>
        </div>
        <Progress value={progress} className="h-2.5 min-w-0 max-w-full rounded-full bg-muted" indicatorClassName="bg-primary" />
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="tabular-nums">{progress}%</span>
          <div className="flex items-center gap-1.5">
            {task.resultTarget ? (
              <Button
                type="button"
                size="xs"
                variant="secondary"
                data-touch="compact"
                className="relative overflow-visible after:absolute after:inset-x-0 after:-inset-y-2 after:rounded-md after:content-['']"
                onClick={onOpenResults}
              >
                查看结果
              </Button>
            ) : null}
            {allowRunningDismiss || !task.isRunning ? (
              <Button type="button" size="xs" variant="ghost" onClick={allowRunningDismiss ? handleDesktopDismiss : onDismiss}>
                收起
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="pointer-events-none fixed inset-x-3 mobile-fixed-bottom z-40 hidden sm:block">
        {desktopCollapsed ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="展开后台任务中心"
            className={`pointer-events-auto mx-auto flex max-w-max items-center gap-2 rounded-full border-border/80 bg-surface-floating px-3 shadow-[var(--shadow-panel)] backdrop-blur-xl ${isDesktopApp ? "ring-1 ring-primary/16" : ""}`}
            onClick={() => setDesktopCollapsed(false)}
          >
            <RefreshCwIcon aria-hidden="true" className={task.isRunning ? "size-3.5 animate-spin" : "size-3.5"} />
            <span className="max-w-40 truncate text-xs font-medium">{title}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{progress}%</span>
            <Badge variant={task.isRunning ? "default" : "secondary"} className="shrink-0">{statusText}</Badge>
            <span className="text-xs text-primary">展开</span>
          </Button>
        ) : (
          <div className={`pointer-events-auto mx-auto max-w-xl rounded-lg border border-border/80 bg-surface-floating p-3 shadow-[var(--shadow-panel)] backdrop-blur-xl ${isDesktopApp ? "ring-1 ring-primary/16" : ""}`}>
            {renderDetail({ allowRunningDismiss: true })}
          </div>
        )}
      </div>
      <div className="mobile-background-task-center fixed mobile-fixed-bottom right-3 z-40 sm:hidden">
        <Button
          type="button"
          variant={task.isRunning ? "secondary" : "outline"}
          size="icon-lg"
          aria-expanded={mobileOpen}
          aria-label="后台任务中心"
          className="relative shadow-[var(--shadow-panel)]"
          onClick={() => setMobileOpen((current) => !current)}
        >
          <RefreshCwIcon aria-hidden="true" className={task.isRunning ? "size-4 animate-spin" : "size-4"} />
          <span className="absolute -right-1.5 -top-1 min-w-7 rounded-full bg-primary px-1.5 py-0.5 text-center text-[0.58rem] font-semibold leading-none text-primary-foreground tabular-nums">
            {`${progress}%`}
          </span>
        </Button>
        {mobileOpen ? (
          <div className="absolute bottom-12 right-0 box-border min-w-0 w-[min(21rem,calc(100vw-1.5rem))] overflow-hidden rounded-lg border border-border/80 bg-surface-floating p-3 shadow-[var(--shadow-panel)] backdrop-blur-xl">
            {renderDetail()}
          </div>
        ) : null}
      </div>
    </>
  );
}
