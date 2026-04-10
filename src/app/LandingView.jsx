import { useEffect, useMemo, useState } from "react";
import { RefreshCcwIcon } from "lucide-react";

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
      <Card className="border-white/65 bg-[rgba(255,252,247,0.98)] shadow-[0_24px_56px_-42px_rgba(30,32,41,0.16)]">
        <CardContent className="relative flex flex-col gap-6 p-6 sm:p-7">
          <div className="pointer-events-none absolute left-6 top-0 h-24 w-[min(36rem,calc(100%-3rem))] rounded-b-[2rem] bg-[linear-gradient(90deg,rgba(59,62,122,0.14),rgba(239,131,95,0.16)_48%,transparent)] blur-sm sm:w-[min(40rem,calc(100%-3.5rem))]" />
          <div className="relative space-y-3">
            <div className="text-[0.7rem] font-semibold uppercase tracking-[0.32em] text-[rgb(59,62,122)]">
              M&amp;M Toolkit
            </div>
            <div className="max-w-3xl text-2xl font-semibold tracking-tight sm:text-[2.55rem]">
              {appConfig?.titleZh || "小猫小狐数据分析"}
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
                        ? "border-[rgba(59,62,122,0.24)] bg-[rgb(59,62,122)] text-white shadow-[0_18px_34px_-24px_rgba(59,62,122,0.42)]"
                        : region.statusTone === "warning"
                          ? "border-[rgba(239,131,95,0.3)] bg-[rgba(255,240,233,0.9)]"
                        : region.statusTone === "ok"
                            ? "border-[rgba(59,62,122,0.18)] bg-[rgba(243,241,251,0.92)]"
                          : region.statusTone === "muted"
                            ? "border-border/80 bg-[rgba(255,252,247,0.88)]"
                          : "border-[rgba(30,32,41,0.08)] bg-[rgba(241,236,228,0.82)]"
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
                      className={`mt-2 h-auto px-0 font-semibold underline underline-offset-4 ${isRecommended ? "text-white hover:text-white/86" : "text-[rgb(59,62,122)]"} disabled:text-muted-foreground`}
                      disabled={!region.canOpen}
                      onClick={() => openRegion(region)}
                    >
                      {region.actionLabel}
                    </Button>
                  </div>
                );
              })}
            </div>

            <div className="relative flex flex-col gap-2.5 sm:flex-row sm:justify-end">
              <Button variant="outline" className="h-10 px-4" disabled={loading} onClick={refreshAllRegions}>
                <RefreshCcwIcon data-icon="inline-start" className={loading ? "animate-spin" : ""} />
                {loading ? "正在刷新..." : "刷新状态"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
