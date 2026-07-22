import * as React from "react"
import { cva } from "class-variance-authority";
import * as Slot from "@radix-ui/react-slot"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-[calc(var(--radius)-0.05rem)] border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 motion-reduce:active:not-aria-[haspopup]:translate-y-0 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[var(--shadow-control)] [a]:hover:bg-[var(--primary-hover)] hover:bg-[var(--primary-hover)]",
        outline:
          "border-border/90 bg-background/92 text-foreground hover:border-[var(--border-warm)] hover:bg-surface-hover-strong hover:text-foreground aria-expanded:border-[var(--border-warm)] aria-expanded:bg-surface-hover-strong aria-expanded:text-foreground",
        secondary:
          "border border-[color-mix(in_oklch,var(--accent-warm)_24%,transparent)] bg-[var(--accent-warm)] text-[var(--accent-warm-foreground)] shadow-[var(--shadow-secondary-control)] hover:bg-[color-mix(in_oklch,var(--accent-warm)_90%,var(--foreground))] hover:text-[var(--accent-warm-foreground)] aria-expanded:bg-[color-mix(in_oklch,var(--accent-warm)_90%,var(--foreground))] aria-expanded:text-[var(--accent-warm-foreground)]",
        compare:
          "border border-[color-mix(in_oklch,var(--accent-compare)_24%,transparent)] bg-[var(--accent-compare)] text-[var(--accent-compare-foreground)] shadow-[0_14px_28px_-20px_var(--accent-compare)] hover:bg-[var(--accent-compare-hover)] hover:text-[var(--accent-compare-foreground)] aria-expanded:bg-[var(--accent-compare-hover)] aria-expanded:text-[var(--accent-compare-foreground)]",
        ghost:
          "hover:bg-surface-hover hover:text-foreground aria-expanded:bg-surface-hover aria-expanded:text-foreground",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20",
        link: "text-primary underline-offset-4 hover:text-accent-foreground hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 rounded-[calc(var(--radius)-0.18rem)] px-2 text-xs in-data-[slot=button-group]:rounded-[calc(var(--radius)-0.12rem)] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-[calc(var(--radius)-0.12rem)] px-3 text-[0.82rem] in-data-[slot=button-group]:rounded-[calc(var(--radius)-0.08rem)] has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[calc(var(--radius)-0.18rem)] in-data-[slot=button-group]:rounded-[calc(var(--radius)-0.12rem)] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-8 rounded-[calc(var(--radius)-0.12rem)] in-data-[slot=button-group]:rounded-[calc(var(--radius)-0.08rem)]",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props} />
  );
}

export { Button, buttonVariants }
