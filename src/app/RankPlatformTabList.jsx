import { useLayoutEffect, useRef } from "react";

import { TabsList } from "@/components/ui/tabs";

export function RankPlatformTabList({ children, className = "", align = "start", leadingGroupRef, ...props }) {
  const containerRef = useRef(null);
  const listRef = useRef(null);
  useLayoutEffect(() => {
    const container = containerRef.current;
    const list = listRef.current;
    const leadingGroup = leadingGroupRef?.current;
    if (!container || !list) return undefined;

    function fitLabels() {
      // Measure the full track before switching modes, including after a resize.
      delete list.dataset.iconOnly;
      const bounds = container.getBoundingClientRect();
      if (!bounds.width) return;
      const wrapped = leadingGroup && bounds.top >= leadingGroup.getBoundingClientRect().bottom;
      if (wrapped || list.getBoundingClientRect().width > bounds.width) {
        list.dataset.iconOnly = "";
      }
    }
    fitLabels();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(fitLabels) : null;
    observer?.observe(container);
    if (leadingGroup) observer?.observe(leadingGroup);
    return () => observer?.disconnect();
  }, [children, leadingGroupRef]);

  return (
    <div ref={containerRef} className={align === "end" ? "flex w-full min-w-0 justify-end" : "w-full min-w-0"}>
      <TabsList
        ref={listRef}
        className={className + " w-max! max-w-none! [&>button]:flex-none [&_.platform-label]:shrink-0 [&_.platform-tab-label-text]:overflow-visible data-[icon-only]:[&_.platform-tab-label-text]:hidden"}
        {...props}
      >
        {children}
      </TabsList>
    </div>
  );
}
