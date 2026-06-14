/**
 * NexusBank — loans: apply (1 per user), display, and payments via Supabase.
 */
(function () {
  'use strict';

  function getClient() {
    return window.NexusAuth?.supabase;
  }

  function formatCurrency(amount) {
    return (
      window.NexusBanking?.formatCurrency(amount) ||
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(amount) || 0)
    );
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function loanTypeLabel(type) {
    const map = { personal: 'Personal Loan', auto: 'Auto Loan', home: 'Home Improvement' };
    return map[type] || 'Personal Loan';
  }

  function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso + (String(iso).includes('T') ? '' : 'T12:00:00')).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  async function fetchActiveLoan() {
    const client = getClient();
    const { data, error } = await client
      .from('loans')
      .select('*')
      .eq('status', 'active')
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async function fetchLoanPayments(loanId, limit = 5) {
    const client = getClient();
    const { data, error } = await client
      .from('loan_payments')
      .select('*')
      .eq('loan_id', loanId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  async function fetchAccounts() {
    if (window.NexusBanking?.fetchAccounts) {
      return window.NexusBanking.fetchAccounts();
    }
    const client = getClient();
    const { data, error } = await client.from('bank_accounts').select('*').order('created_at');
    if (error) throw error;
    return data || [];
  }

  async function applyForLoan(params) {
    const client = getClient();
    const { data, error } = await client.rpc('apply_for_loan', {
      p_principal: params.principal,
      p_term_months: params.termMonths,
      p_interest_rate: params.interestRate,
      p_monthly_payment: params.monthlyPayment,
      p_total_repayment: params.totalRepayment,
      p_protection_enabled: params.protectionEnabled,
      p_loan_type: params.loanType || 'personal',
    });
    if (error) throw new Error(error.message);
    return data;
  }

  async function payLoan(loanId, accountId, amount) {
    const client = getClient();
    const { data, error } = await client.rpc('pay_loan', {
      p_loan_id: loanId,
      p_account_id: accountId,
      p_amount: amount,
    });
    if (error) throw new Error(error.message);
    return data;
  }

  function getCalculatorInputs() {
    const calc = window.NexusLoanCalculator;
    if (!calc) return null;

    const amountEl = document.getElementById('loanAmount');
    const termEl = document.getElementById('termMonths');
    const protectionEl = document.getElementById('protectionEnabled');

    const loanAmount = Number(amountEl?.value) || calc.DEFAULT_LOAN_AMOUNT;
    const termMonths = Number(termEl?.value) || calc.DEFAULT_TERM_MONTHS;
    const protectionEnabled = Boolean(protectionEl?.checked);

    return calc.calculateLoan(loanAmount, termMonths, protectionEnabled);
  }

  function updateOverview(loan) {
    const totalEl = document.getElementById('totalLoanBalance');
    const countEl = document.getElementById('activeLoansCount');
    const nextEl = document.getElementById('nextPaymentDate');
    const monthlyEl = document.getElementById('monthlyDue');
    const statEl = document.getElementById('activeLoansStat');
    const applyHeaderBtn = document.getElementById('headerApplyBtn');

    if (loan) {
      if (totalEl) totalEl.textContent = formatCurrency(loan.remaining_balance);
      if (countEl) countEl.textContent = '1 active loan · ' + loanTypeLabel(loan.loan_type);
      if (nextEl) nextEl.textContent = formatDate(loan.next_payment_date);
      if (monthlyEl) monthlyEl.textContent = formatCurrency(loan.monthly_payment);
      if (statEl) statEl.textContent = '1';
      if (applyHeaderBtn) {
        applyHeaderBtn.innerHTML = '<i class="fas fa-money-bill-wave"></i><span>Make Payment</span>';
        applyHeaderBtn.href = '#activeLoansList';
        applyHeaderBtn.classList.add('js-pay-loan-header');
      }
    } else {
      if (totalEl) totalEl.textContent = formatCurrency(0);
      if (countEl) countEl.textContent = 'No active loans yet';
      if (nextEl) nextEl.textContent = '—';
      if (monthlyEl) monthlyEl.textContent = '—';
      if (statEl) statEl.textContent = '0';
      if (applyHeaderBtn) {
        applyHeaderBtn.innerHTML = '<i class="fas fa-plus"></i><span>Apply for a Loan</span>';
        applyHeaderBtn.href = '#loanCalculator';
        applyHeaderBtn.classList.remove('js-pay-loan-header');
      }
    }
  }

  function renderActiveLoanCard(loan, payments) {
    const paid = Number(loan.principal_amount) - Number(loan.remaining_balance);
    const pct = Math.min(100, Math.round((paid / Number(loan.principal_amount)) * 100));

    const paymentRows =
      payments.length > 0
        ? payments
            .map(
              (p) => `
          <div class="loan-payment-row">
            <span>${formatDate(p.created_at)}</span>
            <span class="loan-payment-amount">-${formatCurrency(p.amount)}</span>
          </div>`
            )
            .join('')
        : '<p class="loan-payments-empty">No payments yet</p>';

    return `
      <div class="active-loan-card" data-loan-id="${loan.id}">
        <div class="active-loan-header">
          <div>
            <span class="loan-status-badge active">Active</span>
            <h3>${escapeHtml(loanTypeLabel(loan.loan_type))}</h3>
            <p class="active-loan-meta">Approved ${formatDate(loan.created_at)} · ${loan.interest_rate}% APR</p>
          </div>
          <div class="active-loan-remaining">
            <span class="label">Remaining</span>
            <span class="value">${formatCurrency(loan.remaining_balance)}</span>
          </div>
        </div>

        <div class="loan-progress">
          <div class="loan-progress-header">
            <span>Paid ${formatCurrency(paid)} of ${formatCurrency(loan.principal_amount)}</span>
            <span>${pct}%</span>
          </div>
          <div class="loan-progress-bar">
            <div class="loan-progress-fill" style="width:${pct}%"></div>
          </div>
        </div>

        <div class="active-loan-details">
          <div><span class="detail-label">Monthly payment</span><span class="detail-value">${formatCurrency(loan.monthly_payment)}</span></div>
          <div><span class="detail-label">Term</span><span class="detail-value">${loan.term_months} months</span></div>
          <div><span class="detail-label">Next due</span><span class="detail-value">${formatDate(loan.next_payment_date)}</span></div>
          <div><span class="detail-label">Protection</span><span class="detail-value">${loan.protection_enabled ? 'Yes' : 'No'}</span></div>
        </div>

        <div class="active-loan-actions">
          <button type="button" class="btn-primary js-pay-loan" data-loan-id="${loan.id}">
            <i class="fas fa-money-bill-wave"></i> Make a Payment
          </button>
          <button type="button" class="btn-secondary js-pay-loan-full" data-loan-id="${loan.id}" data-amount="${loan.remaining_balance}">
            <i class="fas fa-check-circle"></i> Pay Off Balance
          </button>
        </div>

        <div class="loan-payments-history">
          <div class="loan-payments-title">Recent Payments</div>
          ${paymentRows}
        </div>
      </div>`;
  }

  function setCalculatorMode(hasLoan) {
    const calculatorSection = document.getElementById('loanCalculator');
    const applyBtn = document.getElementById('applyLoanBtn');
    const overviewApply = document.getElementById('overviewApplyBtn');

    if (hasLoan) {
      calculatorSection?.classList.add('has-active-loan');
      if (applyBtn) {
        applyBtn.textContent = 'You already have an active loan';
        applyBtn.disabled = true;
        applyBtn.classList.add('disabled');
      }
      if (overviewApply) {
        overviewApply.innerHTML = '<i class="fas fa-money-bill-wave"></i> Make Payment';
        overviewApply.href = '#activeLoansList';
        overviewApply.classList.add('js-pay-loan-header');
      }
    } else {
      calculatorSection?.classList.remove('has-active-loan');
      if (applyBtn) {
        applyBtn.innerHTML = 'Continue to Application <i class="fas fa-arrow-right"></i>';
        applyBtn.disabled = false;
        applyBtn.classList.remove('disabled');
      }
      if (overviewApply) {
        overviewApply.innerHTML = '<i class="fas fa-plus"></i> Apply for a Loan';
        overviewApply.href = '#loanCalculator';
        overviewApply.classList.remove('js-pay-loan-header');
      }
    }
  }

  async function refreshLoansUI() {
    let loan = null;
    let payments = [];

    try {
      loan = await fetchActiveLoan();
      if (loan) payments = await fetchLoanPayments(loan.id);
    } catch (err) {
      console.warn('fetch loan:', err.message);
    }

    updateOverview(loan);
    setCalculatorMode(!!loan);

    const listEl = document.getElementById('activeLoansList');
    if (listEl) {
      if (loan) {
        listEl.className = 'active-loans-container';
        listEl.innerHTML = renderActiveLoanCard(loan, payments);
      } else {
        listEl.className = 'empty-loans';
        listEl.innerHTML = `
          <i class="fas fa-hand-holding-usd"></i>
          <p>You don't have any active loans yet.<br>Use the calculator above to explore options and apply.</p>
          <a href="#loanCalculator" class="btn-primary">
            <i class="fas fa-calculator"></i> Start Calculator
          </a>`;
      }
    }

    bindPayButtons(loan);
    return loan;
  }

  function injectModalStyles() {
    if (document.getElementById('loanModalStyles')) return;
    window.NexusMoney?.injectToastStyles?.();
  }

  function openApplyModal(onSuccess) {
    injectModalStyles();
    const inputs = getCalculatorInputs();
    if (!inputs) {
      window.NexusMoney?.showToast?.('Calculator not ready', 'error');
      return;
    }

    let modal = document.getElementById('loanApplyModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'loanApplyModal';
      modal.className = 'money-modal';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="money-modal-backdrop"></div>
      <div class="money-modal-panel" role="dialog">
        <button type="button" class="money-modal-close" aria-label="Close">&times;</button>
        <h2>Confirm Loan Application</h2>
        <p>Review your loan details. Funds will be deposited to your primary checking account.</p>
        <ul class="loan-apply-details">
          <li><span>Amount</span><strong id="applySummaryAmount"></strong></li>
          <li><span>Term</span><strong>${escapeHtml(inputs.termDisplay)}</strong></li>
          <li><span>Monthly payment</span><strong>${escapeHtml(inputs.monthlyPaymentFormatted)}</strong></li>
          <li><span>Total repayment</span><strong>${escapeHtml(inputs.totalRepaymentFormatted)}</strong></li>
          <li><span>Interest rate</span><strong>${escapeHtml(inputs.interestRateFormatted)}</strong></li>
        </ul>
        <p class="loan-apply-note"><i class="fas fa-info-circle"></i> You can only have one active loan at a time.</p>
        <div class="money-modal-actions">
          <button type="button" class="btn-secondary loan-modal-cancel">Cancel</button>
          <button type="button" class="btn-primary" id="confirmApplyLoan">Submit Application</button>
        </div>
      </div>`;

    const amountEl = document.getElementById('loanAmount');
    const principal = Number(amountEl?.value) || window.NexusLoanCalculator.DEFAULT_LOAN_AMOUNT;
    const summaryAmount = modal.querySelector('#applySummaryAmount');
    if (summaryAmount) {
      summaryAmount.textContent = window.NexusLoanCalculator.formatCurrency(principal);
    }

    modal.classList.add('active');
    const close = () => modal.classList.remove('active');
    modal.querySelector('.money-modal-backdrop').addEventListener('click', close);
    modal.querySelector('.money-modal-close').addEventListener('click', close);
    modal.querySelector('.loan-modal-cancel').addEventListener('click', close);

    modal.querySelector('#confirmApplyLoan').addEventListener('click', async () => {
      const btn = modal.querySelector('#confirmApplyLoan');
      btn.disabled = true;
      try {
        const calc = getCalculatorInputs();
        const protectionEl = document.getElementById('protectionEnabled');
        const result = await applyForLoan({
          principal,
          termMonths: Number(document.getElementById('termMonths')?.value),
          interestRate: calc.interestRate,
          monthlyPayment: calc.monthlyPayment,
          totalRepayment: calc.totalRepayment,
          protectionEnabled: Boolean(protectionEl?.checked),
          loanType: 'personal',
        });
        window.NexusMoney?.showToast?.(result.message || 'Loan approved!', 'success');
        close();
        await refreshLoansUI();
        onSuccess?.(result);
        document.getElementById('activeLoansList')?.scrollIntoView({ behavior: 'smooth' });
      } catch (err) {
        window.NexusMoney?.showToast?.(err.message || 'Application failed', 'error');
      } finally {
        btn.disabled = false;
      }
    });
  }

  function openPayModal(loan, accounts, presetAmount) {
    injectModalStyles();
    if (!loan) return;

    let modal = document.getElementById('loanPayModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'loanPayModal';
      modal.className = 'money-modal';
      document.body.appendChild(modal);
    }

    const remaining = Number(loan.remaining_balance);
    const accountOptions = accounts
      .map(
        (a) =>
          `<option value="${a.id}">${escapeHtml(a.account_name)} (**** ${a.account_number_last4}) — ${formatCurrency(a.balance)}</option>`
      )
      .join('');

    modal.innerHTML = `
      <div class="money-modal-backdrop"></div>
      <div class="money-modal-panel" role="dialog">
        <button type="button" class="money-modal-close" aria-label="Close">&times;</button>
        <h2>Pay Loan</h2>
        <p>Remaining balance: <strong>${formatCurrency(remaining)}</strong></p>
        <form id="loanPayForm">
          <div class="form-group">
            <label for="payLoanAccount">Pay from account</label>
            <select id="payLoanAccount" required>${accountOptions}</select>
          </div>
          <div class="form-group">
            <label for="payLoanAmount">Payment amount (USD)</label>
            <input type="number" id="payLoanAmount" min="0.01" max="${remaining}" step="0.01"
                   value="${presetAmount ? Math.min(presetAmount, remaining).toFixed(2) : ''}"
                   placeholder="0.00" required />
          </div>
          <div class="money-modal-actions">
            <button type="button" class="btn-secondary loan-modal-cancel">Cancel</button>
            <button type="submit" class="btn-primary">Submit Payment</button>
          </div>
        </form>
      </div>`;

    modal.classList.add('active');
    const close = () => modal.classList.remove('active');
    modal.querySelector('.money-modal-backdrop').addEventListener('click', close);
    modal.querySelector('.money-modal-close').addEventListener('click', close);
    modal.querySelector('.loan-modal-cancel').addEventListener('click', close);

    modal.querySelector('#loanPayForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = modal.querySelector('[type="submit"]');
      submitBtn.disabled = true;
      try {
        const accountId = modal.querySelector('#payLoanAccount').value;
        const amount = parseFloat(modal.querySelector('#payLoanAmount').value);
        if (!amount || amount <= 0) throw new Error('Enter a valid amount');
        if (amount > remaining) throw new Error('Amount exceeds remaining balance');

        const result = await payLoan(loan.id, accountId, amount);
        window.NexusMoney?.showToast?.(result.message || 'Payment successful', 'success');
        close();
        await refreshLoansUI();
      } catch (err) {
        window.NexusMoney?.showToast?.(err.message || 'Payment failed', 'error');
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  function bindPayButtons(loan) {
    document.querySelectorAll('.js-pay-loan, .js-pay-loan-header').forEach((btn) => {
      btn.replaceWith(btn.cloneNode(true));
    });
    document.querySelectorAll('.js-pay-loan-full').forEach((btn) => {
      btn.replaceWith(btn.cloneNode(true));
    });

    if (!loan) return;

    const handlePay = async (presetAmount) => {
      try {
        const accounts = await fetchAccounts();
        if (!accounts.length) {
          window.NexusMoney?.showToast?.('No accounts available', 'error');
          return;
        }
        openPayModal(loan, accounts, presetAmount);
      } catch (err) {
        window.NexusMoney?.showToast?.(err.message || 'Could not load accounts', 'error');
      }
    };

    document.querySelectorAll('.js-pay-loan, .js-pay-loan-header').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        handlePay(null);
      });
    });

    document.querySelectorAll('.js-pay-loan-full').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const amount = parseFloat(btn.dataset.amount);
        handlePay(amount);
      });
    });
  }

  async function loadLoansPage(user, profile) {
    if (window.NexusBanking?.ensureBanking) {
      await window.NexusBanking.ensureBanking();
    }

    await refreshLoansUI();

    const applyBtn = document.getElementById('applyLoanBtn');
    if (applyBtn) {
      applyBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const existing = await fetchActiveLoan();
        if (existing) {
          window.NexusMoney?.showToast?.('You already have an active loan', 'info');
          document.getElementById('activeLoansList')?.scrollIntoView({ behavior: 'smooth' });
          return;
        }
        openApplyModal(() => refreshLoansUI());
      });
    }

    if (window.NexusBanking?.bindStatementModalLinks) {
      window.NexusBanking.bindStatementModalLinks(user, profile);
    }

    if (user?.id && window.NexusMoney?.subscribeMoneyUpdates) {
      window.NexusMoney.subscribeMoneyUpdates(user.id, () => refreshLoansUI());
    }
  }

  window.NexusLoans = {
    fetchActiveLoan,
    fetchLoanPayments,
    applyForLoan,
    payLoan,
    refreshLoansUI,
    loadLoansPage,
    openApplyModal,
    openPayModal,
  };
})();
