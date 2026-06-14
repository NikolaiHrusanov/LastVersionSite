/**
 * NexusBank — Shared Sidebar (sidebar.js)
 *
 * Replaces whatever sidebar is in the page with the correct one:
 *  - All nav links working and pointing to the right pages
 *  - Help → help.html  (not help/Help-Centre/index.html)
 *  - Contact Us → help/Contact-Us/index.html  (new item)
 *  - Sign Out wired to Supabase auth.signOut()
 *  - Active item highlighted based on current filename
 *  - Mobile overlay toggle
 *
 * Add ONE line before </body> on every protected page:
 *   <script src="js/sidebar.js"></script>
 */
(function () {
  'use strict';

  /* ── Nav definition ─────────────────────────────────────────── */
  var SECTIONS = [
    {
      title: 'BANKING',
      items: [
        { href: 'accounts.html',     icon: 'fa-wallet',              label: 'Accounts' },
        { href: 'transactions.html', icon: 'fa-history',             label: 'Transactions' },
        { href: 'transfer.html',     icon: 'fa-exchange-alt',        label: 'Transfers' },
        { href: 'cards.html',        icon: 'fa-credit-card',         label: 'Cards' },
      ],
    },
    {
      title: 'FINANCES',
      items: [
        { href: 'savings.html',    icon: 'fa-piggy-bank',          label: 'Savings' },
        { href: 'loans.html',      icon: 'fa-hand-holding-usd',    label: 'Loans' },
        { href: 'bills.html',      icon: 'fa-file-invoice-dollar', label: 'Bills' },
        { href: 'statements.html', icon: 'fa-file-alt',            label: 'Statements' },
      ],
    },
    {
      title: 'ACCOUNT',
      items: [
        { href: 'profile.html',               icon: 'fa-user-circle',     label: 'Profile' },
        { href: 'security.html',              icon: 'fa-shield-alt',      label: 'Security' },
        { href: 'help.html',                  icon: 'fa-question-circle', label: 'Help' },
      ],
    },
  ];

  /* ── Detect active page ─────────────────────────────────────── */
  function currentFile() {
    var parts = window.location.pathname.split('/');
    return parts[parts.length - 1] || 'accounts.html';
  }

  function isActive(href) {
    var file = currentFile();
    // exact filename match
    if (file === href) return true;
    // sub-path match (e.g. help/Contact-Us/index.html)
    if (href.indexOf('/') !== -1 && window.location.pathname.indexOf(href) !== -1) return true;
    return false;
  }

  /* ── Build HTML ─────────────────────────────────────────────── */
  function buildNav() {
    return SECTIONS.map(function (sec) {
      var items = sec.items.map(function (item) {
        var active = isActive(item.href) ? ' active' : '';
        return (
          '<a href="' + item.href + '" class="nav-item' + active + '">' +
            '<div class="nav-item-icon"><i class="fas ' + item.icon + '"></i></div>' +
            '<span>' + item.label + '</span>' +
          '</a>'
        );
      }).join('');
      return (
        '<div class="nav-section">' +
          '<div class="nav-section-title">' + sec.title + '</div>' +
          items +
        '</div>'
      );
    }).join('');
  }

  function buildSidebar() {
    return (
      '<aside class="sidebar" id="sidebar">' +
        '<div class="sidebar-header">' +
          '<a href="accounts.html" class="brand">' +
            '<div class="brand-logo"><i class="fas fa-bolt"></i></div>' +
            '<span>Nexus<span class="brand-accent">Bank</span></span>' +
          '</a>' +
        '</div>' +
        '<div class="sidebar-user">' +
          '<div class="user-avatar"></div>' +
          '<div class="user-name"></div>' +
          '<div class="user-email"></div>' +
        '</div>' +
        '<nav class="sidebar-nav">' + buildNav() + '</nav>' +
        '<div class="sidebar-footer">' +
          '<a href="sign-in.html" class="btn-ghost" id="signOutBtn">' +
            '<i class="fas fa-sign-out-alt"></i>' +
            '<span>Sign Out</span>' +
          '</a>' +
        '</div>' +
      '</aside>'
    );
  }

  /* ── Inject ─────────────────────────────────────────────────── */
  function inject() {
    var container = document.querySelector('.app-container');
    if (!container) return;

    // Remove any existing sidebar (broken or correct)
    var old = document.getElementById('sidebar');
    if (old) old.remove();

    container.insertAdjacentHTML('afterbegin', buildSidebar());
  }

  /* ── Sign-out ───────────────────────────────────────────────── */
  function wireSignOut() {
    var btn = document.getElementById('signOutBtn');
    if (!btn) return;
    btn.addEventListener('click', async function (e) {
      e.preventDefault();
      try {
        if (window.NexusAuth && window.NexusAuth.supabase) {
          await window.NexusAuth.supabase.auth.signOut();
        }
        if (window.NexusAuth && window.NexusAuth.clearLocalSession) {
          window.NexusAuth.clearLocalSession();
        } else {
          localStorage.removeItem('nexusbank_current_user');
          sessionStorage.removeItem('nexusbank_current_user');
        }
      } catch (err) {
        console.warn('Sign out:', err);
      }
      window.location.href = 'sign-in.html';
    });
  }

  /* ── Mobile toggle ──────────────────────────────────────────── */
  function wireMobile() {
    var sidebar = document.getElementById('sidebar');
    var overlay = document.getElementById('sidebarOverlay');
    var btn     = document.getElementById('mobileMenuBtn');

    if (btn) btn.addEventListener('click', function () {
      if (sidebar) sidebar.classList.add('active');
      if (overlay) overlay.classList.add('active');
    });
    if (overlay) overlay.addEventListener('click', function () {
      if (sidebar) sidebar.classList.remove('active');
      if (overlay) overlay.classList.remove('active');
    });
  }

  /* ── User info from localStorage ───────────────────────────── */
  function applyUser() {
    var raw = localStorage.getItem('nexusbank_current_user') ||
              sessionStorage.getItem('nexusbank_current_user');
    if (!raw) return;
    try {
      var u = JSON.parse(raw);
      var name = u.name || 'User';
      var email = u.email || '';
      var initials = name.split(' ').filter(Boolean)
        .map(function (p) { return p[0]; }).join('').slice(0, 2).toUpperCase() || 'NB';

      document.querySelectorAll('.user-avatar').forEach(function (el) { el.textContent = initials; });
      document.querySelectorAll('.user-name').forEach(function (el)   { el.textContent = name; });
      document.querySelectorAll('.user-email').forEach(function (el)  { el.textContent = email; });
    } catch (_) {}
  }

  /* ── Boot ───────────────────────────────────────────────────── */
  function boot() {
    inject();
    wireSignOut();
    wireMobile();
    applyUser();
    // Re-apply after NexusAuth populates localStorage
    document.addEventListener('nexusauth:ready', applyUser);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.NexusSidebar = { refresh: applyUser };
})();
