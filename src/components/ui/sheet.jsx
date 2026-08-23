import * as React from "react";
import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

function Sheet(props) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger(props) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetPortal(props) {
  return <DialogPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({ className, ...props }) {
  return (
    <DialogPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn("fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0", className)}
      {...props}
    />
  );
}

function SheetContent({ className, children, showCloseButton = true, ...props }) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "fixed right-0 top-0 z-50 h-dvh w-[230px] max-w-[calc(100vw-0.75rem)] overflow-y-auto overscroll-contain border-l border-border bg-background p-3 shadow-[var(--shadow-panel)] outline-none sm:w-[260px]",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close className="absolute right-3 top-3 inline-flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <XIcon className="size-4" />
            <span className="sr-only">关闭菜单</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </SheetPortal>
  );
}

function SheetTitle({ className, ...props }) {
  return <DialogPrimitive.Title data-slot="sheet-title" className={cn("font-semibold text-foreground", className)} {...props} />;
}

function SheetDescription({ className, ...props }) {
  return <DialogPrimitive.Description data-slot="sheet-description" className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export { Sheet, SheetContent, SheetDescription, SheetOverlay, SheetPortal, SheetTitle, SheetTrigger };
