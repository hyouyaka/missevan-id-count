import { useLayoutEffect, useRef, useState } from "react";

const minCardWidth = 320;
const columnGap = 12;

export function useResponsiveCardColumns() {
  const containerRef = useRef(null);
  const [columns, setColumns] = useState(1);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = (width) => {
      setColumns(Math.min(3, Math.max(1, Math.floor((width + columnGap) / (minCardWidth + columnGap)))));
    };
    const measureContainer = () => measure(container.getBoundingClientRect().width);
    measureContainer();

    if (typeof ResizeObserver !== "function") {
      window.addEventListener("resize", measureContainer);
      return () => window.removeEventListener("resize", measureContainer);
    }

    const observer = new ResizeObserver(([entry]) => measure(entry.contentRect.width));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return { containerRef, columns };
}
