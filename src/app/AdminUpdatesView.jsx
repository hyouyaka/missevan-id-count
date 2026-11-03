import { useEffect, useState } from "react";
import { ArrowLeftIcon, LightbulbIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { SITE_NOTICE_LIMITS, normalizeSiteNoticeEntries } from "../../shared/siteNotices.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SiteNoticesFeed } from "@/app/SiteNoticesFeed";
import { requestNotices } from "@/app/siteNoticesClient";

export default function AdminUpdatesView() {
  const [snapshot, setSnapshot] = useState(null);
  const [token, setToken] = useState("");
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  useEffect(() => {
    const originalTitle = document.title;
    document.title = "管理员日志管理 · MMToolkit";
    return () => { document.title = originalTitle; };
  }, []);
  function acceptSnapshot(value) {
    setSnapshot(value);
    setDraft({ revision: value.revision, entries: value.entries.map((entry) => ({ ...entry })) });
    setError("");
  }
  async function load(reload = false) {
    if (busy || !token.trim()) return;
    setBusy(true);
    setError("");
    try {
      acceptSnapshot(await requestNotices(reload ? "/admin/site-notices/reload" : "/admin/site-notices", {
        method: reload ? "POST" : "GET", headers: { Authorization: `Bearer ${token.trim()}` },
      }));
    } catch (failure) { setError(failure.message || "读取已发布内容失败，请稍后重试。"); }
    finally { setBusy(false); }
  }
  function changeEntry(id, patch) {
    setDraft((current) => ({ ...current, entries: current.entries.map((entry) => entry.id === id ? { ...entry, ...patch } : entry) }));
  }
  function addEntry() {
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    setDraft((current) => ({ ...current, entries: [{ id: crypto.randomUUID(), date, title: "", body: "" }, ...current.entries] }));
  }
  async function publish(event) {
    event.preventDefault();
    if (busy) return;
    let entries;
    try { entries = normalizeSiteNoticeEntries(draft.entries); }
    catch (failure) { setError(failure.message); return; }
    setBusy(true);
    setError("");
    try {
      acceptSnapshot(await requestNotices("/admin/site-notices", {
        method: "PUT", headers: { Authorization: `Bearer ${token.trim()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ revision: draft.revision, entries }),
      }));
      toast.success("管理员日志已发布。");
    } catch (failure) { setError(failure.message || "发布失败，草稿已保留。"); }
    finally { setBusy(false); }
  }
  async function deletePublished() {
    if (busy || !pendingDelete || !snapshot) return;
    const id = pendingDelete.id;
    setBusy(true);
    setError("");
    try {
      // Delete from the published snapshot, never from the unsaved draft.
      const value = await requestNotices("/admin/site-notices", {
        method: "PUT", headers: { Authorization: `Bearer ${token.trim()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ revision: snapshot.revision, entries: snapshot.entries.filter((entry) => entry.id !== id) }),
      });
      setSnapshot(value);
      setDraft((current) => ({ ...current, revision: value.revision, entries: current.entries.filter((entry) => entry.id !== id) }));
      toast.success("日志已删除。");
    } catch (failure) { setError(failure.message || "删除失败，已发布日志和草稿已保留。"); }
    finally { setBusy(false); setPendingDelete(null); }
  }
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 px-3 py-6 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm"><a href="/tool?view=feedback"><ArrowLeftIcon aria-hidden="true" data-icon="inline-start" />返回说明与反馈</a></Button>
        {draft ? <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setToken(""); setDraft(null); setSnapshot(null); setError(""); }}>退出编辑</Button> : null}
      </div>
      <Card className="min-w-0 border-border/70 bg-card/92">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><LightbulbIcon aria-hidden="true" className="size-5" /></div>
            <div className="min-w-0"><CardTitle><h1>管理员日志管理</h1></CardTitle><CardDescription className="mt-1">一些数据库的更新和已发现待解决的问题</CardDescription></div>
          </div>
        </CardHeader>
        <CardContent className="grid min-w-0 gap-4">
          {!draft ? <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void load(); }}>
            <label htmlFor="site-notices-token" className="text-sm font-medium">管理员令牌</label>
            <Input id="site-notices-token" type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} required disabled={busy} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || !token.trim()}>{busy ? "正在验证…" : "验证并编辑"}</Button>
              <Button type="button" variant="outline" disabled={busy || !token.trim()} onClick={() => load(true)}>从存储重新载入</Button>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">使用 ADMIN_CACHE_REFRESH_TOKEN 验证。令牌仅用于本次编辑，不会保存在浏览器中；读取异常时可从存储重新载入。</p>
          </form> : <form onSubmit={publish} className="flex min-w-0 flex-col gap-4">
            <p className="text-xs leading-5 text-muted-foreground">直接写下更新内容，点击发布后生效。未发布的修改仅保留在当前页面，离开或退出编辑会丢弃。</p>
            <fieldset disabled={busy} className="flex min-w-0 flex-col gap-4">
              <legend className="sr-only">日志记录</legend>
              <Button type="button" variant="outline" className="self-start" disabled={draft.entries.length >= SITE_NOTICE_LIMITS.entries} onClick={addEntry}><PlusIcon aria-hidden="true" data-icon="inline-start" />添加日志</Button>
              {draft.entries.map((entry, index) => (
                <fieldset key={entry.id} className="flex min-w-0 flex-col gap-3 rounded-lg border border-border/70 p-3">
                  <legend className="px-1 text-xs text-muted-foreground">日志 {index + 1}</legend>
                  <label className="flex min-w-0 flex-col gap-1.5 text-sm">日期<Input type="date" required value={entry.date} onChange={(event) => changeEntry(entry.id, { date: event.target.value })} /></label>
                  <label className="flex min-w-0 flex-col gap-1.5 text-sm">标题（选填）<Input maxLength={SITE_NOTICE_LIMITS.title} value={entry.title} onChange={(event) => changeEntry(entry.id, { title: event.target.value })} /></label>
                  <label className="flex min-w-0 flex-col gap-1.5 text-sm">内容（支持 Markdown）
                    <textarea className="min-h-32 w-full min-w-0 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring/40" rows={5} required maxLength={SITE_NOTICE_LIMITS.body} value={entry.body} onChange={(event) => changeEntry(entry.id, { body: event.target.value })} />
                  </label>
                  <div className="flex justify-end"><Button type="button" variant="ghost" size="sm" aria-label={`删除日志 ${index + 1}`} onClick={() => setDraft((current) => ({ ...current, entries: current.entries.filter((item) => item.id !== entry.id) }))}><Trash2Icon aria-hidden="true" data-icon="inline-start" />删除</Button></div>
                </fieldset>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button type="button" variant="ghost" onClick={() => void load()}>放弃草稿，恢复已发布内容</Button>
                <Button type="submit">{busy ? "处理中…" : "发布更新"}</Button>
              </div>
            </fieldset>
          </form>}
          {error ? <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert> : null}
        </CardContent>
      </Card>
      {snapshot ? <Card className="min-w-0 border-border/70 bg-card/92">
        <CardHeader><CardTitle>已发布日志</CardTitle><CardDescription>删除后立即生效，无需再次点击发布。</CardDescription></CardHeader>
        <CardContent><SiteNoticesFeed entries={snapshot.entries} onDelete={setPendingDelete} busy={busy} /></CardContent>
      </Card> : null}
      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => { if (!open && !busy) setPendingDelete(null); }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>删除这条已发布日志？</AlertDialogTitle>
            <AlertDialogDescription>确认后会立即从公开日志中移除。其他未发布的修改会保留，不会同时发布。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={busy} onClick={(event) => { event.preventDefault(); void deletePublished(); }}>{busy ? "正在删除…" : "确认删除"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
