import * as React from "react"
import { cva } from "class-variance-authority";
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-[calc(var(--radius)-0.1rem)] border border-transparent px-2.5 py-0.5 text-[0.72rem] font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] [a]:hover:bg-[color-mix(in_srgb,var(--primary)_92%,black)]",
        secondary:
          "border-[rgba(239,131,95,0.24)] bg-secondary text-secondary-foreground [a]:hover:bg-[color-mix(in_srgb,var(--secondary)_88%,white)]",
        info:
          "border-[rgba(59,62,122,0.18)] bg-[rgb(59,62,122)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] [a]:hover:bg-[color-mix(in_srgb,rgb(59,62,122)_90%,black)]",
        coral:
          "border-[rgba(239,131,95,0.18)] bg-[rgb(239,131,95)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] [a]:hover:bg-[color-mix(in_srgb,rgb(239,131,95)_90%,black)]",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-border/85 bg-background/86 text-foreground [a]:hover:bg-[rgba(255,240,233,0.8)] [a]:hover:text-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-[rgb(59,62,122)] underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props} />
  );
}

export { Badge, badgeVariants }
