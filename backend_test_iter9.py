#!/usr/bin/env python3
"""
Iteration 9 Backend Tests for CRacker Pro
Tests:
1. Employee Master - password + workspace_role_id sync to users
2. Employee template download
3. Bulk upload reads Password + Roles
4. WBS endpoints (CRUD, template, bulk upload)
5. Regression tests
"""
import requests
import json
import io
from openpyxl import Workbook, load_workbook

# Read backend URL from frontend/.env
with open("/app/frontend/.env") as f:
    for line in f:
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip() + "/api"
            break

print(f"🔗 Backend URL: {BASE_URL}\n")

# Test credentials
ADMIN_CREDS = {"email": "admin@crackerpro.com", "password": "Admin@123"}
PERMANENT_ADMIN_1 = {"email": "rohit.kataria@waisldigital.com", "password": "RKataria@121"}
PERMANENT_ADMIN_2 = {"email": "tushar.sukhija@waisldigital.com", "password": "TSukhija@121"}

def login(creds):
    """Login and return token"""
    resp = requests.post(f"{BASE_URL}/auth/login", json=creds)
    if resp.status_code != 200:
        print(f"❌ Login failed for {creds['email']}: {resp.status_code} {resp.text}")
        return None
    data = resp.json()
    return data.get("access_token")

def get_headers(token):
    """Return auth headers"""
    return {"Authorization": f"Bearer {token}"}

# Login as admin
admin_token = login(ADMIN_CREDS)
if not admin_token:
    print("❌ Cannot proceed - admin login failed")
    exit(1)

print("✅ Admin login successful\n")

# ============================================================
# TEST 1: Employee Master — new fields (password + workspace_role_id) sync to users
# ============================================================
print("=" * 80)
print("TEST 1: Employee Master — Password + Workspace Role Sync to Users")
print("=" * 80)

# Step a) Create a custom role
print("\n1a. Create custom role 'QA Workspace Role'")
role_payload = {
    "name": "QA Workspace Role",
    "description": "QA test role",
    "permissions": {
        "dashboard": {"can_view": True, "can_edit": False},
        "pipeline": {"can_view": False, "can_edit": False},
        "projects": {"can_view": False, "can_edit": False},
        "change_requests": {"can_view": False, "can_edit": False},
        "customer_profile": {"can_view": False, "can_edit": False},
        "wbs_budget": {"can_view": False, "can_edit": False}
    }
}
resp = requests.post(f"{BASE_URL}/roles", headers=get_headers(admin_token), json=role_payload)
if resp.status_code in [200, 201]:
    qa_role = resp.json()
    qa_role_id = qa_role.get("id")
    print(f"✅ Created role 'QA Workspace Role' with ID: {qa_role_id}")
else:
    print(f"❌ Failed to create role: {resp.status_code} {resp.text}")
    exit(1)

# Step b) Create employee with password and workspace_role_id
print("\n1b. POST /api/employees with password and workspace_role_id")
employee_payload = {
    "employee_no": "W9001",
    "email_id": "qa.user1@example.com",
    "employee_name": "QA User One",
    "status": "Active",
    "joining_date": "01-01-2026",
    "employment_type": "Employee",
    "role_zoho": "Tester",
    "location": "Remote",
    "department": "QA",
    "sub_department": "Backend",
    "password": "Q@1qwerty",
    "workspace_role_id": qa_role_id
}
resp = requests.post(f"{BASE_URL}/employees", headers=get_headers(admin_token), json=employee_payload)
if resp.status_code in [200, 201]:
    qa_employee = resp.json()
    qa_employee_id = qa_employee.get("id")
    print(f"✅ Created employee with ID: {qa_employee_id}")
    
    # Verify EmployeeOut fields
    if qa_employee.get("workspace_role_id") == qa_role_id:
        print(f"✅ workspace_role_id matches: {qa_role_id}")
    else:
        print(f"❌ workspace_role_id mismatch: expected {qa_role_id}, got {qa_employee.get('workspace_role_id')}")
    
    if qa_employee.get("workspace_role_name") == "QA Workspace Role":
        print(f"✅ workspace_role_name = 'QA Workspace Role'")
    else:
        print(f"❌ workspace_role_name mismatch: {qa_employee.get('workspace_role_name')}")
    
    if qa_employee.get("has_user_account") == True:
        print(f"✅ has_user_account = true")
    else:
        print(f"❌ has_user_account should be true, got: {qa_employee.get('has_user_account')}")
    
    # CRITICAL: password field must NOT be in response
    if "password" in qa_employee:
        print(f"❌ SECURITY ISSUE: password field present in response!")
    else:
        print(f"✅ password field NOT in response (secure)")
else:
    print(f"❌ Failed to create employee: {resp.status_code} {resp.text}")
    exit(1)

# Step c) Login as qa.user1@example.com
print("\n1c. Login as qa.user1@example.com / Q@1qwerty")
qa_token = login({"email": "qa.user1@example.com", "password": "Q@1qwerty"})
if qa_token:
    print(f"✅ Login successful")
    
    # Check /api/auth/me
    resp = requests.get(f"{BASE_URL}/auth/me", headers=get_headers(qa_token))
    if resp.status_code == 200:
        user = resp.json()
        if user.get("role") == "finance":
            print(f"✅ role = 'finance'")
        else:
            print(f"❌ Expected role='finance', got: {user.get('role')}")
        
        if user.get("role_id") == qa_role_id:
            print(f"✅ role_id matches QA role: {qa_role_id}")
        else:
            print(f"❌ role_id mismatch: expected {qa_role_id}, got {user.get('role_id')}")
    else:
        print(f"❌ Failed to get /api/auth/me: {resp.status_code}")
    
    # Check /api/me/permissions
    resp = requests.get(f"{BASE_URL}/me/permissions", headers=get_headers(qa_token))
    if resp.status_code == 200:
        perms = resp.json()
        dash_perms = perms.get("permissions", {}).get("dashboard", {})
        if dash_perms.get("can_view") == True and dash_perms.get("can_edit") == False:
            print(f"✅ dashboard.can_view=true, can_edit=false")
        else:
            print(f"❌ dashboard permissions incorrect: {dash_perms}")
        
        # Check all other sections are false
        all_false = True
        for section in ["pipeline", "projects", "change_requests", "customer_profile", "wbs_budget"]:
            sec_perms = perms.get("permissions", {}).get(section, {})
            if sec_perms.get("can_view") != False or sec_perms.get("can_edit") != False:
                print(f"❌ {section} should be all false, got: {sec_perms}")
                all_false = False
        if all_false:
            print(f"✅ All other sections have can_view=false, can_edit=false")
        
        # Check can_delete=false everywhere
        all_delete_false = True
        for section in ["dashboard", "pipeline", "projects", "change_requests", "customer_profile", "wbs_budget"]:
            sec_perms = perms.get("permissions", {}).get(section, {})
            if sec_perms.get("can_delete") != False:
                print(f"❌ {section}.can_delete should be false, got: {sec_perms.get('can_delete')}")
                all_delete_false = False
        if all_delete_false:
            print(f"✅ can_delete=false everywhere")
    else:
        print(f"❌ Failed to get /api/me/permissions: {resp.status_code}")
else:
    print(f"❌ Login failed")

# Step d) Update employee: set workspace_role_id=null and new password
print("\n1d. PUT /api/employees/{id} - update workspace_role_id=null and new password")
update_payload = {
    "employee_no": "W9001",
    "email_id": "qa.user1@example.com",
    "employee_name": "QA User One",
    "status": "Active",
    "joining_date": "01-01-2026",
    "employment_type": "Employee",
    "role_zoho": "Tester",
    "location": "Remote",
    "department": "QA",
    "sub_department": "Backend",
    "password": "NewQ@1pass",
    "workspace_role_id": None
}
resp = requests.put(f"{BASE_URL}/employees/{qa_employee_id}", headers=get_headers(admin_token), json=update_payload)
if resp.status_code == 200:
    print(f"✅ Employee updated")
    
    # Login with new password
    print("\n1d-i. Login with new password NewQ@1pass")
    qa_token_new = login({"email": "qa.user1@example.com", "password": "NewQ@1pass"})
    if qa_token_new:
        print(f"✅ Login with new password successful")
        
        # Check permissions (should have no can_view anywhere since role_id=null)
        resp = requests.get(f"{BASE_URL}/me/permissions", headers=get_headers(qa_token_new))
        if resp.status_code == 200:
            perms = resp.json()
            # Default when role_id=null is dashboard.can_view=true
            dash_perms = perms.get("permissions", {}).get("dashboard", {})
            if dash_perms.get("can_view") == True:
                print(f"✅ Default: dashboard.can_view=true (role_id=null)")
            else:
                print(f"❌ Expected dashboard.can_view=true, got: {dash_perms}")
            
            # All others should be false
            all_false = True
            for section in ["pipeline", "projects", "change_requests", "customer_profile", "wbs_budget"]:
                sec_perms = perms.get("permissions", {}).get(section, {})
                if sec_perms.get("can_view") != False:
                    print(f"❌ {section}.can_view should be false, got: {sec_perms}")
                    all_false = False
            if all_false:
                print(f"✅ All other sections have can_view=false")
        else:
            print(f"❌ Failed to get permissions: {resp.status_code}")
    else:
        print(f"❌ Login with new password failed")
else:
    print(f"❌ Failed to update employee: {resp.status_code} {resp.text}")

# Step e) Delete employee
print("\n1e. DELETE /api/employees/{id}")
resp = requests.delete(f"{BASE_URL}/employees/{qa_employee_id}", headers=get_headers(admin_token))
if resp.status_code == 200:
    print(f"✅ Employee deleted")
    
    # Try to login (should fail - user deactivated)
    print("\n1e-i. Try to login after deletion (should fail)")
    qa_token_deleted = login({"email": "qa.user1@example.com", "password": "NewQ@1pass"})
    if qa_token_deleted is None:
        print(f"✅ Login failed as expected (user deactivated)")
    else:
        print(f"❌ Login should have failed but succeeded")
else:
    print(f"❌ Failed to delete employee: {resp.status_code} {resp.text}")

# Step f) Cleanup QA role
print("\n1f. Cleanup: Delete QA role")
resp = requests.delete(f"{BASE_URL}/roles/{qa_role_id}", headers=get_headers(admin_token))
if resp.status_code == 200:
    print(f"✅ QA role deleted")
else:
    print(f"❌ Failed to delete role: {resp.status_code} {resp.text}")

# ============================================================
# TEST 2: Employee template download
# ============================================================
print("\n" + "=" * 80)
print("TEST 2: Employee Template Download")
print("=" * 80)

print("\n2. GET /api/employees/template")
resp = requests.get(f"{BASE_URL}/employees/template", headers=get_headers(admin_token))
if resp.status_code == 200:
    print(f"✅ Template download successful (200)")
    
    # Check content-type
    content_type = resp.headers.get("content-type", "")
    if "spreadsheet" in content_type or "excel" in content_type:
        print(f"✅ Content-Type is Excel: {content_type}")
    else:
        print(f"❌ Unexpected Content-Type: {content_type}")
    
    # Check content-disposition
    content_disp = resp.headers.get("content-disposition", "")
    if "employees_template.xlsx" in content_disp:
        print(f"✅ Content-Disposition includes 'employees_template.xlsx'")
    else:
        print(f"❌ Content-Disposition incorrect: {content_disp}")
    
    # Load and verify headers
    try:
        wb = load_workbook(io.BytesIO(resp.content), read_only=True)
        ws = wb.active
        headers = [cell.value for cell in next(ws.iter_rows(min_row=1, max_row=1))]
        print(f"✅ Loaded workbook, found {len(headers)} columns")
        
        expected_headers = [
            "Employee No", "Email ID", "Status", "Joining Date", "Exit Date",
            "Employement Type", "Employee Name", "Role (as per Zoho)", "L1 Manager",
            "Location", "Department", "Sub Department", "Password", "Roles"
        ]
        
        if headers == expected_headers:
            print(f"✅ Headers match exactly (including Password and Roles)")
        else:
            print(f"❌ Headers mismatch:")
            print(f"   Expected: {expected_headers}")
            print(f"   Got:      {headers}")
    except Exception as e:
        print(f"❌ Failed to parse Excel: {e}")
else:
    print(f"❌ Template download failed: {resp.status_code} {resp.text}")

# ============================================================
# TEST 3: Bulk upload reads Password + Roles
# ============================================================
print("\n" + "=" * 80)
print("TEST 3: Bulk Upload Reads Password + Roles")
print("=" * 80)

# Step a) Create a role "Sales Viewer Bulk"
print("\n3a. Create role 'Sales Viewer Bulk'")
bulk_role_payload = {
    "name": "Sales Viewer Bulk",
    "description": "Bulk upload test role",
    "permissions": {
        "customer_profile": {"can_view": True, "can_edit": False},
        "dashboard": {"can_view": True, "can_edit": False},
        "pipeline": {"can_view": False, "can_edit": False},
        "projects": {"can_view": False, "can_edit": False},
        "change_requests": {"can_view": False, "can_edit": False},
        "wbs_budget": {"can_view": False, "can_edit": False}
    }
}
resp = requests.post(f"{BASE_URL}/roles", headers=get_headers(admin_token), json=bulk_role_payload)
if resp.status_code in [200, 201]:
    bulk_role = resp.json()
    bulk_role_id = bulk_role.get("id")
    print(f"✅ Created role 'Sales Viewer Bulk' with ID: {bulk_role_id}")
else:
    print(f"❌ Failed to create role: {resp.status_code} {resp.text}")
    exit(1)

# Step b) Build xlsx with Password + Roles columns
print("\n3b. Build xlsx with Password + Roles columns")
wb = Workbook()
ws = wb.active
ws.append([
    "Employee No", "Email ID", "Status", "Joining Date", "Exit Date",
    "Employement Type", "Employee Name", "Role (as per Zoho)", "L1 Manager",
    "Location", "Department", "Sub Department", "Password", "Roles"
])
ws.append([
    "W9101", "bulk1@example.com", "Active", "01-01-2026", "",
    "Employee", "Bulk One", "Sales Rep", "W0989",
    "Mumbai", "Sales", "Direct Sales", "B@1ulk111", "Sales Viewer Bulk"
])
ws.append([
    "W9102", "bulk2@example.com", "Active", "01-01-2026", "",
    "Employee", "Bulk Two", "Sales Rep", "W0989",
    "Delhi", "Sales", "Direct Sales", "B@2ulk222", ""
])

excel_buffer = io.BytesIO()
wb.save(excel_buffer)
excel_buffer.seek(0)

# Step c) POST /api/employees/bulk-upload?mode=append
print("\n3c. POST /api/employees/bulk-upload?mode=append")
resp = requests.post(
    f"{BASE_URL}/employees/bulk-upload?mode=append",
    headers=get_headers(admin_token),
    files={"file": ("bulk_employees.xlsx", excel_buffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
)
if resp.status_code == 200:
    result = resp.json()
    print(f"✅ Bulk upload successful: {result}")
    
    # Step d) Verify response
    if result.get("saved") == 2 and result.get("failed") == 0:
        print(f"✅ saved=2, failed=0")
    else:
        print(f"❌ Expected saved=2, failed=0, got: saved={result.get('saved')}, failed={result.get('failed')}")
else:
    print(f"❌ Bulk upload failed: {resp.status_code} {resp.text}")
    exit(1)

# Step e) GET /api/employees - verify bulk1 and bulk2
print("\n3e. GET /api/employees - verify bulk1 and bulk2")
resp = requests.get(f"{BASE_URL}/employees", headers=get_headers(admin_token))
if resp.status_code == 200:
    employees = resp.json()
    bulk1 = next((e for e in employees if e.get("email_id", "").lower() == "bulk1@example.com"), None)
    bulk2 = next((e for e in employees if e.get("email_id", "").lower() == "bulk2@example.com"), None)
    
    if bulk1:
        print(f"✅ Found bulk1@example.com")
        if bulk1.get("workspace_role_name") == "Sales Viewer Bulk":
            print(f"✅ bulk1 workspace_role_name = 'Sales Viewer Bulk'")
        else:
            print(f"❌ bulk1 workspace_role_name mismatch: {bulk1.get('workspace_role_name')}")
        
        if bulk1.get("has_user_account") == True:
            print(f"✅ bulk1 has_user_account = true")
        else:
            print(f"❌ bulk1 has_user_account should be true: {bulk1.get('has_user_account')}")
    else:
        print(f"❌ bulk1@example.com not found")
    
    if bulk2:
        print(f"✅ Found bulk2@example.com")
        if bulk2.get("has_user_account") == True:
            print(f"✅ bulk2 has_user_account = true")
        else:
            print(f"❌ bulk2 has_user_account should be true: {bulk2.get('has_user_account')}")
        
        if bulk2.get("workspace_role_name") is None:
            print(f"✅ bulk2 workspace_role_name = None (no role assigned)")
        else:
            print(f"❌ bulk2 workspace_role_name should be None: {bulk2.get('workspace_role_name')}")
    else:
        print(f"❌ bulk2@example.com not found")
else:
    print(f"❌ Failed to get employees: {resp.status_code}")

# Step f) Login as bulk1@example.com
print("\n3f. Login as bulk1@example.com / B@1ulk111")
bulk1_token = login({"email": "bulk1@example.com", "password": "B@1ulk111"})
if bulk1_token:
    print(f"✅ Login successful")
    
    # Check permissions
    resp = requests.get(f"{BASE_URL}/me/permissions", headers=get_headers(bulk1_token))
    if resp.status_code == 200:
        perms = resp.json()
        cp_perms = perms.get("permissions", {}).get("customer_profile", {})
        if cp_perms.get("can_view") == True:
            print(f"✅ customer_profile.can_view=true (from Sales Viewer Bulk role)")
        else:
            print(f"❌ customer_profile.can_view should be true: {cp_perms}")
    else:
        print(f"❌ Failed to get permissions: {resp.status_code}")
else:
    print(f"❌ Login failed")

# Step g) Login as bulk2@example.com
print("\n3g. Login as bulk2@example.com / B@2ulk222")
bulk2_token = login({"email": "bulk2@example.com", "password": "B@2ulk222"})
if bulk2_token:
    print(f"✅ Login successful")
else:
    print(f"❌ Login failed")

# Step h) Permanent admin protection in replace mode
print("\n3h. Permanent admin protection in replace mode")
print("    Build tiny xlsx with just header + 1 stub row, POST with mode=replace")

wb_replace = Workbook()
ws_replace = wb_replace.active
ws_replace.append([
    "Employee No", "Email ID", "Status", "Joining Date", "Exit Date",
    "Employement Type", "Employee Name", "Role (as per Zoho)", "L1 Manager",
    "Location", "Department", "Sub Department", "Password", "Roles"
])
ws_replace.append([
    "W9999", "stub@example.com", "Active", "01-01-2026", "",
    "Employee", "Stub User", "Test", "W0989",
    "Test", "Test", "Test", "Stub@123", ""
])

excel_buffer_replace = io.BytesIO()
wb_replace.save(excel_buffer_replace)
excel_buffer_replace.seek(0)

resp = requests.post(
    f"{BASE_URL}/employees/bulk-upload?mode=replace",
    headers=get_headers(admin_token),
    files={"file": ("replace_employees.xlsx", excel_buffer_replace, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
)
if resp.status_code == 200:
    result = resp.json()
    print(f"✅ Replace mode upload successful: {result}")
    
    # Verify permanent admins still exist
    resp = requests.get(f"{BASE_URL}/employees", headers=get_headers(admin_token))
    if resp.status_code == 200:
        employees = resp.json()
        rk_emp = next((e for e in employees if e.get("email_id", "").lower() == "rohit.kataria@waisldigital.com"), None)
        ts_emp = next((e for e in employees if e.get("email_id", "").lower() == "tushar.sukhija@waisldigital.com"), None)
        
        if rk_emp:
            print(f"✅ rohit.kataria@waisldigital.com still exists after replace")
        else:
            print(f"❌ rohit.kataria@waisldigital.com MISSING after replace")
        
        if ts_emp:
            print(f"✅ tushar.sukhija@waisldigital.com still exists after replace")
        else:
            print(f"❌ tushar.sukhija@waisldigital.com MISSING after replace")
        
        # Try to login with original passwords
        print("\n3h-i. Login as rohit.kataria with original password")
        rk_token = login(PERMANENT_ADMIN_1)
        if rk_token:
            print(f"✅ rohit.kataria login successful with original password")
        else:
            print(f"❌ rohit.kataria login failed")
        
        print("\n3h-ii. Login as tushar.sukhija with original password")
        ts_token = login(PERMANENT_ADMIN_2)
        if ts_token:
            print(f"✅ tushar.sukhija login successful with original password")
        else:
            print(f"❌ tushar.sukhija login failed")
    else:
        print(f"❌ Failed to get employees: {resp.status_code}")
else:
    print(f"❌ Replace mode upload failed: {resp.status_code} {resp.text}")

# Step i) Cleanup created employees & role
print("\n3i. Cleanup: Delete bulk employees and role")
resp = requests.get(f"{BASE_URL}/employees", headers=get_headers(admin_token))
if resp.status_code == 200:
    employees = resp.json()
    for email in ["bulk1@example.com", "bulk2@example.com", "stub@example.com"]:
        emp = next((e for e in employees if e.get("email_id", "").lower() == email), None)
        if emp:
            resp = requests.delete(f"{BASE_URL}/employees/{emp['id']}", headers=get_headers(admin_token))
            if resp.status_code == 200:
                print(f"✅ Deleted {email}")
            else:
                print(f"❌ Failed to delete {email}: {resp.status_code}")

resp = requests.delete(f"{BASE_URL}/roles/{bulk_role_id}", headers=get_headers(admin_token))
if resp.status_code == 200:
    print(f"✅ Deleted 'Sales Viewer Bulk' role")
else:
    print(f"❌ Failed to delete role: {resp.status_code}")

# ============================================================
# TEST 4: WBS endpoints
# ============================================================
print("\n" + "=" * 80)
print("TEST 4: WBS Endpoints")
print("=" * 80)

# Step a) GET /api/wbs
print("\n4a. GET /api/wbs")
resp = requests.get(f"{BASE_URL}/wbs", headers=get_headers(admin_token))
if resp.status_code == 200:
    wbs_list = resp.json()
    print(f"✅ GET /api/wbs returned 200 with {len(wbs_list)} items")
else:
    print(f"❌ GET /api/wbs failed: {resp.status_code}")

# Step b) GET /api/wbs/template
print("\n4b. GET /api/wbs/template")
resp = requests.get(f"{BASE_URL}/wbs/template", headers=get_headers(admin_token))
if resp.status_code == 200:
    print(f"✅ WBS template download successful (200)")
    
    # Check content-type
    content_type = resp.headers.get("content-type", "")
    if "spreadsheet" in content_type or "excel" in content_type:
        print(f"✅ Content-Type is Excel: {content_type}")
    else:
        print(f"❌ Unexpected Content-Type: {content_type}")
    
    # Load and verify headers
    try:
        wb = load_workbook(io.BytesIO(resp.content), read_only=True)
        ws = wb.active
        headers = [cell.value for cell in next(ws.iter_rows(min_row=1, max_row=1))]
        print(f"✅ Loaded workbook, found {len(headers)} columns")
        
        expected_headers = [
            "Project definition", "WBS element", "Name",
            "Original Budget", "Total PO Value", "Open PO Value", "Balance Budget",
            "Level", "Acct asst elem.ind.", "Company code", "Currency",
            "Description", "Object Class", "Person responsible", "Plant",
            "Profit center", "Short ID", "Status", "Cost Center", "Controlling area"
        ]
        
        if headers == expected_headers:
            print(f"✅ Headers match exactly (all 20 BRD columns in correct order)")
        else:
            print(f"❌ Headers mismatch:")
            print(f"   Expected: {expected_headers}")
            print(f"   Got:      {headers}")
    except Exception as e:
        print(f"❌ Failed to parse Excel: {e}")
else:
    print(f"❌ WBS template download failed: {resp.status_code}")

# Step c) POST /api/wbs
print("\n4c. POST /api/wbs as admin")
wbs_payload = {
    "project_definition": "C.0050021",
    "wbs_element": "C.0050021.01",
    "name": "Phase 1",
    "original_budget": 1000000,
    "total_po_value": 500000,
    "open_po_value": 100000,
    "balance_budget": 400000,
    "level": "1",
    "acct_asst_elem_ind": "P",
    "company_code": "1000",
    "currency": "INR",
    "description": "Phase 1 desc",
    "object_class": "Investment",
    "person_responsible": "Rohit Kataria",
    "plant": "DXB",
    "profit_center": "PC1",
    "short_id": "P1",
    "status": "REL",
    "cost_center": "CC1",
    "controlling_area": "1000"
}
resp = requests.post(f"{BASE_URL}/wbs", headers=get_headers(admin_token), json=wbs_payload)
if resp.status_code in [200, 201]:
    wbs_created = resp.json()
    wbs_id = wbs_created.get("id")
    print(f"✅ WBS created with ID: {wbs_id}")
    
    # Verify all fields persisted
    if wbs_created.get("wbs_element") == "C.0050021.01":
        print(f"✅ wbs_element persisted correctly")
    else:
        print(f"❌ wbs_element mismatch: {wbs_created.get('wbs_element')}")
    
    if wbs_created.get("original_budget") == 1000000:
        print(f"✅ original_budget persisted correctly")
    else:
        print(f"❌ original_budget mismatch: {wbs_created.get('original_budget')}")
    
    if wbs_created.get("person_responsible") == "Rohit Kataria":
        print(f"✅ person_responsible persisted correctly")
    else:
        print(f"❌ person_responsible mismatch: {wbs_created.get('person_responsible')}")
else:
    print(f"❌ Failed to create WBS: {resp.status_code} {resp.text}")
    wbs_id = None

# Step d) Duplicate wbs_element
print("\n4d. POST /api/wbs with duplicate wbs_element (should return 409)")
resp = requests.post(f"{BASE_URL}/wbs", headers=get_headers(admin_token), json=wbs_payload)
if resp.status_code == 409:
    print(f"✅ Duplicate wbs_element blocked with 409: {resp.json().get('detail')}")
else:
    print(f"❌ Expected 409, got {resp.status_code}: {resp.text}")

# Step e) PUT /api/wbs/{id}
if wbs_id:
    print("\n4e. PUT /api/wbs/{id} - update description")
    update_wbs_payload = {
        "project_definition": "C.0050021",
        "wbs_element": "C.0050021.01",
        "name": "Phase 1",
        "original_budget": 1000000,
        "total_po_value": 500000,
        "open_po_value": 100000,
        "balance_budget": 400000,
        "level": "1",
        "acct_asst_elem_ind": "P",
        "company_code": "1000",
        "currency": "INR",
        "description": "Phase 1 desc UPDATED",
        "object_class": "Investment",
        "person_responsible": "Rohit Kataria",
        "plant": "DXB",
        "profit_center": "PC1",
        "short_id": "P1",
        "status": "REL",
        "cost_center": "CC1",
        "controlling_area": "1000"
    }
    resp = requests.put(f"{BASE_URL}/wbs/{wbs_id}", headers=get_headers(admin_token), json=update_wbs_payload)
    if resp.status_code == 200:
        updated_wbs = resp.json()
        print(f"✅ WBS updated")
        
        if updated_wbs.get("description") == "Phase 1 desc UPDATED":
            print(f"✅ description updated correctly")
        else:
            print(f"❌ description not updated: {updated_wbs.get('description')}")
        
        if updated_wbs.get("updated_at") != updated_wbs.get("created_at"):
            print(f"✅ updated_at changed")
        else:
            print(f"❌ updated_at should have changed")
    else:
        print(f"❌ Failed to update WBS: {resp.status_code} {resp.text}")

# Step f) Bulk upload
print("\n4f. Build xlsx with 3 WBS rows and test bulk-upload")
wb_wbs = Workbook()
ws_wbs = wb_wbs.active
ws_wbs.append([
    "Project definition", "WBS element", "Name",
    "Original Budget", "Total PO Value", "Open PO Value", "Balance Budget",
    "Level", "Acct asst elem.ind.", "Company code", "Currency",
    "Description", "Object Class", "Person responsible", "Plant",
    "Profit center", "Short ID", "Status", "Cost Center", "Controlling area"
])
ws_wbs.append([
    "C.0050022", "C.0050022.01", "Phase 2A",
    2000000, 1500000, 200000, 500000,
    "1", "P", "1000", "INR",
    "Phase 2A desc", "Investment", "Test User", "DXB",
    "PC2", "P2A", "REL", "CC2", "1000"
])
ws_wbs.append([
    "C.0050022", "C.0050022.02", "Phase 2B",
    3000000, 2500000, 300000, 500000,
    "1", "P", "1000", "INR",
    "Phase 2B desc", "Investment", "Test User", "DXB",
    "PC2", "P2B", "REL", "CC2", "1000"
])
ws_wbs.append([
    "C.0050023", "C.0050023.01", "Phase 3",
    4000000, 3500000, 400000, 500000,
    "1", "P", "1000", "INR",
    "Phase 3 desc", "Investment", "Test User", "DXB",
    "PC3", "P3", "REL", "CC3", "1000"
])

excel_buffer_wbs = io.BytesIO()
wb_wbs.save(excel_buffer_wbs)
excel_buffer_wbs.seek(0)

print("\n4f-i. POST /api/wbs/bulk-upload?mode=append")
resp = requests.post(
    f"{BASE_URL}/wbs/bulk-upload?mode=append",
    headers=get_headers(admin_token),
    files={"file": ("wbs_bulk.xlsx", excel_buffer_wbs, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
)
if resp.status_code == 200:
    result = resp.json()
    print(f"✅ WBS bulk upload (append) successful: {result}")
    
    # Note: saved might be 2 if C.0050021.01 already exists from step c
    if result.get("failed") == 0:
        print(f"✅ failed=0")
    else:
        print(f"❌ Expected failed=0, got: {result.get('failed')}")
else:
    print(f"❌ WBS bulk upload failed: {resp.status_code} {resp.text}")

# Test replace mode
print("\n4f-ii. POST /api/wbs/bulk-upload?mode=replace")
excel_buffer_wbs.seek(0)
resp = requests.post(
    f"{BASE_URL}/wbs/bulk-upload?mode=replace",
    headers=get_headers(admin_token),
    files={"file": ("wbs_bulk.xlsx", excel_buffer_wbs, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
)
if resp.status_code == 200:
    result = resp.json()
    print(f"✅ WBS bulk upload (replace) successful: {result}")
    
    if result.get("saved") == 3 and result.get("failed") == 0:
        print(f"✅ saved=3, failed=0 (all old WBS wiped, 3 new loaded)")
    else:
        print(f"⚠️  Expected saved=3, failed=0, got: saved={result.get('saved')}, failed={result.get('failed')}")
else:
    print(f"❌ WBS bulk upload (replace) failed: {resp.status_code} {resp.text}")

# Step g) DELETE /api/wbs/{id}
print("\n4g. DELETE /api/wbs/{id}")
resp = requests.get(f"{BASE_URL}/wbs", headers=get_headers(admin_token))
if resp.status_code == 200:
    wbs_list = resp.json()
    if wbs_list:
        first_wbs_id = wbs_list[0].get("id")
        resp = requests.delete(f"{BASE_URL}/wbs/{first_wbs_id}", headers=get_headers(admin_token))
        if resp.status_code == 200:
            print(f"✅ WBS deleted successfully")
        else:
            print(f"❌ Failed to delete WBS: {resp.status_code}")
    else:
        print(f"⚠️  No WBS to delete")

# Step h) Cleanup remaining WBS rows
print("\n4h. Cleanup: Delete all remaining WBS rows")
resp = requests.get(f"{BASE_URL}/wbs", headers=get_headers(admin_token))
if resp.status_code == 200:
    wbs_list = resp.json()
    for wbs in wbs_list:
        resp = requests.delete(f"{BASE_URL}/wbs/{wbs['id']}", headers=get_headers(admin_token))
        if resp.status_code == 200:
            print(f"✅ Deleted WBS {wbs.get('wbs_element')}")
        else:
            print(f"❌ Failed to delete WBS {wbs.get('wbs_element')}: {resp.status_code}")

# ============================================================
# TEST 5: Regression
# ============================================================
print("\n" + "=" * 80)
print("TEST 5: Regression Tests")
print("=" * 80)

# Permanent admins still log in
print("\n5a. Permanent admins still log in with original passwords")
rk_token = login(PERMANENT_ADMIN_1)
if rk_token:
    print(f"✅ rohit.kataria login successful")
    resp = requests.get(f"{BASE_URL}/auth/me", headers=get_headers(rk_token))
    if resp.status_code == 200:
        user = resp.json()
        if user.get("is_permanent_admin") == True:
            print(f"✅ is_permanent_admin=true")
        else:
            print(f"❌ is_permanent_admin should be true: {user.get('is_permanent_admin')}")
else:
    print(f"❌ rohit.kataria login failed")

ts_token = login(PERMANENT_ADMIN_2)
if ts_token:
    print(f"✅ tushar.sukhija login successful")
    resp = requests.get(f"{BASE_URL}/auth/me", headers=get_headers(ts_token))
    if resp.status_code == 200:
        user = resp.json()
        if user.get("is_permanent_admin") == True:
            print(f"✅ is_permanent_admin=true")
        else:
            print(f"❌ is_permanent_admin should be true: {user.get('is_permanent_admin')}")
else:
    print(f"❌ tushar.sukhija login failed")

# POST /api/admin/users/reset-password for permanent admin blocked
print("\n5b. POST /api/admin/users/reset-password for permanent admin (should be blocked)")
resp = requests.get(f"{BASE_URL}/admin/users", headers=get_headers(admin_token))
if resp.status_code == 200:
    users = resp.json()
    rk_user = next((u for u in users if u["email"] == "rohit.kataria@waisldigital.com"), None)
    if rk_user:
        resp = requests.post(
            f"{BASE_URL}/admin/users/reset-password",
            headers=get_headers(admin_token),
            json={"user_id": rk_user["id"], "new_password": "NewPass@123"}
        )
        if resp.status_code == 400:
            print(f"✅ Password reset blocked with 400: {resp.json().get('detail')}")
        else:
            print(f"❌ Expected 400, got {resp.status_code}: {resp.text}")

# GET /api/me/permissions for admin
print("\n5c. GET /api/me/permissions for admin (should return all 6 sections fully permitted)")
resp = requests.get(f"{BASE_URL}/me/permissions", headers=get_headers(admin_token))
if resp.status_code == 200:
    perms = resp.json()
    sections = ["dashboard", "pipeline", "projects", "change_requests", "customer_profile", "wbs_budget"]
    all_ok = True
    for section in sections:
        sec_perms = perms.get("permissions", {}).get(section, {})
        if not (sec_perms.get("can_view") == True and sec_perms.get("can_edit") == True and sec_perms.get("can_delete") == True):
            print(f"❌ {section}: expected all true, got {sec_perms}")
            all_ok = False
    if all_ok:
        print(f"✅ All 6 sections have full permissions for admin")
else:
    print(f"❌ Failed to get permissions: {resp.status_code}")

print("\n" + "=" * 80)
print("🎉 ITERATION 9 TESTS COMPLETED")
print("=" * 80)
