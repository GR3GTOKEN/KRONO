(function () {
  const api = window.KronosMarketApi;
  const status = document.getElementById("dashboardStatus");
  const marketRows = document.getElementById("homeMarketRows");
  const gainers = document.getElementById("homeGainers");
  const trending = document.getElementById("homeTrending");
  const search = document.getElementById("homeSearchInput");
  const searchResults = document.getElementById("homeSearchResults");
  const previous = document.getElementById("homePrevious");
  const next = document.getElementById("homeNext");
  const pageLabel = document.getElementById("homePageLabel");
  const tabs = Array.from(document.querySelectorAll("[data-market-filter]"));
  if (!api || !status || !marketRows || !gainers || !trending || !search) return;

  let markets = [];
  let page = 1;
  let filter = "all";
  let searchTimer = 0;
  let searchController = null;
  let searchCache = new Map();
  let requestGeneration = 0;
  let lastUpdated = null;
  let loadingMarkets = false;

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    })[character]);
  }

  function setDashboardMessage(message, stateName = "") {
    status.dataset.state = stateName;
    status.textContent = message;
  }

  function changeMarkup(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "—";
    const className = value >= 0 ? "trend" : "negative";
    const arrow = value > 0 ? "▲ " : value < 0 ? "▼ " : "";
    return `<span class="${className}">${arrow}${esc(api.formatChange(value))}</span>`;
  }

  function sparklineMarkup(coin) {
    const values = coin.sparkline_in_7d?.price?.filter((value) => typeof value === "number" && Number.isFinite(value));
    if (!values || values.length < 2) return "—";
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const range = maximum - minimum || Math.abs(maximum) * 0.01 || 1;
    const points = values.map((value, index) => {
      const x = 1 + index / (values.length - 1) * 68;
      const y = 20 - (value - minimum) / range * 18;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    return `<svg class="mini-chart" viewBox="0 0 70 22" role="img" aria-label="${esc(coin.name)} seven-day price chart"><polyline points="${points}" fill="none" stroke="#43c481" stroke-width="1.4" vector-effect="non-scaling-stroke"></polyline></svg>`;
  }

  function renderGlobalStats(globalData, marketsData) {
    const stats = globalData?.data;
    const marketCap = stats?.total_market_cap?.usd;
    const marketCapChange = stats?.market_cap_change_percentage_24h_usd;
    const btcDominance = stats?.market_cap_percentage?.btc;
    const bitcoin = marketsData.find((coin) => coin.id === "bitcoin");
    const ethereum = marketsData.find((coin) => coin.id === "ethereum");

    document.getElementById("globalMarketCap").textContent =
      typeof marketCap === "number" ? api.formatCurrency(marketCap, { compact: true }) : "Unavailable";
    document.getElementById("globalMarketCapChange").innerHTML = changeMarkup(marketCapChange);
    document.getElementById("bitcoinPrice").textContent =
      bitcoin ? api.formatCurrency(bitcoin.current_price) : "Unavailable";
    document.getElementById("bitcoinChange").innerHTML = changeMarkup(bitcoin?.price_change_percentage_24h);
    document.getElementById("ethereumPrice").textContent =
      ethereum ? api.formatCurrency(ethereum.current_price) : "Unavailable";
    document.getElementById("ethereumChange").innerHTML = changeMarkup(ethereum?.price_change_percentage_24h);
    document.getElementById("bitcoinDominance").textContent =
      typeof btcDominance === "number" ? `${btcDominance.toFixed(1)}%` : "Unavailable";
    document.getElementById("activeAssets").textContent =
      typeof stats?.active_cryptocurrencies === "number"
        ? new Intl.NumberFormat("en-US").format(stats.active_cryptocurrencies)
        : "Unavailable";
  }

  function visibleMarkets() {
    const matching = markets.filter((coin) => {
      const change = coin.price_change_percentage_24h;
      if (filter === "gainers") return typeof change === "number" && change > 0;
      if (filter === "losers") return typeof change === "number" && change < 0;
      return true;
    });
    if (filter === "gainers") {
      matching.sort((a, b) => b.price_change_percentage_24h - a.price_change_percentage_24h);
    } else if (filter === "losers") {
      matching.sort((a, b) => a.price_change_percentage_24h - b.price_change_percentage_24h);
    }
    return matching;
  }

  function renderMarkets() {
    const visible = visibleMarkets();
    const offset = (page - 1) * 10;
    const pageItems = visible.slice(offset, offset + 10);
    marketRows.innerHTML = pageItems.length ? pageItems.map((coin, index) => {
      const image = api.safeExternalUrl(coin.image);
      const logo = image
        ? `<img class="token" src="${esc(image)}" alt="" loading="lazy" onerror="this.remove()">`
        : `<span class="token" aria-hidden="true">${esc(coin.symbol.slice(0, 1).toUpperCase())}</span>`;
      return `<tr>
        <td class="rank">${offset + index + 1}</td>
        <td><a class="asset-name" href="token.html?id=${encodeURIComponent(coin.id)}">${logo}${esc(coin.name)} <span class="ticker">${esc(coin.symbol.toUpperCase())}</span></a></td>
        <td>${esc(api.formatCurrency(coin.current_price))}</td>
        <td>${changeMarkup(coin.price_change_percentage_24h)}</td>
        <td>${esc(api.formatCurrency(coin.market_cap, { compact: true }))}</td>
        <td>${esc(api.formatCurrency(coin.total_volume, { compact: true }))}</td>
        <td>${sparklineMarkup(coin)}</td>
      </tr>`;
    }).join("") : '<tr><td colspan="7" class="empty-message">No live assets match this filter.</td></tr>';
    previous.disabled = loadingMarkets || page <= 1;
    next.disabled = loadingMarkets || page * 10 >= visible.length;
    pageLabel.textContent = `${visible.length ? offset + 1 : 0}–${Math.min(offset + 10, visible.length)} of ${visible.length} · loaded market assets`;
  }

  function renderGainers() {
    const top = markets
      .filter((coin) => typeof coin.price_change_percentage_24h === "number")
      .slice()
      .sort((a, b) => b.price_change_percentage_24h - a.price_change_percentage_24h)
      .slice(0, 5);
    gainers.innerHTML = top.length ? top.map((coin, index) => `
      <a class="market-row" href="token.html?id=${encodeURIComponent(coin.id)}">
        <span class="rank">${index + 1}</span>
        <span class="asset-name">${esc(coin.name)}<span class="market-price">${esc(api.formatCurrency(coin.current_price))}</span></span>
        ${changeMarkup(coin.price_change_percentage_24h)}
      </a>`).join("") : '<p class="empty-message">Live market movers are unavailable.</p>';
  }

  function renderTrending(items) {
    const entries = (Array.isArray(items) ? items : []).slice(0, 5).filter(({ item }) =>
      item && typeof item.id === "string" && typeof item.name === "string" && typeof item.symbol === "string"
    );
    trending.innerHTML = entries.length ? entries.map(({ item }, index) => `
      <a class="market-row" href="token.html?id=${encodeURIComponent(item.id)}">
        <span class="rank">${index + 1}</span>
        <span class="asset-name">${esc(item.name)}<span class="market-price">${esc(item.symbol.toUpperCase())} · trending search</span></span>
      </a>`).join("") : '<p class="empty-message">Provider trending data is unavailable.</p>';
  }

  async function loadDashboard() {
    loadingMarkets = true;
    renderMarkets();
    setDashboardMessage("Loading current public market data from CoinGecko...");
    try {
      const results = await Promise.allSettled([
        api.getGlobal(),
        api.getMarkets({ page: 1, perPage: 100, sparkline: true }),
        api.getTrending()
      ]);
      const marketResult = results[1];
      if (marketResult.status !== "fulfilled" || !Array.isArray(marketResult.value)) {
        const reason = marketResult.status === "rejected" ? marketResult.reason : new Error("Unexpected market-data response.");
        throw reason;
      }
      markets = marketResult.value;
      if (results[0].status === "fulfilled") renderGlobalStats(results[0].value, markets);
      else renderGlobalStats(null, markets);
      if (results[2].status === "fulfilled") renderTrending(results[2].value?.coins);
      else renderTrending([]);
      renderGainers();
      lastUpdated = new Date();
      const failures = results.filter((result) => result.status === "rejected").length;
      setDashboardMessage(
        `${failures ? "Some market indicators are unavailable. " : ""}Prices and rankings updated ${api.formatTimestamp(lastUpdated)} · public market data from CoinGecko.`,
        failures ? "error" : "success"
      );
    } catch (error) {
      markets = [];
      renderGlobalStats(null, []);
      renderMarkets();
      renderGainers();
      renderTrending([]);
      setDashboardMessage(`${error instanceof Error ? error.message : "Live market data is unavailable."} No current figures are being shown.`, "error");
    } finally {
      loadingMarkets = false;
      renderMarkets();
    }
  }

  function closeSearch() {
    searchResults.hidden = true;
    search.setAttribute("aria-expanded", "false");
  }

  function renderSearchResults(coins) {
    searchResults.innerHTML = coins.length ? coins.slice(0, 8).map((coin) => `
      <button type="button" role="option" data-coin-id="${esc(coin.id)}">
        <span>${esc(coin.name)} <small>${esc(coin.symbol.toUpperCase())}</small></span>
        <small>${typeof coin.market_cap_rank === "number" ? `Rank #${coin.market_cap_rank}` : "Crypto asset"}</small>
      </button>`).join("") : '<p class="empty-message">No matching assets were found.</p>';
    searchResults.hidden = false;
    search.setAttribute("aria-expanded", "true");
  }

  async function searchAssets() {
    const query = search.value.trim();
    const generation = ++requestGeneration;
    if (query.length < 2) {
      if (searchController) searchController.abort();
      closeSearch();
      return;
    }
    searchResults.innerHTML = '<p class="empty-message">Searching live provider listings…</p>';
    searchResults.hidden = false;
    search.setAttribute("aria-expanded", "true");
    if (searchCache.has(query.toLowerCase())) {
      renderSearchResults(searchCache.get(query.toLowerCase()));
      return;
    }
    if (searchController) searchController.abort();
    searchController = new AbortController();
    const timeout = window.setTimeout(() => searchController?.abort(), 12000);
    try {
      const response = await fetch(`/api/v1/market/search?query=${encodeURIComponent(query)}`, {
        signal: searchController.signal,
        headers: { accept: "application/json" }
      });
      if (!response.ok) {
        if (response.status === 429) throw new Error("Search is temporarily rate limited. Try again shortly.");
        throw new Error("Live asset search is temporarily unavailable.");
      }
      const data = await response.json();
      const coins = Array.isArray(data.coins) ? data.coins : [];
      if (generation !== requestGeneration) return;
      searchCache.set(query.toLowerCase(), coins);
      if (searchCache.size > 30) searchCache.delete(searchCache.keys().next().value);
      renderSearchResults(coins);
    } catch (error) {
      if (error.name === "AbortError" && search.value.trim() !== query) return;
      if (generation !== requestGeneration) return;
      searchResults.innerHTML = `<p class="empty-message">${esc(error instanceof Error ? error.message : "Live asset search is unavailable.")}</p>`;
      searchResults.hidden = false;
      search.setAttribute("aria-expanded", "true");
    } finally {
      window.clearTimeout(timeout);
    }
  }

  search.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    requestGeneration += 1;
    if (searchController) searchController.abort();
    searchTimer = window.setTimeout(searchAssets, 250);
  });
  search.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSearch();
    if (event.key === "Enter") {
      const first = searchResults.querySelector("[data-coin-id]");
      if (first) window.location.href = `token.html?id=${encodeURIComponent(first.dataset.coinId)}`;
    }
  });
  searchResults.addEventListener("click", (event) => {
    const option = event.target.closest("[data-coin-id]");
    if (option) window.location.href = `token.html?id=${encodeURIComponent(option.dataset.coinId)}`;
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".home-search")) closeSearch();
  });
  tabs.forEach((tab) => tab.addEventListener("click", () => {
    filter = tab.dataset.marketFilter;
    page = 1;
    tabs.forEach((item) => {
      const selected = item === tab;
      item.classList.toggle("selected", selected);
      item.setAttribute("aria-selected", String(selected));
    });
    renderMarkets();
  }));
  previous.addEventListener("click", () => {
    if (page > 1 && !loadingMarkets) {
      page -= 1;
      renderMarkets();
    }
  });
  next.addEventListener("click", () => {
    if (page * 10 < visibleMarkets().length && !loadingMarkets) {
      page += 1;
      renderMarkets();
    }
  });

  loadDashboard();
})();
