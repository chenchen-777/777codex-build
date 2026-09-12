export function errorMessage(value, fallback = "请求失败") {
  if (!value || typeof value !== "object") return fallback;
  const message = value.message || value.error?.message || value.error || value.code;
  return typeof message === "string" ? message.slice(0, 300) : fallback;
}

export function normalizeModels(body) {
  const source = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
  return [...new Set(source.slice(0, 5000).map((item) => typeof item === "string" ? item : item?.id || item?.name).filter(value => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\x00-\x1f]/.test(value)))]
    .sort((left, right) => left.localeCompare(right));
}

export function normalizeUsage(body) {
  if (!body || typeof body !== "object") return null;
  const amounts = [["remaining", body.remaining], ["quota.remaining", body.quota?.remaining], ["balance", body.balance], ["data.remaining", body.data?.remaining], ["data.balance", body.data?.balance]];
  const selected = amounts.find(([, value]) => value !== null && value !== undefined && value !== "");
  const number = selected && (typeof selected[1] === "number" || typeof selected[1] === "string" && selected[1].trim()) ? Number(selected[1]) : NaN;
  const scope = selected?.[0].startsWith("quota.") ? "quota" : selected?.[0].startsWith("data.") ? "data" : "root";
  const units = scope === "quota" ? [["quota.currency", body.quota?.currency], ["quota.unit", body.quota?.unit]] : scope === "data" ? [["data.currency", body.data?.currency], ["data.unit", body.data?.unit]] : [["currency", body.currency], ["unit", body.unit]];
  const unit = units.find(([, value]) => typeof value === "string" && value.trim() && value.length <= 32 && !/[\x00-\x1f]/.test(value));
  return { remaining: Number.isFinite(number) ? number : null, currency: unit ? unit[1].trim() : null, sourceField: selected?.[0] || null, currencySource: unit?.[0] || null };
}

export function valueForKey(text, key) {
  const match = String(text).match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, "m"));
  return match?.[1] || null;
}

export function activeProviderBaseUrl(text) {
  const provider = valueForKey(text, "model_provider");
  if (!provider) return null;

  let inProvider = false;
  for (const line of String(text).replace(/\r\n/g, "\n").split("\n")) {
    const table = line.match(/^\s*\[([^\]]+)]\s*(?:#.*)?$/)?.[1]?.trim();
    if (table) {
      inProvider = table === `model_providers.${provider}`;
      continue;
    }
    if (inProvider) {
      const match = line.match(/^\s*base_url\s*=\s*["']([^"']+)["']/);
      if (match) return match[1];
    }
  }
  return null;
}

export function redactSensitiveToml(text) {
  return String(text).replace(
    /^(\s*(?:experimental_bearer_token|api_key|token|password|secret)\s*=\s*)["'][^"']*["']/gim,
    '$1"[已脱敏]"',
  );
}
