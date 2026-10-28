from __future__ import annotations

import asyncio
import json
import os
import re
import time
from collections import deque
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request as UrlRequest, urlopen
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")
HTML_PAGES = frozenset(
    {
        "account.html",
        "discover.html",
        "index.html",
        "launch.html",
        "listing.html",
        "listings.html",
        "login.html",
        "token.html",
        "swap.html",
        "trade.html",
    }
)

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}
MARKET_API_BASE = "https://api.coingecko.com/api/v3"
MARKET_REQUESTS_PER_MINUTE = 60
ZEROX_API_BASE = "https://api.0x.org/swap/allowance-holder/quote"
ZEROX_PRICE_API_BASE = "https://api.0x.org/swap/allowance-holder/price"
ZEROX_SUPPORTED_CHAIN_IDS = frozenset({1, 10, 56, 137, 8453, 42161, 43114})
EVM_ADDRESS_PATTERN = re.compile(r"^0x[a-fA-F0-9]{40}$")
RAW_AMOUNT_PATTERN = re.compile(r"^[0-9]{1,78}$")


def fetch_market_provider(path: str, params: dict[str, str]) -> Any:
    url = f"{MARKET_API_BASE}{path}"
    if params:
        url = f"{url}?{urlencode(params)}"
    provider_request = UrlRequest(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "KRONOS/0.1 public-market-data",
        },
    )
    try:
        with urlopen(provider_request, timeout=12) as response:
            return json.loads(response.read())
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
        raise RuntimeError("The market data provider is unavailable.") from error


class ZeroXProviderError(RuntimeError):
    def __init__(self, status_code: int | None = None) -> None:
        self.status_code = status_code
        super().__init__("The 0x quote provider is unavailable.")


def fetch_zerox_quote(params: dict[str, str], api_key: str) -> dict[str, Any]:
    url = f"{ZEROX_API_BASE}?{urlencode(params)}"
    provider_request = UrlRequest(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "KRONOS/0.1 swap-quote",
            "0x-api-key": api_key,
            "0x-version": "v2",
        },
    )
    try:
        with urlopen(provider_request, timeout=15) as response:
            payload = response.read(1_000_001)
        if len(payload) > 1_000_000:
            raise ZeroXProviderError()
        value = json.loads(payload)
    except HTTPError as error:
        raise ZeroXProviderError(error.code) from error
    except (URLError, TimeoutError, json.JSONDecodeError) as error:
        raise ZeroXProviderError() from error

    if not isinstance(value, dict):
        raise ZeroXProviderError()
    return value


def fetch_zerox_price(params: dict[str, str], api_key: str) -> dict[str, Any]:
    url = f"{ZEROX_PRICE_API_BASE}?{urlencode(params)}"
    provider_request = UrlRequest(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "KRONOS/0.1 swap-price",
            "0x-api-key": api_key,
            "0x-version": "v2",
        },
    )
    try:
        with urlopen(provider_request, timeout=15) as response:
            payload = response.read(1_000_001)
        if len(payload) > 1_000_000:
            raise ZeroXProviderError()
        value = json.loads(payload)
    except HTTPError as error:
        raise ZeroXProviderError(error.code) from error
    except (URLError, TimeoutError, json.JSONDecodeError) as error:
        raise ZeroXProviderError() from error

    if not isinstance(value, dict):
        raise ZeroXProviderError()
    return value


def load_platform_status(project_root: Path) -> dict[str, Any]:
    status_path = project_root / "config" / "platform-status.json"
    try:
        with status_path.open(encoding="utf-8") as status_file:
            value = json.load(status_file)
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("The platform status registry could not be loaded.") from error

    if not isinstance(value, dict) or not isinstance(value.get("capabilities"), list) or not isinstance(value.get("networks"), list):
        raise RuntimeError("The platform status registry has an invalid structure.")

    has_zerox_key = bool(os.environ.get("ZEROX_API_KEY", "").strip())
    supabase_url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    supabase_anon_key = os.environ.get("SUPABASE_ANON_KEY", "").strip()
    supabase_configured = bool(
        supabase_url
        and supabase_anon_key
        and (
            supabase_url.startswith("https://")
            or supabase_url.startswith("http://localhost")
            or supabase_url.startswith("http://127.0.0.1")
        )
    )
    supported_evm_networks = []
    for network in value["networks"]:
        if not isinstance(network, dict):
            raise RuntimeError("The platform status registry has an invalid structure.")
        supported_by_provider = (
            network.get("evm") is True
            and network.get("chain_id") in ZEROX_SUPPORTED_CHAIN_IDS
            and network.get("same_chain_swap_supported") is True
        )
        provider_configured = supported_by_provider and has_zerox_key
        network["same_chain_swap_enabled"] = False
        network["execution_enabled"] = False
        network["quote_enabled"] = provider_configured
        network["provider_configured"] = provider_configured
        network["quote_endpoint_configured"] = provider_configured
        network["quote_endpoint_status"] = "UNVERIFIED"
        network["wallet_adapter_available"] = (
            network.get("evm") is True
            and network.get("wallet_connection_enabled") is True
        )
        network["transaction_execution_implemented"] = False
        network["end_to_end_workflow_tested"] = False
        network["production_readiness_reviewed"] = False
        if supported_by_provider:
            supported_evm_networks.append(network)

    for capability in value["capabilities"]:
        if not isinstance(capability, dict):
            continue
        if capability.get("name") == "User authentication":
            if supabase_configured:
                capability["status"] = "CONFIGURED"
                capability["details"] = "Supabase URL and public key are present. Email provider settings, redirects, migrations, RLS, and real authentication flows still require project configuration and verification."
            else:
                capability["status"] = "UNCONFIGURED"
                capability["details"] = "The email/password signup, sign-in, and password reset UI is implemented, but Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY; wallet connections are separate and are not account authentication."
            continue
        if capability.get("name") != "Token swaps":
            continue
        capability["status"] = "INCOMPLETE"
        capability["readiness"] = {
            "provider_configured": has_zerox_key,
            "quote_endpoint_configured": has_zerox_key and bool(supported_evm_networks),
            "quote_endpoint_status": "UNVERIFIED",
            "wallet_adapter_available": any(
                network["wallet_adapter_available"] for network in supported_evm_networks
            ),
            "transaction_execution_implemented": False,
            "end_to_end_workflow_tested": False,
            "production_readiness_reviewed": False,
            "execution_enabled": False,
        }
        capability["details"] = (
            f"0x provider {'is configured' if has_zerox_key else 'requires ZEROX_API_KEY'}; "
            "firm quote entry/review UI is implemented but live endpoint operation is unverified; "
            "an EVM wallet adapter exists; transaction execution is not implemented; end-to-end workflow testing and "
            "independent production review are incomplete. Execution is disabled."
        )
    return value


def create_app(project_root: Path = PROJECT_ROOT) -> FastAPI:
    root = project_root.resolve()
    market_cache: dict[str, tuple[float, Any]] = {}
    provider_requests: deque[float] = deque()
    quote_requests: dict[str, deque[float]] = {}
    price_requests: dict[str, deque[float]] = {}
    app_mode = os.environ.get("KRONOS_ENV", "development").strip().lower()
    if app_mode not in {"development", "staging", "production"}:
        raise RuntimeError("KRONOS_ENV must be development, staging, or production.")
    app = FastAPI(
        title="KRONOS API",
        version="0.1.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    configured_hosts = os.environ.get("KRONOS_ALLOWED_HOSTS", "").strip()
    platform_hosts = [
        os.environ.get("VERCEL_URL", "").strip(),
        os.environ.get("VERCEL_PROJECT_PRODUCTION_URL", "").strip(),
    ]
    allowed_hosts = [
        host.strip()
        for host in (configured_hosts.split(",") if configured_hosts else ["localhost", "127.0.0.1"] + platform_hosts)
        if host.strip()
    ]
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)
    app.mount("/assets", StaticFiles(directory=root / "assets"), name="assets")

    @app.middleware("http")
    async def add_security_headers(request: Request, call_next: Any) -> Response:
        response = await call_next(request)
        response.headers.update(SECURITY_HEADERS)
        response.headers["X-Request-ID"] = uuid4().hex
        if request.url.path.startswith("/api/") or request.url.path == "/healthz":
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/healthz", include_in_schema=False)
    async def health() -> JSONResponse:
        return JSONResponse(
            {
                "status": "ok",
                "application": "KRONOS",
                "mode": app_mode,
                "trading_enabled": False,
                "live_swap_execution_enabled": False,
                "financial_database": "UNCONFIGURED",
            }
        )

    @app.get("/api/v1/platform/status")
    async def platform_status() -> JSONResponse:
        try:
            try:
                status = load_platform_status(root)
            except RuntimeError as error:
                raise HTTPException(status_code=503, detail=str(error)) from error
        except RuntimeError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
        return JSONResponse(status)

    @app.get("/api/v1/config/public")
    async def public_configuration() -> JSONResponse:
        supabase_url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
        supabase_anon_key = os.environ.get("SUPABASE_ANON_KEY", "").strip()
        configured = bool(supabase_url and supabase_anon_key)
        if configured and not (
            supabase_url.startswith("https://")
            or supabase_url.startswith("http://localhost")
            or supabase_url.startswith("http://127.0.0.1")
        ):
            raise HTTPException(status_code=503, detail="Authentication configuration is invalid.")
        return JSONResponse(
            {
                "supabase_configured": configured,
                "supabase_url": supabase_url if configured else None,
                "supabase_anon_key": supabase_anon_key if configured else None,
            }
        )

    async def get_market_data(
        path: str,
        params: dict[str, str],
        cache_seconds: int,
    ) -> JSONResponse:
        cache_key = f"{path}?{urlencode(sorted(params.items()))}"
        now = time.monotonic()
        cached = market_cache.get(cache_key)
        if cached and now - cached[0] < cache_seconds:
            return JSONResponse(cached[1])

        while provider_requests and now - provider_requests[0] >= 60:
            provider_requests.popleft()
        if len(provider_requests) >= MARKET_REQUESTS_PER_MINUTE:
            raise HTTPException(
                status_code=429,
                detail="Market data is temporarily rate limited. Please try again shortly.",
                headers={"Retry-After": "60"},
            )

        provider_requests.append(now)
        try:
            value = await asyncio.to_thread(fetch_market_provider, path, params)
        except RuntimeError as error:
            raise HTTPException(
                status_code=503,
                detail="Market data is temporarily unavailable. Please try again later.",
            ) from error
        market_cache[cache_key] = (now, value)
        return JSONResponse(value)

    @app.get("/api/v1/market/search")
    async def market_search(query: str = Query(min_length=2, max_length=80)) -> JSONResponse:
        if not query.strip() or any(ord(character) < 32 for character in query):
            raise HTTPException(status_code=422, detail="Invalid market search query.")
        return await get_market_data(
            "/search",
            {"query": query.strip()},
            60,
        )

    @app.get("/api/v1/swap/quote")
    async def swap_quote(
        request: Request,
        chain_id: int = Query(alias="chainId", ge=1, le=100_000_000),
        sell_token: str = Query(alias="sellToken", min_length=42, max_length=42),
        buy_token: str = Query(alias="buyToken", min_length=42, max_length=42),
        sell_amount: str = Query(alias="sellAmount", min_length=1, max_length=78),
        taker: str = Query(min_length=42, max_length=42),
        slippage_bps: int = Query(default=100, alias="slippageBps", ge=0, le=500),
    ) -> JSONResponse:
        if (
            chain_id not in ZEROX_SUPPORTED_CHAIN_IDS
            or not EVM_ADDRESS_PATTERN.fullmatch(sell_token)
            or not EVM_ADDRESS_PATTERN.fullmatch(buy_token)
            or not EVM_ADDRESS_PATTERN.fullmatch(taker)
            or sell_token.lower() == buy_token.lower()
            or not RAW_AMOUNT_PATTERN.fullmatch(sell_amount)
            or int(sell_amount) == 0
        ):
            raise HTTPException(status_code=422, detail="Invalid swap quote parameters.")

        status = load_platform_status(root)
        enabled_network = any(
            network.get("chain_id") == chain_id
            and network.get("same_chain_swap_supported") is True
            and network.get("quote_enabled") is True
            for network in status["networks"]
        )
        api_key = os.environ.get("ZEROX_API_KEY", "").strip()
        if not enabled_network or not api_key:
            raise HTTPException(
                status_code=503,
                detail="Quotes are unavailable for this network until the 0x provider is configured.",
            )

        now = time.monotonic()
        client_address = request.client.host if request.client else "unknown"
        if client_address not in quote_requests and len(quote_requests) >= 1024:
            quote_requests.pop(next(iter(quote_requests)))
        requests_for_client = quote_requests.setdefault(client_address, deque())
        while requests_for_client and now - requests_for_client[0] >= 60:
            requests_for_client.popleft()
        if len(requests_for_client) >= 10:
            raise HTTPException(
                status_code=429,
                detail="Swap quote rate limit reached. Please wait before requesting another quote.",
                headers={"Retry-After": "60"},
            )
        requests_for_client.append(now)

        params = {
            "chainId": str(chain_id),
            "sellToken": sell_token,
            "buyToken": buy_token,
            "sellAmount": sell_amount,
            "taker": taker,
            "slippageBps": str(slippage_bps),
        }
        try:
            quote = await asyncio.to_thread(fetch_zerox_quote, params, api_key)
        except ZeroXProviderError as error:
            if error.status_code == 429:
                raise HTTPException(
                    status_code=429,
                    detail="The 0x quote provider is rate limiting requests.",
                    headers={"Retry-After": "30"},
                ) from error
            if error.status_code in {400, 404}:
                raise HTTPException(
                    status_code=422,
                    detail="0x could not find a valid route for these tokens and amount.",
                ) from error
            raise HTTPException(
                status_code=502,
                detail="The 0x quote provider is temporarily unavailable.",
            ) from error

        transaction = quote.get("transaction")
        minimum_output = quote.get("minBuyAmount")
        estimated_output = quote.get("buyAmount")
        calldata = transaction.get("data") if isinstance(transaction, dict) else None
        if (
            quote.get("liquidityAvailable") is not True
            or not isinstance(estimated_output, str)
            or not estimated_output.isdigit()
            or int(estimated_output) <= 0
            or not isinstance(minimum_output, str)
            or not minimum_output.isdigit()
            or int(minimum_output) <= 0
            or int(minimum_output) > int(estimated_output)
            or quote.get("sellAmount") != sell_amount
            or str(quote.get("sellToken", "")).lower() != sell_token.lower()
            or str(quote.get("buyToken", "")).lower() != buy_token.lower()
            or not isinstance(transaction, dict)
            or not EVM_ADDRESS_PATTERN.fullmatch(str(transaction.get("to", "")))
            or not isinstance(calldata, str)
            or not re.fullmatch(r"0x[0-9a-fA-F]+", calldata)
            or len(calldata) % 2 != 0
        ):
            raise HTTPException(
                status_code=422,
                detail="0x did not return an executable quote with available liquidity.",
            )
        return JSONResponse(quote)

    @app.get("/api/v1/swap/price")
    async def swap_price(
        request: Request,
        chain_id: int = Query(alias="chainId", ge=1, le=100_000_000),
        sell_token: str = Query(alias="sellToken", min_length=42, max_length=42),
        buy_token: str = Query(alias="buyToken", min_length=42, max_length=42),
        sell_amount: str = Query(alias="sellAmount", min_length=1, max_length=78),
        taker: str = Query(min_length=42, max_length=42),
        slippage_bps: int = Query(default=100, alias="slippageBps", ge=0, le=500),
    ) -> JSONResponse:
        if (
            chain_id not in ZEROX_SUPPORTED_CHAIN_IDS
            or not EVM_ADDRESS_PATTERN.fullmatch(sell_token)
            or not EVM_ADDRESS_PATTERN.fullmatch(buy_token)
            or not EVM_ADDRESS_PATTERN.fullmatch(taker)
            or sell_token.lower() == buy_token.lower()
            or not RAW_AMOUNT_PATTERN.fullmatch(sell_amount)
            or int(sell_amount) == 0
        ):
            raise HTTPException(status_code=422, detail="Invalid swap price parameters.")

        status = load_platform_status(root)
        enabled_network = any(
            network.get("chain_id") == chain_id
            and network.get("same_chain_swap_supported") is True
            and network.get("quote_enabled") is True
            for network in status["networks"]
        )
        api_key = os.environ.get("ZEROX_API_KEY", "").strip()
        if not enabled_network or not api_key:
            raise HTTPException(
                status_code=503,
                detail="Indicative prices are unavailable for this network until the 0x provider is configured.",
            )

        now = time.monotonic()
        client_address = request.client.host if request.client else "unknown"
        if client_address not in price_requests and len(price_requests) >= 1024:
            price_requests.pop(next(iter(price_requests)))
        requests_for_client = price_requests.setdefault(client_address, deque())
        while requests_for_client and now - requests_for_client[0] >= 60:
            requests_for_client.popleft()
        if len(requests_for_client) >= 30:
            raise HTTPException(
                status_code=429,
                detail="Swap price update rate limit reached. Please wait before requesting another update.",
                headers={"Retry-After": "60"},
            )
        requests_for_client.append(now)

        params = {
            "chainId": str(chain_id),
            "sellToken": sell_token,
            "buyToken": buy_token,
            "sellAmount": sell_amount,
            "taker": taker,
            "slippageBps": str(slippage_bps),
        }
        try:
            price = await asyncio.to_thread(fetch_zerox_price, params, api_key)
        except ZeroXProviderError as error:
            if error.status_code == 429:
                raise HTTPException(
                    status_code=429,
                    detail="The 0x price provider is rate limiting requests.",
                    headers={"Retry-After": "30"},
                ) from error
            if error.status_code in {400, 404}:
                raise HTTPException(
                    status_code=422,
                    detail="0x could not find a valid route for these tokens and amount.",
                ) from error
            raise HTTPException(
                status_code=502,
                detail="The 0x price provider is temporarily unavailable.",
            ) from error

        output = price.get("buyAmount")
        if (
            price.get("liquidityAvailable") is not True
            or not isinstance(output, str)
            or not output.isdigit()
            or int(output) <= 0
            or price.get("sellAmount") != sell_amount
            or str(price.get("sellToken", "")).lower() != sell_token.lower()
            or str(price.get("buyToken", "")).lower() != buy_token.lower()
        ):
            raise HTTPException(
                status_code=422,
                detail="0x did not return a valid indicative price with available liquidity.",
            )
        return JSONResponse(price)

    @app.get("/api/v1/market/markets")
    async def market_list(
        page: int = Query(default=1, ge=1, le=100),
        per_page: int = Query(default=50, ge=1, le=250),
        ids: str | None = Query(default=None, max_length=1000),
        sparkline: bool = Query(default=False),
    ) -> JSONResponse:
        params = {
            "vs_currency": "usd",
            "order": "market_cap_desc",
            "per_page": str(per_page),
            "page": str(page),
            "sparkline": str(sparkline).lower(),
            "price_change_percentage": "24h",
        }
        if ids:
            requested_ids = ids.split(",")
            if len(requested_ids) > 50 or any(
                not token_id
                or len(token_id) > 100
                or not all(character.isalnum() or character == "-" for character in token_id)
                for token_id in requested_ids
            ):
                raise HTTPException(status_code=422, detail="Invalid market identifiers.")
            params["ids"] = ",".join(requested_ids)
        return await get_market_data("/coins/markets", params, 60)

    @app.get("/api/v1/market/global")
    async def market_global() -> JSONResponse:
        return await get_market_data("/global", {}, 120)

    @app.get("/api/v1/market/trending")
    async def market_trending() -> JSONResponse:
        return await get_market_data("/search/trending", {}, 300)

    @app.get("/api/v1/market/coins/{coin_id}")
    async def market_coin(coin_id: str) -> JSONResponse:
        if not coin_id or len(coin_id) > 100 or not all(
            character.isalnum() or character == "-" for character in coin_id
        ):
            raise HTTPException(status_code=422, detail="Invalid market identifier.")
        params = {
            "localization": "false",
            "tickers": "false",
            "market_data": "true",
            "community_data": "false",
            "developer_data": "false",
            "sparkline": "false",
        }
        return await get_market_data(
            f"/coins/{coin_id}", params, 60
        )

    @app.get("/api/v1/market/coins/{coin_id}/history")
    async def market_history(coin_id: str) -> JSONResponse:
        if not coin_id or len(coin_id) > 100 or not all(
            character.isalnum() or character == "-" for character in coin_id
        ):
            raise HTTPException(status_code=422, detail="Invalid market identifier.")
        return await get_market_data(
            f"/coins/{coin_id}/market_chart",
            {"vs_currency": "usd", "days": "7"},
            300,
        )

    @app.get("/api/v1/market/coins/{coin_id}/ohlc")
    async def market_ohlc(
        coin_id: str,
        days: int = Query(default=1),
    ) -> JSONResponse:
        if not coin_id or len(coin_id) > 100 or not all(
            character.isalnum() or character == "-" for character in coin_id
        ):
            raise HTTPException(status_code=422, detail="Invalid market identifier.")
        if days not in {1, 7, 14, 30, 90, 180, 365}:
            raise HTTPException(status_code=422, detail="Unsupported candlestick period.")
        return await get_market_data(
            f"/coins/{coin_id}/ohlc",
            {"vs_currency": "usd", "days": str(days)},
            300,
        )

    @app.get("/", include_in_schema=False)
    async def homepage() -> FileResponse:
        return FileResponse(root / "index.html")

    @app.get("/{page_name}", include_in_schema=False)
    async def page(page_name: str) -> FileResponse:
        if page_name not in HTML_PAGES:
            raise HTTPException(status_code=404, detail="Page not found.")
        page_path = root / page_name
        if not page_path.is_file():
            raise HTTPException(status_code=404, detail="Page not found.")
        return FileResponse(page_path)

    AUTH_ASSETS = {"auth.css", "auth.js", "auth-config.js"}

@app.get("/auth-assets/{asset_name}", include_in_schema=False)
async def auth_asset(asset_name: str) -> FileResponse:
    if asset_name not in AUTH_ASSETS:
        raise HTTPException(status_code=404, detail="File not found.")

    asset_path = root / asset_name

    if not asset_path.is_file():
        raise HTTPException(status_code=404, detail="File not found.")

    return FileResponse(asset_path)

     
    @app.exception_handler(HTTPException)
    async def http_error(request: Request, error: HTTPException) -> JSONResponse:
        del request
        return JSONResponse(
            {"detail": error.detail},
            status_code=error.status_code,
            headers=error.headers,
        )

    return app


app = create_app()
