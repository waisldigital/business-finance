"""Phase 3 - GET/PUT /api/settings tests + theme/CSS-related backend assertions."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://staff-directory-31.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@crackerpro.com"
ADMIN_PASSWORD = "Admin@123"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    if r.status_code == 429:
        pytest.skip("Admin locked out")
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def non_admin_headers(admin_headers):
    """Create a non-admin user (sales) for 403 tests."""
    email = "TEST_phase3_sales@crackerpro.com"
    payload = {"email": email, "password": "Sales@123", "full_name": "TEST Sales", "role": "sales"}
    # try create (may already exist)
    r = requests.post(f"{API}/admin/users", headers=admin_headers, json=payload, timeout=15)
    if r.status_code not in (200, 201, 400, 409):
        pytest.skip(f"cannot create test sales user: {r.status_code} {r.text}")
    # ensure password reset to known
    if r.status_code in (400, 409):
        # find user id and reset password
        users = requests.get(f"{API}/admin/users", headers=admin_headers, timeout=15).json()
        u = next((x for x in users if x.get("email") == email), None)
        if u:
            requests.post(f"{API}/admin/users/reset-password", headers=admin_headers,
                          json={"user_id": u["id"], "new_password": "Sales@123"}, timeout=15)
    login = requests.post(f"{API}/auth/login", json={"email": email, "password": "Sales@123"}, timeout=15)
    if login.status_code != 200:
        pytest.skip(f"cannot login non-admin: {login.status_code} {login.text}")
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


class TestSettings:
    def test_get_settings_default(self, admin_headers):
        r = requests.get(f"{API}/settings", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "inr_per_usd" in d
        assert "default_currency" in d
        assert isinstance(d["inr_per_usd"], (int, float))
        assert d["inr_per_usd"] > 0
        assert d["default_currency"] in ("INR", "USD")

    def test_put_settings_admin_success(self, admin_headers):
        # change FX
        r = requests.put(f"{API}/settings", headers=admin_headers,
                         json={"inr_per_usd": 100.0, "default_currency": "INR"}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["inr_per_usd"] == 100.0
        assert d["default_currency"] == "INR"
        # GET reflects
        d2 = requests.get(f"{API}/settings", headers=admin_headers, timeout=15).json()
        assert d2["inr_per_usd"] == 100.0
        # restore default 83
        r = requests.put(f"{API}/settings", headers=admin_headers,
                         json={"inr_per_usd": 83.0, "default_currency": "INR"}, timeout=15)
        assert r.status_code == 200

    def test_put_settings_invalid_inr_negative(self, admin_headers):
        r = requests.put(f"{API}/settings", headers=admin_headers,
                         json={"inr_per_usd": -1}, timeout=15)
        assert r.status_code == 400, f"Expected 400 for negative, got {r.status_code}"

    def test_put_settings_invalid_inr_zero(self, admin_headers):
        r = requests.put(f"{API}/settings", headers=admin_headers,
                         json={"inr_per_usd": 0}, timeout=15)
        assert r.status_code == 400

    def test_put_settings_invalid_inr_string(self, admin_headers):
        r = requests.put(f"{API}/settings", headers=admin_headers,
                         json={"inr_per_usd": "abc"}, timeout=15)
        assert r.status_code == 400

    def test_put_settings_invalid_currency(self, admin_headers):
        r = requests.put(f"{API}/settings", headers=admin_headers,
                         json={"default_currency": "EUR"}, timeout=15)
        assert r.status_code == 400

    def test_put_settings_non_admin_forbidden(self, non_admin_headers):
        r = requests.put(f"{API}/settings", headers=non_admin_headers,
                         json={"inr_per_usd": 90}, timeout=15)
        assert r.status_code == 403, f"Expected 403, got {r.status_code} {r.text}"

    def test_get_settings_non_admin_allowed(self, non_admin_headers):
        # GET should work for any auth user (read-only)
        r = requests.get(f"{API}/settings", headers=non_admin_headers, timeout=15)
        assert r.status_code == 200

    def test_settings_unauth(self):
        r = requests.put(f"{API}/settings", json={"inr_per_usd": 90}, timeout=15)
        assert r.status_code in (401, 403)


# ============ Phase 1 + 2 regression smoke ============
class TestRegressionSmoke:
    def test_dashboard(self, admin_headers):
        r = requests.get(f"{API}/dashboard/summary", headers=admin_headers, timeout=15)
        assert r.status_code == 200

    def test_projects_list(self, admin_headers):
        r = requests.get(f"{API}/projects", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_customers_list(self, admin_headers):
        r = requests.get(f"{API}/customers", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_audit_list(self, admin_headers):
        r = requests.get(f"{API}/audit", headers=admin_headers, timeout=15)
        assert r.status_code == 200

    def test_admin_users_list(self, admin_headers):
        r = requests.get(f"{API}/admin/users", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_approval_matrix(self, admin_headers):
        r = requests.get(f"{API}/approvals/rules", headers=admin_headers, timeout=15)
        assert r.status_code == 200
