export function registerStatsRoutes(router, {
  adminCacheRefreshToken,
  buildRanksResponseMeta,
  buildRankTrendAvailabilityResponse,
  buildStatsTaskSnapshot,
  createStatsTaskFromRequest,
  executeAdminCacheRefresh,
  getCachedCvRankTrendResponse,
  getCachedOngoingResponse,
  getCachedRankTrendAggregateSnapshot,
  getCachedWeeklyPlaybackSnapshot,
  getCachedRankTrendResponse,
  getCachedRanksResponse,
  getRanksResponseCacheValidator,
  getStatsTaskSnapshotOr404,
  isNumericId,
  isRankTrendAggregateSnapshot,
  ongoingResponseSchemaVersion,
  rankTrendsResponseSchemaVersion,
  refreshMissevanCooldownState,
  statsTaskCreationLimiter,
  statsTaskEngine,
}) {
  function setNoStoreHeaders(res) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }

  router.get("/ranks/trends/availability", async (req, res) => {
    const platform = String(req.query.platform ?? "").trim();
    const rawIds = Array.isArray(req.query.id) ? req.query.id : [req.query.id];
    const ids = rawIds.map((id) => String(id ?? "").trim()).filter(Boolean);
    const hasValidIds = platform === "manbo"
      ? ids.length > 0 && ids.every((id) => isNumericId(id))
      : ids.length > 0;
    if (!["missevan", "manbo"].includes(platform) || !hasValidIds) {
      return res.status(400).json({
        success: false,
        message: "Invalid rank trend availability request",
      });
    }

    try {
      let aggregateSnapshot = null;
      try {
        aggregateSnapshot = await getCachedRankTrendAggregateSnapshot(platform);
      } catch (_) {
        aggregateSnapshot = null;
      }
      let response = buildRankTrendAvailabilityResponse({
        platform,
        ids,
        aggregateSnapshot,
      });
      if (!response.success || response.ids.length < ids.length) {
        let weeklyPlaybackSnapshot = null;
        try {
          weeklyPlaybackSnapshot = await getCachedWeeklyPlaybackSnapshot(platform);
        } catch (_) {
          weeklyPlaybackSnapshot = null;
        }
        if (!isRankTrendAggregateSnapshot(aggregateSnapshot, platform) && !weeklyPlaybackSnapshot) {
          return res.status(503).json({
            success: false,
            platform,
            latestDate: "",
            availability: {},
            message: "Rank trend aggregate is unavailable",
          });
        }
        response = buildRankTrendAvailabilityResponse({
          platform,
          ids,
          aggregateSnapshot,
          weeklyPlaybackSnapshot,
        });
      }
      if (response && typeof response === "object") {
        response.schemaVersion = rankTrendsResponseSchemaVersion;
      }
      if (!response.success) {
        return res.status(response.status || 503).json(response);
      }

      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      if (response.latestDate) {
        res.setHeader("X-Ranks-Trend-Latest-Date", response.latestDate);
      }
      return res.json(response);
    } catch (error) {
      console.error("Failed to read rank trend availability", error);
      return res.status(503).json({
        success: false,
        message: "Rank trend availability is unavailable",
      });
    }
  });

  router.get("/ranks/trends", async (req, res) => {
    const platform = String(req.query.platform ?? "").trim();
    const dramaId = String(req.query.id ?? "").trim();
    const kind = String(req.query.kind ?? "").trim();
    if (kind === "cv") {
      if (!dramaId) {
        return res.status(400).json({
          success: false,
          message: "Invalid rank trend request",
        });
      }
      try {
        const response = await getCachedCvRankTrendResponse(dramaId);
        if (!response.success) {
          return res.status(response.status || 404).json(response);
        }
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        if (response.latestDate) {
          res.setHeader("X-Ranks-Trend-Latest-Date", response.latestDate);
          res.setHeader(
            "ETag",
            `"ranks-trend-cv-${Buffer.from(`${dramaId}:${response.latestDate}`).toString("base64url")}"`
          );
        }
        return res.json(response);
      } catch (error) {
        console.error("Failed to read CV ranks trend", error);
        return res.status(503).json({
          success: false,
          message: "Rank trends are unavailable",
        });
      }
    }

    const isValidDramaId =
      (platform === "missevan" && dramaId) ||
      (platform === "manbo" && isNumericId(dramaId));
    if (!["missevan", "manbo"].includes(platform) || !isValidDramaId) {
      return res.status(400).json({
        success: false,
        message: "Invalid rank trend request",
      });
    }

    try {
      const response = await getCachedRankTrendResponse(platform, dramaId, kind);
      if (!response.success) {
        return res.status(response.status || 404).json(response);
      }
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      if (response.latestDate) {
        res.setHeader("X-Ranks-Trend-Latest-Date", response.latestDate);
        res.setHeader(
          "ETag",
          `"ranks-trend-${platform}-${Buffer.from(`${dramaId}:${response.latestDate}`).toString("base64url")}"`
        );
      }
      return res.json(response);
    } catch (error) {
      console.error("Failed to read ranks trend", error);
      return res.status(503).json({
        success: false,
        message: "Rank trends are unavailable",
      });
    }
  });

  router.get("/ongoing", async (req, res) => {
    const platform = String(req.query.platform ?? "").trim();
    if (!["missevan", "manbo"].includes(platform)) {
      return res.status(400).json({
        success: false,
        message: "Invalid ongoing platform",
      });
    }

    try {
      const response = await getCachedOngoingResponse(platform);
      if (!response.success) {
        return res.status(response.status || 404).json(response);
      }
      res.setHeader("Cache-Control", "no-store");
      if (response.latestDate) {
        res.setHeader("X-Ongoing-Latest-Date", response.latestDate);
        const etagSource = [
          ongoingResponseSchemaVersion,
          platform,
          response.latestDate,
          response.updatedAt || "",
          Array.isArray(response.items) ? response.items.length : 0,
        ].join(":");
        res.setHeader(
          "ETag",
          `"ongoing-${Buffer.from(etagSource).toString("base64url")}"`
        );
      }
      return res.json(response);
    } catch (error) {
      console.error("Failed to read ongoing dramas", error);
      return res.status(503).json({
        success: false,
        platform,
        updatedAt: "",
        latestDate: "",
        windows: {},
        items: [],
        message: "Ongoing dramas are unavailable",
      });
    }
  });

  router.get("/ranks", async (req, res) => {
    try {
      const { response, cacheStatus, probePhase } = await getCachedRanksResponse();
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
      res.setHeader("X-Ranks-Cache-Status", cacheStatus || "hit");
      res.setHeader("X-Ranks-Normal-Updated-At", response.updatedAt || "");
      res.setHeader("X-Ranks-CV-Updated-At", response.cvSummary?.updatedAt || "");
      if (probePhase) {
        res.setHeader("X-Ranks-Probe-Phase", probePhase);
      }
      const ranksResponseValidator = getRanksResponseCacheValidator(response);
      if (response.updatedAt) {
        res.setHeader("X-Ranks-Updated-At", response.updatedAt);
        res.setHeader("ETag", `"ranks-${Buffer.from(ranksResponseValidator).toString("base64url")}"`);
      }
      return res.json(response);
    } catch (error) {
      console.error("Failed to read ranks snapshot", error);
      return res.status(503).json({
        success: false,
        updatedAt: "",
        cvSummary: { updatedAt: "", missevanDramaCount: 0, manboDramaCount: 0 },
        meta: buildRanksResponseMeta(null),
        platforms: {
          missevan: { key: "missevan", label: "猫耳", categories: [] },
          manbo: { key: "manbo", label: "漫播", categories: [] },
        },
        message: "Ranks are unavailable",
      });
    }
  });

  router.post("/admin/cache/refresh", async (req, res) => {
    const result = await executeAdminCacheRefresh({
      authorization: req.get("Authorization"),
      body: req.body,
    });
    return res.status(result.status).json(result.payload);
  });

  router.get("/admin/task-metrics", (req, res) => {
    if (!adminCacheRefreshToken) {
      return res.status(503).json({
        success: false,
        code: "ADMIN_TOKEN_NOT_CONFIGURED",
        message: "管理员令牌未配置。",
      });
    }
    if (req.get("Authorization") !== `Bearer ${adminCacheRefreshToken}`) {
      return res.status(401).json({
        success: false,
        code: "ADMIN_UNAUTHORIZED",
        message: "管理员鉴权失败。",
      });
    }
    return res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      ...statsTaskEngine.getMetrics(),
    });
  });

  router.get("/health", (req, res) => {
    res.json({ ok: true });
  });

  router.post("/stat-tasks", statsTaskCreationLimiter, async (req, res) => {
    await statsTaskEngine.whenReady();
    if ((req.body?.platform === "manbo" ? "manbo" : "missevan") === "missevan") {
      await refreshMissevanCooldownState();
    }
    const task = createStatsTaskFromRequest(req, res);
    if (!task) {
      return;
    }
    return res.json(buildStatsTaskSnapshot(task));
  });

  router.get("/stat-tasks/:taskId", async (req, res) => {
    await statsTaskEngine.whenReady();
    const snapshot = getStatsTaskSnapshotOr404(req.params.taskId, res, { touch: true });
    if (!snapshot) {
      return;
    }
    setNoStoreHeaders(res);
    return res.json(snapshot);
  });

  router.post("/stat-tasks/:taskId/cancel", async (req, res) => {
    await statsTaskEngine.whenReady();
    const current = getStatsTaskSnapshotOr404(req.params.taskId, res);
    if (!current) {
      return;
    }
    const result = statsTaskEngine.cancel(req.params.taskId);
    return res.json(result.snapshot);
  });

  router.post("/manbo/stat-tasks", statsTaskCreationLimiter, async (req, res) => {
    await statsTaskEngine.whenReady();
    const task = createStatsTaskFromRequest(req, res, "manbo", "id");
    if (!task) {
      return;
    }
    return res.json(buildStatsTaskSnapshot(task));
  });

  router.get("/manbo/stat-tasks/:taskId", async (req, res) => {
    await statsTaskEngine.whenReady();
    const snapshot = getStatsTaskSnapshotOr404(req.params.taskId, res, { touch: true });
    if (!snapshot) {
      return;
    }
    setNoStoreHeaders(res);
    return res.json(snapshot);
  });

  router.post("/manbo/stat-tasks/:taskId/cancel", async (req, res) => {
    await statsTaskEngine.whenReady();
    const current = getStatsTaskSnapshotOr404(req.params.taskId, res);
    if (!current) {
      return;
    }
    const result = statsTaskEngine.cancel(req.params.taskId);
    return res.json(result.snapshot);
  });
}
