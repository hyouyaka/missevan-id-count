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
