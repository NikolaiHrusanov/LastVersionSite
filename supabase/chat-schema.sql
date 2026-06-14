-- ============================================================
-- NexusBank — Support Chat schema
-- Run this in the Supabase SQL Editor AFTER help-schema.sql
-- ============================================================

-- ── Table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_chat_messages (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sender      TEXT        NOT NULL DEFAULT 'user'
                            CHECK (sender IN ('user', 'support')),
    body        TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast per-user lookups ordered by time
CREATE INDEX IF NOT EXISTS support_chat_messages_user_id_idx
    ON public.support_chat_messages (user_id, created_at ASC);

-- ── Row Level Security ────────────────────────────────────────
ALTER TABLE public.support_chat_messages ENABLE ROW LEVEL SECURITY;

-- Users can only read their own messages
DROP POLICY IF EXISTS "Users can view own chat messages" ON public.support_chat_messages;
CREATE POLICY "Users can view own chat messages"
    ON public.support_chat_messages FOR SELECT
    USING (auth.uid() = user_id);

-- Users can only insert their own messages (sender forced to 'user' by RPC)
DROP POLICY IF EXISTS "Users can insert own chat messages" ON public.support_chat_messages;
CREATE POLICY "Users can insert own chat messages"
    ON public.support_chat_messages FOR INSERT
    WITH CHECK (auth.uid() = user_id AND sender = 'user');

-- ── Enable Realtime ───────────────────────────────────────────
-- Adds the table to the supabase_realtime publication so INSERT
-- events are broadcast to subscribed clients.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname   = 'supabase_realtime'
          AND tablename = 'support_chat_messages'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.support_chat_messages;
    END IF;
END;
$$;

-- ── RPC: send_chat_message ────────────────────────────────────
-- SECURITY DEFINER forces sender = 'user' and validates the body.
CREATE OR REPLACE FUNCTION public.send_chat_message(
    p_body TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_msg_id  UUID;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF char_length(p_body) < 1 OR char_length(p_body) > 2000 THEN
        RAISE EXCEPTION 'Message must be between 1 and 2000 characters';
    END IF;

    INSERT INTO public.support_chat_messages (user_id, sender, body)
    VALUES (v_user_id, 'user', p_body)
    RETURNING id INTO v_msg_id;

    RETURN v_msg_id;
END;
$$;

-- ── RPC: get_my_chat_messages ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_chat_messages(
    p_limit INT DEFAULT 100
)
RETURNS TABLE(
    id         UUID,
    sender     TEXT,
    body       TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT m.id, m.sender, m.body, m.created_at
    FROM   public.support_chat_messages m
    WHERE  m.user_id = auth.uid()
    ORDER  BY m.created_at ASC
    LIMIT  p_limit;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.send_chat_message(TEXT)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_chat_messages(INT)  TO authenticated;
