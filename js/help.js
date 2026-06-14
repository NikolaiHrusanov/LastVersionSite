/**
 * NexusBank — Help & Support page (Supabase-backed)
 * Includes: FAQ search, FAQ accordion, support ticket form,
 *           recent tickets list, and live support chat with Realtime.
 */
(function () {
  'use strict';

  /* ─── Helpers ─────────────────────────────────────────────────────────── */

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

  function formatDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return '—'; }
  }

  function formatTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleTimeString(undefined, {
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return ''; }
  }

  function categoryLabel(cat) {
    const map = {
      general: 'General Inquiry', account: 'Account Issue',
      transaction: 'Transaction Dispute', card: 'Card Issue',
      loan: 'Loan Query', technical: 'Technical Problem',
    };
    return map[cat] || cat;
  }

  function categoryIcon(cat) {
    const map = {
      general: 'fa-comment-dots', account: 'fa-user-circle',
      transaction: 'fa-exchange-alt', card: 'fa-credit-card',
      loan: 'fa-hand-holding-usd', technical: 'fa-wrench',
    };
    return map[cat] || 'fa-ticket-alt';
  }

  /* ─── Toast ───────────────────────────────────────────────────────────── */

  function showToast(message, type) {
    if (window.NexusMoney?.showToast) { NexusMoney.showToast(message, type || 'success'); return; }
    const container = document.getElementById('helpToastContainer');
    if (!container) { alert(message); return; }
    const iconMap = { success: 'fa-check-circle', error: 'fa-exclamation-circle', warn: 'fa-exclamation-triangle' };
    const t = type || 'success';
    const toast = document.createElement('div');
    toast.className = 'help-toast ' + t;
    toast.innerHTML = '<i class="fas ' + (iconMap[t] || iconMap.success) + '"></i><span>' + escapeHtml(message) + '</span>';
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(12px)';
      toast.style.transition = 'opacity 0.3s, transform 0.3s';
      setTimeout(() => toast.remove(), 320);
    }, 4000);
  }

  /* ─── Setup banner ────────────────────────────────────────────────────── */

  function showSetupBanner(show) {
    const el = document.getElementById('helpSetupBanner');
    if (el) el.hidden = !show;
  }

  /* ─── Sidebar ─────────────────────────────────────────────────────────── */

  function initSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const menuBtn = document.getElementById('mobileMenuBtn');
    menuBtn?.addEventListener('click', () => { sidebar?.classList.add('active'); overlay?.classList.add('active'); });
    overlay?.addEventListener('click', () => { sidebar?.classList.remove('active'); overlay?.classList.remove('active'); });
    document.getElementById('signOutBtn')?.addEventListener('click', async (e) => {
      e.preventDefault();
      await getClient()?.auth.signOut();
      window.NexusAuth?.clearLocalSession?.();
      window.location.href = window.NexusAuth?.SIGN_IN_PAGE || 'sign-in.html';
    });
  }

  /* ─── FAQ Search ──────────────────────────────────────────────────────── */

  function initSearch() {
    const input     = document.getElementById('helpSearchInput');
    const clearBtn  = document.getElementById('helpSearchClear');
    const noResults = document.getElementById('faqNoResults');
    const countEl   = document.getElementById('faqCount');
    const items     = document.querySelectorAll('.faq-item');
    if (!input) return;

    function filterFaq(query) {
      const q = query.trim().toLowerCase();
      let visible = 0;
      items.forEach((item) => {
        const text     = (item.querySelector('.faq-question span')?.textContent || '').toLowerCase();
        const keywords = (item.dataset.keywords || '').toLowerCase();
        const match    = !q || text.includes(q) || keywords.includes(q);
        item.hidden = !match;
        if (match) visible++;
      });
      if (noResults) noResults.hidden = visible > 0;
      if (countEl)   countEl.textContent = visible + (visible === 1 ? ' article' : ' articles');
      if (clearBtn)  clearBtn.hidden = !q;
    }

    input.addEventListener('input', () => filterFaq(input.value));
    clearBtn?.addEventListener('click', () => { input.value = ''; filterFaq(''); input.focus(); });
  }

  /* ─── FAQ Accordion ───────────────────────────────────────────────────── */

  function initFaqAccordion() {
    document.querySelectorAll('.faq-question').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item   = btn.closest('.faq-item');
        const answer = item?.querySelector('.faq-answer');
        if (!answer) return;
        const isOpen = btn.getAttribute('aria-expanded') === 'true';
        document.querySelectorAll('.faq-question[aria-expanded="true"]').forEach((other) => {
          if (other !== btn) {
            other.setAttribute('aria-expanded', 'false');
            const a = other.closest('.faq-item')?.querySelector('.faq-answer');
            if (a) a.hidden = true;
          }
        });
        btn.setAttribute('aria-expanded', String(!isOpen));
        answer.hidden = isOpen;
      });
    });
  }

  /* ─── Support Ticket Form ─────────────────────────────────────────────── */

  async function submitSupportTicket(user, { subject, category, message }) {
    const client = getClient();
    if (!client) throw new Error('Supabase client not available.');
    const { data: rpcData, error: rpcError } = await client.rpc('submit_support_ticket', {
      p_subject: subject, p_category: category, p_message: message,
    });
    if (!rpcError) return rpcData;
    const { data, error } = await client
      .from('support_tickets')
      .insert([{ user_id: user.id, subject, category, message }])
      .select('id').single();
    if (error) throw new Error(error.message);
    return data?.id;
  }

  function bindTicketForm(user) {
    const form      = document.getElementById('supportTicketForm');
    const errorEl   = document.getElementById('ticketFormError');
    const successEl = document.getElementById('ticketFormSuccess');
    const submitBtn = document.getElementById('ticketSubmitBtn');
    const msgInput  = document.getElementById('ticketMessage');
    const countEl   = document.getElementById('ticketMessageCount');
    if (!form) return;

    msgInput?.addEventListener('input', () => { if (countEl) countEl.textContent = msgInput.value.length; });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const category = document.getElementById('ticketCategory')?.value || '';
      const subject  = document.getElementById('ticketSubject')?.value.trim() || '';
      const message  = msgInput?.value.trim() || '';
      if (errorEl)   { errorEl.hidden  = true; errorEl.textContent  = ''; }
      if (successEl) { successEl.hidden = true; successEl.textContent = ''; }
      if (!category) { showFormError(errorEl, 'Please select a category.'); return; }
      if (!subject)  { showFormError(errorEl, 'Please enter a subject.'); return; }
      if (subject.length > 120) { showFormError(errorEl, 'Subject must be 120 characters or fewer.'); return; }
      if (!message)  { showFormError(errorEl, 'Please enter a message.'); return; }
      if (message.length > 2000) { showFormError(errorEl, 'Message must be 2000 characters or fewer.'); return; }
      if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending…'; }
      try {
        await submitSupportTicket(user, { subject, category, message });
        form.reset();
        if (countEl) countEl.textContent = '0';
        if (successEl) {
          successEl.innerHTML = '<i class="fas fa-check-circle"></i> Ticket submitted! We will get back to you within 24 hours.';
          successEl.hidden = false;
        }
        showToast('Support ticket submitted successfully.', 'success');
        showSetupBanner(false);
        await loadRecentTickets(user);
      } catch (err) {
        const msg = err.message || 'Failed to submit ticket.';
        showFormError(errorEl, msg);
        if (/relation|does not exist|function/i.test(msg)) showSetupBanner(true);
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Ticket'; }
      }
    });
  }

  function showFormError(el, msg) {
    if (!el) return;
    el.innerHTML = '<i class="fas fa-exclamation-circle"></i> ' + escapeHtml(msg);
    el.hidden = false;
  }

  /* ─── Recent Tickets ──────────────────────────────────────────────────── */

  async function loadRecentTickets(user) {
    const list   = document.getElementById('recentTicketsList');
    const badge  = document.getElementById('ticketsBadge');
    const client = getClient();
    if (!list || !client) return;
    list.innerHTML = '<p class="help-empty"><i class="fas fa-spinner fa-spin"></i> Loading tickets…</p>';
    try {
      let tickets = null;
      const { data: rpcData, error: rpcError } = await client.rpc('get_my_support_tickets');
      if (!rpcError && Array.isArray(rpcData)) {
        tickets = rpcData;
      } else {
        const { data, error } = await client
          .from('support_tickets')
          .select('id, subject, category, status, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(10);
        if (error) throw error;
        tickets = data || [];
      }
      if (badge) badge.textContent = tickets.length ? tickets.length + ' ticket' + (tickets.length !== 1 ? 's' : '') : 'None yet';
      if (!tickets.length) {
        list.innerHTML = '<p class="help-empty"><i class="fas fa-inbox"></i> No tickets yet. Submit one above if you need help.</p>';
        return;
      }
      list.innerHTML = tickets.map((t) => {
        const statusClass = (t.status || 'open').replace(/\s+/g, '_');
        return (
          '<div class="ticket-item">' +
          '<div class="ticket-icon"><i class="fas ' + categoryIcon(t.category) + '"></i></div>' +
          '<div class="ticket-body">' +
          '<div class="ticket-subject">' + escapeHtml(t.subject) + '</div>' +
          '<div class="ticket-meta">' + escapeHtml(categoryLabel(t.category)) + ' &middot; ' + escapeHtml(formatDate(t.created_at)) + '</div>' +
          '</div>' +
          '<span class="ticket-status ' + escapeHtml(statusClass) + '">' + escapeHtml(t.status || 'open') + '</span>' +
          '</div>'
        );
      }).join('');
      showSetupBanner(false);
    } catch (err) {
      console.warn('loadRecentTickets:', err.message);
      list.innerHTML = '<p class="help-empty">Run <strong>supabase/help-schema.sql</strong> to enable ticket tracking.</p>';
      if (badge) badge.textContent = '—';
      showSetupBanner(true);
    }
  }

  /* ─── Support Chat ────────────────────────────────────────────────────── */

  let _chatUser    = null;
  let _chatChannel = null;      // Supabase Realtime channel
  let _renderedIds = new Set(); // deduplicate realtime vs history

  /** Append one bubble to #chatMessages */
  function renderBubble(msg) {
    if (_renderedIds.has(msg.id)) return;
    _renderedIds.add(msg.id);

    const list = document.getElementById('chatMessages');
    if (!list) return;

    // Remove the empty-state placeholder if present
    const placeholder = list.querySelector('.chat-empty');
    if (placeholder) placeholder.remove();

    const isUser  = msg.sender === 'user';
    const wrap    = document.createElement('div');
    wrap.className = 'chat-bubble-wrap ' + (isUser ? 'chat-bubble-wrap--user' : 'chat-bubble-wrap--support');

    const bubble  = document.createElement('div');
    bubble.className = 'chat-bubble ' + (isUser ? 'chat-bubble--user' : 'chat-bubble--support');
    bubble.textContent = msg.body;

    const ts      = document.createElement('div');
    ts.className  = 'chat-ts';
    ts.textContent = formatTime(msg.created_at);

    wrap.appendChild(bubble);
    wrap.appendChild(ts);
    list.appendChild(wrap);
    list.scrollTop = list.scrollHeight;
  }

  /** Load message history (RPC preferred, direct query fallback) */
  async function loadChatHistory() {
    const client = getClient();
    const list   = document.getElementById('chatMessages');
    if (!client || !list) return;

    list.innerHTML = '<p class="help-empty chat-empty"><i class="fas fa-spinner fa-spin"></i> Loading conversation…</p>';

    try {
      let messages = [];
      const { data: rpcData, error: rpcError } = await client.rpc('get_my_chat_messages', { p_limit: 100 });
      if (!rpcError && Array.isArray(rpcData)) {
        messages = rpcData;
      } else {
        const { data, error } = await client
          .from('support_chat_messages')
          .select('id, sender, body, created_at')
          .eq('user_id', _chatUser.id)
          .order('created_at', { ascending: true })
          .limit(100);
        if (error) throw error;
        messages = data || [];
      }

      list.innerHTML = '';
      _renderedIds.clear();

      if (!messages.length) {
        list.innerHTML = '<p class="help-empty chat-empty">No messages yet. Send us a message and we’ll reply as soon as possible.</p>';
        return;
      }

      messages.forEach(renderBubble);
    } catch (err) {
      console.warn('loadChatHistory:', err.message);
      list.innerHTML =
        '<p class="help-empty chat-empty">Chat unavailable. Run <strong>supabase/chat-schema.sql</strong> to enable it.</p>';
    }
  }

  /** Subscribe to new rows via Supabase Realtime */
  function subscribeChatRealtime() {
    const client = getClient();
    if (!client || !_chatUser) return;

    if (_chatChannel) { client.removeChannel(_chatChannel); _chatChannel = null; }

    _chatChannel = client
      .channel('support_chat_' + _chatUser.id)
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'support_chat_messages',
          filter: 'user_id=eq.' + _chatUser.id,
        },
        (payload) => { if (payload.new) renderBubble(payload.new); }
      )
      .subscribe();
  }

  /** Send a message (RPC preferred, direct insert fallback) */
  async function sendChatMessage(body) {
    const client = getClient();
    if (!client) throw new Error('Supabase client not available.');
    const { error: rpcError } = await client.rpc('send_chat_message', { p_body: body });
    if (!rpcError) return;
    // Fallback
    const { error } = await client
      .from('support_chat_messages')
      .insert([{ user_id: _chatUser.id, sender: 'user', body }]);
    if (error) throw new Error(error.message);
  }

  /** Wire up the chat textarea + send button */
  function bindChatForm() {
    const form      = document.getElementById('chatForm');
    const input     = document.getElementById('chatInput');
    const sendBtn   = document.getElementById('chatSendBtn');
    const charCount = document.getElementById('chatCharCount');
    if (!form || !input) return;

    // Auto-resize textarea
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      const len = input.value.length;
      if (charCount) charCount.textContent = len + ' / 2000';
      if (sendBtn)   sendBtn.disabled = len === 0 || len > 2000;
    });

    // Enter = send, Shift+Enter = newline
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = input.value.trim();
      if (!body || body.length > 2000) return;

      // Optimistic bubble
      const optId = 'opt-' + Date.now();
      renderBubble({ id: optId, sender: 'user', body, created_at: new Date().toISOString() });

      // Reset input
      input.value = '';
      input.style.height = 'auto';
      if (charCount) charCount.textContent = '0 / 2000';
      if (sendBtn)   sendBtn.disabled = true;

      try {
        await sendChatMessage(body);
        // Realtime will deliver the real row; remove the optimistic one
        _renderedIds.delete(optId);
        document.getElementById('chatMessages')
          ?.querySelector('[data-opt-id="' + optId + '"]')
          ?.remove();
      } catch (err) {
        console.warn('sendChatMessage:', err.message);
        showToast('Could not send message. Run supabase/chat-schema.sql and try again.', 'error');
        _renderedIds.delete(optId);
      }
    });
  }

  /** Full chat initialisation */
  async function initChat(user) {
    _chatUser = user;
    await loadChatHistory();
    subscribeChatRealtime();
    bindChatForm();
  }

  /* ─── Page bootstrap ─────────────────────────────────────────────────── */

  async function initHelpPage(user) {
    initSidebar();
    initSearch();
    initFaqAccordion();
    bindTicketForm(user);
    await loadRecentTickets(user);
    await initChat(user);
  }

  window.NexusHelp = {
    initHelpPage,
    loadRecentTickets,
    loadChatHistory,
    sendChatMessage,
    showToast,
  };
})();
