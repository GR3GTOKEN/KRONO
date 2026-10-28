(function () {
  const api = window.KronosMarketApi;
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const status = document.getElementById("tokenStatus");
  const content = document.getElementById("tokenContent");
  const errorCard = document.getElementById("tokenError");
  const errorMessage = document.getElementById("tokenErrorMessage");
  const refresh = document.getElementById("tokenRefresh");
  let loading = false;

  function setError(message) {
    status.hidden = true;
    content.hidden = true;
    errorMessage.textContent = message;
    errorCard.hidden = false;
  }

  function setText(idValue, value) {
    document.getElementById(idValue).textContent = value;
  }

  function renderChart(prices) {
    const chart = document.getElementById("priceChart");
    if (!Array.isArray(prices) || prices.length < 2) {
      chart.innerHTML = "";
      document.getElementById("chartStatus").textContent = "Price history is currently unavailable.";
      return;
    }

    const values = prices.map((point) => point[1]).filter((value) => typeof value === "number" && Number.isFinite(value));
    if (values.length < 2) {
      document.getElementById("chartStatus").textContent = "Price history is currently unavailable.";
      return;
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || Math.abs(max) * 0.01 || 1;
    const points = values.map((value, index) => {
      const x = 8 + (index / (values.length - 1)) * 884;
      const y = 8 + ((max - value) / range) * 214;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    chart.innerHTML = `<defs><linearGradient id="chartArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#ce3b48" stop-opacity=".3"/><stop offset="100%" stop-color="#ce3b48" stop-opacity="0"/></linearGradient></defs><polygon points="8,240 ${points} 892,240" fill="url(#chartArea)"/><polyline points="${points}" fill="none" stroke="#e45a66" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
    document.getElementById("chartStatus").textContent = `Seven-day price history · ${values.length} data points`;
  }

  function renderCoin(coin) {
    document.title = `${coin.name} (${coin.symbol.toUpperCase()}) — KRONOS`;
    setText("tokenName", coin.name);
    setText("tokenSymbol", coin.symbol.toUpperCase());
    const logo = api.safeExternalUrl(coin.image?.large || coin.image?.small);
    document.getElementById("tokenLogo").innerHTML = logo
      ? `<img src="${logo}" alt="${coin.name} logo">`
      : coin.symbol.slice(0, 2).toUpperCase();
    const market = coin.market_data || {};
    setText("tokenPrice", api.formatCurrency(market.current_price?.usd));
    const change = market.price_change_percentage_24h;
    const changeElement = document.getElementById("tokenChange");
    changeElement.textContent = `24h change ${api.formatChange(change)}`;
    changeElement.className = `token-change ${typeof change === "number" ? (change >= 0 ? "positive" : "negative") : ""}`;
    setText("tokenMarketCap", api.formatCurrency(market.market_cap?.usd, { compact: true }));
    setText("tokenVolume", api.formatCurrency(market.total_volume?.usd, { compact: true }));
    setText("tokenCirculating", typeof market.circulating_supply === "number" ? api.formatCompact(market.circulating_supply) : "Not provided");
    const supply = [market.total_supply, market.max_supply].map((value) => typeof value === "number" ? api.formatCompact(value) : "Not provided");
    setText("tokenSupply", `${supply[0]} / ${supply[1]}`);
    const description = coin.description?.en?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    setText("tokenDescription", description || "Project description is not available from the provider.");

    const links = [];
    const homepage = api.safeExternalUrl(coin.links?.homepage?.find(Boolean));
    if (homepage) links.push(["Website", homepage]);
    const explorer = api.safeExternalUrl(coin.links?.blockchain_site?.find(Boolean));
    if (explorer) links.push(["Explorer", explorer]);
    const whitepaper = api.safeExternalUrl(coin.links?.whitepaper);
    if (whitepaper) links.push(["Whitepaper", whitepaper]);
    document.getElementById("tokenLinks").innerHTML = links.length
      ? links.map(([label, href]) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`).join("")
      : "No official links available.";
  }

  async function load(force = false) {
    if (loading) return;
    if (!id || !/^[a-zA-Z0-9-]+$/.test(id)) {
      setError("The token URL is missing a valid provider ID.");
      return;
    }

    loading = true;
    refresh.disabled = true;
    status.hidden = false;
    errorCard.hidden = true;
    status.innerHTML = '<span class="loading">Loading token details...</span>';
    try {
      const coin = await api.getCoin(id, { force });
      renderCoin(coin);
      content.hidden = false;
      status.innerHTML = `<span class="success">Market data from CoinGecko</span><span>Updated ${api.formatTimestamp()}</span>`;
      try {
        const history = await api.getHistory(id, { force });
        renderChart(history.prices);
      } catch (error) {
        document.getElementById("chartStatus").textContent = error.message || "Price history could not be loaded.";
        document.getElementById("priceChart").innerHTML = "";
      }
    } catch (error) {
      setError(error.message || "Could not load this token. Try again later.");
    } finally {
      loading = false;
      refresh.disabled = false;
    }
  }

  refresh.addEventListener("click", () => load(true));
  load();
})();
