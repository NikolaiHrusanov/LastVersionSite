# Bills setup (Supabase)

Run `supabase/bills-schema.sql` in the Supabase SQL Editor **after** `banking-schema.sql` and `money-management.sql`.

This creates:

- `utility_bills` table (electricity, rent, water, gas)
- `add_utility_bill` — auto-flags amounts over **€40,000**
- `pay_utility_bill` — debits your bank account and blocks over-limit bills

## Verify connection

1. Sign in at `sign-in.html`
2. Open `bills.html`
3. **Sync Status** should show **Connected**
4. Add a bill — it appears in Supabase → Table Editor → `utility_bills`

If you see the yellow setup banner, the SQL migration has not been run yet.
