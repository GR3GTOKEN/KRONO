(function () {
  const wallet = window.KronosWallet;
  const elements = {
    notice: document.getElementById("swapCapabilityNotice"),
    network: document.getElementById("swapNetwork"),
    status: document.getElementById("swapStatus"),
    fromAmount: document.getElementById("swap-from-amount"),
    fromAsset: document.getElementById("swap-from"),
    toAmount: document.getElementById("swap-to-amount"),
    toAsset: document.getElementById("swap-to"),
    rate: document.getElementById("swap-rate"),
    slippage: document.getElementById("swapSlippage"),
    assetCount: document.getElementById("swap-asset-count"),
    updated: document.getElementById("swap-updated"),
    submit: document.getElementById("getQuote"),
    review: document.getElementById("swapQuoteReview")
  };

  if (!elements.notice || !elements.network || !elements.status || !elements.fromAmount || !elements.fromAsset || !elements.toAmount || !elements.toAsset || !elements.rate || !elements.slippage || !elements.submit || !elements.review) {
    return;
  }

  const addressPattern = /^0x[a-fA-F0-9]{40}$/;
  const state = {
    networks: [],
    selectedNetwork: null,
    quoteGeneration: 0,
    quoteController: null
  };

  function setStatus(message, stateName) {
    elements.status.textContent = message || "";
    elements.status.dataset.state = stateName || "";
  }

  function formatUnits(rawValue, decimals) {
    if (typeof rawValue !== "string" || !/^\d+$/.test(rawValue)) return null;
    const raw = BigInt(rawValue);
    const base = 10n ** BigInt(decimals);
    if (decimals === 0) return raw.toString();
    const whole = raw / base;
    const fraction = (raw % base).toString().padStart(decimals, "0").replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
  }

  function parseUnits(value, decimals) {
    const amount = value.trim();
    if (!/^\d+(?:\.\d+)?$/.test(amount)) throw new Error("Enter a valid positive token amount.");
    const [whole, fraction = ""] = amount.split(".");
    if (fraction.length > decimals) throw new Error(`This token supports at most ${decimals} decimal places.`);
    const raw = BigInt(`${whole}${fraction.padEnd(decimals, "0")}`);
    if (raw <= 0n) throw new Error("Enter an amount greater than zero.");
    return raw.toString();
  }

  function clearQuote() {
    state.quoteGeneration += 1;
    if (state.quoteController) state.quoteController.abort();
    state.quoteController = null;
    elements.review.hidden = true;
    elements.toAmount.value = "";
    elements.rate.textContent = elements.fromAmount.value.trim() ? "Request a live firm quote" : "—";
  }

  function setCapabilityText(network) {
    if (!network) {
      elements.notice.textContent = "No supported EVM network is available.";
      return;
    }
    if (!network.same_chain_swap_supported) {
      elements.notice.textContent = `${network.name}: the 0x Swap API does not support this network.`;
      return;
    }

    const provider = network.provider_configured
      ? "0x credentials are configured"
      : "0x credentials are not configured";
    const quote = network.quote_endpoint_status === "VERIFIED"
      ? "quote endpoint verified"
      : "quote endpoint live operation is unverified";
    const walletStatus = network.wallet_adapter_available
      ? "EVM wallet adapter is available"
      : "EVM wallet adapter is unavailable";
    elements.notice.textContent = `${network.name}: ${provider}; ${quote}; ${walletStatus}. Transaction execution is not implemented, end-to-end testing and production review are incomplete, and swaps are disabled.`;
  }

  function syncSubmitButton() {
    const address = wallet && wallet.getAddress ? wallet.getAddress() : "";
    const chainId = wallet && wallet.getChainId ? wallet.getChainId() : null;
    if (!address) {
      elements.submit.disabled = false;
      elements.submit.textContent = "Connect wallet";
      return;
    }
    if (!state.selectedNetwork) {
      elements.submit.disabled = true;
      elements.submit.textContent = "Select network";
      return;
    }
    if (chainId !== Number(state.selectedNetwork.chain_id)) {
      elements.submit.disabled = true;
      elements.submit.textContent = "Switch wallet network";
      return;
    }
    if (!state.selectedNetwork.provider_configured) {
      elements.submit.disabled = true;
      elements.submit.textContent = "Quote provider not configured";
      return;
    }
    elements.submit.disabled = false;
    elements.submit.textContent = "Request firm quote";
  }

  function refreshWalletMessage() {
    const address = wallet && wallet.getAddress ? wallet.getAddress() : "";
    const chainId = wallet && wallet.getChainId ? wallet.getChainId() : null;
    const targetNetwork = state.selectedNetwork;
    if (!address) {
      setStatus("Connect an EVM wallet to request a provider quote. Transaction signing and execution are disabled.", "pending");
      return;
    }
    if (!targetNetwork) {
      setStatus("Select a supported EVM network to continue.", "pending");
      return;
    }
    if (chainId !== Number(targetNetwork.chain_id)) {
      setStatus(`Switch the connected wallet to ${targetNetwork.name} before requesting a quote.`, "pending");
      return;
    }
    setStatus("Wallet connected. Quotes require configured 0x credentials; this page cannot approve or submit transactions.", "pending");
  }

  function handleNetworkChange() {
    const value = elements.network.value;
    state.selectedNetwork = state.networks.find((network) => String(network.chain_id) === value) || null;
    clearQuote();
    if (!state.selectedNetwork) {
      setCapabilityText(null);
      setStatus("No supported network could be selected.", "error");
      syncSubmitButton();
      return;
    }
    setCapabilityText(state.selectedNetwork);
    refreshWalletMessage();
    syncSubmitButton();
  }

  async function readTokenDecimals(provider, address) {
    const result = await provider.request({
      method: "eth_call",
      params: [{ to: address, data: "0x313ce567" }, "latest"]
    });
    if (typeof result !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(result)) {
      throw new Error(`Could not read decimals from token contract ${address}.`);
    }
    const decimals = Number(BigInt(result));
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
      throw new Error(`Token ${address} reports unsupported decimal precision.`);
    }
    return decimals;
  }

  async function verifyWalletContext(provider, expectedAddress, expectedChainId) {
    const [chainId, accounts] = await Promise.all([
      provider.request({ method: "eth_chainId" }),
      provider.request({ method: "eth_accounts" })
    ]);
    if (typeof chainId !== "string" || Number.parseInt(chainId, 16) !== Number(expectedChainId)) {
      throw new Error("The connected wallet is no longer on the selected network.");
    }
    const activeAddress = Array.isArray(accounts) ? accounts[0] : null;
    if (
      typeof activeAddress !== "string"
      || !addressPattern.test(activeAddress)
      || activeAddress.toLowerCase() !== expectedAddress.toLowerCase()
    ) {
      throw new Error("The connected wallet account changed. Reconnect it before requesting a quote.");
    }
    return activeAddress;
  }

  function formatProviderFees(quote, sellAddress, buyAddress, sellDecimals, buyDecimals) {
    const lines = ["zeroExFee", "integratorFee", "gasFee"].flatMap((name) => {
      const fee = quote.fees?.[name];
      if (!fee || typeof fee.amount !== "string" || !/^\d+$/.test(fee.amount)) return [];
      const token = typeof fee.token === "string" ? fee.token : "";
      const tokenLower = token.toLowerCase();
      const decimals = tokenLower === sellAddress.toLowerCase()
        ? sellDecimals
        : tokenLower === buyAddress.toLowerCase()
          ? buyDecimals
          : null;
      const amount = decimals === null ? `${fee.amount} base units` : formatUnits(fee.amount, decimals);
      return [`${name}: ${amount}${token ? ` · ${token}` : ""}`];
    });
    return lines.length ? lines.join(" · ") : "No additional token fee reported by provider";
  }

  function showQuote(quote, sellDecimals, buyDecimals, sellAmount, buyAddress, sellAddress) {
    if (
      quote.liquidityAvailable !== true
      || quote.sellToken?.toLowerCase() !== sellAddress.toLowerCase()
      || quote.buyToken?.toLowerCase() !== buyAddress.toLowerCase()
      || quote.sellAmount !== sellAmount
      || typeof quote.buyAmount !== "string"
      || !/^\d+$/.test(quote.buyAmount)
      || typeof quote.minBuyAmount !== "string"
      || !/^\d+$/.test(quote.minBuyAmount)
      || BigInt(quote.minBuyAmount) <= 0n
      || BigInt(quote.minBuyAmount) > BigInt(quote.buyAmount)
      || !quote.transaction
    ) {
      throw new Error("The quote response did not match the requested tokens and amount.");
    }

    const output = formatUnits(quote.buyAmount, buyDecimals);
    const minimum = formatUnits(quote.minBuyAmount, buyDecimals);
    const input = formatUnits(quote.sellAmount, sellDecimals);
    if (output === null || minimum === null || input === null) {
      throw new Error("The provider returned an invalid token amount.");
    }
    elements.toAmount.value = output;
    elements.rate.textContent = `${input} input → ${output} estimated output`;
    document.getElementById("quoteSellAmount").textContent = `${input} · ${sellAddress}`;
    document.getElementById("quoteBuyAmount").textContent = `${output} · ${buyAddress}`;
    document.getElementById("quoteMinimumReceived").textContent = `${minimum} · ${buyAddress}`;
    const feeAmount = formatUnits(quote.totalNetworkFee || "", state.selectedNetwork.native_currency.decimals);
    document.getElementById("quoteNetworkFee").textContent = feeAmount === null
      ? "Not reported by provider"
      : `${feeAmount} ${state.selectedNetwork.native_currency.symbol} · provider estimate`;
    document.getElementById("quoteProviderFees").textContent =
      formatProviderFees(quote, sellAddress, buyAddress, sellDecimals, buyDecimals);
    document.getElementById("quotePriceImpact").textContent = "Not reported by provider";
    const routeSources = Array.isArray(quote.route?.fills)
      ? [...new Set(quote.route.fills.map((fill) => fill.source).filter((source) => typeof source === "string"))]
      : [];
    document.getElementById("quoteRoute").textContent = routeSources.length ? routeSources.join(", ") : "Provider route details unavailable";
    document.getElementById("quoteBlock").textContent = typeof quote.blockNumber === "string" ? quote.blockNumber : "Not reported";
    elements.review.hidden = false;
  }

  async function requestQuote() {
    const walletAddress = wallet && wallet.getAddress ? wallet.getAddress() : "";
    if (!walletAddress) {
      document.querySelector("[data-wallet-connect]")?.click();
      setStatus("Connect an EVM wallet before requesting a quote.", "pending");
      return;
    }
    if (!state.selectedNetwork || wallet.getChainId() !== Number(state.selectedNetwork.chain_id)) {
      setStatus("Connect the wallet to the selected network before requesting a quote.", "error");
      return;
    }
    if (!state.selectedNetwork.provider_configured) {
      setStatus("Firm quotes are unavailable until the server is configured with ZEROX_API_KEY.", "error");
      return;
    }

    const generation = ++state.quoteGeneration;
    if (state.quoteController) state.quoteController.abort();
    state.quoteController = new AbortController();
    const currentController = state.quoteController;
    elements.submit.disabled = true;
    elements.submit.textContent = "Preparing provider quote…";
    elements.review.hidden = true;
    setStatus("Reading token precision from the connected network and requesting a firm quote…", "pending");
    const timeout = window.setTimeout(() => currentController.abort(), 20000);

    try {
      const sellAddress = elements.fromAsset.value.trim();
      const buyAddress = elements.toAsset.value.trim();
      if (!addressPattern.test(sellAddress) || !addressPattern.test(buyAddress)) {
        throw new Error("Enter valid ERC-20 contract addresses for both assets.");
      }
      if (sellAddress.toLowerCase() === buyAddress.toLowerCase()) {
        throw new Error("Choose two different token contracts.");
      }
      const slippageBps = Number(elements.slippage.value);
      if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 500) {
        throw new Error("Slippage must be between 0 and 500 basis points.");
      }
      const provider = await wallet.getProviderAsync();
      if (!provider) throw new Error("Reconnect the wallet before requesting a quote.");
      const activeWalletAddress = await verifyWalletContext(
        provider,
        walletAddress,
        state.selectedNetwork.chain_id
      );
      const [sellDecimals, buyDecimals] = await Promise.all([
        readTokenDecimals(provider, sellAddress),
        readTokenDecimals(provider, buyAddress)
      ]);
      await verifyWalletContext(provider, activeWalletAddress, state.selectedNetwork.chain_id);
      const sellAmount = parseUnits(elements.fromAmount.value, sellDecimals);
      const params = new URLSearchParams({
        chainId: String(state.selectedNetwork.chain_id),
        sellToken: sellAddress,
        buyToken: buyAddress,
        sellAmount,
        taker: activeWalletAddress,
        slippageBps: String(slippageBps)
      });
      const response = await fetch(`/api/v1/swap/quote?${params}`, {
        headers: { accept: "application/json" },
        signal: currentController.signal,
        cache: "no-store"
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(typeof payload.detail === "string" ? payload.detail : "The quote provider is unavailable.");
      }
      if (generation !== state.quoteGeneration) return;
      showQuote(payload, sellDecimals, buyDecimals, sellAmount, buyAddress, sellAddress);
      setStatus("Firm quote received. Review the amounts and estimated network fee. No approval or transaction will be submitted.", "success");
    } catch (error) {
      if (generation !== state.quoteGeneration) return;
      const message = error instanceof Error
        ? error.name === "AbortError" ? "Quote request timed out or was cancelled." : error.message
        : "Could not obtain a firm quote.";
      setStatus(message, "error");
    } finally {
      window.clearTimeout(timeout);
      if (generation === state.quoteGeneration) {
        elements.submit.disabled = false;
        syncSubmitButton();
      }
    }
  }

  async function loadNetworkRegistry() {
    try {
      const response = await fetch("/api/v1/platform/status", {
        headers: { accept: "application/json" },
        cache: "no-store"
      });
      if (!response.ok) throw new Error("Network capability registry unavailable.");
      const status = await response.json();
      const networks = Array.isArray(status.networks)
        ? status.networks.filter((network) => network.evm && network.wallet_connection_enabled)
        : [];
      state.networks = networks;
      if (!networks.length) {
        elements.network.innerHTML = '<option value="">Unavailable</option>';
        elements.network.disabled = true;
        elements.notice.textContent = "No supported EVM networks were returned by the registry.";
        elements.assetCount.textContent = "0";
        setStatus("The network registry is empty.", "error");
        return;
      }
      elements.assetCount.textContent = String(networks.length);
      elements.updated.textContent = networks.some((network) => network.provider_configured)
        ? "0x credentials · configured, unverified"
        : "0x credentials · setup required";
      elements.network.innerHTML = networks
        .map((network) => `<option value="${network.chain_id}">${network.name}</option>`)
        .join("");
      const preferred = networks.find((network) => network.chain_id === 1) || networks[0];
      elements.network.value = String(preferred.chain_id);
      handleNetworkChange();
    } catch (error) {
      elements.notice.textContent = error instanceof Error ? error.message : "Registry unavailable.";
      elements.network.innerHTML = '<option value="">Unavailable</option>';
      elements.network.disabled = true;
      elements.assetCount.textContent = "0";
      setStatus("The swap registry could not be loaded.", "error");
    }
  }

  function wireEvents() {
    elements.network.addEventListener("change", handleNetworkChange);
    [elements.fromAmount, elements.fromAsset, elements.toAsset, elements.slippage].forEach((input) => {
      input.addEventListener("input", clearQuote);
      input.addEventListener("change", clearQuote);
    });
    elements.submit.addEventListener("click", requestQuote);
    document.getElementById("swap-direction").addEventListener("click", () => {
      const sellAddress = elements.fromAsset.value;
      elements.fromAsset.value = elements.toAsset.value;
      elements.toAsset.value = sellAddress;
      clearQuote();
    });
    window.addEventListener("kronos:walletChanged", () => {
      clearQuote();
      refreshWalletMessage();
      syncSubmitButton();
    });
    const menuToggle = document.querySelector(".menu-toggle");
    const mobileMenu = document.querySelector(".mobile-menu");
    if (menuToggle && mobileMenu) {
      menuToggle.addEventListener("click", () => {
        const isOpen = mobileMenu.classList.toggle("is-open");
        menuToggle.setAttribute("aria-expanded", String(isOpen));
      });
      mobileMenu.addEventListener("click", (event) => {
        if (event.target instanceof HTMLAnchorElement) {
          mobileMenu.classList.remove("is-open");
          menuToggle.setAttribute("aria-expanded", "false");
        }
      });
    }
  }

  wireEvents();
  setStatus("Select a network and ERC-20 contracts. Quotes require server credentials; transaction execution remains disabled.", "pending");
  refreshWalletMessage();
  syncSubmitButton();
  loadNetworkRegistry();
})();
