(function () {
  const API_BASE = "/api/v1/market";
  const cache = new Map();
  const pending = new Map();

  async function request(path, { cacheMs = 60_000, force = false } = {}) {
    const url = `${API_BASE}${path}`;
    const cached = cache.get(url);
    if (!force && cached && Date.now() - cached.time < cacheMs) return cached.value;
    if (pending.has(url)) return pending.get(url);

    const requestPromise = (async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { accept: "application/json" }
        });
        if (!response.ok) {
          if (response.status === 429) throw new Error("Market data is temporarily rate limited. Please try again shortly.");
          if (response.status === 404) throw new Error("Market information is not available for this asset.");
          throw new Error("Market data is temporarily unavailable. Please try again later.");
        }
        const value = await response.json();
        cache.set(url, { time: Date.now(), value });
        return value;
      } catch (error) {
        if (error.name === "AbortError") throw new Error("The market data request timed out. Please try again.");
        if (error instanceof TypeError) throw new Error("Could not load market data. Check your connection and try again.");
        throw error;
      } finally {
        window.clearTimeout(timeout);
        pending.delete(url);
      }
    })();
    pending.set(url, requestPromise);
    return requestPromise;
  }

  function getMarkets({ page = 1, perPage = 50, ids, sparkline = false, force = false } = {}) {
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
      sparkline: String(sparkline)
    });
    if (ids) params.set("ids", ids);
    return request(`/markets?${params}`, { force, cacheMs: 60_000 });
  }

  function getTrending({ force = false } = {}) {
    return request("/trending", { force, cacheMs: 5 * 60_000 });
  }

  function getGlobal({ force = false } = {}) {
    return request("/global", { force, cacheMs: 2 * 60_000 });
  }

  function searchTokens(query, { force = false } = {}) {
    const params = new URLSearchParams({ query });
    return request(`/search?${params}`, { force, cacheMs: 60_000 });
  }

  function getCoin(id, { force = false } = {}) {
    const params = new URLSearchParams({
      localization: "false",
      tickers: "false",
      market_data: "true",
      community_data: "false",
      developer_data: "false",
      sparkline: "false"
    });
    return request(`/coins/${encodeURIComponent(id)}?${params}`, { force, cacheMs: 60_000 });
  }

  function getHistory(id, { force = false } = {}) {
    return request(`/coins/${encodeURIComponent(id)}/history`, { force, cacheMs: 5 * 60_000 });
  }

  function getOhlc(id, { days = 1, force = false } = {}) {
    const params = new URLSearchParams({ days: String(days) });
    return request(`/coins/${encodeURIComponent(id)}/ohlc?${params}`, { force, cacheMs: 5 * 60_000 });
  }

  function formatCurrency(value, { compact = false, maximumFractionDigits } = {}) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "—";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: maximumFractionDigits ?? (value < 1 ? 6 : 2)
    }).format(value);
  }

  function formatCompact(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "—";
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
  }

  function formatChange(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "—";
    return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
  }

  function formatTimestamp(value = Date.now()) {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(value);
  }

  function safeExternalUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    } catch {
      return null;
    }
  }

  window.KronosMarketApi = { getMarkets, getGlobal, getTrending, searchTokens, getCoin, getHistory, getOhlc, formatCurrency, formatCompact, formatChange, formatTimestamp, safeExternalUrl };
})();
