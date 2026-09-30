import { useEffect, useId, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function ShareImagePreviewDialog({
  description = "预览生成的 PNG 图片，可保存到设备。",
  error,
  fileName,
  imageAlt,
  onOpenChange,
  onRetry,
  onSave,
  open,
  previewUrl,
  status,
  title,
  fallbackTitle = "分享图片",
}) {
  const [fitWidth, setFitWidth] = useState(true);
  const [naturalWidth, setNaturalWidth] = useState(0);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const descriptionId = useId();

  useEffect(() => {
    setFitWidth(true);
    setNaturalWidth(0);
    setImageLoadFailed(false);
  }, [open, previewUrl]);

  const imageAvailable = Boolean(previewUrl && !imageLoadFailed);
  const dialogStyle = naturalWidth > 0
    ? { width: `${naturalWidth + 68}px` }
    : undefined;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/35 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={descriptionId}
          className="fixed top-1/2 left-1/2 z-50 grid h-[min(92dvh,68rem)] w-[min(96vw,48rem)] min-w-0 max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_minmax(0,1fr)_auto] gap-3 rounded-xl border border-border bg-background p-3 text-foreground shadow-[var(--shadow-panel)] outline-none sm:gap-4 sm:p-5"
          style={dialogStyle}
        >
          <div className="flex min-w-0 items-start justify-between gap-3 pr-1">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="break-words pr-1 text-sm font-semibold leading-5 sm:text-base">
                {title || fallbackTitle}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description id={descriptionId} className="sr-only">
                {description}
              </DialogPrimitive.Description>
            </div>
            {imageAvailable ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-11 min-h-11 shrink-0 px-2.5 text-xs sm:hidden"
                aria-label={fitWidth ? "按原图尺寸查看" : "适应屏幕宽度"}
                onClick={() => setFitWidth((current) => !current)}
              >
                {fitWidth ? "原图尺寸" : "适应宽度"}
              </Button>
            ) : null}
            <DialogPrimitive.Close
              aria-label="关闭图片预览"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span aria-hidden="true" className="text-xl leading-none">×</span>
            </DialogPrimitive.Close>
          </div>

          <div className="min-h-0 min-w-0 overflow-auto overscroll-contain rounded-lg border border-border/80 bg-muted/30 p-2 [-webkit-overflow-scrolling:touch] sm:p-3">
            {imageAvailable ? (
              <img
                key={previewUrl}
                alt={imageAlt || title || "分享图片"}
                className={`mx-auto block h-auto ${fitWidth ? "w-full max-w-full" : "w-auto max-w-none"} sm:w-auto sm:max-w-full`}
                src={previewUrl}
                onLoad={(event) => setNaturalWidth(event.currentTarget.naturalWidth || 0)}
                onError={() => setImageLoadFailed(true)}
              />
            ) : status === "loading" ? (
              <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
                <RefreshCwIcon aria-hidden="true" className="size-4 animate-spin" />
                正在生成 PNG 图片…
              </div>
            ) : (
              <Alert className="border-destructive/30 bg-destructive/10">
                <AlertTitle>图片生成失败</AlertTitle>
                <AlertDescription>
                  {error || (imageLoadFailed ? "PNG 图片无法加载，请重试。" : "请重试生成分享图片。")}
                </AlertDescription>
              </Alert>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/80 pt-3">
            <span className="min-w-0 flex-1 break-all text-xs text-muted-foreground">{fileName}</span>
            <div className="flex shrink-0 items-center gap-2">
              {!imageAvailable ? (
                <Button type="button" variant="outline" size="sm" disabled={status === "loading"} onClick={onRetry}>
                  {status === "loading" ? "正在生成" : "重试"}
                </Button>
              ) : null}
              {imageAvailable ? (
                <Button type="button" size="sm" onClick={onSave}>
                  保存 PNG
                </Button>
              ) : null}
              <DialogPrimitive.Close asChild>
                <Button type="button" variant="outline" size="sm">关闭</Button>
              </DialogPrimitive.Close>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
