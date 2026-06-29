import * as React from "react"
import { cva } from "class-variance-authority";
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn("group/tabs flex gap-2 data-horizontal:flex-col", className)}
      {...props} />
  );
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex h-9 w-fit items-center justify-center rounded-full border-0 bg-[var(--control-track)] p-1 text-muted-foreground shadow-none group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col",
  {
    variants: {
      variant: {
        default: "",
        line: "",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props} />
  );
}

function TabsTrigger({
  className,
  ...props
}) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[30px] flex-1 items-center justify-center gap-1.5 rounded-full border-0 px-3 py-1 text-sm font-medium whitespace-nowrap text-muted-foreground transition-[background-color,color,box-shadow] group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:bg-surface-hover hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 data-[state=active]:bg-[var(--control-selected)] data-[state=active]:text-foreground data-[state=active]:shadow-[var(--shadow-selected)] data-[platform=manbo]:text-[var(--platform-manbo)] data-[platform=manbo]:data-[state=active]:bg-[var(--platform-manbo-soft)] data-[platform=manbo]:data-[state=active]:text-[var(--platform-manbo)] data-[platform=missevan]:text-[var(--platform-missevan)] data-[platform=missevan]:data-[state=active]:bg-[var(--platform-missevan-soft)] data-[platform=missevan]:data-[state=active]:text-[var(--platform-missevan)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props} />
  );
}

function TabsContent({
  className,
  ...props
}) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props} />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
