/**
 * NexusBank — utility bills via Supabase (utility_bills table + RPC).
 */
(function () {
  'use strict';

  const POLICY_LIMIT = 40000;

  const BILL_TYPES = {
    electricity: { label: 'Electricity', icon: 'fa-bolt', color: 'electricity' },
    rent: { label: 'Rent', icon: 'fa-home', color: 'rent' },
    water: { label: 'Water', icon: 'fa-tint', color: 'water' },
    gas: { label: 'Gas (Heating)', icon: 'fa-fire', color: 'gas' },
  };

  let billsChannel = null;
  let schemaReady = false;

  function getClient() {
    return window.NexusAuth?.supabase;
  }

  function formatCurrency(amount) {
    return (
      window.NexusBanking?.formatCurrency(amount) ||
      new Intl.NumberFormat('en-EU', { style: 'currency', currency: 'EUR' }).format(Number(amount) || 0)
    );
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
    return new Date(iso + (String(iso).includes('T') ? '' : 'T12:00:00')).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  function isMissingTableError(error) {
    if (!error) return false;
    const msg = (error.message || '').toLowerCase();
    return (
      error.code === '42P01' ||
      error.code === 'PGRST205' ||
      error.code === 'PGRST204' ||
      msg.includes('does not exist') ||
      msg.includes('could not find the table') ||
      msg.includes('utility_bills')
    );
  }

  function isMissingRpcError(error) {
    if (!error) return false;
    const msg = (error.message || '').toLowerCase();
    return error.code === '42883' || msg.includes('function') && msg.includes('does not exist');
  }

  function applyPolicy(amount) {
    const num = Number(amount) || 0;
    const violation = num > POLICY_LIMIT;
    return {
      policy_violation: violation,
      status: violation ? 'flagged' : 'pending',
      approval_status: violation ? 'blocked' : 'approved',
    };
  }

  function normalizeBill(row) {
    const policy = applyPolicy(row.amount);
    return {
      id: row.id,
      bill_type: row.bill_type,
      provider_name: row.provider_name,
      amount: Number(row.amount),
      due_date: row.due_date || null,
      notes: row.notes || '',
      status: row.status || policy.status,
      policy_violation: row.policy_violation ?? policy.policy_violation,
      approval_status: row.approval_status || policy.approval_status,
      paid_at: row.paid_at || null,
      created_at: row.created_at || new Date().toISOString(),
    };
  }

  function updateSyncStatus(ready) {
    schemaReady = ready;
    const el = document.getElementById('billsSyncStatus');
    const banner = document.getElementById('billsSetupBanner');
    if (el) {
      el.textContent = ready ? 'Connected' : 'Not set up';
      el.style.color = ready ? 'var(--success)' : 'var(--warn)';
    }
    if (banner) {
      banner.classList.toggle('visible', !ready);
    }
  }

  async function ensureBillsSchema() {
    const client = getClient();
    if (!client) throw new Error('Supabase client not ready');

    const { error } = await client.from('utility_bills').select('id', { count: 'exact', head: true });

    if (isMissingTableError(error)) {
      updateSyncStatus(false);
      return false;
    }
    if (error) throw error;

    updateSyncStatus(true);
    return true;
  }

  async function fetchBills(userId) {
    const client = getClient();
    if (!client) throw new Error('Supabase client not ready');

    const { data, error } = await client
      .from('utility_bills')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      if (isMissingTableError(error)) {
        updateSyncStatus(false);
        return [];
      }
      throw error;
    }

    updateSyncStatus(true);
    return (data || []).map(normalizeBill);
  }

  async function addBillViaInsert(userId, payload) {
    const client = getClient();
    const policy = applyPolicy(payload.amount);

    const { data, error } = await client
      .from('utility_bills')
      .insert({
        user_id: userId,
        bill_type: payload.bill_type,
        provider_name: payload.provider_name.trim(),
        amount: payload.amount,
        due_date: payload.due_date || null,
        notes: payload.notes || null,
        status: policy.status,
        policy_violation: policy.policy_violation,
        approval_status: policy.approval_status,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async function addBill(userId, payload) {
    const client = getClient();
    if (!client) throw new Error('Supabase client not ready');

    const ready = await ensureBillsSchema();
    if (!ready) {
      throw new Error('Bills table not found. Run supabase/bills-schema.sql in Supabase SQL Editor.');
    }

    const policy = applyPolicy(payload.amount);

    const { data, error } = await client.rpc('add_utility_bill', {
      p_bill_type: payload.bill_type,
      p_provider_name: payload.provider_name,
      p_amount: payload.amount,
      p_due_date: payload.due_date || null,
      p_notes: payload.notes || null,
    });

    if (!error) {
      if (policy.policy_violation) {
        window.NexusMoney?.showToast?.(
          'Policy violation: bill over €40,000 flagged and blocked from payment.',
          'error'
        );
      } else {
        window.NexusMoney?.showToast?.('Bill saved to Supabase', 'success');
      }
      return data;
    }

    if (isMissingRpcError(error)) {
      await addBillViaInsert(userId, payload);
      if (policy.policy_violation) {
        window.NexusMoney?.showToast?.(
          'Policy violation: bill over €40,000 flagged and blocked from payment.',
          'error'
        );
      } else {
        window.NexusMoney?.showToast?.('Bill saved to Supabase', 'success');
      }
      return null;
    }

    throw error;
  }

  async function payBill(userId, billId, accountId) {
    const client = getClient();
    if (!client) throw new Error('Supabase client not ready');

    const { data, error } = await client.rpc('pay_utility_bill', {
      p_bill_id: billId,
      p_account_id: accountId,
    });

    if (!error) {
      window.NexusMoney?.showToast?.('Bill paid — balance updated in Supabase', 'success');
      return data;
    }

    if (isMissingRpcError(error)) {
      throw new Error(
        'pay_utility_bill function missing. Re-run supabase/bills-schema.sql in Supabase SQL Editor.'
      );
    }

    throw new Error(error.message || 'Payment failed');
  }

  async function deleteBill(userId, billId) {
    const client = getClient();
    if (!client) throw new Error('Supabase client not ready');

    const { error } = await client
      .from('utility_bills')
      .delete()
      .eq('id', billId)
      .eq('user_id', userId);

    if (error) throw error;
  }

  function statusBadge(bill) {
    if (bill.status === 'paid') {
      return '<span class="bill-status paid">Paid</span>';
    }
    if (bill.policy_violation || bill.amount > POLICY_LIMIT) {
      return '<span class="bill-status flagged"><i class="fas fa-exclamation-triangle"></i> Policy Violation</span>';
    }
    return '<span class="bill-status pending">Pending</span>';
  }

  function renderBillCard(bill) {
    const meta = BILL_TYPES[bill.bill_type] || BILL_TYPES.electricity;
    const blocked = bill.policy_violation || bill.amount > POLICY_LIMIT;
    const canPay = bill.status !== 'paid' && !blocked && schemaReady;

    return `
      <div class="bill-card ${blocked ? 'bill-card-flagged' : ''}" data-bill-id="${escapeHtml(bill.id)}">
        <div class="bill-card-header">
          <div class="bill-type-icon ${meta.color}"><i class="fas ${meta.icon}"></i></div>
          <div class="bill-card-title">
            <h3>${escapeHtml(meta.label)}</h3>
            <p>${escapeHtml(bill.provider_name)}</p>
          </div>
          ${statusBadge(bill)}
        </div>
        <div class="bill-card-amount ${blocked ? 'amount-flagged' : ''}">${formatCurrency(bill.amount)}</div>
        ${blocked ? `<div class="policy-alert"><i class="fas fa-shield-alt"></i><span>Exceeds €40,000 policy limit — automatically blocked</span></div>` : ''}
        <div class="bill-card-meta">
          <span><i class="fas fa-calendar"></i> Due ${formatDate(bill.due_date)}</span>
          <span><i class="fas fa-clock"></i> Added ${formatDate(bill.created_at)}</span>
        </div>
        ${bill.notes ? `<p class="bill-notes">${escapeHtml(bill.notes)}</p>` : ''}
        <div class="bill-card-actions">
          ${canPay ? `<button type="button" class="btn-sm btn-sm-primary js-pay-bill" data-bill-id="${escapeHtml(bill.id)}"><i class="fas fa-check"></i> Pay Bill</button>` : ''}
          ${blocked && bill.status !== 'paid' ? `<button type="button" class="btn-sm btn-sm-ghost" disabled><i class="fas fa-ban"></i> Blocked</button>` : ''}
          ${bill.status !== 'paid' ? `<button type="button" class="btn-sm btn-sm-ghost js-delete-bill" data-bill-id="${escapeHtml(bill.id)}"><i class="fas fa-trash"></i></button>` : ''}
        </div>
      </div>`;
  }

  function renderPolicyAlerts(bills) {
    const flagged = bills.filter((b) => b.policy_violation || b.amount > POLICY_LIMIT);
    const el = document.getElementById('policyAlertsList');
    if (!el) return;

    if (!flagged.length) {
      el.innerHTML = '<p class="empty-alerts"><i class="fas fa-check-circle"></i> No policy violations — all bills within limits.</p>';
      return;
    }

    el.innerHTML = flagged
      .map(
        (b) => `
        <div class="policy-alert-item">
          <div class="policy-alert-icon"><i class="fas fa-exclamation-triangle"></i></div>
          <div>
            <strong>${escapeHtml(BILL_TYPES[b.bill_type]?.label || b.bill_type)} — ${escapeHtml(b.provider_name)}</strong>
            <p>${formatCurrency(b.amount)} exceeds the €40,000 limit. Payment blocked pending policy review.</p>
          </div>
        </div>`
      )
      .join('');
  }

  function updateOverview(bills) {
    const pending = bills.filter((b) => b.status !== 'paid');
    const flagged = bills.filter((b) => b.policy_violation || b.amount > POLICY_LIMIT);
    const totalPending = pending.reduce((s, b) => s + Number(b.amount), 0);

    const totalEl = document.getElementById('totalPendingBills');
    const countEl = document.getElementById('pendingBillsCount');
    const pendingStatEl = document.getElementById('pendingBillsStat');
    const flaggedEl = document.getElementById('flaggedBillsCount');
    const limitEl = document.getElementById('policyLimitDisplay');

    if (totalEl) totalEl.textContent = formatCurrency(totalPending);
    if (countEl) {
      const n = pending.length;
      countEl.textContent = n + ' bill' + (n === 1 ? '' : 's') + ' awaiting payment';
    }
    if (pendingStatEl) pendingStatEl.textContent = String(pending.length);
    if (flaggedEl) flaggedEl.textContent = String(flagged.length);
    if (limitEl) limitEl.textContent = formatCurrency(POLICY_LIMIT);
  }

  async function refreshBillsUI(userId) {
    const bills = await fetchBills(userId);
    updateOverview(bills);
    renderPolicyAlerts(bills);

    const grid = document.getElementById('billsGrid');
    if (!grid) return bills;

    if (!schemaReady) {
      grid.innerHTML = `<div class="empty-bills">
        <i class="fas fa-database"></i>
        <p>Connect Supabase: run <strong>supabase/bills-schema.sql</strong> in the SQL Editor, then refresh.</p>
      </div>`;
      return bills;
    }

    grid.innerHTML =
      bills.length > 0
        ? bills.map(renderBillCard).join('')
        : `<div class="empty-bills">
            <i class="fas fa-file-invoice-dollar"></i>
            <p>No bills yet. Add electricity, rent, water, or gas bills — they sync to Supabase instantly.</p>
          </div>`;

    return bills;
  }

  function openAddBillModal(presetType, userId, onSaved) {
    if (!schemaReady) {
      window.NexusMoney?.showToast?.('Run supabase/bills-schema.sql first to enable bills.', 'error');
      return;
    }

    window.NexusMoney?.injectToastStyles?.();

    let modal = document.getElementById('addBillModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'addBillModal';
      modal.className = 'money-modal';
      document.body.appendChild(modal);
    }

    const typeOptions = Object.entries(BILL_TYPES)
      .map(([key, val]) => `<option value="${key}" ${presetType === key ? 'selected' : ''}>${val.label}</option>`)
      .join('');

    modal.innerHTML = `
      <div class="money-modal-backdrop"></div>
      <div class="money-modal-panel" role="dialog">
        <button type="button" class="money-modal-close" aria-label="Close">&times;</button>
        <h2>Add Bill</h2>
        <p>Saved to Supabase. Bills over <strong>€40,000</strong> are flagged and blocked.</p>
        <form id="addBillForm">
          <div class="form-group">
            <label for="billType">Bill Type</label>
            <select id="billType" required>${typeOptions}</select>
          </div>
          <div class="form-group">
            <label for="billProvider">Provider / Payee</label>
            <input type="text" id="billProvider" required placeholder="e.g. City Power" maxlength="120">
          </div>
          <div class="form-group">
            <label for="billAmount">Amount (€)</label>
            <input type="number" id="billAmount" required min="0.01" step="0.01">
            <p class="form-hint" id="billAmountHint"></p>
          </div>
          <div class="form-group">
            <label for="billDueDate">Due Date (optional)</label>
            <input type="date" id="billDueDate">
          </div>
          <div class="form-group">
            <label for="billNotes">Notes (optional)</label>
            <textarea id="billNotes" rows="2"></textarea>
          </div>
          <div class="money-modal-actions">
            <button type="button" class="btn-secondary money-modal-cancel">Cancel</button>
            <button type="submit" class="btn-primary">Save to Supabase</button>
          </div>
        </form>
      </div>`;

    const close = () => modal.classList.remove('active');
    modal.querySelector('.money-modal-backdrop').addEventListener('click', close);
    modal.querySelector('.money-modal-close').addEventListener('click', close);
    modal.querySelector('.money-modal-cancel').addEventListener('click', close);

    const amountInput = modal.querySelector('#billAmount');
    const hint = modal.querySelector('#billAmountHint');

    function updateHint() {
      const val = Number(amountInput.value);
      if (!val) { hint.textContent = ''; return; }
      if (val > POLICY_LIMIT) {
        hint.textContent = '⚠ Over €40,000 — flagged and blocked in Supabase';
        hint.className = 'form-hint form-hint-warn';
      } else {
        hint.textContent = 'Within policy limits';
        hint.className = 'form-hint form-hint-ok';
      }
    }
    amountInput.addEventListener('input', updateHint);

    modal.querySelector('#addBillForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = modal.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      try {
        await addBill(userId, {
          bill_type: modal.querySelector('#billType').value,
          provider_name: modal.querySelector('#billProvider').value.trim(),
          amount: Number(modal.querySelector('#billAmount').value),
          due_date: modal.querySelector('#billDueDate').value || null,
          notes: modal.querySelector('#billNotes').value.trim(),
        });
        close();
        await onSaved?.();
      } catch (err) {
        window.NexusMoney?.showToast?.(err.message || 'Could not save bill', 'error');
      } finally {
        submitBtn.disabled = false;
      }
    });

    modal.classList.add('active');
    updateHint();
  }

  async function openPayBillModal(userId, billId, onPaid) {
    const bills = await fetchBills(userId);
    const bill = bills.find((b) => b.id === billId);
    if (!bill) return;

    if (bill.policy_violation || bill.amount > POLICY_LIMIT) {
      window.NexusMoney?.showToast?.('Blocked — amount exceeds €40,000 policy limit.', 'error');
      return;
    }

    const accounts = await window.NexusBanking?.fetchAccounts?.();
    if (!accounts?.length) {
      window.NexusMoney?.showToast?.('No accounts found in Supabase', 'error');
      return;
    }

    window.NexusMoney?.injectToastStyles?.();

    let modal = document.getElementById('payBillModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'payBillModal';
      modal.className = 'money-modal';
      document.body.appendChild(modal);
    }

    const meta = BILL_TYPES[bill.bill_type] || BILL_TYPES.electricity;
    const accountOptions = accounts
      .map((a) => `<option value="${a.id}">${escapeHtml(a.account_name)} (**** ${a.account_number_last4}) — ${formatCurrency(a.balance)}</option>`)
      .join('');

    modal.innerHTML = `
      <div class="money-modal-backdrop"></div>
      <div class="money-modal-panel" role="dialog">
        <button type="button" class="money-modal-close">&times;</button>
        <h2>Pay ${escapeHtml(meta.label)} Bill</h2>
        <p>Debit <strong>${formatCurrency(bill.amount)}</strong> from your account via Supabase.</p>
        <form id="payBillForm">
          <div class="form-group">
            <label for="payBillAccount">Pay From</label>
            <select id="payBillAccount" required>${accountOptions}</select>
          </div>
          <div class="money-modal-actions">
            <button type="button" class="btn-secondary money-modal-cancel">Cancel</button>
            <button type="submit" class="btn-primary">Confirm Payment</button>
          </div>
        </form>
      </div>`;

    const close = () => modal.classList.remove('active');
    modal.querySelector('.money-modal-backdrop').addEventListener('click', close);
    modal.querySelector('.money-modal-close').addEventListener('click', close);
    modal.querySelector('.money-modal-cancel').addEventListener('click', close);

    modal.querySelector('#payBillForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = modal.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      try {
        await payBill(userId, billId, modal.querySelector('#payBillAccount').value);
        close();
        await onPaid?.();
      } catch (err) {
        window.NexusMoney?.showToast?.(err.message || 'Payment failed', 'error');
      } finally {
        submitBtn.disabled = false;
      }
    });

    modal.classList.add('active');
  }

  function bindBillActions(userId, onRefresh) {
    document.querySelectorAll('.js-add-bill').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        openAddBillModal(btn.dataset.billType || null, userId, onRefresh);
      });
    });

    document.getElementById('billsGrid')?.addEventListener('click', async (e) => {
      const payBtn = e.target.closest('.js-pay-bill');
      if (payBtn) {
        e.preventDefault();
        await openPayBillModal(userId, payBtn.dataset.billId, onRefresh);
        return;
      }
      const delBtn = e.target.closest('.js-delete-bill');
      if (delBtn) {
        e.preventDefault();
        if (!confirm('Delete this bill from Supabase?')) return;
        try {
          await deleteBill(userId, delBtn.dataset.billId);
          window.NexusMoney?.showToast?.('Bill deleted', 'success');
          await onRefresh();
        } catch (err) {
          window.NexusMoney?.showToast?.(err.message || 'Could not delete', 'error');
        }
      }
    });
  }

  function subscribeBillsUpdates(userId, onUpdate) {
    const client = getClient();
    if (!client || !userId) return;

    if (billsChannel) {
      client.removeChannel(billsChannel);
      billsChannel = null;
    }

    billsChannel = client
      .channel('bills-updates-' + userId)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'utility_bills', filter: 'user_id=eq.' + userId },
        () => onUpdate?.()
      )
      .subscribe();
  }

  async function loadBillsPage(user, profile) {
    const client = getClient();
    if (!client) throw new Error('Supabase client not ready');

    if (window.NexusBanking?.ensureBanking) {
      await window.NexusBanking.ensureBanking();
    }

    const userId = user.id;
    const refresh = () => refreshBillsUI(userId);

    await ensureBillsSchema();
    await refresh();
    bindBillActions(userId, refresh);
    subscribeBillsUpdates(userId, refresh);

    if (window.NexusBanking?.bindStatementModalLinks) {
      window.NexusBanking.bindStatementModalLinks(user, profile);
    }

    if (window.NexusMoney?.subscribeMoneyUpdates) {
      window.NexusMoney.subscribeMoneyUpdates(userId, () => refresh());
    }
  }

  window.NexusBills = {
    POLICY_LIMIT,
    BILL_TYPES,
    ensureBillsSchema,
    fetchBills,
    addBill,
    payBill,
    refreshBillsUI,
    loadBillsPage,
    openAddBillModal,
  };
})();
