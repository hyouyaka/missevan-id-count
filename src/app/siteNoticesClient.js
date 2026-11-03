export async function requestNotices(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(15000), ...options });
  const payload = await response.json();
  if (!response.ok || !payload.success || !Array.isArray(payload.entries)) {
    throw new Error(payload.message || "管理员日志暂时无法读取，请稍后重试。");
  }
  return payload;
}
