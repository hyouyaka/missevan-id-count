import manboIconUrl from "@/assets/platform-icons/manbo.png";
import missevanIconUrl from "@/assets/platform-icons/missevan.png";

export const platformTabMeta = {
  missevan: { label: "猫耳", icon: missevanIconUrl },
  manbo: { label: "漫播", icon: manboIconUrl },
};

export function PlatformTabLabel({ platform, label, iconClassName = "size-4" }) {
  const key = platform?.key || platform;
  const meta = platformTabMeta[key];
  const displayLabel = label || meta?.label || platform?.label || platform;
  return (
    <span className="inline-flex min-w-0 items-center justify-center gap-1.5">
      {meta?.icon ? (
        <img
          alt=""
          aria-hidden="true"
          className={`${iconClassName} shrink-0 object-contain`}
          src={meta.icon}
        />
      ) : null}
      <span className="platform-tab-label-text min-w-0 truncate">{displayLabel}</span>
    </span>
  );
}

export function PlatformIdIcon({ platform, label, className = "size-3.5 shrink-0", ...props }) {
  const key = platform?.key || platform;
  const meta = platformTabMeta[key];
  if (!meta?.icon) {
    return null;
  }
  return (
    <img
      alt={label || `${meta?.label || "平台"} ID`}
      aria-label={label || `${meta?.label || "平台"} ID`}
      className={`${className} object-contain`}
      role="img"
      src={meta.icon}
      title={props.title || label || `${meta?.label || "平台"} ID`}
      {...props}
    />
  );
}
