import { StrictMode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { useToolNavigation } from "@/app/useToolNavigation";

const appConfig = {
  brandName: "M&M Toolkit",
  desktopApp: false,
  missevanEnabled: true,
  titleZh: "M&M Toolkit",
};

beforeEach(() => {
  window.history.replaceState({}, "", "/tool");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function StrictModeWrapper({ children }) {
  return <StrictMode>{children}</StrictMode>;
}

test("consecutive navigation in one act uses the latest route state", () => {
  const { result } = renderHook(() => useToolNavigation({
    appConfig,
    initialAppConfig: appConfig,
  }));

  act(() => {
    result.current.navigateToolRoute({
      platform: "manbo",
      q: "first query",
      view: "search",
    });
    result.current.navigateToolRoute({ q: "second query" });
  });

  expect(result.current.toolRouteState).toMatchObject({
    platform: "manbo",
    q: "second query",
    view: "search",
  });
  expect(new URL(window.location.href).searchParams.get("q")).toBe("second query");
  expect(new URL(window.location.href).searchParams.get("platform")).toBe("manbo");
});

test("a PopStateEvent restores the route and requests a fresh search restore", () => {
  window.history.replaceState({}, "", "/tool?view=search&q=before&platform=missevan");
  const { result } = renderHook(() => useToolNavigation({
    appConfig,
    initialAppConfig: appConfig,
  }), { wrapper: StrictModeWrapper });

  expect(result.current.searchRouteRestoreGeneration).toBe(0);
  expect(result.current.searchRouteRestoreKeyword).toBe("before");

  window.history.replaceState({}, "", "/tool?view=search&q=restored&platform=manbo");
  act(() => {
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

  expect(result.current.toolRouteState).toMatchObject({
    platform: "manbo",
    q: "restored",
    view: "search",
  });
  expect(result.current.searchRouteRestoreKeyword).toBe("restored");
  expect(result.current.searchRouteRestoreGeneration).toBe(1);
});

test("an app-config correction updates its ref and replaces an invalid desktop route", () => {
  const webConfig = {
    ...appConfig,
    titleZh: "Web Toolkit",
  };
  const desktopConfig = {
    ...webConfig,
    desktopApp: true,
    titleZh: "Desktop Toolkit",
  };
  const replaceState = vi.spyOn(window.history, "replaceState");
  const { result, rerender } = renderHook(
    ({ currentAppConfig }) => useToolNavigation({
      appConfig: currentAppConfig,
      initialAppConfig: webConfig,
    }),
    { initialProps: { currentAppConfig: webConfig } }
  );

  expect(result.current.currentPlatform).toBe("home");

  rerender({ currentAppConfig: desktopConfig });

  expect(result.current.appConfigRef.current).toBe(desktopConfig);
  expect(result.current.currentPlatform).toBe("search");
  expect(result.current.currentPlatformRef.current).toBe("search");
  expect(document.title).toBe("Desktop Toolkit");
  expect(new URL(window.location.href).searchParams.get("view")).toBe("search");
  expect(replaceState).toHaveBeenCalledWith(
    expect.objectContaining({
      toolRoute: expect.objectContaining({ view: "search" }),
    }),
    "",
    expect.stringContaining("view=search")
  );
});
