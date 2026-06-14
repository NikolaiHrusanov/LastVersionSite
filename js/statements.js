/**
 * NexusBank — account statements page (Supabase-backed).
 */
(function () {
  'use strict';

  let cachedUser = null;
  let cachedProfile = null;
  let allAccounts = [];
  let allTransactions = [];

  function formatCurrency(amount) {
    return window.NexusBanking?.formatCurrency(amount) || String(amount);
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatTxDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function isCredit(tx) {
    return (
      tx.transaction_type === 'credit' ||
      (tx.type && window.NexusMoney?.isCreditType(tx.type))
    );
  }

  function getPeriodRange(periodKey) {
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    let start;

    switch (periodKey) {
      case 'last_month': {
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
        return { start, end: lastDay, label: 'Last month' };
      }
      case 'last_3_months':
        start = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        return { start, end, label: 'Last 3 months' };
      case 'last_year':
        start = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
        return { start, end, label: 'Last 12 months' };
      case 'all':
        return { start: null, end: null, label: 'All time' };
      case 'current_month':
      default:
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        return { start, end, label: 'Current month' };
    }
  }

  function filterTransactions(transactions, periodKey, accountFilter, accounts) {
    const { start, end } = getPeriodRange(periodKey);
    const accountIds = new Set();

    if (accountFilter === 'checking') {
      accounts.filter((a) => a.account_type === 'checking').forEach((a) => accountIds.add(a.id));
    } else if (accountFilter === 'savings') {
      accounts.filter((a) => a.account_type === 'savings').forEach((a) => accountIds.add(a.id));
    } else if (accountFilter !== 'all') {
      accountIds.add(accountFilter);
    }

    return transactions.filter((tx) => {
      if (accountFilter !== 'all' && accountIds.size && !accountIds.has(tx.account_id)) {
        return false;
      }
      if (!start || !end) return true;
      const d = new Date(tx.created_at);
      return d >= start && d <= end;
    });
  }

  function renderTransactionRow(tx) {
    if (tx.type && window.NexusMoney?.renderMoneyTransactionRow) {
      return window.NexusMoney.renderMoneyTransactionRow(tx);
    }

    const credit = isCredit(tx);
    const sign = credit ? '+' : '-';
    const acct = tx.bank_accounts;
    const acctLabel = acct ? `${acct.account_name} · ****${acct.account_number_last4}` : '';

    return `
      <div class="stmt-tx-item">
        <div class="stmt-tx-icon ${credit ? 'credit' : 'debit'}">
          <i class="fas fa-receipt"></i>
        </div>
        <div class="stmt-tx-details">
          <div class="stmt-tx-name">${escapeHtml(tx.description)}</div>
          <div class="stmt-tx-meta">${formatTxDate(tx.created_at)}${acctLabel ? ' · ' + escapeHtml(acctLabel) : ''}</div>
        </div>
        <div class="stmt-tx-amount ${credit ? 'credit' : 'debit'}">${sign}${formatCurrency(tx.amount)}</div>
      </div>`;
  }

  function renderAccountSummary(accounts, accountFilter) {
    let list = accounts;
    if (accountFilter === 'checking') list = accounts.filter((a) => a.account_type === 'checking');
    else if (accountFilter === 'savings') list = accounts.filter((a) => a.account_type === 'savings');
    else if (accountFilter !== 'all') list = accounts.filter((a) => a.id === accountFilter);

    if (!list.length) {
      return '<p class="empty-state">No accounts in this view.</p>';
    }

    return list
      .map(
        (a) => `
        <div class="stmt-account-card">
          <div class="stmt-account-top">
            <span class="stmt-account-type">${escapeHtml(a.account_type)}</span>
            <span class="stmt-account-num">**** ${escapeHtml(a.account_number_last4)}</span>
          </div>
          <div class="stmt-account-name">${escapeHtml(a.account_name)}</div>
          <div class="stmt-account-balance">${formatCurrency(a.balance)}</div>
        </div>`
      )
      .join('');
  }

  function updateOverview(filteredTx, accounts, periodLabel) {
    const total = accounts.reduce((s, a) => s + Number(a.balance || 0), 0);
    const credits = filteredTx.filter(isCredit).reduce((s, t) => s + Number(t.amount), 0);
    const debits = filteredTx.filter((t) => !isCredit(t)).reduce((s, t) => s + Number(t.amount), 0);

    const totalEl = document.getElementById('statementTotalBalance');
    const periodEl = document.getElementById('statementPeriodLabel');
    const txCountEl = document.getElementById('statementTxCount');
    const creditsEl = document.getElementById('statementCredits');
    const debitsEl = document.getElementById('statementDebits');
    const accountsEl = document.getElementById('statementAccountCount');

    if (totalEl) totalEl.textContent = formatCurrency(total);
    if (periodEl) periodEl.textContent = periodLabel;
    if (txCountEl) txCountEl.textContent = String(filteredTx.length);
    if (creditsEl) creditsEl.textContent = formatCurrency(credits);
    if (debitsEl) debitsEl.textContent = formatCurrency(debits);
    if (accountsEl) accountsEl.textContent = String(accounts.length);
  }

  function refreshUI() {
    const periodKey = document.getElementById('statementPeriod')?.value || 'current_month';
    const accountFilter = document.getElementById('statementAccountFilter')?.value || 'all';
    const { label } = getPeriodRange(periodKey);

    const filtered = filterTransactions(allTransactions, periodKey, accountFilter, allAccounts);

    updateOverview(filtered, allAccounts, label);

    const accountsGrid = document.getElementById('statementAccountsGrid');
    if (accountsGrid) {
      accountsGrid.innerHTML = renderAccountSummary(allAccounts, accountFilter);
    }

    const txList = document.getElementById('statementTransactionsList');
    if (txList) {
      txList.innerHTML =
        filtered.length > 0
          ? filtered.map(renderTransactionRow).join('')
          : '<p class="empty-state"><i class="fas fa-inbox"></i> No transactions for this period.</p>';
    }

    const holderEl = document.getElementById('statementHolderName');
    if (holderEl && cachedProfile) {
      holderEl.textContent =
        cachedProfile.full_name || cachedUser?.user_metadata?.full_name || 'Account Holder';
    }
  }

  function populateAccountFilter(accounts) {
    const select = document.getElementById('statementAccountFilter');
    if (!select) return;

    const current = select.value;
    select.innerHTML = `
      <option value="all">All accounts</option>
      <option value="checking">Checking only</option>
      <option value="savings">Savings only</option>
      ${accounts
        .map(
          (a) =>
            `<option value="${escapeHtml(a.id)}">${escapeHtml(a.account_name)} (****${escapeHtml(a.account_number_last4)})</option>`
        )
        .join('')}`;

    if ([...select.options].some((o) => o.value === current)) {
      select.value = current;
    }
  }

  async function reloadFromSupabase() {
    const [accounts, transactions] = await Promise.all([
      window.NexusBanking.fetchAccounts(),
      window.NexusBanking.fetchAllTransactions(),
    ]);
    allAccounts = accounts;
    allTransactions = transactions;
    populateAccountFilter(accounts);
    refreshUI();
  }

  function bindControls(user, profile) {
    cachedUser = user;
    cachedProfile = profile;

    document.getElementById('statementPeriod')?.addEventListener('change', refreshUI);
    document.getElementById('statementAccountFilter')?.addEventListener('change', refreshUI);

    document.getElementById('downloadFullStatement')?.addEventListener('click', async (e) => {
      e.preventDefault();
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await window.NexusBanking.downloadBankStatement(user, profile);
        window.NexusMoney?.showToast?.('Statement downloaded', 'success');
      } catch (err) {
        window.NexusMoney?.showToast?.(err.message || 'Download failed', 'error');
      } finally {
        btn.disabled = false;
      }
    });

    document.getElementById('downloadSavingsStatement')?.addEventListener('click', async (e) => {
      e.preventDefault();
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await window.NexusBanking.downloadSavingsStatement(user, profile);
        window.NexusMoney?.showToast?.('Savings statement downloaded', 'success');
      } catch (err) {
        window.NexusMoney?.showToast?.(err.message || 'Download failed', 'error');
      } finally {
        btn.disabled = false;
      }
    });

    document.getElementById('printStatement')?.addEventListener('click', (e) => {
      e.preventDefault();
      window.print();
    });
  }

  async function loadStatementsPage(user, profile) {
    if (!window.NexusBanking) throw new Error('Banking module not loaded');

    await window.NexusBanking.ensureBanking();
    window.NexusMoney?.injectToastStyles?.();

    bindControls(user, profile);
    await reloadFromSupabase();

    if (window.NexusMoney?.subscribeMoneyUpdates) {
      window.NexusMoney.subscribeMoneyUpdates(user.id, () => reloadFromSupabase());
    }
  }

  window.NexusStatements = {
    loadStatementsPage,
    refreshUI,
    reloadFromSupabase,
  };
})();
