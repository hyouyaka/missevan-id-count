import { normalizePlatformClientError } from "./clientErrors.js";

function requireMethod(dependencies, name) {
  if (typeof dependencies?.[name] !== "function") {
    throw new TypeError(`Manbo client requires ${name}`);
  }
  return dependencies[name];
}

async function invoke(method, args) {
  try {
    return await method(...args);
  } catch (error) {
    throw normalizePlatformClientError(error);
  }
}

export function createManboClient(dependencies = {}) {
  return {
    getDramaDetail(dramaId, options = {}) {
      return invoke(requireMethod(dependencies, "dramaDetail"), [dramaId, options]);
    },
    getSetDetail(setId, options = {}) {
      return invoke(requireMethod(dependencies, "setDetail"), [setId, options]);
    },
    getDanmakuSummary(setId, dramaTitle, episodeTitle = "", source = "", options = {}) {
      return invoke(requireMethod(dependencies, "danmakuSummary"), [
        setId,
        dramaTitle,
        episodeTitle,
        source,
        options,
      ]);
    },
  };
}
