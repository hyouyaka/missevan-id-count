import { useEffect, useMemo, useState } from "react";

import { LandingView } from "@/app/LandingView";
import { ToolView } from "@/app/ToolView";
import { Card, CardContent } from "@/components/ui/card";
import {
  buildVersionedUrl,
  getBackendVersionFromResponse,
  getDefaultAppConfig,
  mergeAppConfig,
  normalizeVersion,
} from "@/app/app-utils";

function getCurrentPath() {
  if (typeof window === "undefined") {
    return "/";
  }
  return String(window.location.pathname || "/").replace(/\/+$/, "") || "/";
}

function isToolPath() {
  return getCurrentPath() === "/tool";
}

function isProbablyDesktopShell() {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /Electron/i.test(String(navigator.userAgent || ""));
}

export function RootApp() {
  const [resolvedView, setResolvedView] = useState("");
  const [appConfig, setAppConfig] = useState(getDefaultAppConfig());

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const response = await fetch(buildVersionedUrl("/app-config", appConfig.frontendVersion), {
          cache: "no-store",
        });
        if (response.ok) {
          const config = await response.json();
          const nextConfig = mergeAppConfig(appConfig, {
            ...config,
            backendVersion: getBackendVersionFromResponse(response, config),
          });
          if (!cancelled) {
            setAppConfig(nextConfig);
          }
        }
      } catch (_) {
      } finally {
        if (!cancelled) {
          setResolvedView(isToolPath() || isProbablyDesktopShell() ? "tool" : "landing");
        }
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const versionedConfig = useMemo(
    () => ({
      ...appConfig,
      frontendVersion: normalizeVersion(appConfig.frontendVersion),
    }),
    [appConfig]
  );

  if (resolvedView === "tool") {
    return <ToolView initialAppConfig={versionedConfig} />;
  }

  if (resolvedView === "landing") {
    return <LandingView appConfig={versionedConfig} />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md border-white/55 bg-[rgba(245,240,230,0.9)] shadow-xl shadow-[0_18px_40px_-28px_rgba(54,54,54,0.18)] backdrop-blur">
        <CardContent className="flex flex-col gap-2 p-6">
          <div className="text-xl font-semibold">正在加载入口</div>
          <p className="text-sm leading-6 text-muted-foreground">
            正在读取当前环境并选择合适的页面。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
