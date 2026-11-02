import { normalizePaidCoefficient } from "../../shared/paidCoefficient.js";

const STORAGE_KEY = "mm-toolkit-paid-coefficients";
const listeners = new Set();
let values;

function normalizePlatformCoefficient(platform, value) {
  return normalizePaidCoefficient(value, platform === "manbo" ? { max: Number.MAX_SAFE_INTEGER, allowDecimal: true } : {});
}

function readValues() {
  try {
    const stored = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || "{}");
    return { missevan: normalizePlatformCoefficient("missevan", stored?.missevan), manbo: normalizePlatformCoefficient("manbo", stored?.manbo) };
  } catch {
    return { missevan: 1, manbo: 1 };
  }
}

export function getPaidCoefficient(platform) {
  values ||= readValues();
  return values[platform] ?? 1;
}

export function subscribePaidCoefficient(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setPaidCoefficient(platform, value) {
  if (!["missevan", "manbo"].includes(platform)) return;
  values ||= readValues();
  values = { ...values, [platform]: normalizePlatformCoefficient(platform, value) };
  listeners.forEach((listener) => listener());
}

export function persistPaidCoefficients() {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(values || readValues()));
  } catch {
    // Keep the in-memory preference usable when storage is unavailable.
  }
}
