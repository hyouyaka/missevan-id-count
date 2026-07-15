import { useEffect, useMemo, useRef, useState } from "react";

import { ToolView } from "@/app/ToolView";
import { Card, CardContent } from "@/components/ui/card";
import {
  buildVersionedUrl,
  getBackendVersionFromResponse,
  getDefaultAppConfig,
  mergeAppConfig,
  normalizeVersion,
} from "@/app/app-utils";

export function RootApp() {
  const [configReady, setConfigReady] = useState(false);
  const [appConfig, setAppConfig] = useState(getDefaultAppConfig());
  const initialAppConfigRef = useRef(appConfig);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const initialAppConfig = initialAppConfigRef.current;
        const response = await fetch(buildVersionedUrl("/app-config", initialAppConfig.frontendVersion), {
          cache: "no-store",
        });
        if (response.ok) {
          const config = await response.json();
          const nextConfig = mergeAppConfig(initialAppConfig, {
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
          setConfigReady(true);
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

  if (configReady) {
    return <ToolView initialAppConfig={versionedConfig} />;
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
