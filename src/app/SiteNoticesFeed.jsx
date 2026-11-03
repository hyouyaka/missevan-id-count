import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Trash2Icon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

export function SiteNoticesFeed({ entries, onDelete, busy = false }) {
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));
  if (!sorted.length) return <p className="text-sm text-muted-foreground">暂无管理员日志。</p>;
  return (
    <section aria-label="管理员日志列表" tabIndex={0}
      className="max-h-[min(32rem,65dvh)] min-w-0 overflow-y-auto overscroll-contain pr-1 outline-none [scrollbar-gutter:stable] focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring/40">
    <ol aria-label="管理员日志记录" className="grid min-w-0 divide-y divide-border/70">
      {sorted.map((entry) => (
        <li key={entry.id} className="py-5 first:pt-0 last:pb-0">
          <article aria-label={entry.title || `${entry.date} 的管理员日志`} className="flex min-w-0 items-start gap-3">
            <Avatar><AvatarImage src="/icon.png" alt="网站 logo" /><AvatarFallback>MM</AvatarFallback></Avatar>
            <div className="grid min-w-0 flex-1 gap-2">
              <header className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-sm font-semibold text-foreground">MMToolkit</span>
                <div className="flex flex-wrap items-center gap-2">
                  <time dateTime={entry.date} className="text-xs tabular-nums text-muted-foreground">{entry.date}</time>
                  {onDelete ? <Button type="button" variant="ghost" size="sm" disabled={busy}
                    aria-label={`删除已发布日志：${entry.title || entry.date}`} onClick={() => onDelete(entry)}>
                    <Trash2Icon aria-hidden="true" data-icon="inline-start" />删除
                  </Button> : null}
                </div>
              </header>
              {entry.title ? <h3 className="break-words text-sm font-medium leading-6 [overflow-wrap:anywhere]">{entry.title}</h3> : null}
              <div className="min-w-0 w-full overflow-x-auto break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere] [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_h1]:text-base [&_h2]:text-base [&_h3]:text-sm [&_li]:ml-5 [&_ol]:list-decimal [&_p:not(:last-child)]:mb-3 [&_pre]:overflow-x-auto [&_ul]:list-disc">
                <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={["img"]}
                  components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>
                  {entry.body}
                </ReactMarkdown>
              </div>
            </div>
          </article>
        </li>
      ))}
    </ol>
    </section>
  );
}
