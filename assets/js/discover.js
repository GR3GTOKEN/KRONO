(function () {
  const api = window.KronosMarketApi;
  const rows = document.getElementById("marketRows");
  const cards = document.getElementById("assetCards");
  const status = document.getElementById("marketStatus");
  const search = document.getElementById("searchInput");
  const sort = document.getElementById("sortSelect");
  const empty = document.getElementById("emptyState");
  const previous = document.getElementById("previousPage");
  const next = document.getElementById("nextPage");
  const refresh = document.getElementById("refreshButton");
  const pageLabel = document.getElementById("pageLabel");
  let page = 1;
  let currentFilter = "all";
  let markets = [];
  let trendingMarkets = [];
  let trendingError = "";
  let loading = false;
  let hasLoadedMarkets = false;

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    })[character]);
  }

  function numberOrLowest(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
  }

  function metricValue(value) {
    if (typeof value === "number") return api.formatCurrency(value, { compact: true });
    return typeof value === "string" && value.trim() ? value : "—";
  }

  function parseProviderMetric(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string") return Number.NEGATIVE_INFINITY;
    const match = value.replace(/,/g, "").match(/^\$?([\d.]+)\s*([KMBT])?$/i);
    if (!match) return Number.NEGATIVE_INFINITY;
    const scale = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
    return Number(match[1]) * (scale[match[2]?.toUpperCase()] || 1);
  }

  function getVisibleMarkets() {
    let visible = (currentFilter === "trending" ? trendingMarkets : markets).slice();
    if (currentFilter === "gainers") visible = visible.filter((coin) => typeof coin.price_change_percentage_24h === "number" && coin.price_change_percentage_24h > 0);
    if (currentFilter === "losers") visible = visible.filter((coin) => typeof coin.price_change_percentage_24h === "number" && coin.price_change_percentage_24h < 0);

    const query = search.value.trim().toLowerCase();
    if (query) visible = visible.filter((coin) => coin.name.toLowerCase().includes(query) || coin.symbol.toLowerCase().includes(query));

    const key = sort.value;
    const [field, direction] = key.endsWith("_asc") ? [key.slice(0, -4), 1] : [key.slice(0, -5), -1];
    const fieldName = field === "change" ? "price_change_percentage_24h" : field;
    if (fieldName === "market_cap" || fieldName === "total_volume") {
      visible.sort((a, b) => (parseProviderMetric(a[fieldName]) - parseProviderMetric(b[fieldName])) * direction);
      return visible;
    }
    visible.sort((a, b) => (numberOrLowest(a[fieldName]) - numberOrLowest(b[fieldName])) * direction);
    return visible;
  }

  function logoMarkup(coin) {
    const fallback = esc(coin.symbol.slice(0, 2).toUpperCase());
    const image = api.safeExternalUrl(coin.image);
    return `<span class="asset-logo">${image ? `<img src="${esc(image)}" alt="" loading="lazy" onerror="this.remove()">` : fallback}</span>`;
  }

  function render() {
    const visible = getVisibleMarkets();
    const offset = (page - 1) * 50;
    rows.innerHTML = visible.map((coin, index) => {
      const change = coin.price_change_percentage_24h;
      const changeClass = typeof change === "number" ? (change >= 0 ? "positive" : "negative") : "";
      const href = `token.html?id=${encodeURIComponent(coin.id)}`;
      const changeMarkup = typeof change === "number" ? `<span class="${changeClass}">${esc(api.formatChange(change))}</span>` : "—";
      return `<tr>
        <td>${offset + index + 1}</td>
        <td><a class="asset-name" href="${href}">${logoMarkup(coin)}<span>${esc(coin.name)}<span class="asset-symbol">${esc(coin.symbol)}</span></span></a></td>
        <td>${esc(api.formatCurrency(coin.current_price))}</td>
        <td>${changeMarkup}</td>
        <td>${esc(metricValue(coin.market_cap))}</td>
        <td>${esc(metricValue(coin.total_volume))}</td>
      </tr>`;
    }).join("");
    cards.innerHTML = visible.map((coin, index) => {
      const change = coin.price_change_percentage_24h;
      const changeClass = typeof change === "number" ? (change >= 0 ? "positive" : "negative") : "";
      const href = `token.html?id=${encodeURIComponent(coin.id)}`;
      return `<a class="asset-card" href="${href}">
        <span class="asset-name">${logoMarkup(coin)}<span>${esc(coin.name)}<span class="asset-symbol">${esc(coin.symbol)}</span></span></span>
        <span class="asset-card-price">${esc(api.formatCurrency(coin.current_price))}<br><span class="${changeClass}">${esc(api.formatChange(change))}</span></span>
        <span class="asset-card-extra"><span>Market cap ${esc(metricValue(coin.market_cap))}</span><span>Vol ${esc(metricValue(coin.total_volume))}</span></span>
      </a>`;
    }).join("");
    empty.hidden = visible.length > 0 || loading || !hasLoadedMarkets || Boolean(status.querySelector(".error"));
    pageLabel.textContent = currentFilter === "trending"
      ? `${trendingMarkets.length} currently trending assets`
      : `Page ${page} · ${markets.length} markets loaded`;
    previous.disabled = loading || currentFilter === "trending" || page === 1;
    next.disabled = loading || currentFilter === "trending" || markets.length < 50;
    if (currentFilter === "trending" && trendingError) {
      status.innerHTML = `<strong class="success">Live market data</strong><span class="error">Trending data unavailable: ${esc(trendingError)}</span>`;
    }
  }

  async function loadMarkets(force = false) {
    if (loading) return;
    loading = true;
    refresh.disabled = true;
    refresh.textContent = "Loading...";
    status.innerHTML = '<span class="loading">Loading live market data from CoinGecko...</span>';
    render();

    try {
      const [result, trendingResult] = await Promise.allSettled([
        api.getMarkets({ page, perPage: 50, force }),
        api.getTrending({ force })
      ]);
      if (result.status === "rejected") throw result.reason;
      const marketData = result.value;
      if (!Array.isArray(marketData)) throw new Error("The market provider returned an unexpected response.");
      markets = marketData;
      hasLoadedMarkets = true;
      if (trendingResult.status === "fulfilled" && Array.isArray(trendingResult.value.coins)) {
        trendingError = "";
        trendingMarkets = trendingResult.value.coins.map(({ item }) => {
          if (!item || typeof item.id !== "string" || !item.data) return null;
          return {
            id: item.id,
            name: item.name,
            symbol: item.symbol,
            image: item.small || item.thumb,
            market_cap_rank: item.market_cap_rank,
            current_price: item.data.price,
            price_change_percentage_24h: item.data.price_change_percentage_24h?.usd,
            market_cap: item.data.market_cap,
            total_volume: item.data.total_volume,
            market_cap_sort: parseProviderMetric(item.data.market_cap),
            total_volume_sort: parseProviderMetric(item.data.total_volume)
          };
        }).filter((coin) => coin && typeof coin.name === "string" && typeof coin.symbol === "string");
      } else {
        trendingMarkets = [];
        trendingError = trendingResult.status === "rejected"
          ? trendingResult.reason.message
          : "The provider returned an unexpected response.";
      }
      status.innerHTML = `<strong class="success">Live market data</strong><span>Updated ${esc(api.formatTimestamp())}</span><span>${markets.length} assets on this page</span>${trendingError ? `<span class="error">Trending list unavailable</span>` : ""}`;
    } catch (error) {
      status.innerHTML = `<span class="error">${esc(error.message || "Could not load live market data.")}</span>`;
      markets = [];
      trendingMarkets = [];
      hasLoadedMarkets = false;
    } finally {
      loading = false;
      refresh.disabled = false;
      refresh.textContent = "↻  Refresh data";
      render();
    }
  }

  search.addEventListener("input", render);
  sort.addEventListener("change", render);
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      currentFilter = button.dataset.filter;
      if (currentFilter !== "trending") status.innerHTML = `<strong class="success">Live market data</strong><span>Updated ${esc(api.formatTimestamp())}</span><span>${markets.length} assets on this page</span>`;
      page = 1;
      document.querySelectorAll("[data-filter]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      render();
    });
  });
  refresh.addEventListener("click", () => loadMarkets(true));
  previous.addEventListener("click", () => {
    if (page > 1 && !loading) { page -= 1; loadMarkets(); }
  });
  next.addEventListener("click", () => {
    if (markets.length === 50 && !loading) { page += 1; loadMarkets(); }
  });

  loadMarkets();
})();
