import { cn } from "@/lib/utils";

export function AppIcon({ className = "" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-8 shrink-0 overflow-hidden rounded-lg border border-border/70 bg-background shadow-sm",
        className
      )}
    >
      <img alt="" className="size-full object-cover" draggable="false" src="/app-icon.png" />
    </span>
  );
}
