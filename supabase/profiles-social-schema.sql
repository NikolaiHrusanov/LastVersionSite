-- NexusBank — Social profile fields + secure public directory
-- Run in Supabase SQL Editor AFTER profiles-registration-rls.sql
--
-- Adds username, bio, avatar, location, follower counts, and a safe RPC
-- so authenticated users can browse public profiles without exposing PII.

-- ─────────────────────────────────────────────
-- EXTEND profiles TABLE
-- ─────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS followers_count integer NOT NULL DEFAULT 0 CHECK (followers_count >= 0),
  ADD COLUMN IF NOT EXISTS following_count integer NOT NULL DEFAULT 0 CHECK (following_count >= 0),
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique_idx
  ON public.profiles (lower(username))
  WHERE username IS NOT NULL AND trim(username) <> '';

-- ─────────────────────────────────────────────
-- RPC: list public profiles (no email, phone, balance, documents)
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.list_public_profiles()
RETURNS TABLE (
  id uuid,
  full_name text,
  username text,
  bio text,
  avatar_url text,
  location text,
  followers_count integer,
  following_count integer,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.full_name,
    p.username,
    p.bio,
    p.avatar_url,
    COALESCE(
      NULLIF(trim(p.location), ''),
      NULLIF(trim(concat_ws(', ', p.city, p.country)), '')
    ) AS location,
    COALESCE(p.followers_count, 0),
    COALESCE(p.following_count, 0),
    COALESCE(p.created_at, p.updated_at, now())
  FROM public.profiles p
  WHERE COALESCE(p.account_status, 'active') = 'active'
  ORDER BY p.full_name NULLS LAST, p.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.list_public_profiles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_public_profiles() TO authenticated;

-- ─────────────────────────────────────────────
-- RPC: get own full social profile (authenticated user only)
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_social_profile()
RETURNS TABLE (
  id uuid,
  full_name text,
  email text,
  username text,
  bio text,
  avatar_url text,
  location text,
  city text,
  country text,
  followers_count integer,
  following_count integer,
  created_at timestamptz,
  account_status text,
  kyc_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.full_name,
    p.email,
    p.username,
    p.bio,
    p.avatar_url,
    COALESCE(
      NULLIF(trim(p.location), ''),
      NULLIF(trim(concat_ws(', ', p.city, p.country)), '')
    ) AS location,
    p.city,
    p.country,
    COALESCE(p.followers_count, 0),
    COALESCE(p.following_count, 0),
    COALESCE(p.created_at, p.updated_at, now()),
    p.account_status,
    p.kyc_status
  FROM public.profiles p
  WHERE p.id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_my_social_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_social_profile() TO authenticated;
