const HTTP_METHODS = [
  "all",
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "options",
  "head",
];
const wrappedHandlerSet = new WeakSet();

function wrapHandler(handler, cache) {
  if (typeof handler !== "function") {
    return handler;
  }
  if (wrappedHandlerSet.has(handler)) {
    return handler;
  }
  if (cache.has(handler)) {
    return cache.get(handler);
  }

  const invoke = (receiver, args, next) => {
    try {
      const result = handler.apply(receiver, args);
      if (result && typeof result.then === "function") {
        void Promise.resolve(result).catch(next);
      }
      return result;
    } catch (error) {
      return next(error);
    }
  };
  const wrapped = handler.length === 4
    ? function wrappedErrorHandler(error, req, res, next) {
        return invoke(this, [error, req, res, next], next);
      }
    : function wrappedRouteHandler(req, res, next) {
        return invoke(this, [req, res, next], next);
      };
  cache.set(handler, wrapped);
  wrappedHandlerSet.add(wrapped);
  return wrapped;
}

function wrapHandlers(value, cache) {
  return Array.isArray(value)
    ? value.map((handler) => wrapHandlers(handler, cache))
    : wrapHandler(value, cache);
}

function wrapRoute(route, cache) {
  for (const method of HTTP_METHODS) {
    const original = route[method];
    if (typeof original !== "function") {
      continue;
    }
    route[method] = function registerWrappedRouteHandlers(...handlers) {
      return original.apply(
        route,
        handlers.map((handler) => wrapHandlers(handler, cache))
      );
    };
  }
  return route;
}

/**
 * Add async rejection forwarding to a single Express app or router instance.
 * app.get("trust proxy") remains Express's setting lookup because a one
 * argument get call has no route handler to wrap and is passed through as-is.
 */
export function installAsyncRouteSupport(router) {
  if (!router || router.__asyncRouteSupportInstalled) {
    return false;
  }
  const cache = new WeakMap();
  const originalRoute = router.route.bind(router);
  router.route = (routePath) => wrapRoute(originalRoute(routePath), cache);
  for (const method of HTTP_METHODS) {
    const original = router[method];
    if (typeof original !== "function") {
      continue;
    }
    router[method] = function registerWrappedHandlers(...args) {
      if (method === "get" && args.length === 1) {
        return original.apply(router, args);
      }
      if (args.length < 2) {
        return original.apply(router, args);
      }
      return original.call(
        router,
        args[0],
        ...args.slice(1).map((handler) => wrapHandlers(handler, cache))
      );
    };
  }
  Object.defineProperty(router, "__asyncRouteSupportInstalled", {
    configurable: false,
    enumerable: false,
    value: true,
  });
  return true;
}
