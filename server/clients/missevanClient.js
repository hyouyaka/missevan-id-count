import { normalizePlatformClientError } from "./clientErrors.js";

function requireMethod(dependencies, name) {
  if (typeof dependencies?.[name] !== "function") {
    throw new TypeError(`Missevan client requires ${name}`);
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

export function createMissevanClient(dependencies = {}) {
  return {
    getSoundSummary(soundId, options = {}) {
      return invoke(requireMethod(dependencies, "soundSummary"), [soundId, options]);
    },
    getDramaInfo(dramaId, soundId = null, options = {}) {
      return invoke(requireMethod(dependencies, "dramaInfo"), [dramaId, soundId, options]);
    },
    getDanmakuSummary(soundId, dramaTitle, episodeTitle = "", source = "", options = {}) {
      return invoke(requireMethod(dependencies, "danmakuSummary"), [
        soundId,
        dramaTitle,
        episodeTitle,
        source,
        options,
      ]);
    },
    getRewardSummary(dramaId, options = {}) {
      return invoke(requireMethod(dependencies, "rewardSummary"), [dramaId, options]);
    },
    getRewardDetailMeta(dramaId, options = {}) {
      return invoke(requireMethod(dependencies, "rewardDetailMeta"), [dramaId, options]);
    },
  };
}
