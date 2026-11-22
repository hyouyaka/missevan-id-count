import { useLayoutEffect, useRef } from "react";

import { TabsList } from "@/components/ui/tabs";

export function RankPlatformTabList({ children, className = "", ...props }) {
  const containerRef = useRef(null);
  const listRef = useRef(null);
  useLayoutEffect(() => {
    const container = containerRef.current;
    const list = listRef.current;
    if (!container || !list) return undefined;

    function fitLabels() {
      // Measure the full track before switching modes, including after a resize.
      delete list.dataset.iconOnly;
      if (list.getBoundingClientRect().width > container.getBoundingClientRect().width) {
        list.dataset.iconOnly = "";
      }
    }
    fitLabels();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(fitLabels) : null;
    observer?.observe(container);
    return () => observer?.disconnect();
  }, [children]);

  return (
    <div ref={containerRef} className="w-full min-w-0">
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
