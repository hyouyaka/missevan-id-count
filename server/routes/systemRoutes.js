export function registerSystemRoutes(router, {
  appVersion,
  desktopApp,
  desktopAppUrl,
  feedbackEnabled,
  getFrontendVersionFromRequest,
  getMissevanAccessDeniedCooldownUntil,
  logger,
  missevanCooldownHours,
  missevanEnabled,
  normalizeTextValue,
  buildFavoriteMetaFromInfoStore,
}) {
  router.get("/app-config", (req, res) => {
    const frontendVersion = getFrontendVersionFromRequest(req);
    res.json({
      missevanEnabled,
      desktopApp,
      brandName: missevanEnabled ? "MMTOOLKIT.APP" : "Manbo Toolkit",
      titleZh: missevanEnabled ? "小猫小狐工具箱" : "小狐分析",
      description: missevanEnabled
        ? "支持 Missevan 与 Manbo 的作品导入、分集筛选、弹幕统计和数据汇总。"
        : "支持 Manbo 平台的作品导入、分集筛选、弹幕统计和去重 ID 汇总。",
      cooldownHours: missevanCooldownHours,
      cooldownUntil: getMissevanAccessDeniedCooldownUntil(),
      desktopAppUrl: desktopAppUrl,
      feedbackEnabled: Boolean(feedbackEnabled),
      frontendVersion,
      versionMismatch: frontendVersion !== appVersion,
    });
  });

  if (desktopApp) return;

  router.get("/favorites/meta", async (req, res) => {
    const platform = normalizeTextValue(req.query.platform);
    const dramaId = normalizeTextValue(req.query.dramaId ?? req.query.id);
    try {
      const meta = await buildFavoriteMetaFromInfoStore(platform, dramaId);
      if (!meta) {
        return res.json({ success: false, mainCvText: "" });
      }
      return res.json({ success: true, ...meta });
    } catch (error) {
      logger.error("favorite_meta_read_failed", error, { route: "/favorites/meta" });
      return res.status(500).json({ success: false, message: "收藏元数据读取失败", mainCvText: "" });
    }
  });
}
