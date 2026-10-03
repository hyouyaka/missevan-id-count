import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  buildVersionedUrl,
  getBackendVersionFromResponse,
  getDefaultAppConfig,
  mergeAppConfig,
  normalizeVersion,
} from "@/app/app-utils";

const WebToolView = lazy(() => import("@/app/ToolView").then((module) => ({ default: module.ToolView })));
const DesktopStatisticsView = lazy(() => import("@/app/DesktopStatisticsView"));

function hasTrustedDesktopMarker() {
  return typeof window !== "undefined" && window.mmToolkit?.desktopApp === true;
}

export function RootApp() {
  const [configReady, setConfigReady] = useState(false);
  const desktopMarkerRef = useRef(hasTrustedDesktopMarker());
  const mountedRef = useRef(false);
  const bootstrapRequestRef = useRef(0);
  const bootstrapAbortRef = useRef(null);
  const [configError, setConfigError] = useState(false);
  const [appConfig, setAppConfig] = useState(() => ({
    ...getDefaultAppConfig(),
    desktopApp: desktopMarkerRef.current,
    missevanEnabled: desktopMarkerRef.current ? true : getDefaultAppConfig().missevanEnabled,
    feedbackEnabled: desktopMarkerRef.current ? false : getDefaultAppConfig().feedbackEnabled,
  }));
  const initialAppConfigRef = useRef(appConfig);

  const bootstrap = useCallback(async () => {
    bootstrapAbortRef.current?.abort();
    const controller = new AbortController();
    bootstrapAbortRef.current = controller;
    const requestId = bootstrapRequestRef.current + 1;
    bootstrapRequestRef.current = requestId;
    setConfigError(false);
    setConfigReady(false);
    try {
      const initialAppConfig = initialAppConfigRef.current;
      const response = await fetch(buildVersionedUrl("/app-config", initialAppConfig.frontendVersion), {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`入口配置读取失败：${response.status}`);
      }
      const config = await response.json();
      if (!mountedRef.current || requestId !== bootstrapRequestRef.current) return;
      const nextConfig = mergeAppConfig(initialAppConfig, {
        ...config,
        desktopApp: desktopMarkerRef.current || config?.desktopApp === true,
        missevanEnabled: desktopMarkerRef.current ? true : config?.missevanEnabled,
        feedbackEnabled: desktopMarkerRef.current ? false : config?.feedbackEnabled,
        backendVersion: getBackendVersionFromResponse(response, config),
      });
      setAppConfig(nextConfig);
      setConfigReady(true);
    } catch (error) {
      if (!mountedRef.current || requestId !== bootstrapRequestRef.current || error?.name === "AbortError") return;
      if (desktopMarkerRef.current) {
        setConfigError(true);
        setConfigReady(false);
      } else {
        setConfigReady(true);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void bootstrap();
    return () => {
      mountedRef.current = false;
      bootstrapAbortRef.current?.abort();
    };
  }, [bootstrap]);

  const versionedConfig = useMemo(
    () => ({
      ...appConfig,
      frontendVersion: normalizeVersion(appConfig.frontendVersion),
    }),
    [appConfig]
  );

  if (configReady) {
    const View = versionedConfig.desktopApp ? DesktopStatisticsView : WebToolView;
    return (
      <Suspense fallback={(
        <div className="flex min-h-screen items-center justify-center px-4 py-10">
          <Card className="w-full max-w-md"><CardContent className="p-6 text-sm text-muted-foreground">正在准备计算与统计界面。</CardContent></Card>
        </div>
      )}>
        <View initialAppConfig={versionedConfig} />
      </Suspense>
    );
  }

  if (configError) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-10">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col gap-3 p-6">
            <div className="text-xl font-semibold">无法读取桌面版入口配置</div>
            <p className="text-sm leading-6 text-muted-foreground">本机服务暂时没有响应，请检查本机服务后重试。</p>
            <Button type="button" className="self-start" onClick={() => void bootstrap()}>重试</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md">
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
