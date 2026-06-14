/**
 * NexusBank — Profile directory page
 *
 * Fetches profiles from Supabase (profiles table + RPC helpers).
 * Requires an authenticated session via NexusAuth.
 *
 * Expected Supabase row shape (public fields from list_public_profiles):
 * {
 *   id:            '550e8400-e29b-41d4-a716-446655440000',
 *   full_name:     'Alex Morgan',
 *   username:      'alexmorgan',
 *   bio:           'Product designer passionate about fintech UX.',
 *   avatar_url:    'https://example.com/avatars/alex.jpg',  // optional
 *   location:      'London, UK',
 *   followers_count: 248,
 *   following_count: 112,
 *   created_at:    '2024-06-12T09:30:00.000Z'
 * }
 *
 * Own profile (get_my_social_profile) also includes: email, city, country,
 * account_status, kyc_status.
 */
(function () {
  'use strict';

  /** Demo profiles shown when RPC is unavailable or directory is empty */
  const SAMPLE_PROFILES = [
    {
      id: 'sample-001',
      full_name: 'Alex Morgan',
      username: 'alexmorgan',
      bio: 'Product designer passionate about fintech UX and inclusive banking.',
      avatar_url: null,
      location: 'London, UK',
      followers_count: 248,
      following_count: 112,
      created_at: '2024-06-12T09:30:00.000Z',
      isSample: true,
    },
    {
      id: 'sample-002',
      full_name: 'Priya Sharma',
      username: 'priyasharma',
      bio: 'Software engineer building secure payment rails at scale.',
      avatar_url: null,
      location: 'Mumbai, India',
      followers_count: 512,
      following_count: 189,
      created_at: '2023-11-03T14:00:00.000Z',
      isSample: true,
    },
    {
      id: 'sample-003',
      full_name: 'Jordan Lee',
      username: 'jordanlee',
      bio: 'Personal finance coach helping families save smarter every day.',
      avatar_url: null,
      location: 'Toronto, Canada',
      followers_count: 891,
      following_count: 340,
      created_at: '2023-02-18T08:15:00.000Z',
      isSample: true,
    },
    {
      id: 'sample-004',
      full_name: 'Elena Vasquez',
      username: 'elenav',
      bio: 'NexusBank community ambassador · crypto-curious, cash-flow conscious.',
      avatar_url: null,
      location: 'Madrid, Spain',
      followers_count: 156,
      following_count: 98,
      created_at: '2024-01-22T16:45:00.000Z',
      isSample: true,
    },
  ];

  /** Cached state for modal re-open */
  let allProfiles = [];
  let currentUserId = null;

  /* ── Utilities ── */

  function getClient() {
    return window.NexusAuth?.supabase;
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Derive @username from row or generate from name/email */
  function resolveUsername(row) {
    if (row.username && String(row.username).trim()) {
      return String(row.username).replace(/^@/, '');
    }
    if (row.email) {
      return row.email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');
    }
    return String(row.full_name || 'user')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 20) || 'nexusbank_user';
  }

  /** Build display location from dedicated field or city/country */
  function resolveLocation(row) {
    if (row.location && String(row.location).trim()) return row.location.trim();
    const parts = [row.city, row.country].filter(Boolean);
    return parts.length ? parts.join(', ') : 'Location not set';
  }

  /** Initials for avatar fallback */
  function getInitials(name) {
    return String(name || 'U')
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  /** Format join date for display */
  function formatJoinDate(iso) {
    if (!iso) return 'Recently joined';
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return 'Recently joined';
    }
  }

  /** Format large counts (1.2K etc.) */
  function formatCount(n) {
    const num = Number(n) || 0;
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (num >= 10_000) return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
    return num.toLocaleString();
  }

  /** Normalize raw Supabase row into a consistent view model */
  function normalizeProfile(row) {
    if (!row) return null;
    return {
      id: row.id,
      fullName: row.full_name || 'NexusBank User',
      username: resolveUsername(row),
      bio: row.bio || 'No bio yet.',
      avatarUrl: row.avatar_url || null,
      location: resolveLocation(row),
      followers: Number(row.followers_count) || 0,
      following: Number(row.following_count) || 0,
      joinDate: row.created_at || row.updated_at || null,
      joinDateLabel: formatJoinDate(row.created_at || row.updated_at),
      email: row.email || null,
      isSample: Boolean(row.isSample),
    };
  }

  /** Avatar HTML — image or gradient initials */
  function avatarHtml(profile, sizeClass) {
    const cls = 'profile-avatar' + (sizeClass ? ' ' + sizeClass : '');
    if (profile.avatarUrl) {
      return (
        '<div class="' +
        cls +
        '"><img src="' +
        escapeHtml(profile.avatarUrl) +
        '" alt="' +
        escapeHtml(profile.fullName) +
        '" loading="lazy"></div>'
      );
    }
    return (
      '<div class="' +
      cls +
      '" aria-hidden="true">' +
      escapeHtml(getInitials(profile.fullName)) +
      '</div>'
    );
  }

  /* ── Skeleton loaders ── */

  function renderMyProfileSkeleton() {
    const el = document.getElementById('myProfileCard');
    if (!el) return;
    el.innerHTML =
      '<div class="my-profile-inner skeleton-card">' +
      '<div class="skeleton skeleton-avatar lg"></div>' +
      '<div style="flex:1">' +
      '<div class="skeleton skeleton-line lg"></div>' +
      '<div class="skeleton skeleton-line sm"></div>' +
      '<div class="skeleton skeleton-line md" style="margin-top:1rem"></div>' +
      '<div class="skeleton skeleton-line lg"></div>' +
      '<div style="display:flex;gap:1rem;margin-top:1.25rem">' +
      '<div class="skeleton skeleton-line" style="width:80px;height:48px"></div>' +
      '<div class="skeleton skeleton-line" style="width:80px;height:48px"></div>' +
      '</div></div></div>';
  }

  function renderGridSkeletons(count) {
    const grid = document.getElementById('profilesGrid');
    if (!grid) return;
    let html = '';
    for (let i = 0; i < count; i++) {
      html +=
        '<article class="profile-card skeleton-card" aria-hidden="true">' +
        '<div class="profile-card-top">' +
        '<div class="skeleton skeleton-avatar"></div>' +
        '<div style="flex:1">' +
        '<div class="skeleton skeleton-line md"></div>' +
        '<div class="skeleton skeleton-line sm"></div>' +
        '</div></div>' +
        '<div class="skeleton skeleton-line lg"></div>' +
        '<div class="skeleton skeleton-line md"></div>' +
        '</article>';
    }
    grid.innerHTML = html;
  }

  /* ── Render profile cards ── */

  function renderMyProfile(profile) {
    const el = document.getElementById('myProfileCard');
    if (!el || !profile) return;

    el.innerHTML =
      '<div class="my-profile-inner">' +
      avatarHtml(profile, 'lg') +
      '<div class="my-profile-info">' +
      '<span class="my-profile-badge"><i class="fas fa-star"></i> Your Profile</span>' +
      '<h2 class="my-profile-name">' +
      escapeHtml(profile.fullName) +
      '</h2>' +
      '<p class="profile-username">@' +
      escapeHtml(profile.username) +
      '</p>' +
      '<p class="profile-bio">' +
      escapeHtml(profile.bio) +
      '</p>' +
      '<div class="profile-meta-row">' +
      '<span class="profile-meta-item"><i class="fas fa-map-marker-alt"></i> ' +
      escapeHtml(profile.location) +
      '</span>' +
      '<span class="profile-meta-item"><i class="fas fa-calendar-alt"></i> Joined ' +
      escapeHtml(profile.joinDateLabel) +
      '</span>' +
      (profile.email
        ? '<span class="profile-meta-item"><i class="fas fa-envelope"></i> ' +
          escapeHtml(profile.email) +
          '</span>'
        : '') +
      '</div>' +
      '<div class="profile-stats">' +
      statBlock(profile.followers, 'Followers') +
      statBlock(profile.following, 'Following') +
      '</div>' +
      '</div></div>';
  }

  function statBlock(value, label) {
    return (
      '<div class="profile-stat">' +
      '<div class="profile-stat-value">' +
      formatCount(value) +
      '</div>' +
      '<div class="profile-stat-label">' +
      escapeHtml(label) +
      '</div></div>'
    );
  }

  function renderProfileCard(profile) {
    return (
      '<article class="profile-card" tabindex="0" role="button" ' +
      'data-profile-id="' +
      escapeHtml(profile.id) +
      '" aria-label="View profile of ' +
      escapeHtml(profile.fullName) +
      '">' +
      '<div class="profile-card-top">' +
      avatarHtml(profile) +
      '<div class="profile-card-body">' +
      '<h3 class="profile-card-name">' +
      escapeHtml(profile.fullName) +
      '</h3>' +
      '<p class="profile-username">@' +
      escapeHtml(profile.username) +
      '</p>' +
      '</div></div>' +
      '<p class="profile-bio">' +
      escapeHtml(profile.bio) +
      '</p>' +
      '<div class="profile-card-footer">' +
      '<div class="profile-card-stats">' +
      '<span><strong>' +
      formatCount(profile.followers) +
      '</strong> followers</span>' +
      '<span><strong>' +
      formatCount(profile.following) +
      '</strong> following</span>' +
      '</div>' +
      '<span class="profile-card-location"><i class="fas fa-map-marker-alt"></i> ' +
      escapeHtml(profile.location) +
      '</span>' +
      '</div></article>'
    );
  }

  function renderProfilesGrid(profiles) {
    const grid = document.getElementById('profilesGrid');
    const countEl = document.getElementById('profilesCount');
    if (!grid) return;

    if (!profiles.length) {
      grid.innerHTML =
        '<div class="empty-profiles">' +
        '<i class="fas fa-users"></i>' +
        '<p>No community profiles yet. Check back soon!</p></div>';
      if (countEl) countEl.textContent = '0 profiles';
      return;
    }

    grid.innerHTML = profiles.map(renderProfileCard).join('');
    if (countEl) {
      const sampleNote = profiles.some((p) => p.isSample) ? ' (sample)' : '';
      countEl.textContent = profiles.length + ' profile' + (profiles.length !== 1 ? 's' : '') + sampleNote;
    }

    grid.querySelectorAll('.profile-card').forEach((card) => {
      const id = card.dataset.profileId;
      const open = () => openModal(id);
      card.addEventListener('click', open);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });
    });
  }

  /* ── Modal ── */

  function openModal(profileId) {
    const profile = allProfiles.find((p) => p.id === profileId);
    if (!profile) return;

    const overlay = document.getElementById('profileModal');
    const body = document.getElementById('modalBody');
    if (!overlay || !body) return;

    body.innerHTML =
      '<div class="modal-header">' +
      avatarHtml(profile, 'lg') +
      '<h2 class="my-profile-name">' +
      escapeHtml(profile.fullName) +
      '</h2>' +
      '<p class="profile-username">@' +
      escapeHtml(profile.username) +
      '</p>' +
      (profile.isSample
        ? '<p style="font-size:0.75rem;color:var(--warn);margin-top:0.35rem"><i class="fas fa-flask"></i> Sample profile</p>'
        : '') +
      '</div>' +
      '<div class="modal-body">' +
      '<p class="profile-bio">' +
      escapeHtml(profile.bio) +
      '</p>' +
      '<div class="modal-meta-grid">' +
      metaCell('Location', profile.location) +
      metaCell('Joined', profile.joinDateLabel) +
      metaCell('Followers', formatCount(profile.followers)) +
      metaCell('Following', formatCount(profile.following)) +
      '</div>' +
      '<div class="profile-stats" style="justify-content:center">' +
      statBlock(profile.followers, 'Followers') +
      statBlock(profile.following, 'Following') +
      '</div></div>';

    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    document.getElementById('modalCloseBtn')?.focus();
  }

  function metaCell(label, value) {
    return (
      '<div class="modal-meta-cell"><span>' +
      escapeHtml(label) +
      '</span><strong>' +
      escapeHtml(value) +
      '</strong></div>'
    );
  }

  function closeModal() {
    const overlay = document.getElementById('profileModal');
    if (!overlay) return;
    overlay.classList.remove('active');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function initModal() {
    document.getElementById('modalCloseBtn')?.addEventListener('click', closeModal);
    document.getElementById('profileModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'profileModal') closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });
  }

  /* ── Theme toggle ── */

  function initThemeToggle() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;

    const saved = localStorage.getItem('nexusbank_theme');
    if (saved === 'light') {
      document.body.classList.replace('dark-theme', 'light-theme');
      document.documentElement.classList.replace('dark-theme', 'light-theme');
      btn.querySelector('i')?.classList.replace('fa-moon', 'fa-sun');
    }

    btn.addEventListener('click', () => {
      const isDark = document.body.classList.contains('dark-theme');
      if (isDark) {
        document.body.classList.replace('dark-theme', 'light-theme');
        document.documentElement.classList.replace('dark-theme', 'light-theme');
        btn.querySelector('i')?.classList.replace('fa-moon', 'fa-sun');
        localStorage.setItem('nexusbank_theme', 'light');
      } else {
        document.body.classList.replace('light-theme', 'dark-theme');
        document.documentElement.classList.replace('light-theme', 'dark-theme');
        btn.querySelector('i')?.classList.replace('fa-sun', 'fa-moon');
        localStorage.setItem('nexusbank_theme', 'dark');
      }
    });
  }

  /* ── Supabase data fetching ── */

  async function fetchMyProfile(client, userId) {
    // Prefer secure RPC; fall back to direct select (RLS: own row only)
    const { data: rpcData, error: rpcError } = await client.rpc('get_my_social_profile');

    if (!rpcError && rpcData && rpcData.length) {
      return normalizeProfile(rpcData[0]);
    }

    if (rpcError) {
      console.warn('get_my_social_profile:', rpcError.message);
    }

    const { data, error } = await client
      .from('profiles')
      .select(
        'id, full_name, email, username, bio, avatar_url, location, city, country, followers_count, following_count, created_at, updated_at'
      )
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.warn('profiles select:', error.message);
      return null;
    }

    return normalizeProfile(data);
  }

  async function fetchPublicProfiles(client, excludeUserId) {
    const { data, error } = await client.rpc('list_public_profiles');

    if (!error && Array.isArray(data)) {
      return data
        .filter((row) => row.id !== excludeUserId)
        .map(normalizeProfile)
        .filter(Boolean);
    }

    if (error) {
      console.warn('list_public_profiles:', error.message);
      showSetupBanner(true);
    }

    // Fallback: only own profile readable via RLS — show sample directory
    return SAMPLE_PROFILES.map(normalizeProfile);
  }

  function showSetupBanner(show) {
    const banner = document.getElementById('profileSetupBanner');
    if (banner) banner.classList.toggle('visible', show);
  }

  /* ── Sidebar mobile + sign out ── */

  function initSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const menuBtn = document.getElementById('mobileMenuBtn');

    menuBtn?.addEventListener('click', () => {
      sidebar?.classList.add('active');
      overlay?.classList.add('active');
    });
    overlay?.addEventListener('click', () => {
      sidebar?.classList.remove('active');
      overlay?.classList.remove('active');
    });

    document.getElementById('signOutBtn')?.addEventListener('click', async (e) => {
      e.preventDefault();
      await window.NexusAuth?.supabase?.auth.signOut();
      window.NexusAuth?.clearLocalSession?.();
      window.location.href = window.NexusAuth?.SIGN_IN_PAGE || 'sign-in.html';
    });
  }

  /* ── Page bootstrap ── */

  async function initProfilePage() {
    initModal();
    initThemeToggle();
    initSidebar();
    renderMyProfileSkeleton();
    renderGridSkeletons(6);

    const session = await window.NexusAuth?.requireAuthWithProfile?.();
    if (!session) return;

    const client = getClient();
    const userId = session.user.id;
    currentUserId = userId;

    try {
      const [myProfile, communityProfiles] = await Promise.all([
        fetchMyProfile(client, userId),
        fetchPublicProfiles(client, userId),
      ]);

      if (myProfile) {
        renderMyProfile(myProfile);
      } else {
        document.getElementById('myProfileCard').innerHTML =
          '<p class="empty-profiles">Could not load your profile.</p>';
      }

      // Merge for modal lookup: community + self
      allProfiles = communityProfiles.slice();
      if (myProfile) allProfiles.unshift(myProfile);

      renderProfilesGrid(communityProfiles);
    } catch (err) {
      console.error('Profile page error:', err);
      renderProfilesGrid(SAMPLE_PROFILES.map(normalizeProfile));
      showSetupBanner(true);
    }
  }

  document.addEventListener('DOMContentLoaded', initProfilePage);

  window.NexusProfiles = {
    SAMPLE_PROFILES,
    normalizeProfile,
    formatJoinDate,
    formatCount,
  };
})();
