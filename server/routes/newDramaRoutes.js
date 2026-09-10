export function registerNewDramaRoutes(router, {
  filterUntrackedNewDramaIds,
  logger,
  normalizeNewDramaIdsForPlatform,
  queueNewDramaIdsAppend,
}) {
  router.post("/register-new-drama-ids", async (req, res) => {
    const platform = req.body?.platform;

    if (!["missevan", "manbo"].includes(platform)) {
      return res.status(400).json({
        success: false,
        message: "Invalid platform",
      });
    }

    const dramaIds = normalizeNewDramaIdsForPlatform(platform, req.body?.drama_ids || []);

    if (!dramaIds.length) {
      return res.json({
        success: true,
        count: 0,
      });
    }

    try {
      const missingDramaIds = await filterUntrackedNewDramaIds(platform, dramaIds);
      if (missingDramaIds.length > 0) {
        await queueNewDramaIdsAppend(platform, missingDramaIds);
      }
      return res.json({
        success: true,
        count: missingDramaIds.length,
      });
    } catch (error) {
      void logger.error("new_drama_ids_register_failed", error, { platform });
      return res.status(500).json({
        success: false,
        message: "Failed to register drama ids",
      });
    }
  });
}
