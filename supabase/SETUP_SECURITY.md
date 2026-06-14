# Security setup (Supabase)

Run `supabase/security-schema.sql` in the Supabase SQL Editor **after** `profiles-registration-rls.sql`.

This creates:

| Table / RPC | Purpose |
|-------------|---------|
| `security_settings` | Per-user toggles (2FA, biometrics, alert preferences) |
| `login_events` | Sign-in and security activity log |
| `security_alerts` | Security notifications shown on the Security page |
| `ensure_security_settings()` | Creates default settings for new users |
| `log_security_event()` | Records login and security events |
| `update_security_settings()` | Saves toggle changes from the UI |
| `get_security_overview()` | Loads settings, recent activity, and alerts |
| `mark_security_alert_read()` | Dismisses an alert |

## Verify

1. Sign in at `sign-in.html`
2. Open `security.html`
3. **Connection status** should show **Connected**
4. Change a toggle or update your password — events appear under **Recent Activity**
5. In Supabase → Table Editor, check `security_settings` and `login_events`

If you see the yellow setup banner, the SQL migration has not been run yet.
