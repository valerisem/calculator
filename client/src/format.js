export const fmtInt = (n) => (n == null ? '–' : Math.round(Number(n)).toLocaleString('en-GB'));
export const fmtMoney = (n, cur = 'GBP', digits = 0) =>
  n == null
    ? '–'
    : new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(n));
export const fmtPct = (x, digits = 1) => (x == null ? '–' : `${(Number(x) * 100).toFixed(digits)}%`);
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
