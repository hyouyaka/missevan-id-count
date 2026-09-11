import { useEffect, useRef, useState } from "react";

import {
  areToolRouteStatesEqual,
  buildToolRouteUrl,
  normalizeToolRouteState,
  readToolRouteStateFromLocation,
} from "./app-utils.js";

export function createInitialToolViewOptions(initialAppConfig = {}) {
  return {
    desktopApp: initialAppConfig?.desktopApp === true,
    missevanEnabled: initialAppConfig?.missevanEnabled !== false,
  };
}

export function getInitialToolRouteState(options = {}) {
  if (typeof window === "undefined") {
    return normalizeToolRouteState({}, options);
  }
  return readToolRouteStateFromLocation(window.location, options);
}

function isDetailRoute(routeState) {
  return ["ongoing", "ranks", "cv"].includes(routeState?.view);
}

export function createToolNavigationController({
  buildRouteUrl = buildToolRouteUrl,
  getRouteOptions,
  getRouteState,
  getWindow = () => (typeof window === "undefined" ? null : window),
  normalizeRoute = normalizeToolRouteState,
  readRouteState = readToolRouteStateFromLocation,
  routesEqual = areToolRouteStatesEqual,
  setRouteState,
} = {}) {
  let pendingDetailRouteReplace = false;

  function applyCurrentPlatformFromUrl() {
    const browserWindow = getWindow();
    if (!browserWindow) {
      return getRouteState();
    }
    const nextRouteState = readRouteState(browserWindow.location, getRouteOptions());
    pendingDetailRouteReplace = false;
    setRouteState(nextRouteState);
    return nextRouteState;
  }

  function navigateToolRoute(patch, options = {}) {
    const currentRouteState = getRouteState();
    const nextRouteState = normalizeRoute(
      {
        ...currentRouteState,
        ...(patch || {}),
      },
      getRouteOptions()
    );
    const isDetailUpdate =
      currentRouteState.view === nextRouteState.view &&
      !routesEqual(currentRouteState, nextRouteState);
    const replace =
      options?.replace === true ||
      (pendingDetailRouteReplace && isDetailRoute(currentRouteState) && isDetailUpdate);

    if (routesEqual(currentRouteState, nextRouteState)) {
      return currentRouteState;
    }

    const browserWindow = getWindow();
    if (browserWindow) {
      const nextUrl = buildRouteUrl(browserWindow.location, nextRouteState, getRouteOptions());
      browserWindow.history[replace ? "replaceState" : "pushState"](
        { toolRoute: nextRouteState },
        "",
        nextUrl
      );
    }
    pendingDetailRouteReplace = options?.seedDetailReplace === true;
    setRouteState(nextRouteState);
    return nextRouteState;
  }

  function navigateCurrentPlatform(nextPlatform) {
    return navigateToolRoute(
      { view: nextPlatform },
      { seedDetailReplace: nextPlatform === "ongoing" || nextPlatform === "ranks" }
    );
  }

  return {
    applyCurrentPlatformFromUrl,
    getPendingDetailRouteReplace: () => pendingDetailRouteReplace,
    navigateCurrentPlatform,
    navigateToolRoute,
  };
}

export function useToolNavigation({ initialAppConfig, appConfig = {} } = {}) {
  const initialToolViewOptionsRef = useRef(createInitialToolViewOptions(initialAppConfig));
  const [toolRouteState, setToolRouteState] = useState(() =>
    getInitialToolRouteState(initialToolViewOptionsRef.current)
  );
  const initialToolRouteStateRef = useRef(toolRouteState);
  const toolRouteStateRef = useRef(toolRouteState);
  const currentPlatformRef = useRef(toolRouteState.view);
  const appConfigRef = useRef(appConfig);
  const [searchRouteRestoreGeneration, setSearchRouteRestoreGeneration] = useState(0);
  const [searchRouteRestoreKeyword, setSearchRouteRestoreKeyword] = useState(() =>
    toolRouteState.view === "search" ? toolRouteState.q : ""
  );
  const controllerRef = useRef(null);

  if (!controllerRef.current) {
    controllerRef.current = createToolNavigationController({
      getRouteOptions: () => appConfigRef.current,
      getRouteState: () => toolRouteStateRef.current,
      setRouteState(nextRouteState) {
        toolRouteStateRef.current = nextRouteState;
        currentPlatformRef.current = nextRouteState.view;
        setToolRouteState(nextRouteState);
      },
    });
  }

  const controller = controllerRef.current;

  useEffect(() => {
    function handleToolViewPopState() {
      const nextRouteState = controller.applyCurrentPlatformFromUrl();
      setSearchRouteRestoreKeyword(nextRouteState.view === "search" ? nextRouteState.q : "");
      setSearchRouteRestoreGeneration((current) => current + 1);
    }

    window.addEventListener("popstate", handleToolViewPopState);
    return () => {
      window.removeEventListener("popstate", handleToolViewPopState);
    };
  }, [controller]);

  useEffect(() => {
    appConfigRef.current = appConfig;
    if (typeof document !== "undefined") {
      document.title = appConfig.titleZh || appConfig.brandName;
    }
    const normalizedRoute = normalizeToolRouteState(toolRouteStateRef.current, appConfig);
    const currentRoute = toolRouteStateRef.current;
    if (!areToolRouteStatesEqual(normalizedRoute, currentRoute)) {
      controller.navigateToolRoute(normalizedRoute, { replace: true });
    }
  }, [appConfig, controller]);

  return {
    appConfigRef,
    applyCurrentPlatformFromUrl: controller.applyCurrentPlatformFromUrl,
    currentPlatform: toolRouteState.view,
    currentPlatformRef,
    initialToolRouteState: initialToolRouteStateRef.current,
    navigateCurrentPlatform: controller.navigateCurrentPlatform,
    navigateToolRoute: controller.navigateToolRoute,
    searchRouteRestoreGeneration,
    searchRouteRestoreKeyword,
    toolRouteState,
    toolRouteStateRef,
  };
}
