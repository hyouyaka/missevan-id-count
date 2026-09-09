import { randomUUID } from "node:crypto";

import {
  ImageProxyPolicyError,
  validateImageProxyUrl,
} from "../../shared/imageProxyPolicy.js";

export function registerImageProxyRoutes(router, {
  fetchImageBufferWithRetry,
  formatImageProxyError,
  imageProxyLimiter,
  isAllowedImageHost,
  logger,
}) {
  router.get("/image-proxy", imageProxyLimiter, async (req, res) => {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({
        success: false,
        code: "INVALID_IMAGE_URL",
        message: "缺少图片地址。",
      });
    }

    let targetUrl;
    try {
      targetUrl = validateImageProxyUrl(url, isAllowedImageHost);
    } catch (error) {
      return res.status(error?.status || 400).json({
        success: false,
        code: error?.code || "INVALID_IMAGE_URL",
        message: "图片地址无效。",
      });
    }

    const operationId = randomUUID();
    const operationStartedAt = Date.now();
    try {
      const { attempts, buffer, contentType } = await fetchImageBufferWithRetry(targetUrl);
      void logger.operation("image_proxy_fetch", {
        operationId,
        endpoint: targetUrl.pathname,
        targetHost: targetUrl.hostname,
        attempts,
        responseBytes: buffer.byteLength,
        contentType,
        durationMs: Date.now() - operationStartedAt,
        success: true,
      });
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.send(buffer);
    } catch (error) {
      const attempts = error?.attempts ?? 1;
      const summary = formatImageProxyError(error);
      void logger.operation("image_proxy_fetch", {
        operationId,
        endpoint: targetUrl.pathname,
        targetHost: targetUrl.hostname,
        attempts,
        errorMessage: summary,
        durationMs: Date.now() - operationStartedAt,
        success: false,
      }, "warn");
      const isPolicyError = error instanceof ImageProxyPolicyError;
      const status = isPolicyError ? error.status : 502;
      const code = error?.code === "IMAGE_TOO_LARGE"
        ? "IMAGE_TOO_LARGE"
        : error?.code === "IMAGE_TYPE_UNSUPPORTED"
          ? "IMAGE_TYPE_UNSUPPORTED"
          : "IMAGE_PROXY_FAILED";
      const message = code === "IMAGE_TOO_LARGE"
        ? "图片大小超过 10 MiB 限制。"
        : code === "IMAGE_TYPE_UNSUPPORTED"
          ? "图片类型不受支持。"
          : "图片代理请求失败。";
      return res.status(status).json({
        success: false,
        code,
        message,
      });
    }
  });
}
