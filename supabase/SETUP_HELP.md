# Help & Support setup (Supabase)

Run `supabase/help-schema.sql` in the Supabase SQL Editor **after** `banking-schema.sql`.

## What it creates

| Object | Purpose |
|--------|---------|
| `support_tickets` | Stores user-submitted help requests |
| `submit_support_ticket(subject, category, message)` | RPC to safely insert a ticket (SECURITY DEFINER) |
| `get_my_support_tickets()` | RPC to fetch the current user's last 10 tickets |
| RLS policies | Users can only read/write their own tickets |

## Ticket categories

`general` · `account` · `transaction` · `card` · `loan` · `technical`

## Ticket statuses

| Status | Meaning |
|--------|---------|
| `open` | Newly submitted, awaiting review |
| `in_progress` | Being investigated by support |
| `resolved` | Issue fixed |
| `closed` | Ticket closed without further action |

## Verify

1. Sign in at `sign-in.html`
2. Open `help.html`
3. Fill in the **Submit a Support Ticket** form and click **Send Ticket**
4. The ticket should appear in **Your Recent Tickets** immediately
5. In Supabase → Table Editor, check the `support_tickets` table

If you see the yellow setup banner, the SQL migration has not been run yet.

## Admin access

To view and manage all tickets (not just your own), create a service-role query or
add an admin policy in Supabase:

```sql
-- Allow admins to view all tickets (add to your admin role)
CREATE POLICY "Admins can view all tickets"
    ON public.support_tickets FOR SELECT
    USING (auth.jwt() ->> 'role' = 'admin');
```
