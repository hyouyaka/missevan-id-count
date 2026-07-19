import { SquareArrowOutUpRightIcon } from "lucide-react";

import {
  buildDramaExternalUrl,
  buildDramaExternalUsagePayload,
  buildVersionedUrl,
  getDefaultAppConfig,
} from "@/app/app-utils";
import manboIconUrl from "@/assets/platform-icons/manbo.png";
import missevanIconUrl from "@/assets/platform-icons/missevan.png";

export const platformTabMeta = {
  missevan: { label: "猫耳", icon: missevanIconUrl },
  manbo: { label: "漫播", icon: manboIconUrl },
};

function PlatformGlyph({ platform, className = "size-4", tone = "brand", ...props }) {
  const key = platform?.key || platform;
  const meta = platformTabMeta[key];
  if (!meta?.icon) {
    return null;
  }
  return (
    <span
      aria-hidden="true"
      data-platform={key}
      data-tone={tone}
      className={`platform-glyph inline-block shrink-0 ${className}`.trim()}
      style={{
        WebkitMaskImage: `url(${meta.icon})`,
        maskImage: `url(${meta.icon})`,
      }}
      {...props}
    />
  );
}

export function PlatformTabLabel({ platform, label, iconClassName = "size-4", tone = "brand" }) {
  const key = platform?.key || platform;
  const meta = platformTabMeta[key];
  const displayLabel = label || meta?.label || platform?.label || platform;
  return (
    <span className="platform-label inline-flex min-w-0 items-center justify-center gap-1.5" data-platform={key} data-tone={tone}>
      <PlatformGlyph platform={platform} className={iconClassName} tone={tone} />
      <span className="platform-tab-label-text min-w-0 truncate">{displayLabel}</span>
    </span>
  );
}

export function PlatformIdIcon({ platform, label, className = "size-3.5 shrink-0", tone = "inherit", ...props }) {
  const key = platform?.key || platform;
  const meta = platformTabMeta[key];
  if (!meta?.icon) {
    return null;
  }
  return (
    <span
      aria-label={label || `${meta?.label || "平台"} ID`}
      data-platform={key}
      data-tone={tone}
      className={`platform-glyph inline-block ${className}`.trim()}
      role="img"
      style={{
        WebkitMaskImage: `url(${meta.icon})`,
        maskImage: `url(${meta.icon})`,
      }}
      title={props.title || label || `${meta?.label || "平台"} ID`}
      {...props}
    />
  );
}

export function PlatformDramaLink({
  platform,
  dramaId,
  displayId = dramaId,
  idLabel = "作品ID",
  source = "unknown",
  dramaTitle = "",
  frontendVersion = getDefaultAppConfig().frontendVersion,
  ariaLabel,
  title,
  className = "",
  iconClassName = "size-3.5 shrink-0",
  textClassName = "",
  externalIconClassName = "size-3.5",
}) {
  const key = platform?.key || platform;
  const meta = platformTabMeta[key];
  const href = buildDramaExternalUrl(key, dramaId);
  const visibleId = String(displayId ?? "").trim();
  if (!meta || !href || !visibleId) {
    return null;
  }

  const normalizedDramaId = String(dramaId ?? "").trim();
  const linkLabel =
    ariaLabel || `在${meta.label}打开${idLabel} ${normalizedDramaId}（新窗口）`;

  function logExternalOpen() {
    const payload = buildDramaExternalUsagePayload(key, normalizedDramaId, source, dramaTitle);
    if (!payload) {
      return;
    }
    fetch(buildVersionedUrl("/usage-log", frontendVersion), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch((error) => {
      console.error("Failed to log drama external open", error);
    });
  }

  return (
    <a
      aria-label={linkLabel}
      className={`-mt-0.5 -mb-2 inline-flex w-fit max-w-full cursor-pointer items-start self-start gap-1.5 rounded-sm pt-0.5 pb-2 text-xs text-muted-foreground underline-offset-4 transition-colors duration-200 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${className}`.trim()}
      href={href}
      onClick={logExternalOpen}
      rel="noopener noreferrer"
      target="_blank"
      title={title || linkLabel}
    >
      <PlatformIdIcon
        aria-hidden="true"
        className={iconClassName}
        platform={key}
        tone="inherit"
      />
      <span className={`min-w-0 break-all ${textClassName}`.trim()}>{visibleId}</span>
      <SquareArrowOutUpRightIcon
        aria-hidden="true"
        className={`mt-px shrink-0 ${externalIconClassName}`.trim()}
      />
    </a>
  );
}
