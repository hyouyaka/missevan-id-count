import { useEffect, useRef, useState } from "react";
import { BookOpenIcon, MicIcon } from "lucide-react";
import { LazyImage } from "@/components/ui/lazy-image";

function SuggestionImage({ item }) {
  const source = item.type === "cv" ? item.avatar : item.cover;
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [source]);
  const Icon = item.type === "cv" ? MicIcon : BookOpenIcon;
  return (
    <span className={`flex size-14 shrink-0 items-center justify-center overflow-hidden border border-border/70 bg-muted text-muted-foreground ${item.type === "cv" ? "rounded-full" : "rounded-md"}`}>
      {source && !failed ? (
        <LazyImage
          alt={item.type === "cv" ? `${item.name}头像` : `${item.name}封面`}
          className="size-full object-cover"
          src={`/image-proxy?url=${encodeURIComponent(source)}`}
          onError={() => setFailed(true)}
        />
      ) : <Icon aria-hidden="true" className="size-5" />}
    </span>
  );
}

export function SearchSuggestionList({ id, items, selectedIndex, onOpen }) {
  const listRef = useRef(null);
  useEffect(() => {
    listRef.current?.children[selectedIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [selectedIndex]);
  if (!items.length) return null;
  return (
    <div
      ref={listRef}
      id={id}
      role="listbox"
      aria-label="搜索联想"
      className="absolute inset-x-0 top-full z-50 mt-1.5 max-h-[min(18rem,40dvh)] overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-1 shadow-[var(--shadow-panel)]"
    >
      {items.map((item, index) => (
        <button
          key={item.key}
          id={`${id}-${index}`}
          type="button"
          role="option"
          tabIndex={-1}
          aria-selected={index === selectedIndex}
          aria-label={`${item.name}，${item.type === "cv" ? "CV" : item.platform === "manbo" ? "漫播" : "猫耳"}${item.contentTypeLabel ? `，${item.contentTypeLabel}` : ""}`}
          className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-muted ${index === selectedIndex ? "bg-muted" : ""}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onOpen(item)}
        >
          <SuggestionImage item={item} />
          <span className="grid min-w-0 flex-1 grid-rows-[1.25rem_1rem_1rem] gap-0.5">
            <span className="truncate leading-5" title={item.name}>{item.name}</span>
            <span className="truncate text-xs leading-4 text-muted-foreground" title={item.mainCvNames?.join("，")}>
              {item.type === "drama" ? item.mainCvNames?.join("，") || "" : ""}
            </span>
            <span className="flex min-w-0 items-center gap-2 text-xs leading-4 text-muted-foreground">
              <span>{item.type === "cv" ? "CV" : item.platform === "manbo" ? "漫播" : "猫耳"}</span>
              {item.type === "drama" && item.contentTypeLabel ? (
                <span className="truncate rounded bg-muted px-1.5">{item.contentTypeLabel}</span>
              ) : null}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
