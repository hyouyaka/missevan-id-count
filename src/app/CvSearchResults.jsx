import { useEffect, useState } from "react";
import { ChevronRightIcon, MicIcon } from "lucide-react";

import { LazyImage } from "@/components/ui/lazy-image";

function buildProxyImageUrl(url) {
  const normalized = String(url ?? "").trim();
  return normalized ? `/image-proxy?url=${encodeURIComponent(normalized)}` : "";
}

function CvAvatar({ name, avatar }) {
  const avatarUrl = buildProxyImageUrl(avatar);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [avatarUrl]);

  if (!avatarUrl || failed) {
    return <MicIcon aria-hidden="true" className="size-5 text-muted-foreground" />;
  }
  return (
    <LazyImage
      alt={`${name}头像`}
      className="size-full object-cover"
      src={avatarUrl}
      onError={() => setFailed(true)}
    />
  );
}

export function CvSearchResults({
  results = [],
  onOpenCv,
}) {
  if (!results.length) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-border/80 bg-muted/30 px-6 py-10 text-center">
        <div className="text-base font-semibold">未找到匹配的 CV</div>
      </div>
    );
  }

  return (
    <div className="mt-3 divide-y divide-border/75">
      {results.map((item) => (
        <button
          key={item.profileId || item.name}
          type="button"
          className="group flex w-full items-center gap-3 px-1 py-3.5 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-2"
          onClick={() => onOpenCv?.(item.name, {
            source: "search",
            profileId: item.profileId,
          })}
        >
          <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/80 bg-muted text-xs font-semibold text-muted-foreground">
            <CvAvatar name={item.name} avatar={item.avatar} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold text-foreground">
              {item.name}
            </span>
            <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>猫耳 {Number(item.missevanWorkCount ?? 0) || 0} 部</span>
              <span>漫播 {Number(item.manboWorkCount ?? 0) || 0} 部</span>
              <span>共 {Number(item.workCount ?? 0) || 0} 部</span>
            </span>
          </span>
          <ChevronRightIcon
            aria-hidden="true"
            className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
          />
        </button>
      ))}
    </div>
  );
}
