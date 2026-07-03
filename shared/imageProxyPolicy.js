export class ImageProxyPolicyError extends Error {
  constructor(message, { status = 400, code = "INVALID_IMAGE_REQUEST" } = {}) {
    super(message);
    this.name = "ImageProxyPolicyError";
    this.status = status;
    this.code = code;
    this.retryable = false;
  }
}

export function detectImageContentType(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value ?? []);

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 6 &&
    ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))
  ) {
    return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (
    buffer.length >= 16 &&
    buffer.toString("ascii", 4, 8) === "ftyp"
  ) {
    const declaredBoxSize = buffer.readUInt32BE(0);
    const boxEnd = Math.min(buffer.length, declaredBoxSize);
    const brands = [buffer.toString("ascii", 8, 12)];
    for (let offset = 16; offset + 4 <= boxEnd; offset += 4) {
      brands.push(buffer.toString("ascii", offset, offset + 4));
    }
    if (brands.includes("avif") || brands.includes("avis")) {
      return "image/avif";
    }
  }
  return null;
}

export function assertImageContentLength(value, maxBytes) {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) {
    return;
  }
  const contentLength = Number(rawValue);
  if (Number.isFinite(contentLength) && contentLength > Number(maxBytes)) {
    throw new ImageProxyPolicyError("Image response is too large", {
      status: 413,
      code: "IMAGE_TOO_LARGE",
    });
  }
}

export async function readImageBodyWithLimit(body, maxBytes) {
  if (!body || typeof body[Symbol.asyncIterator] !== "function") {
    throw new ImageProxyPolicyError("Image response body is unavailable", {
      status: 502,
      code: "IMAGE_BODY_UNAVAILABLE",
    });
  }
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of body) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      body.destroy?.();
      throw new ImageProxyPolicyError("Image response is too large", {
        status: 413,
        code: "IMAGE_TOO_LARGE",
      });
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, totalBytes);
}

export function validateImageProxyUrl(value, isAllowedHost) {
  let targetUrl;
  try {
    targetUrl = value instanceof URL ? new URL(value.toString()) : new URL(value);
  } catch {
    throw new ImageProxyPolicyError("Invalid image URL", {
      status: 400,
      code: "INVALID_IMAGE_URL",
    });
  }
  if (
    targetUrl.protocol !== "https:" ||
    typeof isAllowedHost !== "function" ||
    !isAllowedHost(targetUrl.hostname.toLowerCase())
  ) {
    throw new ImageProxyPolicyError("Invalid image host", {
      status: 400,
      code: "INVALID_IMAGE_HOST",
    });
  }
  return targetUrl;
}
