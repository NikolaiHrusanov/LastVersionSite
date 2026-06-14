-- ============================================================
-- NexusBank — Help & Support schema
-- Run this in the Supabase SQL Editor AFTER banking-schema.sql
-- ============================================================

-- ── Support Tickets ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_tickets (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    subject     TEXT        NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 120),
    category    TEXT        NOT NULL DEFAULT 'general'
                            CHECK (category IN ('general','account','transaction','card','loan','technical')),
    message     TEXT        NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
    status      TEXT        NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open','in_progress','resolved','closed')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast per-user lookups
CREATE INDEX IF NOT EXISTS support_tickets_user_id_idx
    ON public.support_tickets (user_id, created_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_tickets_updated_at ON public.support_tickets;
CREATE TRIGGER support_tickets_updated_at
    BEFORE UPDATE ON public.support_tickets
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Row Level Security ────────────────────────────────────────
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

-- Users can only see their own tickets
DROP POLICY IF EXISTS "Users can view own tickets" ON public.support_tickets;
CREATE POLICY "Users can view own tickets"
    ON public.support_tickets FOR SELECT
    USING (auth.uid() = user_id);

-- Users can only insert their own tickets
DROP POLICY IF EXISTS "Users can insert own tickets" ON public.support_tickets;
CREATE POLICY "Users can insert own tickets"
    ON public.support_tickets FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- ── RPC: submit_support_ticket ────────────────────────────────
-- SECURITY DEFINER so the insert always succeeds for authenticated users
CREATE OR REPLACE FUNCTION public.submit_support_ticket(
    p_subject   TEXT,
    p_category  TEXT,
    p_message   TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id   UUID := auth.uid();
    v_ticket_id UUID;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF char_length(p_subject) < 1 OR char_length(p_subject) > 120 THEN
        RAISE EXCEPTION 'Subject must be between 1 and 120 characters';
    END IF;

    IF char_length(p_message) < 1 OR char_length(p_message) > 2000 THEN
        RAISE EXCEPTION 'Message must be between 1 and 2000 characters';
    END IF;

    IF p_category NOT IN ('general','account','transaction','card','loan','technical') THEN
        RAISE EXCEPTION 'Invalid category';
    END IF;

    INSERT INTO public.support_tickets (user_id, subject, category, message)
    VALUES (v_user_id, p_subject, p_category, p_message)
    RETURNING id INTO v_ticket_id;

    RETURN v_ticket_id;
END;
$$;

-- ── RPC: get_my_support_tickets ──────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_support_tickets()
RETURNS TABLE(
    id          UUID,
    subject     TEXT,
    category    TEXT,
    status      TEXT,
    created_at  TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.id,
        t.subject,
        t.category,
        t.status,
        t.created_at
    FROM public.support_tickets t
    WHERE t.user_id = auth.uid()
    ORDER BY t.created_at DESC
    LIMIT 10;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.submit_support_ticket(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_support_tickets() TO authenticated;
