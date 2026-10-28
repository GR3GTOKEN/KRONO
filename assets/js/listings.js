import { getSupabaseClient } from "./supabase-client.js";

(function () {
  const api = window.KronosMarketApi;
  const demos = [
    { id: "bitcoin", category: "Payments", blockchain: "Bitcoin", description: "Directory example for a peer-to-peer digital currency." },
    { id: "ethereum", category: "Layer 1", blockchain: "Ethereum", description: "Directory example for a programmable blockchain network." },
    { id: "solana", category: "Layer 1", blockchain: "Solana", description: "Directory example for a high-throughput blockchain ecosystem." },
    { id: "binancecoin", category: "Infrastructure", blockchain: "BNB Smart Chain", description: "Directory example for a blockchain utility asset." },
    { id: "ripple", category: "Payments", blockchain: "XRP Ledger", description: "Directory example for a digital asset and payment network." },
    { id: "cardano", category: "Layer 1", blockchain: "Cardano", description: "Directory example for a proof-of-stake blockchain." },
    { id: "dogecoin", category: "Meme", blockchain: "Dogecoin", description: "Directory example for a community-led digital currency." },
    { id: "avalanche-2", category: "Layer 1", blockchain: "Avalanche", description: "Directory example for a smart-contract blockchain ecosystem." },
    { id: "polkadot", category: "Infrastructure", blockchain: "Polkadot", description: "Directory example for a multichain network." },
    { id: "chainlink", category: "Infrastructure", blockchain: "Ethereum / Multi-chain", description: "Directory example for decentralized oracle infrastructure." }
  ];

  const grid = document.getElementById("listingGrid");
  if (!grid) return;

  const search = document.getElementById("listingSearch");
  const category = document.getElementById("categoryFilter");
  const sort = document.getElementById("listingSort");
  const status = document.getElementById("listingStatus");
  const publishedStatus = document.getElementById("publishedListingStatus");
  const message = document.getElementById("submissionMessage");
  const submitButton = document.getElementById("submitProjectButton");
  let projects = demos.map((project) => ({ ...project, demo: true }));
  let liveData = new Map();
  let supabase = null;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    })[character]);
  }

  function currency(value) {
    return typeof value === "number" ? api.formatCurrency(value, { compact: true }) : "—";
  }

  function fillCategories() {
    const categories = [...new Set(projects.map((project) => project.category))].sort();
    const selected = category.value;
    category.innerHTML = `<option value="">All categories</option>${categories.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}`;
    category.value = categories.includes(selected) ? selected : "";
  }

  function projectCard(project) {
    const live = liveData.get(project.id);
    const name = live?.name || project.name || project.id;
    const symbol = live?.symbol || project.symbol || "";
    const image = api.safeExternalUrl(live?.image || project.logo);
    const logo = image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" onerror="this.remove()">` : escapeHtml(symbol.slice(0, 2).toUpperCase());
    const canOpen = true;
    const target = `listing.html?id=${encodeURIComponent(project.id)}`;
    const badge = project.demo ? "Example asset · not endorsed" : "Community submission · not independently verified";
    const priceLabel = live ? "Price · CoinGecko" : "Market data unavailable";
    return `<article class="card listing-card">
      <div class="listing-card-top"><span class="asset-name">${logo}<span>${escapeHtml(name)}<span class="asset-symbol">${escapeHtml(symbol)}</span></span></span><span class="listing-tag">${badge}</span></div>
      <h2>${escapeHtml(project.category)}</h2>
      <p>${escapeHtml(project.description)}</p>
      <div class="listing-meta"><span>${escapeHtml(project.blockchain)}</span><span>${live ? `CoinGecko market rank ${live.market_cap_rank ?? "—"}` : "No market rank"}</span></div>
      <div class="listing-market"><span>${currency(live?.current_price)}<br><small>${priceLabel}</small></span><span>${currency(live?.market_cap)}<br><small>${live ? "Market cap · CoinGecko" : "Market cap unavailable"}</small></span></div>
      ${canOpen ? `<a class="details" href="${target}">View project details →</a>` : `<span class="fine-print">Preview only · no live data</span>`}
    </article>`;
  }

  function render() {
    const query = search.value.trim().toLowerCase();
    let visible = projects.filter((project) => {
      const live = liveData.get(project.id);
      const name = (live?.name || project.name || project.id).toLowerCase();
      const symbol = (live?.symbol || project.symbol || "").toLowerCase();
      return (!query || name.includes(query) || symbol.includes(query))
        && (!category.value || project.category === category.value);
    });
    const [field, direction] = sort.value.endsWith("_asc")
      ? [sort.value.slice(0, -4), 1]
      : [sort.value.slice(0, -5), -1];
    visible.sort((a, b) => {
      if (field === "name") return (liveData.get(a.id)?.name || a.name || a.id).localeCompare(liveData.get(b.id)?.name || b.name || b.id) * direction;
      const left = liveData.get(a.id)?.market_cap;
      const right = liveData.get(b.id)?.market_cap;
      return (typeof left === "number" ? left : Number.NEGATIVE_INFINITY) - (typeof right === "number" ? right : Number.NEGATIVE_INFINITY) > 0 ? -direction : direction;
    });
    grid.innerHTML = visible.length ? visible.map(projectCard).join("") : '<div class="card empty-state"><strong>No matching projects</strong>Try a different search term or category.</div>';
  }

  async function loadMarkets() {
    try {
      const ids = demos.map((project) => project.id).join(",");
      const coins = await api.getMarkets({ ids, perPage: demos.length });
      if (!Array.isArray(coins)) throw new Error("The provider returned an unexpected response.");
      liveData = new Map(coins.map((coin) => [coin.id, coin]));
      status.innerHTML = `<span class="success">Market data from CoinGecko</span><span>${coins.length} of ${demos.length} example assets matched provider IDs</span><span>Updated ${api.formatTimestamp()}</span>`;
    } catch (error) {
      status.innerHTML = `<span class="error">${escapeHtml(error.message || "Market data unavailable.")}</span><span>Example metadata remains visible; live market fields are unavailable.</span>`;
    }
    render();
  }

  async function loadPublishedListings() {
    if (!supabase) {
      publishedStatus.textContent = "Persistent project listings are unavailable until Supabase is configured.";
      return;
    }
    const { data, error } = await supabase
      .from("project_submissions")
      .select("id,name,symbol,blockchain,contract,website,logo,category,description,status,created_at")
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    const published = (data || []).map((item) => ({ ...item, demo: false }));
    projects = projects.filter((project) => project.demo).concat(published);
    fillCategories();
    render();
    publishedStatus.textContent = published.length
      ? `${published.length} approved community listing${published.length === 1 ? "" : "s"}. Approval is not an independent endorsement or safety review.`
      : "No approved community project submissions are published yet.";
  }

  async function submitProject(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const website = api.safeExternalUrl(data.get("website"));
    const logo = api.safeExternalUrl(data.get("logo"));
    if (!website || !logo) {
      message.dataset.state = "error";
      message.textContent = "Enter valid HTTP or HTTPS website and logo URLs.";
      return;
    }

    if (!supabase) {
      message.dataset.state = "error";
      message.textContent = "Project submissions are unavailable until the KRONOS Supabase project is configured.";
      return;
    }
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      message.dataset.state = "error";
      message.textContent = `Could not verify your account: ${sessionError.message}`;
      return;
    }
    if (!sessionData.session?.user) {
      message.dataset.state = "error";
      message.innerHTML = 'Sign in or create a KRONOS account before submitting. <a href="login.html">Go to account access</a>.';
      return;
    }

    const payload = {
      name: String(data.get("name")).trim(),
      symbol: String(data.get("symbol")).trim().toUpperCase(),
      blockchain: String(data.get("blockchain")).trim(),
      contract: String(data.get("contract")).trim(),
      website,
      logo,
      category: String(data.get("category")),
      description: String(data.get("description")).trim(),
      contact: String(data.get("contact")).trim()
    };
    submitButton.disabled = true;
    submitButton.textContent = "Submitting…";
    try {
      const { error } = await supabase.from("project_submissions").insert(payload);
      if (error) {
        if (error.code === "23505") {
          throw new Error("A submission for this network and contract is already pending or published.");
        }
        if (error.code === "42P01" || error.code === "PGRST205") {
          throw new Error("The project submission migration has not been applied to Supabase yet.");
        }
        throw error;
      }
      form.reset();
      message.dataset.state = "success";
      message.textContent = "Project submitted for review. It will not appear publicly unless an administrator approves it.";
    } catch (error) {
      message.dataset.state = "error";
      message.textContent = error instanceof Error ? error.message : "Could not submit the project. Please try again.";
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Submit for review";
    }
  }

  fillCategories();
  search.addEventListener("input", render);
  category.addEventListener("change", render);
  sort.addEventListener("change", render);
  document.getElementById("projectForm").addEventListener("submit", submitProject);
  render();
  Promise.allSettled([
    loadMarkets(),
    getSupabaseClient().then((client) => {
      supabase = client;
      return loadPublishedListings();
    })
  ]).then((results) => {
    const listingLoad = results[1];
    if (listingLoad.status === "rejected") {
      publishedStatus.textContent = listingLoad.reason instanceof Error
        ? `Approved project listings could not be loaded: ${listingLoad.reason.message}`
        : "Approved project listings could not be loaded.";
    }
  });
})();
