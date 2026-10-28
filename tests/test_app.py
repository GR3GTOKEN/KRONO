from __future__ import annotations

import json
import asyncio
from pathlib import Path
from typing import Any

import httpx
import pytest

from app import main as app_module
from app.main import create_app, load_platform_status


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def request(method: str, path: str, **kwargs: Any) -> httpx.Response:
    async def send() -> httpx.Response:
        transport = httpx.ASGITransport(app=create_app(PROJECT_ROOT))
        async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as client:
            return await client.request(method, path, **kwargs)

    return asyncio.run(send())


def test_health_reports_trading_disabled() -> None:
    response = request("GET", "/healthz")

    assert response.status_code == 200
    assert response.json()["trading_enabled"] is False
    assert response.json()["financial_database"] == "UNCONFIGURED"
    assert response.headers["cache-control"] == "no-store"


def test_application_environment_is_configurable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KRONOS_ENV", "staging")

    response = request("GET", "/healthz")

    assert response.json()["mode"] == "staging"


def test_unknown_application_environment_fails_fast(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KRONOS_ENV", "production-ish")

    with pytest.raises(RuntimeError, match="KRONOS_ENV must be"):
        create_app(PROJECT_ROOT)


def test_api_returns_the_shared_platform_registry() -> None:
    response = request("GET", "/api/v1/platform/status")

    assert response.status_code == 200
    assert response.json() == load_platform_status(PROJECT_ROOT)
    assert response.headers["cache-control"] == "no-store"


def test_global_market_endpoint_proxies_and_caches_provider_data(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requested: list[tuple[str, dict[str, str]]] = []

    def fake_market(path: str, params: dict[str, str]) -> dict[str, Any]:
        requested.append((path, params))
        return {"data": {"total_market_cap": {"usd": 1_000_000}}}

    async def exercise_cache() -> tuple[httpx.Response, httpx.Response]:
        application = create_app(PROJECT_ROOT)
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as client:
            first_response = await client.get("/api/v1/market/global")
            second_response = await client.get("/api/v1/market/global")
            return first_response, second_response

    monkeypatch.setattr(app_module, "fetch_market_provider", fake_market)
    first, second = asyncio.run(exercise_cache())

    assert first.status_code == 200
    assert first.json()["data"]["total_market_cap"]["usd"] == 1_000_000
    assert second.json() == first.json()
    assert requested == [("/global", {})]


def test_homepage_uses_live_market_components_without_static_quotes() -> None:
    response = request("GET", "/")

    assert response.status_code == 200
    assert 'id="homeMarketRows"' in response.text
    assert 'id="homeSearchInput"' in response.text
    assert 'id="homeTrending"' in response.text
    assert 'id="research"' in response.text
    assert 'assets/js/home.js' in response.text
    assert "$67,482.21" not in response.text
    assert "Bitcoin Holds $67K" not in response.text


def test_swap_navigation_uses_existing_product_pages() -> None:
    response = request("GET", "/swap.html")

    assert response.status_code == 200
    assert "./trade.html" in response.text
    assert "./listings.html#submit-project" in response.text
    assert "./index.html#research" in response.text
    assert "promotions.html" not in response.text
    assert "list-project.html" not in response.text
    assert "about.html" not in response.text


def test_swap_ui_requests_quotes_without_signing_or_submitting_transactions() -> None:
    page = request("GET", "/swap.html")
    script = (PROJECT_ROOT / "assets" / "js" / "swap.js").read_text(encoding="utf-8")

    assert page.status_code == 200

def test_market_list_can_request_provider_sparklines(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requested: list[tuple[str, dict[str, str]]] = []

    def fake_market(path: str, params: dict[str, str]) -> list[dict[str, Any]]:
        requested.append((path, params))
        return []

    monkeypatch.setattr(app_module, "fetch_market_provider", fake_market)
    response = request("GET", "/api/v1/market/markets", params={"per_page": "100", "sparkline": "true"})

    assert response.status_code == 200
    assert requested == [
        (
            "/coins/markets",
            {
                "vs_currency": "usd",
                "order": "market_cap_desc",
                "per_page": "100",
                "page": "1",
                "sparkline": "true",
                "price_change_percentage": "24h",
            },
        ),
    ]


def test_market_ohlc_endpoint_proxies_valid_periods_and_rejects_unsupported_periods(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requested: list[tuple[str, dict[str, str]]] = []
    candles = [[1_700_000_000_000, 10.0, 12.0, 9.0, 11.0]]

    def fake_market(path: str, params: dict[str, str]) -> list[list[float]]:
        requested.append((path, params))
        return candles

    monkeypatch.setattr(app_module, "fetch_market_provider", fake_market)
    response = request("GET", "/api/v1/market/coins/bitcoin/ohlc", params={"days": 7})
    invalid_period = request("GET", "/api/v1/market/coins/bitcoin/ohlc", params={"days": 2})

    assert response.status_code == 200
    assert response.json() == candles
    assert response.headers["cache-control"] == "no-store"
    assert requested == [("/coins/bitcoin/ohlc", {"vs_currency": "usd", "days": "7"})]
    assert invalid_period.status_code == 422


def test_trading_page_uses_real_market_data_and_discloses_disabled_execution() -> None:
    response = request("GET", "/trade.html")
    script = (PROJECT_ROOT / "assets" / "js" / "trade.js").read_text(encoding="utf-8")

    assert response.status_code == 200
    assert 'id="tradeSearch"' in response.text
    assert 'id="tradeCandles"' in response.text
    assert 'id="tradePeriod"' in response.text
    assert 'href="swap.html"' in response.text
    assert "getOhlc" in script
    assert "getCoin" in script
    assert "disabled aria-disabled=\"true\"" in response.text
    assert "no simulated orders or activity are shown." in response.text.lower()


def test_login_page_contains_a_complete_signup_form() -> None:
    response = request("GET", "/login.html")

    assert response.status_code == 200
    assert 'id="signUpTab"' in response.text
    assert 'id="authForm"' in response.text
    assert 'id="displayName"' in response.text
    assert 'id="confirmPassword"' in response.text
    assert 'id="authMessage"' in response.text
    assert 'id="demoAccountButton"' not in response.text
    assert "PASSWORD_RECOVERY" in response.text
    assert "updateUser({ password: passwordValue  })" in response.text


def test_persistent_account_and_listing_pages_are_wired_to_supabase() -> None:
    account = request("GET", "/account.html")
    listings = request("GET", "/listings.html")
    account_script = (PROJECT_ROOT / "account.html").read_text(encoding="utf-8")
    listings_script = (PROJECT_ROOT / "assets" / "js" / "listings.js").read_text(encoding="utf-8")


def test_new_migration_limits_watchlists_and_moderation_to_owner_or_admin() -> None:
    migration = (
        PROJECT_ROOT / "supabase" / "migrations"
        / "202610200002_persistent_watchlists_and_submissions.sql"
    ).read_text(encoding="utf-8")

    assert "create table if not exists public.watchlist_items" in migration
    assert "auth.uid()) = user_id" in migration
    assert "app_metadata" in migration and "role') = 'admin'" in migration
    assert '"Admins can read project submissions"' in migration
    assert "project_submissions_active_contract_unique" in migration
    assert "grant select (" in migration
    assert "contact" not in migration.split("grant select (", 1)[1].split(") on public.project_submissions", 1)[0]
    assert "Cannot create the active project network/contract uniqueness index" in migration
    assert "resolve duplicate submissions without deleting user data" in migration


def test_account_exposes_moderation_only_for_server_assigned_admin_role() -> None:
    account = (PROJECT_ROOT / "account.html").read_text(encoding="utf-8")

    assert 'id="projectModeration" hidden' in account
    assert "authenticatedUser.app_metadata?.role === 'admin'" in account
    assert ".eq('status', 'pending')" in account
    assert ".eq('status', 'pending')" in account.split(".update({ status })", 1)[1]


def test_account_portfolio_uses_live_wallet_balance_and_market_reference() -> None:
    account = (PROJECT_ROOT / "account.html").read_text(encoding="utf-8")

    assert "eth_getBalance" in account
    assert "/api/v1/market/coins/${encodeURIComponent(asset.coinId)}" in account
    assert "Native asset only; other wallet holdings are excluded." in account
    assert "not account P&L" in account


def test_authentication_capability_reflects_supabase_configuration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_ANON_KEY", raising=False)

    status = load_platform_status(PROJECT_ROOT)
    auth = next(item for item in status["capabilities"] if item["name"] == "User authentication")
    assert auth["status"] == "UNCONFIGURED"

    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "public-anon-key")
    status = load_platform_status(PROJECT_ROOT)
    auth = next(item for item in status["capabilities"] if item["name"] == "User authentication")
    assert auth["status"] == "CONFIGURED"


def test_swap_capability_does_not_claim_the_unwired_page_is_live(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ZEROX_API_KEY", "server-only-key")
    monkeypatch.setenv("KRONOS_ENABLE_LIVE_SWAPS", "true")

    status = load_platform_status(PROJECT_ROOT)
    swaps = next(item for item in status["capabilities"] if item["name"] == "Token swaps")

    assert swaps["status"] == "INCOMPLETE"
    assert "transaction execution is not implemented" in swaps["details"]
    assert "independent production review are incomplete" in swaps["details"]
    assert swaps["readiness"] == {
        "provider_configured": True,
        "quote_endpoint_configured": True,
        "quote_endpoint_status": "UNVERIFIED",
        "wallet_adapter_available": True,
        "transaction_execution_implemented": False,
        "end_to_end_workflow_tested": False,
        "production_readiness_reviewed": False,
        "execution_enabled": False,
    }


def test_live_swap_flag_never_enables_execution_or_claims_readiness(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ZEROX_API_KEY", "server-only-key")
    monkeypatch.setenv("KRONOS_ENABLE_LIVE_SWAPS", "true")

    health = request("GET", "/healthz")
    status = load_platform_status(PROJECT_ROOT)
    ethereum = next(network for network in status["networks"] if network["chain_id"] == 1)

    assert health.json()["live_swap_execution_enabled"] is False
    assert ethereum["execution_enabled"] is False
    assert ethereum["same_chain_swap_enabled"] is False
    assert ethereum["quote_endpoint_status"] == "UNVERIFIED"
    assert ethereum["transaction_execution_implemented"] is False
    assert ethereum["end_to_end_workflow_tested"] is False
    assert ethereum["production_readiness_reviewed"] is False


def test_public_auth_configuration_never_exposes_service_role_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "public-anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "must-never-be-returned")

    response = request("GET", "/api/v1/config/public")

    assert response.status_code == 200
    assert response.json() == {
        "supabase_configured": True,
        "supabase_url": "https://example.supabase.co",
        "supabase_anon_key": "public-anon-key",
    }
    assert account.status_code == 200
    assert listings.status_code == 200
    assert "from('profiles')" in account_script
    assert "from('watchlist_items')" in account_script
    assert "from('project_submissions')" in account_script
    assert "sessionStorage" not in listings_script
    assert "from(\"project_submissions\").insert(payload)" in listings_script
    assert "auth.signOut()" in account_script
    assert 'id="swapQuoteReview"' in page.text

def test_server_serves_only_known_html_pages_and_assets() -> None:
    assert request("GET", "/").status_code == 200
    assert request("GET", "/discover.html").status_code == 200
    assert request("GET", "/swap.html").status_code == 200
    assert request("GET", "/assets/js/platform-registry.js").status_code == 200
    assert request("GET", "/ARCHITECTURE.md").status_code == 404
    assert request("GET", "/.venv/pyvenv.cfg").status_code == 404
    assert request("GET", "/missing.html").status_code == 404


def test_responses_include_security_headers() -> None:
    response = request("GET", "/healthz")

    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "strict-origin-when-cross-origin"
    assert response.headers["permissions-policy"] == "camera=(), microphone=(), geolocation=()"
    assert response.headers["x-request-id"]


def test_untrusted_host_is_rejected() -> None:
    response = request("GET", "/", headers={"host": "attacker.example"})

    assert response.status_code == 400


def test_registry_rejects_invalid_json(tmp_path: Path) -> None:
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    (config_dir / "platform-status.json").write_text("{", encoding="utf-8")

    try:
        load_platform_status(tmp_path)
    except RuntimeError as error:
        assert "could not be loaded" in str(error)
    else:
        raise AssertionError("Invalid JSON should not be accepted.")


def test_registry_rejects_invalid_structure(tmp_path: Path) -> None:
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    (config_dir / "platform-status.json").write_text(
        json.dumps({"capabilities": {}, "networks": []}),
        encoding="utf-8",
    )

    try:
        load_platform_status(tmp_path)
    except RuntimeError as error:
        assert "invalid structure" in str(error)
    else:
        raise AssertionError("An invalid structure should not be accepted.")


def test_registry_lists_chain_capabilities_and_keeps_live_swaps_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ZEROX_API_KEY", raising=False)
    monkeypatch.delenv("KRONOS_ENABLE_LIVE_SWAPS", raising=False)

    status = load_platform_status(PROJECT_ROOT)
    networks = {network["network_key"]: network for network in status["networks"]}

    assert set(networks) == {
        "ethereum", "bnb-smart-chain", "polygon", "arbitrum", "base", "avalanche", "optimism", "solana", "multiversx",
    }
    for key in ("ethereum", "bnb-smart-chain", "polygon", "arbitrum", "base", "avalanche", "optimism"):
        assert networks[key]["market_data_enabled"] is True
        assert networks[key]["wallet_connection_enabled"] is True
        assert networks[key]["same_chain_swap_supported"] is True
        assert networks[key]["same_chain_swap_enabled"] is False
        assert networks[key]["cross_chain_swap_enabled"] is False
        assert networks[key]["execution_enabled"] is False
        assert networks[key]["wallet_adapter_available"] is True
        assert networks[key]["quote_endpoint_status"] == "UNVERIFIED"
        assert networks[key]["transaction_execution_implemented"] is False
    assert networks["solana"]["wallet_connection_enabled"] is False
    assert networks["solana"]["same_chain_swap_supported"] is False
    assert networks["multiversx"]["same_chain_swap_supported"] is False


def test_registry_requires_api_key_and_explicit_live_swap_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ZEROX_API_KEY", "server-only-key")
    monkeypatch.delenv("KRONOS_ENABLE_LIVE_SWAPS", raising=False)
    status = load_platform_status(PROJECT_ROOT)
    ethereum = next(network for network in status["networks"] if network["chain_id"] == 1)
    assert ethereum["quote_enabled"] is True
    assert ethereum["execution_enabled"] is False

    monkeypatch.setenv("KRONOS_ENABLE_LIVE_SWAPS", "true")
    status = load_platform_status(PROJECT_ROOT)
    ethereum = next(network for network in status["networks"] if network["chain_id"] == 1)
    assert ethereum["execution_enabled"] is False
    assert ethereum["same_chain_swap_enabled"] is False

    monkeypatch.delenv("ZEROX_API_KEY")
    status = load_platform_status(PROJECT_ROOT)
    ethereum = next(network for network in status["networks"] if network["chain_id"] == 1)
    assert ethereum["quote_enabled"] is False
    assert ethereum["execution_enabled"] is False


def test_otp_screen_contains_required_elements() -> None:
    response = request("GET", "/login.html")

    assert response.status_code == 200
    assert 'id="otpScreen"' in response.text
    assert 'id="otpBack"' in response.text
    assert 'id="otpVerify"' in response.text
    assert 'id="otpResend"' in response.text
    assert 'id="otpResendCountdown"' in response.text
    assert 'id="otpEmailDisplay"' in response.text
    assert 'id="otpDescription"' in response.text
    assert 'id="otpSubtitle"' in response.text


def test_otp_verify_button_starts_enabled_and_reflects_cooldown_state() -> None:
    response = request("GET", "/login.html")

    assert response.status_code == 200
    assert 'id="otpVerify"' in response.text
    assert 'id="otpScreen"' in response.text
    assert "Verify Email" in response.text


def test_complete_signup_to_otp_navigation_flow() -> None:
    response = request("GET", "/login.html")

    assert response.status_code == 200
    assert 'id="otpScreen"' in response.text
    assert 'id="otpVerify"' in response.text
    assert "Verify Email" in response.text
    assert 'id="otpResend"' in response.text
    assert 'id="otpResendCountdown"' in response.text







def test_new_migration_limits_watchlists_and_moderation_to_owner_or_admin() -> None:
    migration = (
        PROJECT_ROOT / "supabase" / "migrations"
        / "202610200002_persistent_watchlists_and_submissions.sql"
    ).read_text(encoding="utf-8")

    assert "create table if not exists public.watchlist_items" in migration
    assert "auth.uid()) = user_id" in migration
    assert "app_metadata" in migration and "role') = 'admin'" in migration
    assert '"Admins can read project submissions"' in migration
    assert "project_submissions_active_contract_unique" in migration
    assert "grant select (" in migration
    assert "contact" not in migration.split("grant select (", 1)[1].split(") on public.project_submissions", 1)[0]
    assert "Cannot create the active project network/contract uniqueness index" in migration
    assert "resolve duplicate submissions without deleting user data" in migration


def test_account_exposes_moderation_only_for_server_assigned_admin_role() -> None:
    account = (PROJECT_ROOT / "account.html").read_text(encoding="utf-8")

    assert 'id="projectModeration" hidden' in account
    assert "authenticatedUser.app_metadata?.role === 'admin'" in account
    assert ".eq('status', 'pending')" in account
    assert ".eq('status', 'pending')" in account.split(".update({ status })", 1)[1]


def test_account_portfolio_uses_live_wallet_balance_and_market_reference() -> None:
    account = (PROJECT_ROOT / "account.html").read_text(encoding="utf-8")

    assert "eth_getBalance" in account
    assert "/api/v1/market/coins/${encodeURIComponent(asset.coinId)}" in account
    assert "Native asset only; other wallet holdings are excluded." in account
    assert "not account P&L" in account



def test_swap_capability_does_not_claim_the_unwired_page_is_live(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ZEROX_API_KEY", "server-only-key")
    monkeypatch.setenv("KRONOS_ENABLE_LIVE_SWAPS", "true")

    status = load_platform_status(PROJECT_ROOT)
    swaps = next(item for item in status["capabilities"] if item["name"] == "Token swaps")

    assert swaps["status"] == "INCOMPLETE"
    assert "transaction execution is not implemented" in swaps["details"]
    assert "independent production review are incomplete" in swaps["details"]
    assert swaps["readiness"] == {
        "provider_configured": True,
        "quote_endpoint_configured": True,
        "quote_endpoint_status": "UNVERIFIED",
        "wallet_adapter_available": True,
        "transaction_execution_implemented": False,
        "end_to_end_workflow_tested": False,
        "production_readiness_reviewed": False,
        "execution_enabled": False,
    }


def test_live_swap_flag_never_enables_execution_or_claims_readiness(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ZEROX_API_KEY", "server-only-key")
    monkeypatch.setenv("KRONOS_ENABLE_LIVE_SWAPS", "true")

    health = request("GET", "/healthz")
    status = load_platform_status(PROJECT_ROOT)
    ethereum = next(network for network in status["networks"] if network["chain_id"] == 1)

    assert health.json()["live_swap_execution_enabled"] is False
    assert ethereum["execution_enabled"] is False
    assert ethereum["same_chain_swap_enabled"] is False
    assert ethereum["quote_endpoint_status"] == "UNVERIFIED"
    assert ethereum["transaction_execution_implemented"] is False
    assert ethereum["end_to_end_workflow_tested"] is False
    assert ethereum["production_readiness_reviewed"] is False


def test_public_auth_configuration_never_exposes_service_role_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "public-anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "must-never-be-returned")

    response = request("GET", "/api/v1/config/public")

    assert response.status_code == 200
    assert response.json() == {
        "supabase_configured": True,
        "supabase_url": "https://example.supabase.co",
        "supabase_anon_key": "public-anon-key",
    }


def test_server_serves_only_known_html_pages_and_assets() -> None:
    assert request("GET", "/").status_code == 200
    assert request("GET", "/discover.html").status_code == 200
    assert request("GET", "/swap.html").status_code == 200
    assert request("GET", "/assets/js/platform-registry.js").status_code == 200
    assert request("GET", "/ARCHITECTURE.md").status_code == 404
    assert request("GET", "/.venv/pyvenv.cfg").status_code == 404
    assert request("GET", "/missing.html").status_code == 404


def test_responses_include_security_headers() -> None:
    response = request("GET", "/healthz")

    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "strict-origin-when-cross-origin"
    assert response.headers["permissions-policy"] == "camera=(), microphone=(), geolocation=()"
    assert response.headers["x-request-id"]


def test_untrusted_host_is_rejected() -> None:
    response = request("GET", "/", headers={"host": "attacker.example"})

    assert response.status_code == 400


def test_registry_rejects_invalid_json(tmp_path: Path) -> None:
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    (config_dir / "platform-status.json").write_text("{", encoding="utf-8")

    try:
        load_platform_status(tmp_path)
    except RuntimeError as error:
        assert "could not be loaded" in str(error)
    else:
        raise AssertionError("Invalid JSON should not be accepted.")


def test_registry_rejects_invalid_structure(tmp_path: Path) -> None:
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    (config_dir / "platform-status.json").write_text(
        json.dumps({"capabilities": {}, "networks": []}),
        encoding="utf-8",
    )

    try:
        load_platform_status(tmp_path)
    except RuntimeError as error:
        assert "invalid structure" in str(error)
    else:
        raise AssertionError("An invalid structure should not be accepted.")


def test_registry_lists_chain_capabilities_and_keeps_live_swaps_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ZEROX_API_KEY", raising=False)
    monkeypatch.delenv("KRONOS_ENABLE_LIVE_SWAPS", raising=False)

    status = load_platform_status(PROJECT_ROOT)
    networks = {network["network_key"]: network for network in status["networks"]}

    assert set(networks) == {
        "ethereum", "bnb-smart-chain", "polygon", "arbitrum", "base", "avalanche", "optimism", "solana", "multiversx",
    }
    for key in ("ethereum", "bnb-smart-chain", "polygon", "arbitrum", "base", "avalanche", "optimism"):
        assert networks[key]["market_data_enabled"] is True
        assert networks[key]["wallet_connection_enabled"] is True
        assert networks[key]["same_chain_swap_supported"] is True
        assert networks[key]["same_chain_swap_enabled"] is False
        assert networks[key]["cross_chain_swap_enabled"] is False
        assert networks[key]["execution_enabled"] is False
        assert networks[key]["wallet_adapter_available"] is True
        assert networks[key]["quote_endpoint_status"] == "UNVERIFIED"
        assert networks[key]["transaction_execution_implemented"] is False
    assert networks["solana"]["wallet_connection_enabled"] is False
    assert networks["solana"]["same_chain_swap_supported"] is False
    assert networks["multiversx"]["same_chain_swap_supported"] is False
def test_authentication_capability_reflects_supabase_configuration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_ANON_KEY", raising=False)

    status = load_platform_status(PROJECT_ROOT)
    auth = next(item for item in status["capabilities"] if item["name"] == "User authentication")
    assert auth["status"] == "UNCONFIGURED"

    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "public-anon-key")
    status = load_platform_status(PROJECT_ROOT)
    auth = next(item for item in status["capabilities"] if item["name"] == "User authentication")
    assert auth["status"] == "CONFIGURED"