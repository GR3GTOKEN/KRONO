# KRONOS multi-chain DEX foundation

## Existing project audit

The existing product is a plain HTML/CSS/JavaScript KRONOS market-discovery site. It has no frontend framework or frontend package manager. It uses CoinGecko's public API for Discover, token, listing, Trading, and homepage market information. Trading-page OHLC candles are informational USD references, not a spot order price, futures mark price, or swap quote.

The project has no financial database, custody service, or spot exchange adapter. Phantom and WalletConnect connection UI exists, but a connected display address is not an authenticated user or permission to spend. The homepage uses live public market data through the FastAPI proxy. Project-directory examples remain unverified; authenticated community submissions are intended to persist in Supabase and appear publicly only after approval.

## Stage 1 implemented

- Added a small FastAPI application server without replacing the existing web interface.
- The application serves a fixed allowlist of existing HTML pages and the public `assets` directory. It does not serve arbitrary project files such as this document or `.venv`.
- Added `/healthz` and `/api/v1/platform/status`. The status API returns the same checked-in JSON registry rendered by the Platform Status page.
- Added basic response security headers, unique request IDs, no-store API responses, and configurable trusted hosts.
- Added a non-root Docker image and `.dockerignore`. The image builds the static frontend and API together; no external paid service is required.
- Added Python dependencies and API tests. Development dependencies are separate from the runtime image.
- No custody, financial ledger, deposits, or withdrawals were created. The legacy live-swap flag is ignored; transaction execution remains disabled regardless of server-side provider configuration.

## Capability status

| Capability | Status | Current behavior |
| --- | --- | --- |
| Public market data | LIVE | CoinGecko market data is displayed on Discover, token, listing, Trading, and homepage pages. Trading also displays provider OHLC candles as USD references. Provider rate limits, freshness, terms, and availability apply. |
| Trading page | INFORMATIONAL ONLY | Asset search, USD reference market data, and provider OHLC candles are available. Buy/sell execution, order-book trading, limit orders, and KRONOS transaction history are not implemented. The page does not fabricate orders or fills. |
| Project directory | MIXED | CoinGecko-backed example assets are labeled as examples; authenticated community submissions persist as pending and public pages query approved records. Supabase configuration and migration application are still required. Approval is not independent endorsement or safety verification. |
| Wallet sessions | EVM ONLY | EIP-1193 wallet connections, network switching, native balances, and selected ERC-20 balances are read from the connected wallet on supported EVM networks. Wallets remain independent from KRONOS accounts. Solana and MultiversX wallet adapters are not implemented. |
| User authentication | CONFIGURABLE | The standard login page supports email/password signup, sign-in, reset requests, and recovery password updates through Supabase. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY`; account access requires a Supabase session and is independent of wallet connection. Email confirmation and password-reset redirect URLs must be configured in Supabase. |
| Spot matching and ledger | UNCONFIGURED | No persistent financial store, order management, or matching engine exists yet. |
| Same-chain EVM swaps | INCOMPLETE | The FastAPI server has a 0x quote proxy; the browser can request and review firm quotes using manually entered EVM token contract addresses when server credentials are configured. Provider live health, approvals, transaction signing/submission, receipt tracking, end-to-end testing, and independent production review remain incomplete. A swap cannot currently be completed through the UI; execution is always disabled. |
| Cross-chain swaps | UNAVAILABLE | No cross-chain provider, route coverage, destination tracking, or delivery confirmation is configured. |
| Futures and margin | UNCONFIGURED | No positions, margin, borrowing, liquidation, or risk engine exists. |
| Deposits and withdrawals | UNAVAILABLE | No custody, deposit address service, transaction monitor, financial journal, or withdrawal infrastructure exists. |

## Multi-chain DEX foundation

`config/platform-status.json` is the chain-capability registry. The API reports provider configuration separately from live quote endpoint verification. Quote endpoint health remains `UNVERIFIED` until an actual credential-backed provider check is performed. Wallet adapter presence is code availability, not a successful wallet test. Transaction execution, end-to-end workflow testing, and independent production review remain false; execution is always disabled. `KRONOS_ENABLE_LIVE_SWAPS` cannot enable it.

The intended swap scope is ERC-20-to-ERC-20 swaps on the seven EVM networks listed above. The browser validates wallet chain/account, reads token decimals from the connected chain, requests a firm quote, and presents the provider's output, minimum received, reported fees, and route sources. It does not request approvals or sign, broadcast, or track transactions. Do not treat a quote as a completed trade or a guarantee of execution.

The backend quote proxy at `/api/v1/swap/quote` keeps the 0x API key server-side, validates chain IDs, addresses, amount and slippage bounds, rate-limits requests, and rejects responses without an executable transaction. The browser calls this endpoint only after explicit user request but does not handle approvals, signing, broadcast, or receipt confirmation. Quote provider support is based on the [0x supported chains list](https://docs.0x.org/docs/introduction/supported-chains); this does not guarantee liquidity or route availability for every token pair.

The seven EVM networks are mainnets. No corresponding 0x testnet route is listed for these networks. `KRONOS_ENABLE_LIVE_SWAPS` is ignored; provider credentials, the browser integration, wallet/provider testing, and independent review are still required before any live transaction workflow can be offered.

Solana has separate market data coverage, but its wallet, Jupiter order/sign/execute flow, and transaction status handling are not implemented. Jupiter's API has a distinct transaction workflow and production API-key/rate-limit considerations; it must not be routed through the EVM adapter. MultiversX wallet integration and a separately verified xExchange routing provider are also not implemented. Same-chain routes do not imply cross-chain support. Cross-chain swaps remain disabled on every network until source/destination coverage, fees, signing, and destination delivery verification are implemented.

The swap history is stored only in the user's browser. It is not an authenticated account record or financial ledger. There is no custody, account balance, order matching, deposit, or withdrawal function. Supabase signup/login is separate from wallet connection and works without connecting a wallet when the provider is configured.

### Provider configuration

| Variable | Purpose | Client-visible? |
| --- | --- | --- |
| `ZEROX_API_KEY` | Server-side 0x Swap API access for firm EVM quotes | No |
| `KRONOS_ENABLE_LIVE_SWAPS` | Legacy flag; ignored. Swap execution remains hard-disabled until the complete workflow passes testing and independent review | Server configuration |
| `SUPABASE_URL` | Supabase project URL for email/password signup, sign-in, and reset | Yes, public |
| `SUPABASE_ANON_KEY` | Supabase anon/public key; RLS must protect private rows | Yes, public |
| `KRONOS_ALLOWED_HOSTS` | Optional comma-separated trusted hosts; Vercel's `VERCEL_URL` and `VERCEL_PROJECT_PRODUCTION_URL` are accepted when unset | Server configuration |

Do not place a 0x key, Supabase service-role key, private key, or seed phrase in HTML, JavaScript, or browser storage. Enable Supabase Email/Password auth and configure site URL plus allowed redirect URLs for login confirmation and password reset before offering account signup. Only the anon/public key is returned to browsers; configure RLS for any private data. The existing WalletConnect project ID is a public application identifier; create and allowlist a project for deployed domains before production use.

### Supabase project setup

1. Create a Supabase project and enable **Authentication → Providers → Email**. Configure the production site URL and allowed redirect URLs for `/login.html` on each trusted local, preview, and production origin. Confirm the email confirmation and password recovery templates link to that page.
2. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in the local server environment or the Vercel project's environment settings for each deployment environment. These are public client configuration values; never expose `SUPABASE_SERVICE_ROLE_KEY` in the browser or add it to source control.
3. Apply `supabase/migrations/202610200001_initial_profiles_and_listings.sql`, then `supabase/migrations/202610200002_persistent_watchlists_and_submissions.sql` using the Supabase CLI linked to the intended project (`supabase link --project-ref <project-ref>` followed by `supabase db push`) or the SQL editor in chronological order. The second migration checks for duplicate active network/contract submissions before creating its unique index. If it reports duplicates, review and resolve them without deleting user data, then retry.
4. Create reviewer access only by setting `app_metadata.role` to `admin` for designated accounts through a trusted Supabase administrator workflow. The browser uses this server-assigned claim to show the moderation UI; never trust `user_metadata` for authorization.
5. Test signup, confirmation, sign-in, reset/recovery, profile, watchlist isolation across two users, pending submissions, admin review, and approved-only public reads in a non-production project before enabling account features in production.

### Vercel deployment

Vercel's Python runtime recognizes the existing FastAPI instance in `app/main.py`; `requirements.txt` supplies runtime dependencies and the mounted `assets` directory is promoted for static delivery. Connect the repository to Vercel and configure `ZEROX_API_KEY` only for server-side quote access. `KRONOS_ENABLE_LIVE_SWAPS` is ignored and cannot enable execution. Configure Supabase public variables only if enabling account authentication. When using a custom trusted-host list, include each production hostname and Vercel preview hostname that should be served.

### Current limitations

- EVM ERC-20 swaps only; no native-token swaps, Solana execution, or MultiversX execution.
- Same-chain swaps only; no bridge or cross-chain route.
- Quote requests do not require account authentication; they are rate-limited in-process and should receive a production edge/WAF rate policy before high-volume use.
- No account-linked trade history, balance ledger, custody, or portfolio valuation is created.
- Provider availability, API quotas, contract behavior, token risks, and network fees remain user-facing execution risks.

## Architecture boundaries and next implementation stage

`app/main.py` is the HTTP/API boundary. `config/platform-status.json` is the source of truth for public capability and network status. `assets/js/platform-registry.js` renders the API response. CoinGecko remains a separate informational data source.

The next stages should add separately verified Solana and MultiversX adapters, then a cross-chain routing provider only after its exact route coverage and destination-delivery tracking are validated. A custodial spot ledger or matching simulation is a separate product and must never be conflated with these wallet-signed DEX swaps.

Futures and margin must remain separate risk systems. Blockchain deposits and withdrawals require network-specific monitoring and a separately reviewed custody/signing design. A matching engine does not execute DEX swaps. Do not enable production financial actions before qualified legal/compliance review, provider and liquidity validation, operational controls, and independent security testing.

## Deployment and cost

FastAPI, Uvicorn, Python, and Docker are open-source/free tooling. A self-hosted server avoids a paid centralized-exchange API as a core dependency, but hosting, bandwidth, database operations, backups, security work, and blockchain nodes still have operating costs. A node can be self-hosted later; managed RPC must be evaluated for cost and reliability rather than assumed free. No paid provider integration was introduced here.

The Docker image runs as an unprivileged user. Set `KRONOS_ENV` to `development`, `staging`, or `production`; put it behind a TLS-terminating reverse proxy in any network-accessible deployment and set `KRONOS_ALLOWED_HOSTS` to the exact public host names. Quote and market requests have only process-local rate limits; the application has no authenticated quote authorization, distributed rate limiter, durable database, structured operational audit log, or financial controls. Do not expose higher-volume financial APIs or real customer data until those controls and deployment operations exist.

## Run locally

Python 3.14.2 and Node.js 24.12.0 were present in the workspace. Install open-source Python dependencies in a virtual environment:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.lock
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Open `http://localhost:8000/`; the API health endpoint is `http://localhost:8000/healthz`. WalletConnect requires HTTPS or localhost.

Run tests and browser-JavaScript syntax checks:

```powershell
.\.venv\Scripts\python.exe -m pytest
node --check assets/js/platform-registry.js
node --check assets/js/wallet-connect.js
node --check assets/js/market-api.js
node --check assets/js/trade.js
node --check assets/js/swap.js
```

Build and run the self-hostable image where Docker is installed:

```powershell
docker build -t kronos:stage1 .
docker run --rm -p 8000:8000 -e KRONOS_ALLOWED_HOSTS=localhost,127.0.0.1 kronos:stage1
```

## Gates before real money

1. Document the custodial operating model, target jurisdictions, and provider eligibility with qualified legal/compliance professionals.
2. Implement and test Stage 2's demo ledger/matcher, then threat-model it. Demo balances and matches must remain isolated and unmistakably non-production.
3. Independently review custody, transaction monitoring, key-vault/HSM access, multi-approval withdrawals, reconciliation, incident recovery, and operational controls before testnet deposits.
4. Validate authoritative price sources, market liquidity, chain adapters, provider permissions, and independent security reviews before any live trading feature.
