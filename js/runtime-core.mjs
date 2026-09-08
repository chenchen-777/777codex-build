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
  const remaining = body.remaining ?? body.quota?.remaining ?? body.balance ?? body.data?.remaining ?? body.data?.balance;
  const currency = body.currency ?? body.quota?.currency ?? body.data?.currency ?? "USD";
  return { remaining: remaining ?? null, currency: String(currency || "USD") };
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
