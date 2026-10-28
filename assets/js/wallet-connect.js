(function () {
  const projectId = "bc30b4aa529543b802f21f8ffbf32acf";
  const addressPattern = /^0x[a-fA-F0-9]{40}$/;
  const supportedChains = [1, 56, 137, 42161, 8453, 43114, 10];
  const dialog = document.createElement("dialog");
  dialog.className = "wallet-dialog";
  dialog.setAttribute("aria-labelledby", "walletDialogTitle");
  dialog.innerHTML = `
    <h2 id="walletDialogTitle">Connect an EVM wallet</h2>
    <p>Connect a wallet independently of your KRONOS account. KRONOS never receives your private keys.</p>
    <div class="wallet-dialog-options">
      <button class="wallet-dialog-option" type="button" data-wallet-provider="metamask">
        <span class="wallet-option-icon" aria-hidden="true">◆</span>
        <span class="wallet-option-copy"><strong>MetaMask</strong><small>Use your MetaMask EVM wallet</small></span>
      </button>
      <button class="wallet-dialog-option" type="button" data-wallet-provider="phantom">
        <span class="wallet-option-icon" aria-hidden="true">◈</span>
        <span class="wallet-option-copy"><strong>Phantom (EVM)</strong><small>Connect Phantom's EVM wallet</small></span>
      </button>
      <button class="wallet-dialog-option" type="button" data-wallet-provider="walletconnect">
        <span class="wallet-option-icon" aria-hidden="true">◎</span>
        <span class="wallet-option-copy"><strong>WalletConnect</strong><small>Scan a QR code or open a mobile EVM wallet</small></span>
      </button>
    </div>
    <p class="wallet-dialog-status" role="status" aria-live="polite"></p>
    <button class="wallet-dialog-close" type="button">Cancel</button>`;
  document.body.appendChild(dialog);

  const status = dialog.querySelector(".wallet-dialog-status");
  const optionButtons = Array.from(dialog.querySelectorAll("[data-wallet-provider]"));
  const walletMessage = document.getElementById("walletMessage");
  let activeProvider;
  let activeProviderType;
  let walletConnectProvider;
  const providerListeners = new WeakMap();

  function report(message, state) {
    status.textContent = message;
    status.dataset.state = state || "";
    if (walletMessage) {
      walletMessage.textContent = message;
      walletMessage.dataset.state = state || "";
    }
  }

  function dispatchWalletChange() {
    window.dispatchEvent(new CustomEvent("kronos:walletChanged", {
      detail: {
        address: localStorage.getItem("krnoWalletAddress"),
        chainId: localStorage.getItem("krnoWalletChainId"),
        provider: localStorage.getItem("krnoWalletProvider")
      }
    }));
  }

  function updateWalletButtons() {
    const address = localStorage.getItem("krnoWalletAddress");
    document.querySelectorAll("[data-wallet-connect]").forEach((button) => {
      const label = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Connect Wallet";
      const text = button.querySelector("[data-wallet-label]") || button;
      text.textContent = label;
      button.setAttribute("aria-label", address ? `Connected wallet ${label}` : "Connect Wallet");
      const indicator = button.querySelector(".wallet-dot");
      if (indicator) indicator.classList.toggle("connected", Boolean(address));
    });
  }

  function getInjectedProvider(providerType) {
    if (providerType === "metamask") {
      return window.ethereum && window.ethereum.isMetaMask ? window.ethereum : undefined;
    }
    if (providerType === "phantom") {
      return (window.phantom && window.phantom.ethereum)
        || (window.ethereum && window.ethereum.isPhantom ? window.ethereum : undefined);
    }
    return undefined;
  }

  async function getWalletConnectProvider() {
    if (walletConnectProvider) return walletConnectProvider;
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
      throw new Error("WalletConnect requires this site to be served over HTTPS or localhost.");
    }
    const { EthereumProvider } = await import("https://esm.sh/@walletconnect/ethereum-provider@2.17.0?bundle");
    walletConnectProvider = await EthereumProvider.init({
      projectId,
      chains: [1],
      optionalChains: supportedChains.filter((chainId) => chainId !== 1),
      showQrModal: true,
      metadata: {
        name: "KRONOS",
        description: "KRONOS crypto intelligence",
        url: window.location.origin,
        icons: [`${window.location.origin}/assets/kronos%20main.png`]
      }
    });
    if (typeof walletConnectProvider.on === "function") {
      walletConnectProvider.on("display_uri", () => report("Scan the WalletConnect QR code with your wallet.", "pending"));
    }
    return walletConnectProvider;
  }

  function attachProviderEvents(provider, providerType) {
    if (typeof provider.on !== "function" || providerListeners.has(provider)) return;
    const listeners = {
      accountsChanged: (accounts) => {
      const address = Array.isArray(accounts) ? accounts[0] : undefined;
      if (typeof address === "string" && addressPattern.test(address)) {
        localStorage.setItem("krnoWalletAddress", address);
      } else {
        localStorage.removeItem("krnoWalletAddress");
        localStorage.removeItem("krnoWalletProvider");
        localStorage.removeItem("krnoWalletChainId");
      }
      updateWalletButtons();
      dispatchWalletChange();
      },
      chainChanged: (chainId) => {
      if (typeof chainId === "string" && /^0x[0-9a-f]+$/i.test(chainId)) {
        localStorage.setItem("krnoWalletChainId", chainId);
      }
      localStorage.setItem("krnoWalletProvider", providerType);
      updateWalletButtons();
      dispatchWalletChange();
      },
      disconnect: () => clearLocalConnection()
    };
    Object.entries(listeners).forEach(([eventName, listener]) => provider.on(eventName, listener));
    providerListeners.set(provider, listeners);
  }

  function detachProviderEvents(provider) {
    const listeners = providerListeners.get(provider);
    if (!listeners) return;
    Object.entries(listeners).forEach(([eventName, listener]) => {
      if (typeof provider.removeListener === "function") provider.removeListener(eventName, listener);
      else if (typeof provider.off === "function") provider.off(eventName, listener);
    });
    providerListeners.delete(provider);
  }

  function clearLocalConnection() {
    if (activeProvider) detachProviderEvents(activeProvider);
    localStorage.removeItem("krnoWalletAddress");
    localStorage.removeItem("krnoWalletProvider");
    localStorage.removeItem("krnoWalletChainId");
    activeProvider = undefined;
    activeProviderType = undefined;
    updateWalletButtons();
    dispatchWalletChange();
  }

  async function finishConnection(provider, providerType, redirectToAccount) {
    const accounts = await provider.request({ method: "eth_accounts" });
    const address = Array.isArray(accounts) ? accounts[0] : undefined;
    if (typeof address !== "string" || !addressPattern.test(address)) {
      throw new Error("The wallet did not return a valid EVM account address.");
    }
    const chainId = await provider.request({ method: "eth_chainId" });
    if (typeof chainId !== "string" || !/^0x[0-9a-f]+$/i.test(chainId)) {
      throw new Error("The wallet did not return a valid network identifier.");
    }
    activeProvider = provider;
    activeProviderType = providerType;
    localStorage.setItem("krnoWalletAddress", address);
    localStorage.setItem("krnoWalletProvider", providerType);
    localStorage.setItem("krnoWalletChainId", chainId);
    attachProviderEvents(provider, providerType);
    updateWalletButtons();
    dispatchWalletChange();
    if (redirectToAccount) window.location.href = "account.html";
    return { address, chainId, providerType };
  }

  async function connect(providerType, redirectToAccount) {
    const provider = providerType === "walletconnect"
      ? await getWalletConnectProvider()
      : getInjectedProvider(providerType);
    if (!provider || typeof provider.request !== "function") {
      const name = providerType === "phantom" ? "Phantom EVM" : "MetaMask";
      throw new Error(`No ${name} wallet was detected. Install it or choose another EVM wallet.`);
    }
    await provider.request({ method: "eth_requestAccounts" });
    return finishConnection(provider, providerType, Boolean(redirectToAccount));
  }

  function getProvider() {
    if (activeProvider) return activeProvider;
    const providerType = localStorage.getItem("krnoWalletProvider");
    if (providerType === "walletconnect") return undefined;
    const provider = getInjectedProvider(providerType);
    if (provider) {
      activeProvider = provider;
      activeProviderType = providerType;
      attachProviderEvents(provider, providerType);
    }
    return provider;
  }

  async function getProviderAsync() {
    const provider = getProvider();
    if (provider) return provider;
    if (localStorage.getItem("krnoWalletProvider") !== "walletconnect") return undefined;
    const restoredProvider = await getWalletConnectProvider();
    const accounts = await restoredProvider.request({ method: "eth_accounts" });
    const address = Array.isArray(accounts) ? accounts[0] : undefined;
    if (!addressPattern.test(address || "") || address.toLowerCase() !== (localStorage.getItem("krnoWalletAddress") || "").toLowerCase()) {
      throw new Error("The saved WalletConnect session is no longer available. Reconnect your wallet.");
    }
    const chainId = await restoredProvider.request({ method: "eth_chainId" });
    if (typeof chainId !== "string" || !/^0x[0-9a-f]+$/i.test(chainId)) {
      throw new Error("WalletConnect did not return a valid network identifier.");
    }
    activeProvider = restoredProvider;
    activeProviderType = "walletconnect";
    localStorage.setItem("krnoWalletChainId", chainId);
    attachProviderEvents(restoredProvider, "walletconnect");
    dispatchWalletChange();
    return restoredProvider;
  }

  async function disconnect() {
    let provider = activeProvider || (activeProviderType === "walletconnect" ? walletConnectProvider : undefined);
    const providerType = activeProviderType || localStorage.getItem("krnoWalletProvider");
    let disconnectError;
    if (providerType === "walletconnect" && provider && typeof provider.disconnect === "function") {
      try {
        await provider.disconnect();
      } catch (error) {
        disconnectError = error;
      }
    } else if (providerType === "walletconnect") {
      try {
        provider = await getProviderAsync();
        if (provider && typeof provider.disconnect === "function") await provider.disconnect();
      } catch (error) {
        disconnectError = error;
      }
    }
    clearLocalConnection();
    if (disconnectError) {
      throw new Error(`Disconnected from KRONOS, but WalletConnect could not confirm session revocation: ${disconnectError instanceof Error ? disconnectError.message : "provider unavailable"}`);
    }
    report("Disconnected from KRONOS. Your wallet remains controlled by its provider.", "success");
  }

  async function switchChain(chainId) {
    if (!supportedChains.includes(chainId)) {
      throw new Error("This network is not supported by KRONOS's EVM wallet adapter.");
    }
    const provider = getProvider();
    if (!provider) throw new Error("Reconnect your wallet before switching networks.");
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${chainId.toString(16)}` }]
    });
  }

  window.KronosWallet = {
    connect,
    disconnect,
    getProvider,
    getProviderAsync,
    switchChain,
    getAddress: () => localStorage.getItem("krnoWalletAddress"),
    getChainId: () => {
      const value = localStorage.getItem("krnoWalletChainId");
      return value ? Number.parseInt(value, 16) : null;
    }
  };

  document.querySelectorAll("[data-wallet-connect]").forEach((button) => {
    button.addEventListener("click", () => {
      if (localStorage.getItem("krnoWalletAddress")) {
        if (button.dataset.walletStay !== "true") window.location.href = "account.html";
        return;
      }
      report("", "");
      dialog.showModal();
    });
  });

  optionButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      optionButtons.forEach((option) => { option.disabled = true; });
      const providerName = button.dataset.walletProvider;
      const message = providerName === "walletconnect"
        ? "Opening WalletConnect..."
        : providerName === "phantom"
          ? "Waiting for Phantom approval..."
          : "Waiting for MetaMask approval...";
      report(message, "pending");
      try {
        await connect(providerName, document.body.dataset.swapPage !== "true");
        report("Wallet connected. KRONOS does not hold or control your funds.", "success");
        if (document.body.dataset.swapPage === "true") dialog.close();
      } catch (error) {
        const text = error && error.code === 4001
          ? "Wallet connection was cancelled."
          : error instanceof Error
            ? error.message
            : "Wallet connection failed. Please try again.";
        report(text, "error");
      } finally {
        optionButtons.forEach((option) => { option.disabled = false; });
      }
    });
  });

  document.querySelectorAll("[data-wallet-disconnect]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await disconnect();
      } catch (error) {
        report(error instanceof Error ? error.message : "Wallet disconnect failed.", "error");
      } finally {
        button.disabled = false;
      }
    });
  });

  dialog.querySelector(".wallet-dialog-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  updateWalletButtons();
  if (localStorage.getItem("krnoWalletProvider") === "walletconnect") {
    getProviderAsync().catch((error) => {
      report(error instanceof Error ? error.message : "The WalletConnect session could not be restored.", "error");
    });
  }
})();
