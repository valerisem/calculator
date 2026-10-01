import mondaySdk from 'monday-sdk-js';

export const monday = mondaySdk();
export const inMonday = window.parent !== window;

async function sessionToken() {
  if (!inMonday) return null;
  try {
    const res = await monday.get('sessionToken');
    return res?.data || null;
  } catch {
    return null;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const token = await sessionToken();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: token } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `Request failed (${res.status})`);
    err.result = json;
    err.status = res.status;
    throw err;
  }
  return json;
}

export function openUrl(url) {
  if (inMonday) monday.execute('openLinkInTab', { url });
  else window.open(url, '_blank', 'noopener');
}

export function notify(message, type = 'success') {
  if (inMonday) monday.execute('notice', { message, type, timeout: 4000 });
}
