(function () {
  const registry = { capabilities: [], networks: [], ready: false };
  const capabilityGrid = document.getElementById("capabilityGrid");
  const networkRegistry = document.getElementById("networkRegistry");

  function renderCapabilities() {
    capabilityGrid.replaceChildren();
    registry.capabilities.forEach((capability) => {
      const card = document.createElement("article");
      card.className = "capability";
      const header = document.createElement("header");
      const title = document.createElement("h2");
      title.textContent = capability.name;
      const status = document.createElement("span");
      status.className = "status";
      status.dataset.status = capability.status;
      status.textContent = capability.status;
      const description = document.createElement("p");
      description.textContent = capability.details;
      header.append(title, status);
      card.append(header, description);
      capabilityGrid.append(card);
    });
  }

  function renderNetworks() {
    networkRegistry.replaceChildren();
    registry.networks.forEach((network) => {
      const heading = document.createElement("h3");
      heading.textContent = network.name;
      const details = document.createElement("dl");
      const entries = [
        ["Chain ID", Number.isInteger(network.chain_id) ? String(network.chain_id) : "Non-EVM network"],
        ["Native currency", `${network.native_currency.name} (${network.native_currency.symbol}, ${network.native_currency.decimals} decimals)`],
        ["Environment", network.environment],
        ["Market data", network.market_data_enabled ? "CoinGecko global asset data (not chain-specific DEX data)" : "Unavailable"],
        ["Wallet connection", network.wallet_connection_enabled ? "EVM wallet connection and on-wallet balance reads" : "Not implemented"],
        ["0x provider", network.provider_configured ? "Credentials configured" : network.same_chain_swap_supported ? "Credentials not configured" : "Not supported"],
        ["Quote endpoint", network.quote_endpoint_configured ? `Configured; live operation ${String(network.quote_endpoint_status || "UNVERIFIED").toLowerCase()}` : "Not configured"],
        ["Wallet adapter", network.wallet_adapter_available ? "Available; runtime not verified" : "Unavailable"],
        ["Transaction execution", network.transaction_execution_implemented ? "Implemented" : "Not implemented"],
        ["End-to-end workflow", network.end_to_end_workflow_tested ? "Tested" : "Not tested"],
        ["Production review", network.production_readiness_reviewed ? "Reviewed" : "Not reviewed"],
        ["Cross-chain swaps", network.cross_chain_swap_enabled ? "Enabled" : "Not implemented"],
        ["Trading execution", "Disabled"]
      ];
      if (network.status_note) entries.push(["Status note", network.status_note]);

      entries.forEach(([label, value]) => {
        const term = document.createElement("dt");
        term.textContent = label;
        const description = document.createElement("dd");
        description.textContent = value;
        details.append(term, description);
      });

      const explorerTerm = document.createElement("dt");
      explorerTerm.textContent = "Explorer";
      const explorerDescription = document.createElement("dd");
      const explorerLink = document.createElement("a");
      explorerLink.href = network.explorer_url;
      explorerLink.textContent = network.explorer_url;
      explorerLink.target = "_blank";
      explorerLink.rel = "noopener noreferrer";
      explorerDescription.append(explorerLink);
      details.append(explorerTerm, explorerDescription);
      networkRegistry.append(heading, details);
    });
  }

  async function load() {
    const response = await fetch("/api/v1/platform/status", {
      headers: { accept: "application/json" },
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(`Platform registry request failed (${response.status}).`);
    }
    const value = await response.json();
    if (!value || !Array.isArray(value.capabilities) || !Array.isArray(value.networks)) {
      throw new Error("The platform registry returned an invalid response.");
    }
    registry.capabilities = value.capabilities;
    registry.networks = value.networks;
    registry.ready = true;
    const notice = document.getElementById("tradingNotice");
    if (notice) {
      notice.textContent = "Swap execution is disabled. Provider credentials do not establish quote endpoint health; the transaction workflow is not implemented, end-to-end testing has not passed, and production readiness has not been independently reviewed.";
    }
    renderCapabilities();
    renderNetworks();
  }

  window.KronosPlatformRegistry = registry;
  load().catch((error) => {
    const message = document.createElement("p");
    message.className = "notice";
    message.setAttribute("role", "alert");
    message.textContent = `${error instanceof Error ? error.message : "Platform status is unavailable."} Use the KRONOS application server to load the authoritative status registry.`;
    capabilityGrid.replaceChildren(message);
  });
})();
