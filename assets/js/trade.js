(function () {
  const api = window.KronosMarketApi;
  const searchInput = document.getElementById("tradeSearch");
  const searchResults = document.getElementById("tradeSearchResults");
  const periodSelect = document.getElementById("tradePeriod");
  const chart = document.getElementById("tradeCandles");
  const chartStatus = document.getElementById("tradeChartStatus");
  const selectedAssetName = document.getElementById("tradeAssetName");
  const chartTitle = document.getElementById("tradeChartTitle");
  const tokenLink = document.getElementById("tradeTokenLink");
  const assetPrice = document.getElementById("tradeAssetPrice");
  const changeValue = document.getElementById("tradeChange");
  const volumeValue = document.getElementById("tradeVolume");
  const marketCapValue = document.getElementById("tradeMarketCap");
  const updatedValue = document.getElementById("tradeUpdated");
  const bookPrice = document.getElementById("tradeBookPrice");
  const chartUpdated = document.getElementById("tradeChartUpdated");
  let activeCoinId = "bitcoin";
  let searchTimer;
  let searchSequence = 0;
  let loadSequence = 0;

  function setStatus(element, message, kind) {
    element.replaceChildren();
    const span = document.createElement("span");
    span.className = kind || "";
    span.textContent = message;
    element.append(span);
  }

  function svgElement(name, attributes) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
    return element;
  }

  function renderCandles(rows, coinName, days) {
    const data = Array.isArray(rows) ? rows.filter((row) =>
      Array.isArray(row) && row.length >= 5 && row.slice(0, 5).every(Number.isFinite) &&
      row[1] > 0 && row[2] > 0 && row[3] > 0 && row[4] > 0 &&
      row[2] >= Math.max(row[1], row[4], row[3]) && row[3] <= Math.min(row[1], row[4])
    ) : [];
    if (!data.length) throw new Error("Candlestick data is unavailable for this asset and period.");

    const width = 1000;
    const height = 360;
    const padding = { top: 18, right: 24, bottom: 34, left: 84 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    let minimum = Math.min(...data.map((row) => row[3]));
    let maximum = Math.max(...data.map((row) => row[2]));
    if (minimum === maximum) {
      const adjustment = Math.max(minimum * 0.01, 0.000001);
      minimum -= adjustment;
      maximum += adjustment;
    }
    const y = (price) => padding.top + ((maximum - price) / (maximum - minimum)) * plotHeight;
    const xStep = plotWidth / data.length;
    const bodyWidth = Math.max(2, Math.min(14, xStep * 0.65));
    chart.replaceChildren();
    chart.setAttribute("aria-label", `${coinName} OHLC candlestick chart for ${days} ${days === 1 ? "day" : "days"}, USD reference`);

    for (let index = 0; index <= 4; index += 1) {
      const lineY = padding.top + (plotHeight * index) / 4;
      const price = maximum - ((maximum - minimum) * index) / 4;
      chart.append(svgElement("line", { x1: padding.left, y1: lineY, x2: width - padding.right, y2: lineY, class: "trade-grid-line" }));
      const label = svgElement("text", { x: padding.left - 10, y: lineY + 4, "text-anchor": "end", class: "trade-axis-label" });
      label.textContent = api.formatCurrency(price, { maximumFractionDigits: price < 1 ? 6 : 2 });
      chart.append(label);
    }

    data.forEach((row, index) => {
      const [timestamp, open, high, low, close] = row;
      const centerX = padding.left + xStep * (index + 0.5);
      const rising = close >= open;
      const candleClass = rising ? "trade-candle-up" : "trade-candle-down";
      chart.append(svgElement("line", { x1: centerX, y1: y(high), x2: centerX, y2: y(low), class: `${candleClass} trade-candle-wick` }));
      const bodyTop = Math.min(y(open), y(close));
      chart.append(svgElement("rect", {
        x: centerX - bodyWidth / 2,
        y: bodyTop,
        width: bodyWidth,
        height: Math.max(1, Math.abs(y(open) - y(close))),
        class: `${candleClass} trade-candle-body`
      }));

      const labelStride = Math.max(1, Math.ceil(data.length / 5));
      if (index % labelStride === 0 || index === data.length - 1) {
        const timeLabel = svgElement("text", { x: centerX, y: height - 10, "text-anchor": "middle", class: "trade-axis-label" });
        timeLabel.textContent = new Date(timestamp).toLocaleDateString(undefined, days === 1
          ? { hour: "numeric", minute: "2-digit" }
          : { month: "short", day: "numeric" });
        chart.append(timeLabel);
      }
    });
  }

  function updateMarketDetails(coin) {
    const market = coin && coin.market_data;
    const usd = market && market.current_price && market.current_price.usd;
    selectedAssetName.textContent = `${coin.name} (${String(coin.symbol || "").toUpperCase()})`;
    chartTitle.textContent = `${coin.name} / USD`;
    assetPrice.textContent = typeof usd === "number" ? api.formatCurrency(usd) : "USD price unavailable";
    bookPrice.textContent = typeof usd === "number" ? api.formatCurrency(usd) : "Unavailable";
    const change = market && market.price_change_percentage_24h;
    changeValue.textContent = api.formatChange(change);
    changeValue.className = typeof change === "number" ? (change >= 0 ? "positive" : "negative") : "";
    volumeValue.textContent = market && typeof market.total_volume?.usd === "number"
      ? api.formatCurrency(market.total_volume.usd, { compact: true }) : "—";
    marketCapValue.textContent = market && typeof market.market_cap?.usd === "number"
      ? api.formatCurrency(market.market_cap.usd, { compact: true }) : "—";
    updatedValue.textContent = market && market.last_updated
      ? new Date(market.last_updated).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—";
    chartUpdated.textContent = market && market.last_updated
      ? `Market data · ${new Date(market.last_updated).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Market data time unavailable";
    tokenLink.href = `token.html?id=${encodeURIComponent(coin.id)}`;
  }

  async function loadAsset(coinId, { updateUrl = true } = {}) {
    const currentLoad = ++loadSequence;
    activeCoinId = coinId;
    if (updateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set("coin", coinId);
      window.history.replaceState(null, "", url);
    }
    setStatus(chartStatus, "Loading provider market data…", "loading");
    chart.replaceChildren();
    chart.setAttribute("aria-label", `${coinId} candlestick chart loading`);
    try {
      const coin = await api.getCoin(coinId);
      if (currentLoad !== loadSequence) return;
      updateMarketDetails(coin);
      const days = Number(periodSelect.value);
      try {
        const rows = await api.getOhlc(coinId, { days });
        if (currentLoad !== loadSequence) return;
        renderCandles(rows, coin.name, days);
        setStatus(chartStatus, `Provider OHLC data loaded · ${rows.length} reported candles`, "success");
      } catch (error) {
        if (currentLoad !== loadSequence) return;
        setStatus(chartStatus, error.message || "Candlestick data could not be loaded.", "error");
      }
    } catch (error) {
      if (currentLoad !== loadSequence) return;
      selectedAssetName.textContent = "Market data unavailable";
      assetPrice.textContent = "—";
      chart.setAttribute("aria-label", "Candlestick chart unavailable");
      setStatus(chartStatus, error.message || "Market data could not be loaded.", "error");
    }
  }

  function closeSearch() {
    searchResults.hidden = true;
    searchInput.setAttribute("aria-expanded", "false");
  }

  function showSearchResults(coins) {
    searchResults.replaceChildren();
    const matches = Array.isArray(coins) ? coins.slice(0, 8) : [];
    if (!matches.length) {
      const empty = document.createElement("p");
      empty.className = "trade-search-empty";
      empty.textContent = "No matching market assets.";
      searchResults.append(empty);
    } else {
      matches.forEach((coin, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "trade-search-option";
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", "false");
        button.dataset.coinId = coin.id;
        button.id = `trade-search-option-${index}`;
        const name = document.createElement("strong");
        name.textContent = coin.name || coin.id;
        const symbol = document.createElement("span");
        symbol.textContent = String(coin.symbol || "").toUpperCase();
        button.append(name, symbol);
        button.addEventListener("click", () => {
          searchInput.value = `${coin.name} (${String(coin.symbol || "").toUpperCase()})`;
          closeSearch();
          loadAsset(coin.id);
        });
        searchResults.append(button);
      });
    }
    searchResults.hidden = false;
    searchInput.setAttribute("aria-expanded", "true");
  }

  function showSearchError(message) {
    searchResults.replaceChildren();
    const error = document.createElement("p");
    error.className = "trade-search-empty";
    error.setAttribute("role", "status");
    error.textContent = message;
    searchResults.append(error);
    searchResults.hidden = false;
    searchInput.setAttribute("aria-expanded", "true");
  }

  searchInput.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    const query = searchInput.value.trim();
    const sequence = ++searchSequence;
    if (query.length < 2) {
      closeSearch();
      return;
    }
    searchTimer = window.setTimeout(async () => {
      try {
        const result = await api.searchTokens(query);
        if (sequence === searchSequence) showSearchResults(result.coins);
      } catch (error) {
        if (sequence === searchSequence) showSearchError(error.message || "Asset search is temporarily unavailable.");
      }
    }, 250);
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSearch();
    if (event.key === "Enter" && !searchResults.hidden) {
      const first = searchResults.querySelector("button[data-coin-id]");
      if (first) {
        event.preventDefault();
        first.click();
      }
    }
  });

  document.addEventListener("click", (event) => {
    if (!searchResults.contains(event.target) && event.target !== searchInput) closeSearch();
  });

  periodSelect.addEventListener("change", () => loadAsset(activeCoinId, { updateUrl: false }));
  const initialCoin = new URLSearchParams(window.location.search).get("coin") || "bitcoin";
  if (!/^[a-z0-9-]{1,100}$/i.test(initialCoin)) {
    setStatus(chartStatus, "The requested market identifier is invalid.", "error");
  } else {
    loadAsset(initialCoin, { updateUrl: false });
  }
})();
