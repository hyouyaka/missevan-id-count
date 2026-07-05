import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquarePlusIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function FeedbackView({ featureSuggestionUrl }) {
  const feedbackRef = useRef(null);
  const [loadError, setLoadError] = useState("");
  const normalizedEnvId = useMemo(
    () => String(featureSuggestionUrl || "").trim().replace(/\/+$/, ""),
    [featureSuggestionUrl]
  );

  useEffect(() => {
    const feedbackElement = feedbackRef.current;
    if (!normalizedEnvId || !feedbackElement) {
      return undefined;
    }

    let cancelled = false;
    setLoadError("");
    feedbackElement.replaceChildren();

    async function initializeFeedback() {
      try {
        const twikooModule = await import("twikoo");
        if (cancelled) {
          return;
        }
        const twikoo =
          typeof twikooModule.init === "function"
            ? twikooModule
            : twikooModule.default;
        await twikoo.init({
          envId: normalizedEnvId,
          el: feedbackElement,
          path: "/feedback",
          lang: "zh-CN",
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.error("Failed to initialize feedback", error);
        feedbackElement.replaceChildren();
        setLoadError("反馈区加载失败，请稍后刷新重试。");
      }
    }

    void initializeFeedback();

    return () => {
      cancelled = true;
      feedbackElement.replaceChildren();
    };
  }, [normalizedEnvId]);

  return (
    <div className="grid gap-4 sm:gap-5">
      <Card className="border-border/70 bg-card/92">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <MessageSquarePlusIcon aria-hidden="true" className="size-5" />
            </div>
            <div className="min-w-0">
              <CardTitle>建议反馈</CardTitle>
              <CardDescription className="mt-1">
                可以提交Bug、数据异常、新功能建议等，我的回复也会显示在这里。
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-border/70 bg-muted/35 p-4">
            <h2 className="text-sm font-semibold text-foreground">参考提交格式</h2>
            <ul className="mt-2 grid gap-1.5 text-sm leading-6 text-muted-foreground">
              <li>类型：Bug / 数据异常 / 新功能建议</li>
              <li>详细描述：说明现象、期望或建议内容</li>
              <li>昵称和联系方式（选填）：便于进一步确认</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {!normalizedEnvId ? (
        <Alert className="border-border/70 bg-card/92">
          <MessageSquarePlusIcon className="size-4" />
          <AlertTitle>建议反馈暂未启用</AlertTitle>
          <AlertDescription>当前站点尚未配置反馈服务。</AlertDescription>
        </Alert>
      ) : (
        <Card className="border-border/70 bg-card/92">
          <CardContent className="pt-6">
            {loadError ? (
              <Alert className="mb-4 border-destructive/30 bg-destructive/10">
                <AlertTitle>建议反馈暂不可用</AlertTitle>
                <AlertDescription>{loadError}</AlertDescription>
              </Alert>
            ) : null}
            <div id="twikoo-feedback" ref={feedbackRef} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
