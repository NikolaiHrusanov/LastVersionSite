# NexusBank — Loans setup

Run this **once** in the Supabase SQL Editor after `banking-schema.sql` and `money-management.sql`:

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project → **SQL** → **New query**
2. Paste the contents of `supabase/loans-schema.sql`
3. Click **Run**

## What it creates

- `loans` table — one active loan per user
- `loan_payments` table — payment history
- `apply_for_loan()` — submits application, deposits funds to checking
- `pay_loan()` — pays down remaining balance from any account

## App behavior

- Each user may have **one active loan** at a time
- **Continue to Application** opens a confirmation modal, then saves the loan to Supabase
- Loan funds are deposited to the primary checking account
- **Make a Payment** withdraws from an account and reduces the loan balance
- Paid-off loans free the user to apply again
