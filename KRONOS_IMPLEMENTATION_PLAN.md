# KRONOS implementation plan

Audit baseline: 20 October 2026 repository inspection. This plan is based on files and behavior in the checked-out workspace; it is not a certification of external provider support, production deployment, or legal compliance.

## Product boundary

The currently verifiable product is a public crypto market-discovery site with separate EVM wallet connection UI. It is not an exchange, custody product, or functioning swap interface. Build market intelligence, accounts, and an approved project directory as usable products first. Treat real wallet-signed trading as a separately gated release track; keep custody, deposits/withdrawals, centralized order books, derivatives, and cross-chain execution out of scope until separately designed and reviewed.

## Verified findings

- `index.html` now loads global metrics, market rows, gainers, trending assets, sparklines, and search through the FastAPI CoinGecko proxy. Loading, partial failure, empty results, and provider attribution are displayed; only provider-returned sparkline values are shown.
- `discover.html` and `token.html` use the same market proxy. Discover has market filters, sorting, paging, refresh, and trending; token pages have details and provider-backed seven-day history.
- `trade.html` adds searchable markets, provider-supplied USD asset stats, and OHLC candles through a cached FastAPI endpoint. Buy/sell controls remain disabled; it explicitly is not an order book, does not submit trades, and shows no simulated activity. Candles are reference market data, not execution quotes.
- `login.html` supports Supabase email/password signup, sign-in, reset-email requests, and recovery password updates. Supabase values are absent in the current environment, so external auth lifecycle behavior is not verified.
- `account.html` requires a Supabase session and supports profile editing, persistent watchlists, own-submission status, admin-only pending-submission review, and connected-wallet native-asset valuation from wallet RPC plus public market data. The wallet estimate excludes ERC-20 holdings and is not a KRONOS-held portfolio or account P&L.
- `listings.html` retains clearly labeled CoinGecko example assets, reads only persisted approved community submissions, and sends authenticated submissions for review. Database execution and the administrator moderation workflow are not verified.
- `wallet-connect.js` implements EVM providers for seven networks. Solana and MultiversX adapters do not exist. Wallet connection is not account authentication. Current 0x supported-chain documentation lists all seven configured EVM chains; token route/liquidity remains pair-specific and is not guaranteed.
- `app/main.py` exposes market, status, auth-config, swap-quote, and swap-price endpoints. `swap.js` validates the current wallet chain/account and token decimal metadata, requests a firm quote through the server proxy, and displays estimated/minimum output, reported provider/network fees, and route sources. Approval, signing, submission, and receipt tracking remain absent; execution is disabled. 0x credentials are absent, so live provider quote behavior is unverified.
- `swap.html` navigation now targets existing market, listing, submission, and research pages. The local HTML reference scan passes for all page links and anchors.
- The app has a non-root Dockerfile; the latest local run passed 31 tests, Python compilation, and syntax checks for all 11 JavaScript files. The Trading page has also been browser-checked at desktop/mobile viewport widths with live provider data. Docker is unavailable in the current environment. There is no Git metadata, configured production service, or provider credential available to verify deployment.
- Supabase migrations configure RLS for profiles, watchlists, public approved listings, owner submissions, and trusted app-metadata admin moderation. The duplicate active network/contract preflight fails safely without deleting data; database execution, policy integration tests, and production configuration have not been verified.
- Swap readiness now distinguishes credential presence, quote endpoint configuration/live verification, wallet-adapter code, transaction implementation, end-to-end testing, and independent production review. The legacy `KRONOS_ENABLE_LIVE_SWAPS` flag cannot enable execution.
- Terms/privacy/risk notice coverage, accessibility, real-device layout, and production security have not been audited to a release standard.

## Phases and acceptance criteria

### 1. Audit and keep this plan current
- Record verified behavior, dependencies, and blockers in `KRONOS_IMPLEMENTATION_STATUS.md`.
- Preserve the existing KRONOS visual identity and don't claim untested capabilities.

### 2. Live market experience
- Replace static financial figures and fictional “featured/current news” with provider-backed values or explicit unavailable states.
- Reuse the market API proxy, timeouts, caching, provider attribution, stale/error/loading states, and safe rendering.
- Make homepage search/navigation and market filters work; avoid synthetic chart data and unsupported time-period controls.
- Verify provider usage terms for the intended commercial deployment.

### 3. Supabase authentication
- Support registration, sign-in/out, persisted/refreshed sessions, confirmation redirect, reset request, recovery callback, and password update.
- Load/update a user's own profile through RLS-protected access.
- Test configuration handling and mocked auth paths locally; test provider lifecycle only with user-supplied project credentials.
- Never put a service-role key in the browser or source tree.

### 4. Accounts and project directory
- Define account scope; implement only genuine profile, settings, watchlist, portfolio, and transaction data sources.
- Use the existing migration as a starting point, review it, and connect project submission, ownership, persistence, status tracking, moderation, approved-public reads, search, and detail pages.
- Ensure only persisted approved records appear as published/verified. Do not elevate demo entries into endorsements.

### 5. Wallet adapters
- Keep wallets independent of accounts. Improve EVM reconnect, chain/account events, balance status, mobile behavior, and unsupported-chain errors with automated tests.
- Add Solana or MultiversX only with distinct reviewed adapters and verified RPC/token/transaction support; do not infer support from EVM compatibility.

### 6. Same-chain swaps
- Correctly separate configured provider, quote support, UI readiness, execution flag, and production verification.
- Only if swaps remain in scope: implement real token selection, quote/minimum-received/fees, review, allowance, signing, submission, receipt tracking, and failure handling.
- Keep execution disabled until test coverage, provider configuration, test-wallet verification, and independent transaction review pass.

### 7. Trading terminal
- A reference-data Trading page is implemented with provider-backed search, asset stats, and OHLC candles, and links to the distinct quote-only swap feature.
- Buy/sell execution, a KRONOS order book, limit orders, and transaction history remain unavailable; do not claim the page is an exchange.
- Do not fabricate orders, balances, chart candles, or fills. Add order types only through a real supported protocol with verified lifecycle support.

### 8. Cross-chain routing
- Separate from same-chain swaps. Implement only after provider route coverage, fees, signing, destination tracking, refund/failure states, and delivery verification are established.

### 9. Multi-chain token discovery
- Use chain-specific trusted metadata and verified addresses; distinguish same-symbol assets by chain/address and disclose unsupported liquidity/trade status.

### 10. Security and production readiness
- Review auth, RLS, validation, transaction approvals, secrets, dependency exposure, abuse limits, provider errors, sensitive logs, recovery, and monitoring.
- Add applicable user terms/privacy/risk disclosure with jurisdiction-appropriate professional review. No compliance certification is implied.

### 11. Accessibility and responsive design
- Test keyboard and screen-reader use, focus, contrast, touch targets, responsive breakpoints, errors, loading/empty states, page titles, and all navigation.
- Fix verified problems while retaining the existing visual identity.

### 12. Test
- Run unit/API/UI checks and build/dependency checks available in the environment.
- Use mocks only for isolated tests. Record actual coverage and explicitly mark unavailable provider, wallet, testnet, database, and production checks.

### 13. Deployment preparation
- Keep secrets out of source; document environment values and migrations.
- Verify routes/static assets and Vercel/FastAPI deployment configuration. A local build is not a verified deployment.

### 14. Final audit
- Re-run the checks, reconcile implementation status with runtime capability status, and list remaining actions, exact credential owners/locations, and release blockers.

## Dependency order

1. Phase 1 audit/status -> Phase 2 live market, Phase 3 auth, Phase 5 wallet/readiness, Phase 10 security baseline, Phase 11 accessibility.
2. Phase 3 auth -> Phase 4 persistent user-owned submissions/profile.
3. Phase 5 wallet + Phase 6 independently verified swap workflow -> Phase 7 non-custodial trading terminal.
4. Phase 6/7 -> Phase 8 cross-chain routing (only if selected).
5. Phase 2/3/4/5/6/10/11 -> Phase 12 test gate -> Phase 13 deployment readiness -> Phase 14 final audit.

## Release gates

- No real funds or mainnet execution until transaction code is complete, independently reviewed, tested with appropriate wallets, and explicitly enabled by an authorized operator.
- No claim of live, configured, secure, compliant, or production status without evidence for that exact status.
- Missing external credentials block only provider-dependent validation; do not fabricate credentials or successful results.
