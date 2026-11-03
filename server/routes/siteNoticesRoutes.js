import { timingSafeEqual } from "node:crypto";
import { SiteNoticesError } from "../services/siteNoticesStore.js";

export function registerSiteNoticesRoutes(router, { store, adminToken = "", adminLimiter, logger }) {
  const managementEnabled = Boolean(store.enabled && adminToken);
  void store.initialize().catch((error) => {
    void logger?.error("site_notices_load_failed", error);
  });

  function authorize(req, res, next) {
    if (!managementEnabled) {
      return res.status(503).json({ success: false, message: "公告管理尚未配置。" });
    }
    const supplied = Buffer.from(req.get("Authorization") || "");
    const expected = Buffer.from(`Bearer ${adminToken}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return res.status(401).json({ success: false, message: "管理员令牌无效。" });
    }
    return next();
  }

  function handle(operation) {
    return async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      try {
        const snapshot = await operation(req);
        return res.json({ success: true, ...snapshot });
      } catch (error) {
        const status = error instanceof SiteNoticesError ? error.status : 503;
        if (!(error instanceof SiteNoticesError)) {
          void logger?.error("site_notices_operation_failed", error, { route: req.path });
        }
        return res.status(status).json({ success: false,
          message: error instanceof SiteNoticesError ? error.message : "操作失败，请稍后重试；已发布内容保持不变。" });
      }
    };
  }

  const guards = [
    (req, res, next) => { res.setHeader("Cache-Control", "no-store"); return next(); },
    ...(adminLimiter ? [adminLimiter] : []),
    authorize,
  ];
  router.get("/feedback/notices", handle(() => store.read()));
  router.get("/admin/site-notices", ...guards, handle(() => store.read()));
  router.put("/admin/site-notices", ...guards, handle((req) => store.publish(req.body)));
  // Explicit recovery only; no automatic retries or periodic Redis version checks.
  router.post("/admin/site-notices/reload", ...guards, handle(() => store.reload()));
}
