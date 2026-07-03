export function createDramaService({ missevanClient, manboClient } = {}) {
  return {
    getMissevanDrama(dramaId, options = {}) {
      return missevanClient.getDramaInfo(dramaId, null, options);
    },
    getManboDrama(dramaId, options = {}) {
      return manboClient.getDramaDetail(dramaId, options);
    },
  };
}
