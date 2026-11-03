import { useEffect, useState } from "react";
import { LightbulbIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SiteNoticesFeed } from "@/app/SiteNoticesFeed";
import { requestNotices } from "@/app/siteNoticesClient";

export function SiteNoticesBoard() {
  const [snapshot, setSnapshot] = useState(null);
  const [readError, setReadError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let controller;
    let timeout;
    async function refresh() {
      if (disposed || inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const value = await requestNotices("/feedback/notices", { signal: controller.signal });
        if (!disposed) { setSnapshot(value); setReadError(""); }
      } catch (_) {
        if (!disposed) setReadError("管理员日志暂时无法读取，已有内容将保留。");
      } finally { clearTimeout(timeout); inFlight = false; }
    }
    void refresh();
    const timer = setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      controller?.abort();
      clearTimeout(timeout);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refreshKey]);
  return (
    <Card className="min-w-0 border-border/70 bg-card/92">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><LightbulbIcon aria-hidden="true" className="size-5" /></div>
          <div className="min-w-0"><CardTitle>管理员日志</CardTitle><CardDescription className="mt-1">一些数据库的更新和已发现待解决的问题</CardDescription></div>
        </div>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-4">
        {readError ? <Alert role="status"><AlertDescription>{readError}<Button type="button" variant="link" size="sm" onClick={() => setRefreshKey((value) => value + 1)}>重试</Button></AlertDescription></Alert> : null}
        {!snapshot && !readError ? <p role="status" className="text-sm text-muted-foreground">正在加载管理员日志…</p> : null}
        {snapshot ? <SiteNoticesFeed entries={snapshot.entries} /> : null}
      </CardContent>
    </Card>
  );
}
