import { useEffect, useState } from "react";
import { ScrollTextIcon } from "lucide-react";

import {
  getChangelogEntriesForMode,
  getShouldAutoOpenChangelog,
  markChangelogVersionSeen,
} from "@/app/changelog";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function useChangelogDialog(frontendVersion) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("history");

  useEffect(() => {
    if (getShouldAutoOpenChangelog(frontendVersion)) {
      setMode("summary");
      setOpen(true);
    }
  }, [frontendVersion]);

  function handleOpenChange(nextOpen) {
    setOpen(nextOpen);
    if (!nextOpen) {
      markChangelogVersionSeen(frontendVersion);
    }
  }

  return {
    changelogOpen: open,
    changelogMode: mode,
    openChangelog: () => {
      setMode("history");
      setOpen(true);
    },
    showChangelogHistory: () => setMode("history"),
    setChangelogOpen: handleOpenChange,
  };
}

export function ChangelogButton({ className = "", size = "default", onClick, style }) {
  function handleClick(event) {
    event.preventDefault();
    onClick?.(event);
  }

  return (
    <Button variant="outline" size={size} className={className} style={style} asChild>
      <a href="#更新日志" onClick={handleClick}>
        <ScrollTextIcon data-icon="inline-start" />
        更新日志
      </a>
    </Button>
  );
}

export function ChangelogDialog({ open, mode = "history", onOpenChange, onShowHistory }) {
  const visibleEntries = getChangelogEntriesForMode(mode);
  const latestVersion = visibleEntries[0]?.version ?? "";

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        className={`w-[calc(100vw-1.5rem)] max-w-[30rem] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[32rem] ${mode === "summary" ? "max-h-[min(80dvh,34rem)]" : "h-[min(80dvh,34rem)]"}`}
      >
        <AlertDialogHeader className="grid-rows-none place-items-start gap-3 px-4 pt-4 pb-3 text-left">
          <div className="flex items-center gap-3">
            <AlertDialogMedia className="mb-0 size-9">
              <ScrollTextIcon aria-hidden="true" className="size-5" />
            </AlertDialogMedia>
            <AlertDialogTitle>更新日志 v{latestVersion}</AlertDialogTitle>
          </div>
        </AlertDialogHeader>
        <AlertDialogDescription
          asChild
          className="![text-wrap:wrap] md:![text-wrap:wrap]"
        >
          <div
            data-changelog-scroll-region="true"
            data-changelog-mode={mode}
            role="region"
            aria-label="更新日志内容"
            tabIndex={0}
            className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-4 text-left [-webkit-overflow-scrolling:touch]"
          >
            <div className="grid gap-4">
              {visibleEntries.map((entry) => (
                <section key={entry.version} className="grid gap-2">
                  <div className="text-sm font-semibold text-foreground">v{entry.version}</div>
                  <ul className="grid gap-1.5 pl-4 text-sm leading-6 text-muted-foreground">
                    {entry.changes.map((change) => (
                      <li key={change} className="list-disc">
                        {change}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </AlertDialogDescription>
        <AlertDialogFooter className="mx-0 mb-0 flex flex-row items-center justify-end gap-2 rounded-b-[calc(var(--radius)+0.32rem)] px-4 py-3">
          {mode === "summary" ? (
            <Button type="button" variant="outline" size="sm" className="h-8 w-fit px-4" onClick={onShowHistory}>
              查看完整日志
            </Button>
          ) : null}
          <AlertDialogAction size="sm" className="h-8 w-fit px-4" onClick={() => onOpenChange?.(false)}>
            知道了
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
