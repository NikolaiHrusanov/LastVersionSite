/**
 * NexusBank — Security & Protection page (Supabase-backed)
 */
(function () {
  'use strict';

  let overview = null;

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

  function showToast(message, type) {
    if (window.NexusMoney?.showToast) {
      NexusMoney.showToast(message, type || 'success');
      return;
    }
    alert(message);
  }

  function detectDevice() {
    const ua = navigator.userAgent || '';
    let os = 'Unknown OS';
    if (/Windows/i.test(ua)) os = 'Windows';
    else if (/Mac OS/i.test(ua)) os = 'macOS';
    else if (/Android/i.test(ua)) os = 'Android';
    else if (/iPhone|iPad/i.test(ua)) os = 'iOS';
    else if (/Linux/i.test(ua)) os = 'Linux';

    let browser = 'Browser';
    if (/Edg\//i.test(ua)) browser = 'Edge';
    else if (/Chrome/i.test(ua)) browser = 'Chrome';
    else if (/Firefox/i.test(ua)) browser = 'Firefox';
    else if (/Safari/i.test(ua)) browser = 'Safari';

    return browser + ' on ' + os;
  }

  function formatDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '—';
    }
  }

  function eventLabel(type) {
    const map = {
      sign_in: 'Signed in',
      sign_out: 'Signed out',
      password_change: 'Password changed',
      '2fa_enabled': '2FA enabled',
      '2fa_disabled': '2FA disabled',
      settings_update: 'Settings updated',
    };
    return map[type] || type;
  }

  function eventIcon(type) {
    const map = {
      sign_in: 'fa-sign-in-alt',
      sign_out: 'fa-sign-out-alt',
      password_change: 'fa-key',
      '2fa_enabled': 'fa-shield-alt',
      '2fa_disabled': 'fa-shield',
      settings_update: 'fa-cog',
    };
    return map[type] || 'fa-circle';
  }

  function computeSecurityScore(user, settings) {
    let score = 40;
    if (user?.email_confirmed_at) score += 20;
    if (settings?.two_factor_enabled) score += 25;
    if (settings?.biometric_enabled) score += 10;
    if (settings?.login_alerts) score += 5;
    return Math.min(score, 100);
  }

  function scoreLabel(score) {
    if (score >= 85) return { text: 'Excellent', class: 'excellent' };
    if (score >= 65) return { text: 'Good', class: 'good' };
    if (score >= 45) return { text: 'Fair', class: 'fair' };
    return { text: 'Needs attention', class: 'weak' };
  }

  function showSetupBanner(show) {
    const banner = document.getElementById('securitySetupBanner');
    if (banner) banner.hidden = !show;
  }

  function setConnectionStatus(connected) {
    const el = document.getElementById('securityConnectionStatus');
    if (!el) return;
    if (connected) {
      el.innerHTML = '<i class="fas fa-circle"></i> Connected to Supabase';
      el.className = 'security-status connected';
    } else {
      el.innerHTML = '<i class="fas fa-circle"></i> Setup required';
      el.className = 'security-status disconnected';
    }
  }

  function renderScore(user, settings) {
    const score = computeSecurityScore(user, settings);
    const label = scoreLabel(score);
    const scoreEl = document.getElementById('securityScoreValue');
    const labelEl = document.getElementById('securityScoreLabel');
    const ringEl = document.getElementById('securityScoreRing');

    if (scoreEl) scoreEl.textContent = score + '%';
    if (labelEl) {
      labelEl.textContent = label.text;
      labelEl.className = 'security-score-label ' + label.class;
    }
    if (ringEl) {
      ringEl.style.setProperty('--score', score);
      ringEl.dataset.level = label.class;
    }

    const emailEl = document.getElementById('emailVerifyStatus');
    if (emailEl) {
      const verified = Boolean(user?.email_confirmed_at);
      emailEl.innerHTML = verified
        ? '<span class="status-pill success"><i class="fas fa-check-circle"></i> Verified</span>'
        : '<span class="status-pill warn"><i class="fas fa-exclamation-circle"></i> Not verified</span>';
    }
  }

  function applyToggles(settings) {
    if (!settings) return;
    const map = {
      toggle2fa: settings.two_factor_enabled,
      toggleBiometric: settings.biometric_enabled,
      toggleLoginAlerts: settings.login_alerts,
      toggleTransactionAlerts: settings.transaction_alerts,
      toggleNewDeviceAlerts: settings.new_device_alerts,
    };
    Object.entries(map).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.checked = Boolean(value);
    });
  }

  function renderLoginEvents(events) {
    const list = document.getElementById('loginEventsList');
    if (!list) return;

    if (!events || !events.length) {
      list.innerHTML =
        '<p class="security-empty"><i class="fas fa-history"></i> No activity logged yet. Sign in again to record your first event.</p>';
      return;
    }

    list.innerHTML = events
      .map(
        (ev) =>
          '<div class="activity-item' +
          (ev.success === false ? ' failed' : '') +
          '">' +
          '<div class="activity-icon"><i class="fas ' +
          eventIcon(ev.event_type) +
          '"></i></div>' +
          '<div class="activity-body">' +
          '<div class="activity-title">' +
          escapeHtml(eventLabel(ev.event_type)) +
          '</div>' +
          '<div class="activity-meta">' +
          escapeHtml(ev.device_info || 'Unknown device') +
          (ev.location ? ' · ' + escapeHtml(ev.location) : '') +
          '</div>' +
          '<div class="activity-date">' +
          escapeHtml(formatDate(ev.created_at)) +
          '</div></div></div>'
      )
      .join('');
  }

  function renderAlerts(alerts) {
    const list = document.getElementById('securityAlertsList');
    const badge = document.getElementById('alertsBadge');
    if (!list) return;

    const unread = (alerts || []).filter((a) => !a.is_read).length;
    if (badge) {
      badge.textContent = unread ? unread + ' new' : 'All clear';
      badge.className = 'alerts-badge' + (unread ? ' has-new' : '');
    }

    if (!alerts || !alerts.length) {
      list.innerHTML =
        '<p class="security-empty"><i class="fas fa-bell-slash"></i> No security alerts. You are all caught up.</p>';
      return;
    }

    list.innerHTML = alerts
      .map(
        (alert) =>
          '<article class="alert-item severity-' +
          escapeHtml(alert.severity) +
          (alert.is_read ? ' read' : '') +
          '" data-alert-id="' +
          escapeHtml(alert.id) +
          '">' +
          '<div class="alert-icon"><i class="fas fa-' +
          (alert.severity === 'critical'
            ? 'exclamation-triangle'
            : alert.severity === 'warning'
              ? 'exclamation-circle'
              : 'info-circle') +
          '"></i></div>' +
          '<div class="alert-body">' +
          '<h4>' +
          escapeHtml(alert.title) +
          '</h4>' +
          '<p>' +
          escapeHtml(alert.message) +
          '</p>' +
          '<time>' +
          escapeHtml(formatDate(alert.created_at)) +
          '</time></div>' +
          (!alert.is_read
            ? '<button type="button" class="alert-dismiss" aria-label="Mark as read"><i class="fas fa-check"></i></button>'
            : '') +
          '</article>'
      )
      .join('');

    list.querySelectorAll('.alert-dismiss').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const item = btn.closest('.alert-item');
        const alertId = item?.dataset.alertId;
        if (!alertId) return;
        await markAlertRead(alertId);
        item.classList.add('read');
        btn.remove();
        await refreshOverview();
      });
    });
  }

  async function fetchOverview(client) {
    const { data, error } = await client.rpc('get_security_overview');
    if (error) throw error;
    return data;
  }

  async function refreshOverview() {
    const client = getClient();
    if (!client) return;

    try {
      overview = await fetchOverview(client);
      renderScore(window.__securityUser, overview.settings);
      applyToggles(overview.settings);
      renderLoginEvents(overview.login_events);
      renderAlerts(overview.alerts);
      setConnectionStatus(true);
      showSetupBanner(false);
    } catch (err) {
      console.warn('get_security_overview:', err.message);
      setConnectionStatus(false);
      showSetupBanner(true);
    }
  }

  async function logPageVisit() {
    const client = getClient();
    if (!client) return;

    const key = 'nexusbank_security_logged_' + (window.__securityUser?.id || '');
    if (sessionStorage.getItem(key)) return;

    const { error } = await client.rpc('log_security_event', {
      p_event_type: 'sign_in',
      p_device_info: detectDevice(),
      p_location: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
      p_success: true,
    });

    if (!error) {
      sessionStorage.setItem(key, '1');
    }
  }

  async function updateSetting(field, value) {
    const client = getClient();
    if (!client) return;

    const params = {};
    params[field] = value;

    const { data, error } = await client.rpc('update_security_settings', params);
    if (error) throw new Error(error.message);

    if (field === 'p_two_factor_enabled') {
      const type = value ? '2fa_enabled' : '2fa_disabled';
      await client.rpc('log_security_event', {
        p_event_type: type,
        p_device_info: detectDevice(),
        p_success: true,
      });
    }

    showToast('Security setting saved.', 'success');
    if (data) applyToggles(data);
    await refreshOverview();
  }

  async function markAlertRead(alertId) {
    const client = getClient();
    const { error } = await client.rpc('mark_security_alert_read', { p_alert_id: alertId });
    if (error) console.warn('mark_security_alert_read:', error.message);
  }

  function bindToggles() {
    const bindings = [
      ['toggle2fa', 'p_two_factor_enabled'],
      ['toggleBiometric', 'p_biometric_enabled'],
      ['toggleLoginAlerts', 'p_login_alerts'],
      ['toggleTransactionAlerts', 'p_transaction_alerts'],
      ['toggleNewDeviceAlerts', 'p_new_device_alerts'],
    ];

    bindings.forEach(([id, field]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', async () => {
        try {
          el.disabled = true;
          await updateSetting(field, el.checked);
        } catch (err) {
          el.checked = !el.checked;
          showToast(err.message || 'Could not save setting.', 'error');
        } finally {
          el.disabled = false;
        }
      });
    });
  }

  function bindPasswordForm() {
    const form = document.getElementById('changePasswordForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const current = document.getElementById('currentPassword')?.value || '';
      const next = document.getElementById('newPassword')?.value || '';
      const confirm = document.getElementById('confirmPassword')?.value || '';
      const errorEl = document.getElementById('passwordFormError');
      const statusEl = document.getElementById('passwordFormStatus');
      const submitBtn = form.querySelector('button[type="submit"]');

      if (errorEl) {
        errorEl.hidden = true;
        errorEl.textContent = '';
      }

      if (!current || !next || !confirm) {
        if (errorEl) {
          errorEl.textContent = 'Please fill in all password fields.';
          errorEl.hidden = false;
        }
        return;
      }

      if (next.length < 8) {
        if (errorEl) {
          errorEl.textContent = 'New password must be at least 8 characters.';
          errorEl.hidden = false;
        }
        return;
      }

      if (next !== confirm) {
        if (errorEl) {
          errorEl.textContent = 'New passwords do not match.';
          errorEl.hidden = false;
        }
        return;
      }

      const client = getClient();
      const email = window.__securityUser?.email;
      if (!client || !email) return;

      if (submitBtn) submitBtn.disabled = true;
      if (statusEl) statusEl.hidden = false;

      try {
        const { error: signInError } = await client.auth.signInWithPassword({
          email,
          password: current,
        });
        if (signInError) throw new Error('Current password is incorrect.');

        const { error: updateError } = await client.auth.updateUser({ password: next });
        if (updateError) throw new Error(updateError.message);

        await client.rpc('log_security_event', {
          p_event_type: 'password_change',
          p_device_info: detectDevice(),
          p_success: true,
        });

        form.reset();
        showToast('Password updated successfully.', 'success');
        await refreshOverview();
      } catch (err) {
        if (errorEl) {
          errorEl.textContent = err.message || 'Password update failed.';
          errorEl.hidden = false;
        }
      } finally {
        if (submitBtn) submitBtn.disabled = false;
        if (statusEl) statusEl.hidden = true;
      }
    });
  }

  function bindSignOutAll() {
    document.getElementById('signOutAllBtn')?.addEventListener('click', async () => {
      if (!confirm('Sign out on all devices? You will need to sign in again on this browser.')) return;

      const client = getClient();
      try {
        await client?.rpc('log_security_event', {
          p_event_type: 'sign_out',
          p_device_info: detectDevice(),
          p_success: true,
        });
        await client?.auth.signOut({ scope: 'global' });
        window.NexusAuth?.clearLocalSession?.();
        window.location.href = window.NexusAuth?.SIGN_IN_PAGE || 'sign-in.html';
      } catch (err) {
        showToast(err.message || 'Sign out failed.', 'error');
      }
    });
  }

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
      await getClient()?.auth.signOut();
      window.NexusAuth?.clearLocalSession?.();
      window.location.href = window.NexusAuth?.SIGN_IN_PAGE || 'sign-in.html';
    });
  }

  async function initSecurityPage(user) {
    window.__securityUser = user;
    initSidebar();
    bindToggles();
    bindPasswordForm();
    bindSignOutAll();

    setConnectionStatus(false);
    const emailEl = document.getElementById('securityEmail');
    if (emailEl) emailEl.textContent = user.email || '';

    try {
      await getClient()?.rpc('ensure_security_settings');
      await logPageVisit();
      overview = await fetchOverview(getClient());
      renderScore(user, overview.settings);
      applyToggles(overview.settings);
      renderLoginEvents(overview.login_events);
      renderAlerts(overview.alerts);
      setConnectionStatus(true);
      showSetupBanner(false);
    } catch (err) {
      console.error('Security page init:', err);
      renderScore(user, null);
      setConnectionStatus(false);
      showSetupBanner(true);
      document.getElementById('loginEventsList').innerHTML =
        '<p class="security-empty">Run <strong>supabase/security-schema.sql</strong> in the SQL Editor, then refresh.</p>';
    }
  }

  window.NexusSecurity = {
    initSecurityPage,
    refreshOverview,
    computeSecurityScore,
  };
})();
