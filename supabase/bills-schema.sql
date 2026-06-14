-- NexusBank — Utility bills with spending policy (max €40,000 per bill).
-- Run in Supabase SQL Editor AFTER supabase/banking-schema.sql and supabase/money-management.sql

CREATE TABLE IF NOT EXISTS public.utility_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bill_type text NOT NULL CHECK (bill_type IN ('electricity', 'rent', 'water', 'gas')),
  provider_name text NOT NULL,
  amount numeric(15, 2) NOT NULL CHECK (amount > 0),
  due_date date,
  notes text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'flagged', 'blocked')),
  policy_violation boolean NOT NULL DEFAULT false,
  approval_status text NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('approved', 'pending_approval', 'blocked')),
  paid_at timestamptz,
  account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS utility_bills_user_id_idx ON public.utility_bills (user_id);
CREATE INDEX IF NOT EXISTS utility_bills_status_idx ON public.utility_bills (status);

ALTER TABLE public.utility_bills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own bills" ON public.utility_bills;
CREATE POLICY "Users read own bills"
  ON public.utility_bills FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own bills" ON public.utility_bills;
CREATE POLICY "Users insert own bills"
  ON public.utility_bills FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own bills" ON public.utility_bills;
CREATE POLICY "Users update own bills"
  ON public.utility_bills FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own pending bills" ON public.utility_bills;
CREATE POLICY "Users delete own pending bills"
  ON public.utility_bills FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND status IN ('pending', 'flagged', 'blocked'));

-- ─────────────────────────────────────────────
-- ADD BILL (auto-flags amounts over policy limit)
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.add_utility_bill(
  p_bill_type text,
  p_provider_name text,
  p_amount numeric,
  p_due_date date DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_bill_id uuid;
  v_policy_limit numeric(15, 2) := 40000.00;
  v_violation boolean;
  v_status text;
  v_approval text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_bill_type NOT IN ('electricity', 'rent', 'water', 'gas') THEN
    RAISE EXCEPTION 'Invalid bill type';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;

  IF trim(coalesce(p_provider_name, '')) = '' THEN
    RAISE EXCEPTION 'Provider name is required';
  END IF;

  v_violation := p_amount > v_policy_limit;

  IF v_violation THEN
    v_status := 'flagged';
    v_approval := 'blocked';
  ELSE
    v_status := 'pending';
    v_approval := 'approved';
  END IF;

  INSERT INTO public.utility_bills (
    user_id, bill_type, provider_name, amount, due_date, notes,
    status, policy_violation, approval_status
  )
  VALUES (
    v_user_id, p_bill_type, trim(p_provider_name), p_amount, p_due_date, p_notes,
    v_status, v_violation, v_approval
  )
  RETURNING id INTO v_bill_id;

  RETURN json_build_object(
    'id', v_bill_id,
    'status', v_status,
    'policy_violation', v_violation,
    'approval_status', v_approval
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_utility_bill(text, text, numeric, date, text) TO authenticated;

-- ─────────────────────────────────────────────
-- PAY BILL (blocked when over policy limit)
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.pay_utility_bill(
  p_bill_id uuid,
  p_account_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_bill public.utility_bills%ROWTYPE;
  v_account public.bank_accounts%ROWTYPE;
  v_new_balance numeric(15, 2);
  v_policy_limit numeric(15, 2) := 40000.00;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_bill
  FROM public.utility_bills
  WHERE id = p_bill_id AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found';
  END IF;

  IF v_bill.status = 'paid' THEN
    RAISE EXCEPTION 'Bill is already paid';
  END IF;

  IF v_bill.amount > v_policy_limit OR v_bill.policy_violation OR v_bill.approval_status = 'blocked' THEN
    RAISE EXCEPTION 'Out of policy: bill amount exceeds €40,000 limit and is automatically blocked';
  END IF;

  SELECT * INTO v_account
  FROM public.bank_accounts
  WHERE id = p_account_id AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  IF v_account.balance < v_bill.amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  v_new_balance := v_account.balance - v_bill.amount;

  UPDATE public.bank_accounts
  SET balance = v_new_balance, updated_at = now()
  WHERE id = p_account_id;

  INSERT INTO public.bank_transactions (
    user_id, account_id, description, amount, transaction_type, category, balance_after
  )
  VALUES (
    v_user_id,
    p_account_id,
    initcap(v_bill.bill_type) || ' bill — ' || v_bill.provider_name,
    v_bill.amount,
    'debit',
    'Utilities',
    v_new_balance
  );

  UPDATE public.utility_bills
  SET status = 'paid',
      paid_at = now(),
      account_id = p_account_id,
      updated_at = now()
  WHERE id = p_bill_id;

  RETURN json_build_object(
    'bill_id', p_bill_id,
    'paid_amount', v_bill.amount,
    'balance_after', v_new_balance
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pay_utility_bill(uuid, uuid) TO authenticated;
