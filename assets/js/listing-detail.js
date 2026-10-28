import { getSupabaseClient } from "./supabase-client.js";

(function () {
  const api = window.KronosMarketApi;
  const id = new URLSearchParams(window.location.search).get("id");
  const status = document.getElementById("listingDetailStatus");
  const detail = document.getElementById("listingDetail");
  const error = document.getElementById("listingError");
  const errorText = document.getElementById("listingErrorText");

  const demoProjects = new Map([
    ["bitcoin", { category: "Payments", blockchain: "Bitcoin", description: "Directory example for a peer-to-peer digital currency." }],
    ["ethereum", { category: "Layer 1", blockchain: "Ethereum", description: "Directory example for a programmable blockchain network." }],
    ["solana", { category: "Layer 1", blockchain: "Solana", description: "Directory example for a high-throughput blockchain ecosystem." }],
    ["binancecoin", { category: "Infrastructure", blockchain: "BNB Smart Chain", description: "Directory example for a blockchain utility asset." }],
    ["ripple", { category: "Payments", blockchain: "XRP Ledger", description: "Directory example for a digital asset and payment network." }],
    ["cardano", { category: "Layer 1", blockchain: "Cardano", description: "Directory example for a proof-of-stake blockchain." }],
    ["dogecoin", { category: "Meme", blockchain: "Dogecoin", description: "Directory example for a community-led digital currency." }],
    ["avalanche-2", { category: "Layer 1", blockchain: "Avalanche", description: "Directory example for a smart-contract blockchain ecosystem." }],
    ["polkadot", { category: "Infrastructure", blockchain: "Polkadot", description: "Directory example for a multichain network." }],
    ["chainlink", { category: "Infrastructure", blockchain: "Ethereum / Multi-chain", description: "Directory example for decentralized oracle infrastructure." }]
  ]);

  function text(target, value) {
    document.getElementById(target).textContent = value || "Not provided";
  }

  function showError(message) {
    status.hidden = true;
    errorText.textContent = message;
    error.hidden = false;
  }

  function renderLinks(coin, preview) {
    const links = [];
    const website = api.safeExternalUrl(preview?.website || coin?.links?.homepage?.find(Boolean));
    const explorer = api.safeExternalUrl(coin?.links?.blockchain_site?.find(Boolean));
    if (website) links.push(`<a href="${website}" target="_blank" rel="noopener noreferrer">Website</a>`);
    if (explorer) links.push(`<a href="${explorer}" target="_blank" rel="noopener noreferrer">Explorer</a>`);
    document.getElementById("projectLinks").innerHTML = links.length ? links.join("") : '<span class="fine-print">No official project links supplied.</span>';
  }

  async function load() {
    if (!id) {
      showError("No project ID was provided.");
      return;
    }
    if (!/^[a-zA-Z0-9-]+$/.test(id)) {
      showError("The project ID is invalid.");
      return;
    }
    try {
      const project = demoProjects.get(id);
      if (!project) {
        const supabase = await getSupabaseClient();
        if (!supabase) throw new Error("Persistent project listings are unavailable until Supabase is configured.");
        const { data, error: listingError } = await supabase
          .from("project_submissions")
          .select("id,name,symbol,blockchain,contract,website,logo,category,description,status,created_at")
          .eq("id", id)
          .eq("status", "approved")
          .maybeSingle();
        if (listingError) throw listingError;
        if (!data) throw new Error("This community listing is not published or no longer available.");
        document.title = `${data.name} Listing — KRONOS`;
        text("projectName", data.name);
        text("projectSymbol", data.symbol.toUpperCase());
        const logo = api.safeExternalUrl(data.logo);
        document.getElementById("projectLogo").innerHTML = logo ? `<img src="${logo}" alt="">` : data.symbol.slice(0, 2).toUpperCase();
        ["projectPrice", "projectChange", "projectMarketCap", "projectVolume"].forEach((key) => text(key, "No linked market data"));
        text("projectDescription", data.description);
        renderLinks(null, data);
        text("projectMetadataLabel", "Persisted community submission · approved for publication, not independently verified by KRONOS");
        text("projectBadge", "Community submission · not independently verified");
        text("projectCategory", data.category);
        text("projectChain", data.blockchain);
        text("projectContract", data.contract);
        status.hidden = false;
        detail.hidden = false;
        error.hidden = true;
        status.innerHTML = '<span class="success">Published community listing</span>';
        return;
      }
      const coin = await api.getCoin(id);
      status.hidden = false;
      detail.hidden = false;
      error.hidden = true;
      if (coin) {
        document.title = `${coin.name} Listing — KRONOS`;
        text("projectName", coin.name);
        text("projectSymbol", coin.symbol.toUpperCase());
        const logo = api.safeExternalUrl(coin.image?.large || coin.image?.small);
        document.getElementById("projectLogo").innerHTML = logo ? `<img src="${logo}" alt="">` : coin.symbol.slice(0, 2).toUpperCase();
        const market = coin.market_data || {};
        text("projectPrice", api.formatCurrency(market.current_price?.usd));
        const change = market.price_change_percentage_24h;
        text("projectChange", api.formatChange(change));
        document.getElementById("projectChange").className = typeof change === "number" ? (change >= 0 ? "positive" : "negative") : "";
        text("projectMarketCap", api.formatCurrency(market.market_cap?.usd, { compact: true }));
        text("projectVolume", api.formatCurrency(market.total_volume?.usd, { compact: true }));
        const providerDescription = coin.description?.en?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        text("projectDescription", providerDescription || project.description);
        renderLinks(coin, null);
        text("projectMetadataLabel", "Identity and market data from CoinGecko · example category and network metadata");
      }
      text("projectBadge", "Example asset · not a verified listing");
      text("projectCategory", project.category);
      text("projectChain", project.blockchain);
      text("projectContract", "Not provided");
      status.innerHTML = '<span class="success">Example asset data loaded</span>';
    } catch (requestError) {
      detail.hidden = true;
      showError(requestError.message || "Project information is currently unavailable.");
    }
  }

  load();
})();
