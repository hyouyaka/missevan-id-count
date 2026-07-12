const SCRIPT_URL =
  "https://download.hongrenshuo.com.cn/h5/assets/oss/uxin-security-url-crypto-v2.1.min.js";

let scriptPromise = null;

function loadScript() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Browser only"));
  }

  if (window.uxinSecurityUrlCrypto) {
    return Promise.resolve(window.uxinSecurityUrlCrypto);
  }

  if (scriptPromise) {
    return scriptPromise;
  }

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-manbo-crypto="1"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(window.uxinSecurityUrlCrypto));
      existing.addEventListener("error", () =>
        reject(new Error("Failed to load Manbo crypto script"))
      );
      return;
    }

    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.dataset.manboCrypto = "1";
    script.onload = () => resolve(window.uxinSecurityUrlCrypto);
    script.onerror = () =>
      reject(new Error("Failed to load Manbo crypto script"));
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export function canParseShareUrl(url) {
  try {
    const parsed = new URL(String(url || "").trim());
    return (
      (
        /(^|\.)hongdoulive\.com$/i.test(parsed.hostname) ||
        /(^|\.)kilamanbo\.(com|world)$/i.test(parsed.hostname) ||
        /(^|\.)kilaaudio\.com$/i.test(parsed.hostname)
      ) &&
      parsed.searchParams.has("_specific_parameter")
    );
  } catch (error) {
    return false;
  }
}

export async function decryptShareUrl(url) {
  const CryptoCtor = await loadScript();
  if (!CryptoCtor) {
    throw new Error("Manbo crypto constructor missing");
  }

  const crypto = new CryptoCtor({
    enableSignatureVerification: true,
  });
  const payload = await crypto.handleUrl(String(url || "").trim());

  if (!payload || typeof payload !== "object" || !Object.keys(payload).length) {
    throw new Error("Share link decryption returned empty payload");
  }

  return payload;
}

export function extractResolvedId(payload, sourceUrl = "") {
  const data = payload && typeof payload === "object" ? payload : null;
  if (!data) {
    return null;
  }

  let pathname = "";
  try {
    pathname = new URL(String(sourceUrl || "").trim()).pathname;
  } catch (error) {
    pathname = "";
  }

  const radioDramaId = String(data.radioDramaId ?? "").trim();
  if (/^\d+$/.test(radioDramaId)) {
    const setId = String(
      data.id ?? data.radioDramaSetId ?? data.dramaSetId ?? data.setId ?? ""
    ).trim();

    return {
      resolvedType: "set",
      dramaId: radioDramaId,
      setId: /^\d+$/.test(setId) ? setId : "",
      payload: data,
    };
  }

  const collectId = String(data.collectId ?? "").trim();
  const directDramaId = String(data.id ?? "").trim();
  if (/^\d+$/.test(directDramaId) && /^\d+$/.test(collectId)) {
    return {
      resolvedType: "drama",
      dramaId: directDramaId,
      setId: collectId,
      payload: data,
    };
  }

  const dramaId = String(
    data.radioDramaIdStr ?? data.radioDramaId ?? data.dramaId ?? ""
  ).trim();
  if (/^\d+$/.test(dramaId)) {
    return {
      resolvedType: "drama",
      dramaId,
      setId: /^\d+$/.test(collectId) ? collectId : "",
      payload: data,
    };
  }

  const setId = String(
    data.radioDramaSetId ?? data.dramaSetId ?? data.setId ?? data.dramaSetIdStr ?? ""
  ).trim();
  if (/^\d+$/.test(setId)) {
    return {
      resolvedType: "set",
      dramaId: "",
      setId,
      payload: data,
    };
  }

  const genericId = String(data.id ?? "").trim();
  const bizType = Number(data.bizType ?? 0);
  if (/^\d+$/.test(genericId) && /\/Activecard\/radioplay$/i.test(pathname)) {
    return {
      resolvedType: "drama",
      dramaId: genericId,
      setId: /^\d+$/.test(collectId) ? collectId : "",
      payload: data,
    };
  }

  if (/^\d+$/.test(genericId) && bizType === 105) {
    return {
      resolvedType: "drama",
      dramaId: genericId,
      setId: /^\d+$/.test(collectId) ? collectId : "",
      payload: data,
    };
  }

  if (/^\d+$/.test(genericId) && (bizType === 108 || bizType === 109)) {
    return {
      resolvedType: "set",
      dramaId: "",
      setId: genericId,
      payload: data,
    };
  }

  if (/^\d+$/.test(genericId)) {
    return {
      resolvedType: "unknown",
      id: genericId,
      payload: data,
    };
  }

  return null;
}
