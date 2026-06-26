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
          "border-[var(--border-warm)] bg-secondary text-secondary-foreground [a]:hover:bg-[color-mix(in_srgb,var(--secondary)_88%,white)]",
        info:
          "border-[color-mix(in_srgb,var(--accent-cool)_18%,transparent)] bg-[var(--accent-cool)] text-[var(--accent-cool-foreground)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] [a]:hover:bg-[color-mix(in_srgb,var(--accent-cool)_90%,black)]",
        coral:
          "border-[color-mix(in_srgb,var(--accent-warm)_18%,transparent)] bg-[var(--accent-warm)] text-[var(--accent-warm-foreground)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] [a]:hover:bg-[color-mix(in_srgb,var(--accent-warm)_90%,black)]",
        missevanPlatform:
          "border-[color-mix(in_srgb,var(--accent-neutral)_20%,transparent)] bg-[var(--accent-neutral)] text-[var(--accent-neutral-foreground)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] [a]:hover:bg-[color-mix(in_srgb,var(--accent-neutral)_90%,black)]",
        manboPlatform:
          "border-[color-mix(in_srgb,var(--accent-purple)_20%,transparent)] bg-[var(--accent-purple)] text-[var(--accent-purple-foreground)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] [a]:hover:bg-[color-mix(in_srgb,var(--accent-purple)_90%,black)]",
        free:
          "border-[color-mix(in_srgb,var(--accent-success)_18%,transparent)] bg-[var(--accent-success)] text-[var(--accent-success-foreground)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] [a]:hover:bg-[color-mix(in_srgb,var(--accent-success)_90%,black)]",
        member:
          "border-[color-mix(in_srgb,var(--accent-gold)_28%,black)] bg-[var(--accent-gold)] text-[var(--accent-gold-foreground)] shadow-[inset_0_1px_0_rgba(255,255,255,0.24)] [a]:hover:bg-[color-mix(in_srgb,var(--accent-gold)_90%,white)]",
        paid:
          "border-[color-mix(in_srgb,var(--accent-warm)_18%,transparent)] bg-[var(--accent-warm)] text-[var(--accent-warm-foreground)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] [a]:hover:bg-[color-mix(in_srgb,var(--accent-warm)_90%,black)]",
        radioDrama:
          "border-[color-mix(in_srgb,var(--primary)_18%,transparent)] bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] [a]:hover:bg-[color-mix(in_srgb,var(--primary)_90%,black)]",
        audioDrama:
          "border-[color-mix(in_srgb,var(--accent-purple)_18%,transparent)] bg-[var(--accent-purple)] text-[var(--accent-purple-foreground)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] [a]:hover:bg-[color-mix(in_srgb,var(--accent-purple)_90%,black)]",
        audioComic:
          "border-[color-mix(in_srgb,var(--accent-rose)_18%,transparent)] bg-[var(--accent-rose)] text-[var(--accent-rose-foreground)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] [a]:hover:bg-[color-mix(in_srgb,var(--accent-rose)_90%,black)]",
        imported:
          "border-[color-mix(in_srgb,var(--primary)_18%,transparent)] bg-accent text-accent-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] [a]:hover:bg-[color-mix(in_srgb,var(--accent)_90%,var(--primary))]",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-border/85 bg-background/86 text-foreground [a]:hover:bg-surface-hover [a]:hover:text-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
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
