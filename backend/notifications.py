"""Microsoft Graph email notifications (OAuth2 client-credentials flow).

Design:
- Pure async via httpx (already a project dependency).
- Token cached in-process with thread-safe asyncio lock.
- Graceful degradation: if any required credential is missing or contains a
  placeholder ("REPLACE_..."), emails are skipped and the call returns a
  structured "skipped" result. The app never crashes.
- No secrets are ever logged; only redacted client-id prefixes.
"""
from __future__ import annotations

import os
import asyncio
import logging
import time
from typing import List, Optional, Tuple, Dict, Any

import httpx

logger = logging.getLogger("crackerpro.notifications")

GRAPH_TOKEN_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
GRAPH_SENDMAIL_URL = "https://graph.microsoft.com/v1.0/users/{sender}/sendMail"
GRAPH_SCOPE = "https://graph.microsoft.com/.default"


def _is_placeholder(v: Optional[str]) -> bool:
    if not v:
        return True
    s = v.strip()
    return (not s) or s.upper().startswith("REPLACE_")


class GraphMailer:
    """Singleton-style mailer reading env on init/refresh."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._token: Optional[str] = None
        self._token_exp: float = 0.0
        self._reload_config()

    def _reload_config(self) -> None:
        self.tenant_id = os.environ.get("MS_TENANT_ID", "")
        self.client_id = os.environ.get("MS_CLIENT_ID", "")
        self.client_secret = os.environ.get("MS_CLIENT_SECRET", "")
        self.sender = os.environ.get("MS_SENDER_EMAIL", "")
        self.default_recipient = os.environ.get("NOTIFY_RECIPIENT_EMAIL", "")
        self.enabled = os.environ.get("NOTIFY_ENABLED", "true").strip().lower() not in ("0", "false", "no", "off")

    @property
    def configured(self) -> bool:
        """True only when all 4 credentials are real (no placeholders)."""
        return not any(_is_placeholder(v) for v in (self.tenant_id, self.client_id, self.client_secret, self.sender))

    def status(self) -> Dict[str, Any]:
        return {
            "enabled": self.enabled,
            "configured": self.configured,
            "tenant_id_present": not _is_placeholder(self.tenant_id),
            "client_id_present": not _is_placeholder(self.client_id),
            "client_secret_present": not _is_placeholder(self.client_secret),
            "sender_email": self.sender if not _is_placeholder(self.sender) else None,
            "default_recipient": self.default_recipient or None,
            # Redacted hint for ops
            "client_id_hint": (self.client_id[:6] + "…") if self.client_id and not _is_placeholder(self.client_id) else None,
        }

    async def _get_token(self) -> Tuple[Optional[str], Optional[str]]:
        async with self._lock:
            now = time.time()
            if self._token and now < self._token_exp - 60:
                return self._token, None
            data = {
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "scope": GRAPH_SCOPE,
                "grant_type": "client_credentials",
            }
            url = GRAPH_TOKEN_URL.format(tenant=self.tenant_id)
            try:
                async with httpx.AsyncClient(timeout=20) as client:
                    r = await client.post(url, data=data)
                if r.status_code != 200:
                    return None, f"token request failed: HTTP {r.status_code} - {r.text[:300]}"
                payload = r.json()
            except Exception as e:
                return None, f"token request error: {e}"
            tok = payload.get("access_token")
            exp = int(payload.get("expires_in", 3600))
            if not tok:
                return None, "token missing in response"
            self._token = tok
            self._token_exp = now + exp
            return tok, None

    async def send(
        self,
        subject: str,
        html_body: str,
        to_recipients: Optional[List[str]] = None,
        cc: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Send an email. Returns a structured dict with status."""
        # Refresh config in case .env changed since boot
        self._reload_config()

        if not self.enabled:
            return {"sent": False, "skipped": True, "reason": "notifications disabled (NOTIFY_ENABLED=false)"}
        if not self.configured:
            return {"sent": False, "skipped": True, "reason": "Microsoft Graph credentials not configured (placeholder values)"}

        recipients = [r for r in (to_recipients or [self.default_recipient]) if r]
        if not recipients:
            return {"sent": False, "skipped": True, "reason": "no recipient configured (NOTIFY_RECIPIENT_EMAIL)"}

        tok, err = await self._get_token()
        if err or not tok:
            logger.warning("Graph token error: %s", err)
            return {"sent": False, "error": err or "no token"}

        message = {
            "message": {
                "subject": subject,
                "body": {"contentType": "HTML", "content": html_body},
                "toRecipients": [{"emailAddress": {"address": a}} for a in recipients],
            },
            "saveToSentItems": "true",
        }
        if cc:
            message["message"]["ccRecipients"] = [{"emailAddress": {"address": a}} for a in cc]

        url = GRAPH_SENDMAIL_URL.format(sender=self.sender)
        headers = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.post(url, headers=headers, json=message)
            # Graph returns 202 Accepted on success
            if r.status_code in (200, 202):
                return {"sent": True, "recipients": recipients, "subject": subject}
            return {"sent": False, "error": f"HTTP {r.status_code}: {r.text[:300]}"}
        except Exception as e:
            return {"sent": False, "error": f"send error: {e}"}


# Module-level singleton
mailer = GraphMailer()


# ---------- Templates ----------
def _wrap(title: str, body_html: str) -> str:
    return f"""<!doctype html><html><body style="font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#FAFAF8;margin:0;padding:24px;color:#111110">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #D8D6CC;border-radius:4px;overflow:hidden">
    <div style="background:#5C2B84;color:#FFFFFF;padding:14px 20px;font-size:12px;letter-spacing:.18em;text-transform:uppercase">CRacker Pro · Notification</div>
    <div style="padding:20px">
      <h2 style="margin:0 0 12px 0;font-size:18px;color:#111110">{title}</h2>
      {body_html}
      <p style="margin-top:24px;color:#5E5E5A;font-size:11px">This is an automated notification from CRacker Pro. Do not reply.</p>
    </div>
  </div>
</body></html>"""


def tpl_approval_request(req: Dict[str, Any], project: Dict[str, Any]) -> Tuple[str, str]:
    subject = f"[Approval] {project.get('project_name', 'Project')} → {req.get('target_stage', '')}"
    body = _wrap(
        "New Approval Request",
        f"""<table cellpadding="6" cellspacing="0" style="font-size:13px;border-collapse:collapse;width:100%">
        <tr><td style="color:#5E5E5A;width:35%">Project</td><td><b>{project.get('project_name','—')}</b></td></tr>
        <tr><td style="color:#5E5E5A">Customer</td><td>{project.get('customer_name','—')}</td></tr>
        <tr><td style="color:#5E5E5A">Target Stage</td><td>{req.get('target_stage','—')}</td></tr>
        <tr><td style="color:#5E5E5A">PO Value</td><td>{project.get('po_value','—')}</td></tr>
        <tr><td style="color:#5E5E5A">Margin %</td><td>{project.get('margin_pct','—')}</td></tr>
        <tr><td style="color:#5E5E5A">Raised By</td><td>{req.get('raised_by','—')}</td></tr>
        <tr><td style="color:#5E5E5A">Reason</td><td>{req.get('reason','—')}</td></tr>
        </table>""",
    )
    return subject, body


def tpl_test_email() -> Tuple[str, str]:
    return ("CRacker Pro · Email integration test",
            _wrap("Email Integration Test",
                  "<p style='font-size:13px'>If you received this, Microsoft Graph email notifications are configured correctly.</p>"))
