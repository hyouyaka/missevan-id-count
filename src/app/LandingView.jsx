import { useEffect, useMemo, useState } from "react";
import { MessageSquarePlusIcon, RefreshCcwIcon } from "lucide-react";

import { AppIcon } from "@/app/AppIcon";
import { ChangelogButton, ChangelogDialog, useChangelogDialog } from "@/app/ChangelogDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  createRegionState,
  formatCooldownRemaining,
  getDefaultGatewayConfig,
  normalizeRegionBaseUrl,
  normalizeVersion,
  pickPreferredRegion,
} from "@/app/app-utils";

function buildLandingRegionsUrl(frontendVersion) {
  return `/landing/regions?frontendVersion=${encodeURIComponent(frontendVersion)}`;
}

function buildRegionEntryUrl(baseUrl) {
  const normalized = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!normalized) {
    return "";
  }
  return /\/tool$/i.test(normalized) ? normalized : `${normalized}/tool`;
}

function applyLandingRegionSnapshot(snapshotMap, fallbackVersion, regions) {
  return regions.map((region) => {
    const snapshot = snapshotMap.get(region.key);
    return {
      ...region,
      version: normalizeVersion(snapshot?.version ?? fallbackVersion),
      cooldownUntil: Number(snapshot?.cooldownUntil ?? 0) || 0,
      cooldownHours: Number(snapshot?.cooldownHours ?? 4) || 4,
      statusKnown: snapshot?.statusKnown === true,
    };
  });
}

const landingFooterActionButtonClassName = "h-9 w-[90px] justify-center px-1.5 text-xs sm:h-10 sm:w-auto sm:min-w-fit sm:px-4 sm:text-sm";

export function LandingView({ appConfig = getDefaultGatewayConfig() }) {
  const frontendVersion = normalizeVersion(
    typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0"
  );
  const [loading, setLoading] = useState(false);
  const [regions, setRegions] = useState([
    createRegionState("area1", "节点1", normalizeRegionBaseUrl(import.meta.env.VITE_REGION_AREA1_URL)),
    createRegionState("area2", "节点2", normalizeRegionBaseUrl(import.meta.env.VITE_REGION_AREA2_URL)),
    createRegionState("area3", "节点3", normalizeRegionBaseUrl(import.meta.env.VITE_REGION_AREA3_URL)),
  ]);
  const { changelogOpen, openChangelog, setChangelogOpen } = useChangelogDialog(frontendVersion);

  async function refreshAllRegions() {
    setLoading(true);
    try {
      const response = await fetch(buildLandingRegionsUrl(frontendVersion), {
        cache: "no-store",
      });
      const data = await response.json();
      const snapshotMap = new Map(
        (Array.isArray(data?.regions) ? data.regions : []).map((region) => [region.key, region])
      );
      setRegions((current) => applyLandingRegionSnapshot(snapshotMap, frontendVersion, current));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      console.error("Failed to refresh landing regions", error);
      setRegions((current) => applyLandingRegionSnapshot(new Map(), frontendVersion, current));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshAllRegions();
  }, []);

  const regionCards = useMemo(
    () =>
      regions.map((region) => {
        const hasConfig = Boolean(region.baseUrl);
        const statusKnown = hasConfig && region.statusKnown === true;
        const isCoolingDown = hasConfig && Number(region.cooldownUntil ?? 0) > Date.now();
        const statusTone = !hasConfig ? "muted" : !statusKnown ? "muted" : isCoolingDown ? "warning" : "ok";
        const statusTitle = !hasConfig
          ? "未配置节点"
          : !statusKnown
            ? "状态暂不可知"
            : isCoolingDown
              ? `仅Manbo可用，Missevan受限冷却${formatCooldownRemaining(region.cooldownUntil)}`
              : "可直接进入";

        return {
          ...region,
          canOpen: hasConfig,
          isCoolingDown,
          statusKnown,
          statusTone,
          statusTitle,
          versionText: hasConfig ? normalizeVersion(region.version) : "--",
          cooldownText: !hasConfig ? "未配置" : !statusKnown ? "暂时无法获取" : statusTitle,
          actionLabel: hasConfig ? `进入${region.label}` : "暂不可用",
        };
      }),
    [regions]
  );

  const recommendedRegion = useMemo(() => {
    const availableRegions = regionCards.filter(
      (region) => region.canOpen && region.statusKnown && !region.isCoolingDown
    );
    if (availableRegions.length > 0) {
      return pickPreferredRegion(availableRegions);
    }
    const configuredRegions = regionCards.filter(
      (region) => region.canOpen && region.statusKnown
    );
    if (configuredRegions.length > 0) {
      return pickPreferredRegion(configuredRegions);
    }
    return null;
  }, [regionCards]);

  function openRegion(region) {
    if (!region?.baseUrl || typeof window === "undefined") {
      return;
    }
    window.location.assign(buildRegionEntryUrl(region.baseUrl));
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 sm:py-8">
      <Card>
        <CardContent className="relative flex flex-col gap-6 p-6 sm:p-7">
          <div className="relative space-y-3">
            <div className="text-[0.7rem] font-semibold uppercase tracking-[0.32em] text-primary">
              M&amp;M Toolkit
            </div>
            <div className="inline-flex max-w-3xl items-center gap-3 text-2xl font-semibold leading-none tracking-tight sm:text-[2.55rem]">
              <AppIcon className="size-10 self-center rounded-xl sm:size-12" />
              <span className="min-w-0 leading-none">{appConfig?.titleZh || "小猫小狐数据分析"}</span>
            </div>
          </div>

          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              {regionCards.map((region) => {
                const isRecommended = recommendedRegion?.key === region.key;
                return (
                  <div
                    key={`${region.key}-summary`}
                    className={`rounded-[calc(var(--radius)+0.05rem)] border px-4 py-3 ${
                      isRecommended
                        ? "border-primary bg-primary text-primary-foreground shadow-[var(--shadow-control)]"
                        : region.statusTone === "warning"
                          ? "border-[var(--border-warm)] bg-[var(--surface-destructive)]"
                        : region.statusTone === "ok"
                            ? "border-border bg-accent"
                          : region.statusTone === "muted"
                            ? "border-border bg-card"
                          : "border-border bg-[var(--surface-subtle)]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className={`text-[0.68rem] font-semibold uppercase tracking-[0.24em] ${isRecommended ? "text-white/76" : "text-muted-foreground"}`}>
                        {region.label}
                      </div>
                      <div className={`text-[0.8rem] font-medium ${isRecommended ? "text-white/76" : "text-muted-foreground"}`}>
                        v{region.versionText}
                      </div>
                    </div>
                    <div className={`mt-2 text-sm leading-6 ${isRecommended ? "text-white" : "text-foreground/88"}`}>{region.cooldownText}</div>
                    <Button
                      variant="link"
                      size="sm"
                      className={`mt-2 h-auto px-0 font-semibold underline underline-offset-4 ${isRecommended ? "text-primary-foreground hover:text-primary-foreground/85" : "text-primary"} disabled:text-muted-foreground`}
                      disabled={!region.canOpen}
                      onClick={() => openRegion(region)}
                    >
                      {region.actionLabel}
                    </Button>
                  </div>
                );
              })}
            </div>

            <div className="relative flex flex-row flex-wrap justify-end gap-2.5">
              {appConfig.featureSuggestionUrl ? (
                <Button variant="outline" className={landingFooterActionButtonClassName} asChild>
                  <a href={appConfig.featureSuggestionUrl} rel="noreferrer" target="_blank">
                    <MessageSquarePlusIcon data-icon="inline-start" />
                    功能建议
                  </a>
                </Button>
              ) : null}
              <ChangelogButton className={landingFooterActionButtonClassName} size="default" onClick={openChangelog} />
              <Button variant="outline" className={landingFooterActionButtonClassName} disabled={loading} onClick={refreshAllRegions}>
                <RefreshCcwIcon data-icon="inline-start" className={loading ? "animate-spin" : ""} />
                {loading ? "正在刷新..." : "刷新状态"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <ChangelogDialog open={changelogOpen} onOpenChange={setChangelogOpen} />
    </div>
  );
}
