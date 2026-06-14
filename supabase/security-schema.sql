-- NexusBank — Security settings, login activity, and alerts
-- Run in Supabase SQL Editor AFTER profiles-registration-rls.sql

-- ─────────────────────────────────────────────
-- SECURITY SETTINGS (per user)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.security_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  two_factor_enabled boolean NOT NULL DEFAULT false,
  biometric_enabled boolean NOT NULL DEFAULT false,
  login_alerts boolean NOT NULL DEFAULT true,
  transaction_alerts boolean NOT NULL DEFAULT true,
  new_device_alerts boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- LOGIN / SECURITY EVENTS
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.login_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL DEFAULT 'sign_in'
    CHECK (event_type IN ('sign_in', 'sign_out', 'password_change', '2fa_enabled', '2fa_disabled', 'settings_update')),
  device_info text,
  ip_address text,
  location text,
  success boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_events_user_id_idx ON public.login_events (user_id, created_at DESC);

-- ─────────────────────────────────────────────
-- SECURITY ALERTS
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.security_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alert_type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_alerts_user_id_idx ON public.security_alerts (user_id, created_at DESC);

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────

ALTER TABLE public.security_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own security settings" ON public.security_settings;
CREATE POLICY "Users read own security settings"
  ON public.security_settings FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own security settings" ON public.security_settings;
CREATE POLICY "Users update own security settings"
  ON public.security_settings FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own login events" ON public.login_events;
CREATE POLICY "Users read own login events"
  ON public.login_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own security alerts" ON public.security_alerts;
CREATE POLICY "Users read own security alerts"
  ON public.security_alerts FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own security alerts" ON public.security_alerts;
CREATE POLICY "Users update own security alerts"
  ON public.security_alerts FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- ENSURE DEFAULT SETTINGS ROW
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ensure_security_settings()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.security_settings (user_id)
  VALUES (v_user_id)
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_security_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_security_settings() TO authenticated;

-- ─────────────────────────────────────────────
-- LOG A SECURITY EVENT
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.log_security_event(
  p_event_type text DEFAULT 'sign_in',
  p_device_info text DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_success boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_event_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_event_type NOT IN ('sign_in', 'sign_out', 'password_change', '2fa_enabled', '2fa_disabled', 'settings_update') THEN
    RAISE EXCEPTION 'Invalid event type';
  END IF;

  PERFORM public.ensure_security_settings();

  INSERT INTO public.login_events (user_id, event_type, device_info, location, success)
  VALUES (v_user_id, p_event_type, p_device_info, p_location, COALESCE(p_success, true))
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_security_event(text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_security_event(text, text, text, boolean) TO authenticated;

-- ─────────────────────────────────────────────
-- UPDATE SECURITY TOGGLES
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_security_settings(
  p_two_factor_enabled boolean DEFAULT NULL,
  p_biometric_enabled boolean DEFAULT NULL,
  p_login_alerts boolean DEFAULT NULL,
  p_transaction_alerts boolean DEFAULT NULL,
  p_new_device_alerts boolean DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_row public.security_settings%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM public.ensure_security_settings();

  UPDATE public.security_settings
  SET
    two_factor_enabled = COALESCE(p_two_factor_enabled, two_factor_enabled),
    biometric_enabled = COALESCE(p_biometric_enabled, biometric_enabled),
    login_alerts = COALESCE(p_login_alerts, login_alerts),
    transaction_alerts = COALESCE(p_transaction_alerts, transaction_alerts),
    new_device_alerts = COALESCE(p_new_device_alerts, new_device_alerts),
    updated_at = now()
  WHERE user_id = v_user_id
  RETURNING * INTO v_row;

  PERFORM public.log_security_event('settings_update', 'Security preferences updated', NULL, true);

  RETURN json_build_object(
    'user_id', v_row.user_id,
    'two_factor_enabled', v_row.two_factor_enabled,
    'biometric_enabled', v_row.biometric_enabled,
    'login_alerts', v_row.login_alerts,
    'transaction_alerts', v_row.transaction_alerts,
    'new_device_alerts', v_row.new_device_alerts,
    'updated_at', v_row.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_security_settings(boolean, boolean, boolean, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_security_settings(boolean, boolean, boolean, boolean, boolean) TO authenticated;

-- ─────────────────────────────────────────────
-- SECURITY OVERVIEW (settings + recent activity)
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_security_overview()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_settings json;
  v_events json;
  v_alerts json;
  v_unread integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM public.ensure_security_settings();

  SELECT json_build_object(
    'two_factor_enabled', s.two_factor_enabled,
    'biometric_enabled', s.biometric_enabled,
    'login_alerts', s.login_alerts,
    'transaction_alerts', s.transaction_alerts,
    'new_device_alerts', s.new_device_alerts,
    'updated_at', s.updated_at
  )
  INTO v_settings
  FROM public.security_settings s
  WHERE s.user_id = v_user_id;

  SELECT COALESCE(json_agg(e ORDER BY e.created_at DESC), '[]'::json)
  INTO v_events
  FROM (
    SELECT id, event_type, device_info, location, success, created_at
    FROM public.login_events
    WHERE user_id = v_user_id
    ORDER BY created_at DESC
    LIMIT 15
  ) e;

  SELECT COUNT(*)::integer INTO v_unread
  FROM public.security_alerts
  WHERE user_id = v_user_id AND is_read = false;

  SELECT COALESCE(json_agg(a ORDER BY a.created_at DESC), '[]'::json)
  INTO v_alerts
  FROM (
    SELECT id, alert_type, title, message, severity, is_read, created_at
    FROM public.security_alerts
    WHERE user_id = v_user_id
    ORDER BY created_at DESC
    LIMIT 10
  ) a;

  RETURN json_build_object(
    'settings', v_settings,
    'login_events', v_events,
    'alerts', v_alerts,
    'unread_alerts', COALESCE(v_unread, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_security_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_security_overview() TO authenticated;

-- ─────────────────────────────────────────────
-- MARK ALERT AS READ
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mark_security_alert_read(p_alert_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.security_alerts
  SET is_read = true
  WHERE id = p_alert_id AND user_id = v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_security_alert_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_security_alert_read(uuid) TO authenticated;
