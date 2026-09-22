import { useState } from "react";
import { BookOpenTextIcon, MessageSquarePlusIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import danmakuOverflowMarkdown from "../../DANMAKU_OVERFLOW.md?raw";
import revenueCalculationMarkdown from "../../REVENUE_CALCULATION.md?raw";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { buildVersionedUrl } from "@/app/app-utils";

const MAX_FEEDBACK_MESSAGE_LENGTH = 3000;
const MIN_FEEDBACK_MESSAGE_LENGTH = 5;
const FEEDBACK_TYPES = [
  { value: "bug", label: "Bug" },
  { value: "data", label: "数据异常" },
  { value: "feature", label: "功能建议" },
  { value: "other", label: "其他" },
];

function logExplanationOpen(section, frontendVersion) {
  fetch(buildVersionedUrl("/usage-log", frontendVersion), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "feedback_explanation_open",
      section,
      success: true,
    }),
    keepalive: true,
  }).catch((error) => {
    console.error("Failed to log feedback explanation open", error);
  });
}

const markdownComponents = {
  h1: () => null,
  h2: ({ node: _node, ...props }) => (
    <h2 className="font-heading text-base font-semibold text-foreground" {...props} />
  ),
  p: ({ node: _node, ...props }) => (
    <p className="text-sm leading-6 text-muted-foreground" {...props} />
  ),
  ul: ({ node: _node, ...props }) => (
    <ul className="grid list-disc gap-1.5 pl-5 text-sm leading-6 text-muted-foreground" {...props} />
  ),
  code: ({ node: _node, ...props }) => (
    <code
      className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground"
      {...props}
    />
  ),
  blockquote: ({ node: _node, children }) => (
    <Alert role="note">
      <AlertDescription className="![text-wrap:wrap] text-left md:![text-wrap:wrap]">
        {children}
      </AlertDescription>
    </Alert>
  ),
  table: ({ node: _node, ...props }) => <Table {...props} />,
  thead: ({ node: _node, ...props }) => <TableHeader {...props} />,
  tbody: ({ node: _node, ...props }) => <TableBody {...props} />,
  tr: ({ node: _node, ...props }) => <TableRow {...props} />,
  th: ({ node: _node, ...props }) => <TableHead {...props} />,
  td: ({ node: _node, ...props }) => <TableCell {...props} />,
};

function getFeedbackErrorMessage(status) {
  if (status === 400) {
    return "请检查反馈内容后重试。";
  }
  if (status === 429) {
    return "提交过于频繁，请稍后再试。";
  }
  return "反馈暂时无法发送，请稍后再试。";
}

export function FeedbackView({ frontendVersion, feedbackEnabled = false }) {
  const [type, setType] = useState("bug");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmedMessage = message.trim();
    if (
      trimmedMessage.length < MIN_FEEDBACK_MESSAGE_LENGTH ||
      trimmedMessage.length > MAX_FEEDBACK_MESSAGE_LENGTH
    ) {
      const validationMessage = "请检查反馈内容后重试。";
      setErrorMessage(validationMessage);
      toast.error(validationMessage);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
    try {
      const response = await fetch("/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        body: JSON.stringify({
          type,
          message: trimmedMessage,
          website,
          frontendVersion: String(frontendVersion || "").trim(),
        }),
      });

      if (!response.ok) {
        const nextErrorMessage = getFeedbackErrorMessage(response.status);
        setErrorMessage(nextErrorMessage);
        toast.error(nextErrorMessage);
        return;
      }

      setMessage("");
      setType("bug");
      setWebsite("");
      toast.success("反馈已提交，感谢你的建议。");
    } catch (_) {
      const nextErrorMessage = getFeedbackErrorMessage(503);
      setErrorMessage(nextErrorMessage);
      toast.error(nextErrorMessage);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="grid gap-4 sm:gap-5">
      <Card className="border-border/70 bg-card/92">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <BookOpenTextIcon aria-hidden="true" className="size-5" />
            </div>
            <div className="min-w-0">
              <CardTitle>统计说明</CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Accordion
            type="single"
            collapsible
            className="rounded-xl border border-border/70 bg-muted/20 px-4"
            onValueChange={(value) => {
              if (value) {
                logExplanationOpen("revenue_calculation", frontendVersion);
              }
            }}
          >
            <AccordionItem value="revenue-calculation" className="border-b-0">
              <AccordionTrigger>收益预估计算说明</AccordionTrigger>
              <AccordionContent className="grid gap-4 pb-4">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {revenueCalculationMarkdown}
                </ReactMarkdown>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
          <Accordion
            type="single"
            collapsible
            className="rounded-xl border border-border/70 bg-muted/20 px-4"
            onValueChange={(value) => {
              if (value) {
                logExplanationOpen("danmaku_overflow", frontendVersion);
              }
            }}
          >
            <AccordionItem value="danmaku-overflow" className="border-b-0">
              <AccordionTrigger>弹幕溢出判断说明</AccordionTrigger>
              <AccordionContent className="grid gap-4 pb-4">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {danmakuOverflowMarkdown}
                </ReactMarkdown>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>
      <Card className="border-border/70 bg-card/92">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <MessageSquarePlusIcon aria-hidden="true" className="size-5" />
            </div>
            <div className="min-w-0">
              <CardTitle>建议反馈</CardTitle>
              <CardDescription className="mt-1">
                {feedbackEnabled ? "请填写表格提交反馈，也可私信小红书账号" : "如需交流，可私信小红书账号"}
                <a
                  href="https://xhslink.cn/o/9hUXfAAAP8I"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-primary underline underline-offset-4 transition-colors hover:text-[var(--primary-hover)] focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  MMToolkit
                </a>
                {feedbackEnabled ? "交流。" : "。"}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          {feedbackEnabled ? (
            <form className="grid gap-4" onSubmit={handleSubmit}>
              <div className="grid gap-2">
                <label className="text-sm font-medium text-foreground" htmlFor="feedback-type">
                  类型
                </label>
                <select
                  id="feedback-type"
                  name="type"
                  value={type}
                  onChange={(event) => setType(event.target.value)}
                  className="h-10 w-fit min-w-[7rem] max-w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  {FEEDBACK_TYPES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-sm font-medium text-foreground" htmlFor="feedback-message">
                    反馈内容
                  </label>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {message.length} / {MAX_FEEDBACK_MESSAGE_LENGTH}
                  </span>
                </div>
                <textarea
                  id="feedback-message"
                  name="message"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  maxLength={MAX_FEEDBACK_MESSAGE_LENGTH}
                  rows={6}
                  placeholder="请描述遇到的问题、数据异常或功能建议……"
                  className="min-h-32 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                  aria-describedby="feedback-message-hint"
                />
                <p id="feedback-message-hint" className="text-xs text-muted-foreground">
                  内容长度为 {MIN_FEEDBACK_MESSAGE_LENGTH}～{MAX_FEEDBACK_MESSAGE_LENGTH} 个字符。
                </p>
              </div>
              <input
                name="website"
                type="text"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                className="absolute -left-[9999px] h-px w-px opacity-0"
              />
              {errorMessage ? (
                <Alert variant="destructive" role="alert">
                  <AlertTitle>提交失败</AlertTitle>
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              ) : null}
              <div className="flex justify-end">
                <Button className="min-w-[6rem]" type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "正在提交…" : "提交反馈"}
                </Button>
              </div>
            </form>
          ) : (
            <Alert className="border-border/70 bg-muted/20">
              <MessageSquarePlusIcon aria-hidden="true" className="size-4" />
              <AlertTitle>反馈暂未启用</AlertTitle>
              <AlertDescription>当前站点尚未配置反馈服务。</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
