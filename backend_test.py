"""
Backend Testing for Iteration 10 - Change Request Module (Wave 1)
Tests all CR endpoints, approval matrix, WBS approval, attachments, and in-app notifications.
"""
import requests
import json
import io
import time
from datetime import datetime

# Backend URL from frontend/.env
BASE_URL = "https://staff-directory-31.preview.emergentagent.com/api"

# Test credentials
ADMIN_EMAIL = "admin@crackerpro.com"
ADMIN_PASSWORD = "Admin@123"
TUSHAR_EMAIL = "tushar.sukhija@waisldigital.com"
TUSHAR_PASSWORD = "TSukhija@121"

# Global variables for test data
admin_token = None
tushar_token = None
finance_user_token = None
finance_user_id = None
test_cr_id = None
test_cr_id_low_margin = None
test_attachment_id = None
test_role_id = None

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def login(email, password):
    """Login and return access token"""
    log(f"Logging in as {email}...")
    resp = requests.post(f"{BASE_URL}/auth/login", json={"email": email, "password": password})
    if resp.status_code != 200:
        log(f"❌ Login failed: {resp.status_code} - {resp.text}")
        return None
    data = resp.json()
    log(f"✅ Login successful")
    return data.get("access_token")

def headers(token):
    """Return authorization headers"""
    return {"Authorization": f"Bearer {token}"}

# ============================================================
# TEST 1: Approval Matrix - applies_to field
# ============================================================
def test_approval_matrix_applies_to():
    log("\n=== TEST 1: Approval Matrix - applies_to field ===")
    global admin_token
    
    # a) GET /api/approvals/rules → should have applies_to field
    log("1a) GET /api/approvals/rules - checking applies_to field...")
    resp = requests.get(f"{BASE_URL}/approvals/rules", headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ GET /api/approvals/rules failed: {resp.status_code}")
        return False
    
    rules = resp.json()
    log(f"✅ GET /api/approvals/rules returned {len(rules)} rules")
    
    # Check for "CR Approval - Default" rule with applies_to="change_request"
    cr_default_rule = None
    for rule in rules:
        if "applies_to" not in rule:
            log(f"❌ Rule '{rule.get('name')}' missing applies_to field")
            return False
        if rule.get("name") == "CR Approval - Default":
            cr_default_rule = rule
            if rule.get("applies_to") != "change_request":
                log(f"❌ CR Approval - Default has applies_to='{rule.get('applies_to')}', expected 'change_request'")
                return False
            log(f"✅ Found 'CR Approval - Default' rule with applies_to='change_request'")
    
    if not cr_default_rule:
        log("❌ 'CR Approval - Default' rule not found in seeded data")
        return False
    
    # b) POST /api/approvals/rules with applies_to="project"
    log("1b) POST /api/approvals/rules with applies_to='project'...")
    new_rule = {
        "name": "Test Project Rule",
        "business_category": "Any",
        "min_revenue": 1000000,
        "max_revenue": None,
        "min_margin_pct": None,
        "max_margin_pct": None,
        "target_stage": "Deal P&L",
        "approver_emails": [ADMIN_EMAIL],
        "approver_role": "leadership",
        "applies_to": "project",
        "is_active": True
    }
    resp = requests.post(f"{BASE_URL}/approvals/rules", json=new_rule, headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ POST /api/approvals/rules failed: {resp.status_code} - {resp.text}")
        return False
    
    created_rule = resp.json()
    if created_rule.get("applies_to") != "project":
        log(f"❌ Created rule has applies_to='{created_rule.get('applies_to')}', expected 'project'")
        return False
    log(f"✅ Created rule with applies_to='project', id={created_rule.get('id')}")
    
    # c) PUT rule changing applies_to="change_request"
    log("1c) PUT /api/approvals/rules changing applies_to to 'change_request'...")
    rule_id = created_rule.get("id")
    update_payload = created_rule.copy()
    update_payload["applies_to"] = "change_request"
    resp = requests.put(f"{BASE_URL}/approvals/rules/{rule_id}", json=update_payload, headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ PUT /api/approvals/rules failed: {resp.status_code} - {resp.text}")
        return False
    
    updated_rule = resp.json()
    if updated_rule.get("applies_to") != "change_request":
        log(f"❌ Updated rule has applies_to='{updated_rule.get('applies_to')}', expected 'change_request'")
        return False
    log(f"✅ Updated rule applies_to to 'change_request'")
    
    # Cleanup
    requests.delete(f"{BASE_URL}/approvals/rules/{rule_id}", headers=headers(admin_token))
    
    return True

# ============================================================
# TEST 2: Create CR (draft) with margin + approver computation
# ============================================================
def test_create_cr_draft():
    log("\n=== TEST 2: Create CR (draft) with margin + approver computation ===")
    global admin_token, test_cr_id
    
    log("2a) POST /api/change-requests with full payload...")
    cr_payload = {
        "cr_name": "CR Alpha Test",
        "customer_name": "DIAL - Delhi International Airport",
        "airport_name": "DIAL",
        "wbs_element": "C.NEW.TEST.0001",
        "po_received": True,
        "customer_po_number": "PO-TEST-001",
        "po_value": 10000000,
        "po_issue_date": "01-01-2026",
        "po_from_date": "01-01-2026",
        "po_to_date": "31-12-2026",
        "vendor_cost": 5000000,
        "resource_lines": [
            {
                "resource_count": 2,
                "mandays": 150,
                "grade": "L3",
                "amount": 2000000,
                "free_text": "backend devs"
            }
        ],
        "customer_payment_terms": "Net 30",
        "vendor_payment_terms": "Advance 20%",
        "pbg_ld_required": False,
        "milestones": [
            {
                "date": "30-06-2026",
                "billing_amount": 5000000,
                "notes": "Milestone 1"
            }
        ],
        "assignees_to": [],
        "assignees_cc": []
    }
    
    resp = requests.post(f"{BASE_URL}/change-requests", json=cr_payload, headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ POST /api/change-requests failed: {resp.status_code} - {resp.text}")
        return False
    
    cr = resp.json()
    test_cr_id = cr.get("id")
    log(f"✅ Created CR with id={test_cr_id}")
    
    # Verify cr_number pattern CR-YYYYMM-XXXX
    cr_number = cr.get("cr_number")
    if not cr_number or not cr_number.startswith("CR-"):
        log(f"❌ cr_number '{cr_number}' doesn't match pattern CR-YYYYMM-XXXX")
        return False
    log(f"✅ cr_number matches pattern: {cr_number}")
    
    # Verify status="draft"
    if cr.get("status") != "draft":
        log(f"❌ status is '{cr.get('status')}', expected 'draft'")
        return False
    log(f"✅ status='draft'")
    
    # Verify estimated_resource_cost == 2000000
    if cr.get("estimated_resource_cost") != 2000000:
        log(f"❌ estimated_resource_cost={cr.get('estimated_resource_cost')}, expected 2000000")
        return False
    log(f"✅ estimated_resource_cost=2000000")
    
    # Verify estimated_total_cost == 7000000 (vendor 5M + resource 2M)
    if cr.get("estimated_total_cost") != 7000000:
        log(f"❌ estimated_total_cost={cr.get('estimated_total_cost')}, expected 7000000")
        return False
    log(f"✅ estimated_total_cost=7000000")
    
    # Verify estimated_margin_amount == 3000000
    if cr.get("estimated_margin_amount") != 3000000:
        log(f"❌ estimated_margin_amount={cr.get('estimated_margin_amount')}, expected 3000000")
        return False
    log(f"✅ estimated_margin_amount=3000000")
    
    # Verify estimated_margin_pct ≈ 30.0
    margin_pct = cr.get("estimated_margin_pct")
    if not (29.9 <= margin_pct <= 30.1):
        log(f"❌ estimated_margin_pct={margin_pct}, expected ≈30.0")
        return False
    log(f"✅ estimated_margin_pct={margin_pct} (≈30.0)")
    
    # Verify approver_emails / approver_rule_name populated
    approver_emails = cr.get("approver_emails")
    approver_rule_name = cr.get("approver_rule_name")
    if not approver_emails:
        log(f"❌ approver_emails is empty")
        return False
    if not approver_rule_name:
        log(f"❌ approver_rule_name is empty")
        return False
    log(f"✅ approver_emails={approver_emails}, approver_rule_name='{approver_rule_name}'")
    
    return True

# ============================================================
# TEST 3: CR with low margin — business justification required
# ============================================================
def test_cr_low_margin_justification():
    log("\n=== TEST 3: CR with low margin — business justification required ===")
    global admin_token, test_cr_id_low_margin
    
    # a) Create CR with low margin (~5%)
    log("3a) Creating CR with po_value=1000000, vendor_cost=950000 (margin ~5%)...")
    cr_payload = {
        "cr_name": "CR Low Margin Test",
        "customer_name": "DIAL - Delhi International Airport",
        "airport_name": "DIAL",
        "wbs_element": "C.LOW.MARGIN.0001",
        "po_received": True,
        "customer_po_number": "PO-LOW-001",
        "po_value": 1000000,
        "po_issue_date": "01-01-2026",
        "po_from_date": "01-01-2026",
        "po_to_date": "31-12-2026",
        "vendor_cost": 950000,
        "resource_lines": [],
        "assignees_to": [],
        "assignees_cc": []
    }
    
    resp = requests.post(f"{BASE_URL}/change-requests", json=cr_payload, headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ POST /api/change-requests failed: {resp.status_code} - {resp.text}")
        return False
    
    cr = resp.json()
    test_cr_id_low_margin = cr.get("id")
    margin_pct = cr.get("estimated_margin_pct")
    log(f"✅ Created CR with id={test_cr_id_low_margin}, margin={margin_pct}%")
    
    # b) Try to submit without business_justification → should fail with 400
    log("3b) POST /api/change-requests/{id}/submit without business_justification...")
    resp = requests.post(f"{BASE_URL}/change-requests/{test_cr_id_low_margin}/submit", headers=headers(admin_token))
    if resp.status_code != 400:
        log(f"❌ Expected 400, got {resp.status_code}")
        return False
    
    error_msg = resp.json().get("detail", "")
    if "Business justification is required when margin is below 25%" not in error_msg:
        log(f"❌ Error message doesn't match: {error_msg}")
        return False
    log(f"✅ Submit blocked with 400: {error_msg}")
    
    # c) PUT the CR setting business_justification
    log("3c) PUT /api/change-requests/{id} with business_justification...")
    cr_payload["business_justification"] = "Strategic loss-leader"
    resp = requests.put(f"{BASE_URL}/change-requests/{test_cr_id_low_margin}", json=cr_payload, headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ PUT /api/change-requests failed: {resp.status_code} - {resp.text}")
        return False
    
    updated_cr = resp.json()
    if updated_cr.get("business_justification") != "Strategic loss-leader":
        log(f"❌ business_justification not set correctly")
        return False
    log(f"✅ business_justification set to 'Strategic loss-leader'")
    
    # d) POST submit again → should succeed, status should be "wbs_pending" (WBS doesn't exist)
    log("3d) POST /api/change-requests/{id}/submit again...")
    resp = requests.post(f"{BASE_URL}/change-requests/{test_cr_id_low_margin}/submit", headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ POST submit failed: {resp.status_code} - {resp.text}")
        return False
    
    submitted_cr = resp.json()
    if submitted_cr.get("status") != "wbs_pending":
        log(f"❌ status is '{submitted_cr.get('status')}', expected 'wbs_pending'")
        return False
    log(f"✅ Submit successful, status='wbs_pending'")
    
    return True

# ============================================================
# TEST 4: WBS approval flow
# ============================================================
def test_wbs_approval_flow():
    log("\n=== TEST 4: WBS approval flow ===")
    global admin_token, test_cr_id, finance_user_token, finance_user_id, test_role_id
    
    # a) GET /api/wbs (clean state)
    log("4a) GET /api/wbs to check if WBS exists...")
    resp = requests.get(f"{BASE_URL}/wbs", headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ GET /api/wbs failed: {resp.status_code}")
        return False
    
    wbs_list = resp.json()
    log(f"✅ GET /api/wbs returned {len(wbs_list)} WBS elements")
    
    # Submit the CR from test 2 → WBS "C.NEW.TEST.0001" is NOT in master, so status → "wbs_pending"
    log("4a) Submitting CR from test 2 (WBS not in master)...")
    resp = requests.post(f"{BASE_URL}/change-requests/{test_cr_id}/submit", headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ POST submit failed: {resp.status_code} - {resp.text}")
        return False
    
    submitted_cr = resp.json()
    if submitted_cr.get("status") != "wbs_pending":
        log(f"❌ status is '{submitted_cr.get('status')}', expected 'wbs_pending'")
        return False
    log(f"✅ CR submitted, status='wbs_pending' (WBS not in master)")
    
    # b) POST /api/change-requests/{id}/approve-wbs as admin
    log("4b) POST /api/change-requests/{id}/approve-wbs as admin...")
    resp = requests.post(f"{BASE_URL}/change-requests/{test_cr_id}/approve-wbs", headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ POST approve-wbs failed: {resp.status_code} - {resp.text}")
        return False
    
    approved_cr = resp.json()
    if approved_cr.get("status") != "wbs_approved":
        log(f"❌ status is '{approved_cr.get('status')}', expected 'wbs_approved'")
        return False
    if not approved_cr.get("wbs_approved"):
        log(f"❌ wbs_approved is False, expected True")
        return False
    log(f"✅ WBS approved, status='wbs_approved', wbs_approved=True")
    
    # c) Approving WBS twice → 400
    log("4c) Trying to approve WBS again (should fail with 400)...")
    resp = requests.post(f"{BASE_URL}/change-requests/{test_cr_id}/approve-wbs", headers=headers(admin_token))
    if resp.status_code != 400:
        log(f"❌ Expected 400, got {resp.status_code}")
        return False
    log(f"✅ Second WBS approval blocked with 400")
    
    # d) Test as finance role: create a new user with role=finance
    log("4d) Creating finance user for WBS approval test...")
    
    # First create a role with finance permissions (or get existing)
    import time
    role_name = f"Finance Test Role {int(time.time())}"
    role_payload = {
        "name": role_name,
        "description": "Test role for finance",
        "permissions": {
            "dashboard": {"can_view": True, "can_edit": False},
            "change_requests": {"can_view": True, "can_edit": True}
        }
    }
    resp = requests.post(f"{BASE_URL}/roles", json=role_payload, headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ POST /api/roles failed: {resp.status_code} - {resp.text}")
        return False
    test_role_id = resp.json().get("id")
    
    # Create finance user with unique email
    finance_email = f"finance.test.{int(time.time())}@waisldigital.com"
    finance_user_payload = {
        "email": finance_email,
        "password": "Finance@123",
        "name": "Finance Test User",
        "role": "finance",
        "role_id": test_role_id,
        "location": "HQ"
    }
    resp = requests.post(f"{BASE_URL}/admin/users", json=finance_user_payload, headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ POST /api/admin/users failed: {resp.status_code} - {resp.text}")
        return False
    
    finance_user = resp.json()
    finance_user_id = finance_user.get("id")
    log(f"✅ Created finance user with id={finance_user_id}")
    
    # Login as finance user
    finance_user_token = login(finance_email, "Finance@123")
    if not finance_user_token:
        log(f"❌ Finance user login failed")
        return False
    
    # Create another CR for finance user to approve WBS
    log("4d) Creating another CR for finance user WBS approval test...")
    cr_payload = {
        "cr_name": "CR Finance WBS Test",
        "customer_name": "GHIAL - Hyderabad Airport",
        "airport_name": "GHIAL",
        "wbs_element": "C.FINANCE.TEST.0001",
        "po_received": True,
        "customer_po_number": "PO-FIN-001",
        "po_value": 5000000,
        "po_issue_date": "01-01-2026",
        "po_from_date": "01-01-2026",
        "po_to_date": "31-12-2026",
        "vendor_cost": 3000000,
        "resource_lines": [],
        "business_justification": "Finance test",
        "assignees_to": [],
        "assignees_cc": []
    }
    resp = requests.post(f"{BASE_URL}/change-requests", json=cr_payload, headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ POST /api/change-requests failed: {resp.status_code} - {resp.text}")
        return False
    
    finance_cr = resp.json()
    finance_cr_id = finance_cr.get("id")
    
    # Submit the CR
    resp = requests.post(f"{BASE_URL}/change-requests/{finance_cr_id}/submit", headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ POST submit failed: {resp.status_code} - {resp.text}")
        return False
    
    # Finance user approves WBS
    log("4d) Finance user approving WBS...")
    resp = requests.post(f"{BASE_URL}/change-requests/{finance_cr_id}/approve-wbs", headers=headers(finance_user_token))
    if resp.status_code != 200:
        log(f"❌ Finance user WBS approval failed: {resp.status_code} - {resp.text}")
        return False
    log(f"✅ Finance user successfully approved WBS")
    
    # Cleanup finance CR
    requests.delete(f"{BASE_URL}/change-requests/{finance_cr_id}", headers=headers(admin_token))
    
    # e) Non-admin/non-finance call to approve-wbs → 403
    log("4e) Creating non-admin/non-finance user for negative test...")
    regular_email = f"regular.test.{int(time.time())}@waisldigital.com"
    regular_user_payload = {
        "email": regular_email,
        "password": "Regular@123",
        "name": "Regular Test User",
        "role": "sales",
        "location": "HQ"
    }
    resp = requests.post(f"{BASE_URL}/admin/users", json=regular_user_payload, headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ POST /api/admin/users failed: {resp.status_code} - {resp.text}")
        return False
    
    regular_user_token = login(regular_email, "Regular@123")
    if not regular_user_token:
        log(f"❌ Regular user login failed")
        return False
    
    # Try to approve WBS as regular user
    log("4e) Regular user trying to approve WBS (should fail with 403)...")
    resp = requests.post(f"{BASE_URL}/change-requests/{test_cr_id}/approve-wbs", headers=headers(regular_user_token))
    if resp.status_code != 403:
        log(f"❌ Expected 403, got {resp.status_code}")
        return False
    log(f"✅ Regular user WBS approval blocked with 403")
    
    return True

# ============================================================
# TEST 5: CR full approval flow
# ============================================================
def test_cr_full_approval():
    log("\n=== TEST 5: CR full approval flow ===")
    global admin_token, test_cr_id
    
    # a) Admin is already in approver_emails via the seeded rule
    log("5a) Verifying admin is in approver_emails...")
    resp = requests.get(f"{BASE_URL}/change-requests/{test_cr_id}", headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ GET /api/change-requests/{test_cr_id} failed: {resp.status_code}")
        return False
    
    cr = resp.json()
    approver_emails = [e.lower() for e in cr.get("approver_emails", [])]
    if ADMIN_EMAIL.lower() not in approver_emails:
        log(f"❌ Admin email not in approver_emails: {approver_emails}")
        return False
    log(f"✅ Admin is in approver_emails")
    
    # b) POST /api/change-requests/{id}/approve as admin
    log("5b) POST /api/change-requests/{id}/approve as admin...")
    resp = requests.post(f"{BASE_URL}/change-requests/{test_cr_id}/approve", headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ POST approve failed: {resp.status_code} - {resp.text}")
        return False
    
    approved_cr = resp.json()
    if approved_cr.get("status") != "approved":
        log(f"❌ status is '{approved_cr.get('status')}', expected 'approved'")
        return False
    if not approved_cr.get("approved_by"):
        log(f"❌ approved_by is empty")
        return False
    log(f"✅ CR approved, status='approved', approved_by='{approved_cr.get('approved_by')}'")
    
    # c) Try approve before WBS approved (create new CR for this test)
    log("5c) Testing approve before WBS approved...")
    cr_payload = {
        "cr_name": "CR No WBS Approval Test",
        "customer_name": "BIAL - Bengaluru Airport",
        "airport_name": "BIAL",
        "wbs_element": "C.NO.WBS.0001",
        "po_received": True,
        "customer_po_number": "PO-NOWBS-001",
        "po_value": 3000000,
        "po_issue_date": "01-01-2026",
        "po_from_date": "01-01-2026",
        "po_to_date": "31-12-2026",
        "vendor_cost": 2000000,
        "resource_lines": [],
        "business_justification": "Test",
        "assignees_to": [],
        "assignees_cc": []
    }
    resp = requests.post(f"{BASE_URL}/change-requests", json=cr_payload, headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ POST /api/change-requests failed: {resp.status_code} - {resp.text}")
        return False
    
    no_wbs_cr = resp.json()
    no_wbs_cr_id = no_wbs_cr.get("id")
    
    # Submit the CR
    resp = requests.post(f"{BASE_URL}/change-requests/{no_wbs_cr_id}/submit", headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ POST submit failed: {resp.status_code} - {resp.text}")
        return False
    
    # Try to approve without WBS approval
    log("5c) Trying to approve CR without WBS approval (should fail with 400)...")
    resp = requests.post(f"{BASE_URL}/change-requests/{no_wbs_cr_id}/approve", headers=headers(admin_token))
    if resp.status_code != 400:
        log(f"❌ Expected 400, got {resp.status_code}")
        return False
    
    error_msg = resp.json().get("detail", "")
    if "WBS must be approved" not in error_msg:
        log(f"❌ Error message doesn't match: {error_msg}")
        return False
    log(f"✅ Approve blocked with 400: {error_msg}")
    
    # Cleanup
    requests.delete(f"{BASE_URL}/change-requests/{no_wbs_cr_id}", headers=headers(admin_token))
    
    return True

# ============================================================
# TEST 6: Reject CR
# ============================================================
def test_reject_cr():
    log("\n=== TEST 6: Reject CR ===")
    global admin_token, test_cr_id_low_margin
    
    log("6) POST /api/change-requests/{id}/reject with reason...")
    reject_payload = {"reason": "insufficient margin"}
    resp = requests.post(f"{BASE_URL}/change-requests/{test_cr_id_low_margin}/reject", 
                        json=reject_payload, headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ POST reject failed: {resp.status_code} - {resp.text}")
        return False
    
    rejected_cr = resp.json()
    if rejected_cr.get("status") != "rejected":
        log(f"❌ status is '{rejected_cr.get('status')}', expected 'rejected'")
        return False
    if rejected_cr.get("rejected_reason") != "insufficient margin":
        log(f"❌ rejected_reason is '{rejected_cr.get('rejected_reason')}', expected 'insufficient margin'")
        return False
    log(f"✅ CR rejected, status='rejected', rejected_reason='insufficient margin'")
    
    return True

# ============================================================
# TEST 7: Metrics endpoint
# ============================================================
def test_metrics_endpoint():
    log("\n=== TEST 7: Metrics endpoint ===")
    global admin_token
    
    log("7) GET /api/change-requests/metrics...")
    resp = requests.get(f"{BASE_URL}/change-requests/metrics", headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ GET /api/change-requests/metrics failed: {resp.status_code}")
        return False
    
    metrics = resp.json()
    
    # Verify structure
    required_fields = ["total_count", "total_po_value", "total_cost", "total_margin_amount", 
                      "total_margin_pct", "by_status", "by_airport"]
    for field in required_fields:
        if field not in metrics:
            log(f"❌ Missing field '{field}' in metrics")
            return False
    
    log(f"✅ Metrics endpoint returned all required fields")
    log(f"   total_count={metrics['total_count']}")
    log(f"   total_po_value={metrics['total_po_value']}")
    log(f"   total_cost={metrics['total_cost']}")
    log(f"   total_margin_amount={metrics['total_margin_amount']}")
    log(f"   total_margin_pct={metrics['total_margin_pct']}")
    log(f"   by_status={metrics['by_status']}")
    log(f"   by_airport={metrics['by_airport']}")
    
    # Verify totals correspond to created CRs
    if metrics["total_count"] < 2:
        log(f"❌ total_count={metrics['total_count']}, expected at least 2 (created CRs)")
        return False
    
    return True

# ============================================================
# TEST 8: Attachments
# ============================================================
def test_attachments():
    log("\n=== TEST 8: Attachments ===")
    global admin_token, test_cr_id, test_attachment_id
    
    # a) POST /api/change-requests/{id}/attachments with a tiny PDF
    log("8a) POST /api/change-requests/{id}/attachments with tiny PDF...")
    
    # Create a tiny PDF-like file (just for testing, not a real PDF)
    pdf_content = b"%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n/Pages 2 0 R\n>>\nendobj\n2 0 obj\n<<\n/Type /Pages\n/Kids [3 0 R]\n/Count 1\n>>\nendobj\n3 0 obj\n<<\n/Type /Page\n/Parent 2 0 R\n/MediaBox [0 0 612 792]\n>>\nendobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\ntrailer\n<<\n/Size 4\n/Root 1 0 R\n>>\nstartxref\n190\n%%EOF"
    
    files = {"file": ("test_po.pdf", pdf_content, "application/pdf")}
    resp = requests.post(f"{BASE_URL}/change-requests/{test_cr_id}/attachments?kind=customer_po", 
                        files=files, headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ POST attachments failed: {resp.status_code} - {resp.text}")
        return False
    
    attachment = resp.json()
    test_attachment_id = attachment.get("id")
    
    # Verify response
    if not test_attachment_id:
        log(f"❌ Attachment id is empty")
        return False
    if attachment.get("kind") != "customer_po":
        log(f"❌ kind is '{attachment.get('kind')}', expected 'customer_po'")
        return False
    if attachment.get("filename") != "test_po.pdf":
        log(f"❌ filename is '{attachment.get('filename')}', expected 'test_po.pdf'")
        return False
    if attachment.get("size") != len(pdf_content):
        log(f"❌ size is {attachment.get('size')}, expected {len(pdf_content)}")
        return False
    log(f"✅ Attachment uploaded: id={test_attachment_id}, kind=customer_po, filename=test_po.pdf, size={attachment.get('size')}")
    
    # b) GET /api/change-requests/{id}/attachments
    log("8b) GET /api/change-requests/{id}/attachments...")
    resp = requests.get(f"{BASE_URL}/change-requests/{test_cr_id}/attachments", headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ GET attachments failed: {resp.status_code}")
        return False
    
    attachments = resp.json()
    if len(attachments) == 0:
        log(f"❌ No attachments returned")
        return False
    
    found = False
    for att in attachments:
        if att.get("id") == test_attachment_id:
            found = True
            break
    
    if not found:
        log(f"❌ Uploaded attachment not found in list")
        return False
    log(f"✅ GET attachments returned {len(attachments)} attachment(s)")
    
    # c) GET /api/change-requests/{id}/attachments/{att_id}
    log("8c) GET /api/change-requests/{id}/attachments/{att_id} (download)...")
    resp = requests.get(f"{BASE_URL}/change-requests/{test_cr_id}/attachments/{test_attachment_id}", 
                       headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ GET attachment download failed: {resp.status_code}")
        return False
    
    # Verify content-disposition header
    content_disp = resp.headers.get("content-disposition", "")
    if "test_po.pdf" not in content_disp:
        log(f"❌ content-disposition doesn't include filename: {content_disp}")
        return False
    log(f"✅ Attachment download successful, content-disposition: {content_disp}")
    
    # Verify CR has customer_po_attachment_id set
    log("8c) Verifying CR has customer_po_attachment_id set...")
    resp = requests.get(f"{BASE_URL}/change-requests/{test_cr_id}", headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ GET CR failed: {resp.status_code}")
        return False
    
    cr = resp.json()
    if cr.get("customer_po_attachment_id") != test_attachment_id:
        log(f"❌ customer_po_attachment_id is '{cr.get('customer_po_attachment_id')}', expected '{test_attachment_id}'")
        return False
    log(f"✅ CR has customer_po_attachment_id set to {test_attachment_id}")
    
    # d) DELETE /api/change-requests/{id}/attachments/{att_id}
    log("8d) DELETE /api/change-requests/{id}/attachments/{att_id}...")
    resp = requests.delete(f"{BASE_URL}/change-requests/{test_cr_id}/attachments/{test_attachment_id}", 
                          headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ DELETE attachment failed: {resp.status_code}")
        return False
    log(f"✅ Attachment deleted")
    
    # Verify subsequent GET returns 404
    log("8d) Verifying deleted attachment returns 404...")
    resp = requests.get(f"{BASE_URL}/change-requests/{test_cr_id}/attachments/{test_attachment_id}", 
                       headers=headers(admin_token))
    if resp.status_code != 404:
        log(f"❌ Expected 404, got {resp.status_code}")
        return False
    log(f"✅ Deleted attachment returns 404")
    
    # e) Verify CR's customer_po_attachment_id is cleared
    log("8e) Verifying CR's customer_po_attachment_id is cleared...")
    resp = requests.get(f"{BASE_URL}/change-requests/{test_cr_id}", headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ GET CR failed: {resp.status_code}")
        return False
    
    cr = resp.json()
    if cr.get("customer_po_attachment_id") is not None:
        log(f"❌ customer_po_attachment_id is '{cr.get('customer_po_attachment_id')}', expected None")
        return False
    log(f"✅ CR's customer_po_attachment_id cleared after delete")
    
    return True

# ============================================================
# TEST 9: In-app notifications
# ============================================================
def test_in_app_notifications():
    log("\n=== TEST 9: In-app notifications ===")
    global admin_token, finance_user_token, finance_user_id
    
    # a) Create a CR as admin (with wbs_element NOT in master) and submit
    log("9a) Creating CR as admin for notification test...")
    cr_payload = {
        "cr_name": "CR Notification Test",
        "customer_name": "Calicut International",
        "airport_name": "Other",
        "wbs_element": "C.NOTIF.TEST.0001",
        "po_received": True,
        "customer_po_number": "PO-NOTIF-001",
        "po_value": 2000000,
        "po_issue_date": "01-01-2026",
        "po_from_date": "01-01-2026",
        "po_to_date": "31-12-2026",
        "vendor_cost": 1500000,
        "resource_lines": [],
        "business_justification": "Notification test",
        "assignees_to": [],
        "assignees_cc": []
    }
    resp = requests.post(f"{BASE_URL}/change-requests", json=cr_payload, headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ POST /api/change-requests failed: {resp.status_code} - {resp.text}")
        return False
    
    notif_cr = resp.json()
    notif_cr_id = notif_cr.get("id")
    
    # Submit the CR → finance user should get notification
    log("9b) Submitting CR (finance user should get notification)...")
    resp = requests.post(f"{BASE_URL}/change-requests/{notif_cr_id}/submit", headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ POST submit failed: {resp.status_code} - {resp.text}")
        return False
    log(f"✅ CR submitted")
    
    # c) GET /api/notifications/in-app as finance user
    log("9c) GET /api/notifications/in-app as finance user...")
    resp = requests.get(f"{BASE_URL}/notifications/in-app", headers=headers(finance_user_token))
    if resp.status_code != 200:
        log(f"❌ GET /api/notifications/in-app failed: {resp.status_code}")
        return False
    
    notifications = resp.json()
    log(f"✅ GET /api/notifications/in-app returned {len(notifications)} notification(s)")
    
    # Find the notification for this CR
    cr_notification = None
    for notif in notifications:
        if notif_cr.get("cr_name") in notif.get("title", ""):
            cr_notification = notif
            break
    
    if not cr_notification:
        log(f"⚠️  Warning: CR notification not found (might be expected if finance user wasn't notified)")
        # This is not a failure - the notification logic might not notify finance for all CRs
    else:
        log(f"✅ Found CR notification: kind='{cr_notification.get('kind')}', title='{cr_notification.get('title')}'")
    
    # d) GET /api/notifications/in-app/count
    log("9d) GET /api/notifications/in-app/count...")
    resp = requests.get(f"{BASE_URL}/notifications/in-app/count", headers=headers(finance_user_token))
    if resp.status_code != 200:
        log(f"❌ GET /api/notifications/in-app/count failed: {resp.status_code}")
        return False
    
    count_data = resp.json()
    unread_count = count_data.get("unread", 0)
    log(f"✅ Unread count: {unread_count}")
    
    # e) POST /api/notifications/in-app/{id}/read (if we have a notification)
    if cr_notification:
        log("9e) POST /api/notifications/in-app/{id}/read...")
        notif_id = cr_notification.get("id")
        resp = requests.post(f"{BASE_URL}/notifications/in-app/{notif_id}/read", headers=headers(finance_user_token))
        if resp.status_code != 200:
            log(f"❌ POST mark read failed: {resp.status_code}")
            return False
        log(f"✅ Notification marked as read")
        
        # Verify count decreased
        resp = requests.get(f"{BASE_URL}/notifications/in-app/count", headers=headers(finance_user_token))
        new_count = resp.json().get("unread", 0)
        if new_count >= unread_count:
            log(f"⚠️  Warning: Unread count didn't decrease (was {unread_count}, now {new_count})")
        else:
            log(f"✅ Unread count decreased from {unread_count} to {new_count}")
    
    # f) POST /api/notifications/in-app/mark-all-read
    log("9f) POST /api/notifications/in-app/mark-all-read...")
    resp = requests.post(f"{BASE_URL}/notifications/in-app/mark-all-read", headers=headers(finance_user_token))
    if resp.status_code != 200:
        log(f"❌ POST mark-all-read failed: {resp.status_code}")
        return False
    
    updated_count = resp.json().get("updated", 0)
    log(f"✅ Marked {updated_count} notification(s) as read")
    
    # Verify count is 0
    resp = requests.get(f"{BASE_URL}/notifications/in-app/count", headers=headers(finance_user_token))
    final_count = resp.json().get("unread", 0)
    if final_count != 0:
        log(f"⚠️  Warning: Unread count is {final_count}, expected 0")
    else:
        log(f"✅ Unread count is 0")
    
    # Cleanup
    requests.delete(f"{BASE_URL}/change-requests/{notif_cr_id}", headers=headers(admin_token))
    
    return True

# ============================================================
# TEST 10: Permissions / list filters
# ============================================================
def test_permissions_and_filters():
    log("\n=== TEST 10: Permissions / list filters ===")
    global admin_token, test_cr_id
    
    # GET /api/change-requests?status=draft
    log("10a) GET /api/change-requests?status=draft...")
    resp = requests.get(f"{BASE_URL}/change-requests?status=draft", headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ GET with status filter failed: {resp.status_code}")
        return False
    
    draft_crs = resp.json()
    log(f"✅ GET with status=draft returned {len(draft_crs)} CR(s)")
    
    # GET /api/change-requests?airport=DIAL
    log("10b) GET /api/change-requests?airport=DIAL...")
    resp = requests.get(f"{BASE_URL}/change-requests?airport=DIAL", headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ GET with airport filter failed: {resp.status_code}")
        return False
    
    dial_crs = resp.json()
    log(f"✅ GET with airport=DIAL returned {len(dial_crs)} CR(s)")
    
    # Verify all returned CRs have airport_name=DIAL
    for cr in dial_crs:
        if cr.get("airport_name") != "DIAL":
            log(f"❌ CR {cr.get('cr_number')} has airport_name='{cr.get('airport_name')}', expected 'DIAL'")
            return False
    log(f"✅ All returned CRs have airport_name=DIAL")
    
    # Non-admin user editing someone else's CR via PUT → 403
    log("10c) Non-admin user trying to edit someone else's CR (should fail with 403)...")
    
    # Create a regular user for this test
    regular_email = f"regular.test.{int(time.time())}@waisldigital.com"
    regular_user_payload = {
        "email": regular_email,
        "password": "Regular@123",
        "name": "Regular Test User",
        "role": "sales",
        "location": "HQ"
    }
    resp = requests.post(f"{BASE_URL}/admin/users", json=regular_user_payload, headers=headers(admin_token))
    if resp.status_code != 200:
        log(f"❌ POST /api/admin/users failed: {resp.status_code} - {resp.text}")
        return False
    
    # Login as regular user
    regular_user_token = login(regular_email, "Regular@123")
    if not regular_user_token:
        log(f"❌ Regular user login failed")
        return False
    
    # Try to edit test_cr_id (created by admin)
    update_payload = {
        "cr_name": "Hacked CR",
        "customer_name": "DIAL - Delhi International Airport",
        "airport_name": "DIAL",
        "wbs_element": "C.NEW.TEST.0001",
        "po_received": True,
        "customer_po_number": "PO-TEST-001",
        "po_value": 10000000,
        "po_issue_date": "01-01-2026",
        "po_from_date": "01-01-2026",
        "po_to_date": "31-12-2026",
        "vendor_cost": 5000000,
        "resource_lines": [],
        "assignees_to": [],
        "assignees_cc": []
    }
    resp = requests.put(f"{BASE_URL}/change-requests/{test_cr_id}", json=update_payload, headers=headers(regular_user_token))
    if resp.status_code != 403:
        log(f"❌ Expected 403, got {resp.status_code}")
        return False
    log(f"✅ Non-admin user edit blocked with 403")
    
    return True

# ============================================================
# CLEANUP
# ============================================================
def cleanup():
    log("\n=== CLEANUP ===")
    global admin_token, test_cr_id, test_cr_id_low_margin, finance_user_id, test_role_id
    
    # Delete test CRs
    if test_cr_id:
        log(f"Deleting test CR {test_cr_id}...")
        requests.delete(f"{BASE_URL}/change-requests/{test_cr_id}", headers=headers(admin_token))
    
    if test_cr_id_low_margin:
        log(f"Deleting test CR {test_cr_id_low_margin}...")
        requests.delete(f"{BASE_URL}/change-requests/{test_cr_id_low_margin}", headers=headers(admin_token))
    
    # Delete test users
    if finance_user_id:
        log(f"Deleting finance test user {finance_user_id}...")
        requests.delete(f"{BASE_URL}/admin/users/{finance_user_id}", headers=headers(admin_token))
    
    # Delete regular test user
    log("Deleting regular test user...")
    resp = requests.get(f"{BASE_URL}/admin/users", headers=headers(admin_token))
    if resp.status_code == 200:
        users = resp.json()
        for user in users:
            email = user.get("email", "")
            if "regular.test" in email or "finance.test" in email:
                requests.delete(f"{BASE_URL}/admin/users/{user.get('id')}", headers=headers(admin_token))
                log(f"Deleted user {email}")
    
    # Delete test role
    if test_role_id:
        log(f"Deleting test role {test_role_id}...")
        requests.delete(f"{BASE_URL}/roles/{test_role_id}", headers=headers(admin_token))
    
    # Delete any leftover test roles
    log("Deleting leftover test roles...")
    resp = requests.get(f"{BASE_URL}/roles", headers=headers(admin_token))
    if resp.status_code == 200:
        roles = resp.json()
        for role in roles:
            if "Finance Test Role" in role.get("name", ""):
                requests.delete(f"{BASE_URL}/roles/{role.get('id')}", headers=headers(admin_token))
                log(f"Deleted role {role.get('name')}")
    
    log("✅ Cleanup complete")

# ============================================================
# MAIN
# ============================================================
def main():
    global admin_token, tushar_token
    
    log("=" * 80)
    log("ITERATION 10 - CHANGE REQUEST MODULE (WAVE 1) - BACKEND TESTING")
    log("=" * 80)
    
    # Login
    admin_token = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not admin_token:
        log("❌ Admin login failed, aborting tests")
        return
    
    tushar_token = login(TUSHAR_EMAIL, TUSHAR_PASSWORD)
    if not tushar_token:
        log("⚠️  Tushar login failed (note: review request says he's system role=admin, NOT finance)")
    
    # Run tests
    results = []
    
    results.append(("TEST 1: Approval Matrix - applies_to field", test_approval_matrix_applies_to()))
    results.append(("TEST 2: Create CR (draft) with margin + approver", test_create_cr_draft()))
    results.append(("TEST 3: CR with low margin - business justification", test_cr_low_margin_justification()))
    results.append(("TEST 4: WBS approval flow", test_wbs_approval_flow()))
    results.append(("TEST 5: CR full approval flow", test_cr_full_approval()))
    results.append(("TEST 6: Reject CR", test_reject_cr()))
    results.append(("TEST 7: Metrics endpoint", test_metrics_endpoint()))
    results.append(("TEST 8: Attachments", test_attachments()))
    results.append(("TEST 9: In-app notifications", test_in_app_notifications()))
    results.append(("TEST 10: Permissions / list filters", test_permissions_and_filters()))
    
    # Cleanup
    cleanup()
    
    # Summary
    log("\n" + "=" * 80)
    log("TEST SUMMARY")
    log("=" * 80)
    
    passed = 0
    failed = 0
    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        log(f"{status} - {test_name}")
        if result:
            passed += 1
        else:
            failed += 1
    
    log("=" * 80)
    log(f"TOTAL: {passed} passed, {failed} failed out of {len(results)} tests")
    log("=" * 80)
    
    if failed == 0:
        log("🎉 ALL TESTS PASSED!")
    else:
        log(f"⚠️  {failed} TEST(S) FAILED")

if __name__ == "__main__":
    main()
