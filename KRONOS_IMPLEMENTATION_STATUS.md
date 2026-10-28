# KRONOS implementation status

Last updated: 21 October 2026

## Status vocabulary

- **Implemented**: code exists in the workspace.
- **Tested successfully**: the listed local test/check ran and passed.
- **Configured with real credentials**: actual external account/provider values are installed in the target environment.
- **Verified in production**: checked against the deployed production service.
- **Blocked by external requirements**: waiting on provider/database credentials, wallet/network, product decision, or deployment access.

These statuses are independent. A local test does not mean credentials are configured or production is verified.

## Current implementation

| Workstream | Implemented | Tested successfully | Configured with real credentials | Verified in production | Remaining action / blocker |
|---|---|---|---|---|---|
| FastAPI app and market proxy | Health, status, public config, CoinGecko market/global/trending/search, OHLC, and guarded 0x quote/price endpoints | 31 pytest tests; Python compile; API tests use mocked provider data | No 0x key; CoinGecko is public, commercial terms/plan not verified | No | Confirm data-provider rights/limits for intended commercial use |
| Homepage live dashboard | Provider-backed global metrics, 100-asset market table, gainers, trending, sparklines, filters, paging, and debounced asset search | API/static tests; browser showed live listings and account-access states; no synthetic prices retained | Public market API available; provider plan/terms not verified | No | Add automated browser/accessibility tests and continue visual review |
| Discover and token pages | Shared market API proxy and provider-backed market/token details | Existing API tests and JavaScript syntax checks | Public provider only | No | Verify freshness/limits and add dedicated browser tests |
| Supabase authentication | Signup, sign-in, sign-out, reset request, recovery callback/password update; account page requires a Supabase session | Static wiring tests and browser form check; provider lifecycle not exercised | No (`SUPABASE_URL`, `SUPABASE_ANON_KEY` absent) | No | Owner must configure a Supabase project, auth email templates, and allowed redirects |
| Account features | Profile editing, persistent per-user watchlist, own submission status, connected-wallet native-token value estimate from wallet RPC plus CoinGecko; explicitly excludes ERC-20 balances and account P&L | Static wiring tests; native valuation not browser-tested; no live database or wallet test | No Supabase instance configured | No | Apply migrations and test RLS/profile/watchlist flows using separate users; test the partial wallet valuation against connected EVM wallets |
| Project submissions/listings | Authenticated submissions stored as pending, approved-only public reads, status tracking, trusted app-metadata admin review UI, and community/example labels | Static wiring tests; no live database test; prior listings browser check showed labeled examples and unconfigured status | No Supabase instance configured | No | Apply migrations; test duplicate handling, admin status changes, and approved-public reads |
| Supabase migration security | Owner-scoped watchlists/profile access, safe public listing columns excluding contact/user ownership, admin read/review RLS, profile-trigger execution revoked from API roles, duplicate preflight that does not delete data | Static policy assertions only | No | No | Validate SQL, grants, RLS, and duplicate preflight against a real non-production Supabase project |
| EVM wallet | EIP-1193 connection for seven EVM networks | JavaScript syntax only; no real wallet lifecycle test in this work | WalletConnect ID/provider status must be verified for production | No | Test injected/mobile wallets, chain/account changes, balance failures, and domain allowlist |
| Swap readiness reporting | Separates provider configuration, quote endpoint configuration/live verification, EVM wallet adapter availability, execution implementation, E2E testing, and production review; the legacy live-swap flag is ignored | New readiness regression tests pass; provider live health is not probed | No (`ZEROX_API_KEY` absent) | No | Obtain 0x key and perform credential-backed quote endpoint validation; keep execution disabled |
| Same-chain swap UI | Firm-quote request and review integrated with EVM wallet chain/account checks and on-chain token-decimal reads; approval/sign/submit/receipt remains unimplemented | Static regression test added; real provider/wallet quote not tested; execution remains disabled | No (`ZEROX_API_KEY` absent) | No | Configure 0x key; validate quotes and complete/review approvals, signing, receipt handling before any execution release |
| Trading page | Searchable CoinGecko assets, USD reference stats, cached provider OHLC candlestick charts, 1-day/7-day periods, and explicit non-executable buy/sell and history states | API tests; real provider returned 48 one-day and 42 seven-day BTC candles; browser search selected ETH, rendered live data/candles, and switched to seven days | Public market API available; execution provider/wallet workflow not configured | No | Implement and independently review a real supported execution workflow before enabling buys/sells; no order-book or limit-order protocol is integrated |
| Trading navigation and responsive layout | Added Trading destination to product navigation; responsive layout constrains the chart to a horizontally scrollable viewport | Browser rendered at 815px and 390px; mobile document had no horizontal overflow; all local HTML links and anchors resolve | N/A | No | Continue real-device and accessibility review |
| Solana/MultiversX, cross-chain, order book, futures, custody, deposits/withdrawals | Not implemented | No | No providers selected | No | Out of current verified scope; requires separate product/security decisions |
| Navigation and local HTML references | Repaired missing swap navigation targets; local links and same-page anchors resolve | Full local HTML `href`/fragment scan passes; regression test added | N/A | No | Keep link scan in regression checks |
| Deployment | Dockerfile, Vercel notes, health route exist | Docker build not run (Docker unavailable) | No production environment supplied | No | Configure secrets, domains, migrations, monitoring, and run a deployment smoke test |
| Accessibility/security/legal release review | Basic response headers, RLS design, form states; not release-certified | Focused app tests only; no comprehensive audit | N/A | No | Perform full security/accessibility reviews and get qualified jurisdiction-specific legal review |

## Latest local verification

- Test command: `.\.venv\Scripts\python.exe -m pytest -q`
- Latest result: **31 passed**.
- Python compilation: `.\.venv\Scripts\python.exe -m compileall -q app tests` passed.
- JavaScript syntax: `node --check` passed for all **11** files under `assets\js`.
- Browser checks: homepage rendered 10 live market rows, 5 gainers, and 5 trending assets after the provider cache warmed. The first attempt correctly showed an unavailable state after a provider timeout; a reload then succeeded. Listings rendered 10 example assets with live CoinGecko values and explicitly reported Supabase unconfigured; the signup tab rendered name, email, password, and confirmation inputs. The Trading page rendered live Bitcoin/Ethereum market data; search selected Ethereum; one-day and seven-day charts rendered 48 and 42 real provider candles, respectively. Buy/sell controls remained disabled. No signup or transaction was attempted.
- Market API smoke checks: `/api/v1/market/global`, `/api/v1/market/markets?per_page=2`, `/api/v1/market/trending`, and direct 1-day/7-day OHLC provider requests succeeded. `/healthz` returned HTTP 200 with trading disabled.
- Local HTML reference scan: all page links and same-page anchors resolve across all 10 HTML pages.
- Provider credentials at latest check: Supabase URL/anon key and 0x API key absent; live swap execution remains disabled.
- Docker executable unavailable; image build not run. No production URL or deployment access supplied; no production verification performed.
- Supabase SQL has not been executed. Migration grants/RLS, auth lifecycle, moderation access, and account persistence remain unverified against a real project. Migration 002 now aborts with duplicate examples and a remediation hint before creating its unique index; it does not remove or modify duplicate user rows. Exact setup steps are documented in `ARCHITECTURE.md`.

## Active sequence

1. Have the project owner configure Supabase using the setup steps in `ARCHITECTURE.md`; apply and validate migrations in a non-production project; test signup/recovery, profile, watchlist isolation, submissions, approved reads, and administrator moderation.
2. Complete swap quote/review/sign/receipt UI only after provider credentials and trusted token-address handling are available; keep swaps disabled until wallet testing, E2E verification, and independent review are complete.
3. Complete a real supported trade-execution workflow and independent review before enabling buy/sell. The Trading page currently provides market reference data only; no order-book, limit-order, Solana, MultiversX, or cross-chain execution is verified.
4. Verify provider usage rights/limits and configure deployment secrets/domains; build and smoke-test the deployed service.
5. Reconcile this status against deployment evidence before calling any phase production-ready.

See [KRONOS_IMPLEMENTATION_PLAN.md](./KRONOS_IMPLEMENTATION_PLAN.md) for acceptance criteria, dependencies, and release gates.
