(() => {
  'use strict';
  const TOKEN_KEY = 'hyperTimer_secure_session_v1';
  const base = (window.HYPER_TIMER_API_URL || '').replace(/\/$/, '');
  let revision = null;
  let writes = Promise.resolve();
  async function request(path, { method = 'GET', body, headers = {} } = {}) {
    if (!base) throw new Error('Cloud migration has not been activated. Local timers remain available.');
    const token = localStorage.getItem(TOKEN_KEY);
    const response = await fetch(base + path, {
      method, credentials: 'omit', cache: 'no-store',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) { localStorage.removeItem(TOKEN_KEY); revision = null; }
      const error = new Error(data.error?.message || data.error || data.message || 'Cloud request failed');
      error.status = response.status;
      throw error;
    }
    const newToken = response.headers.get('set-auth-token');
    if (newToken) localStorage.setItem(TOKEN_KEY, newToken);
    return data;
  }
  const cloud = {
    configured: !!base,
    hasSession: () => !!localStorage.getItem(TOKEN_KEY),
    async login(email, password) {
      await request('/auth/sign-in/email', { method: 'POST', body: { email, password } });
      return cloud.account();
    },
    signup: (email, password) => request('/auth/sign-up/email', { method: 'POST', body: { name: email, email, password } }),
    async account() { const data = await request('/account'); revision = data.revision; return data; },
    patch(body) {
      const operation = writes.then(async () => {
        if (!revision) throw new Error('Sync before saving to the cloud.');
        const data = await request('/account', { method: 'PATCH', body, headers: { 'If-Match': revision } });
        revision = data.revision;
        return data;
      });
      writes = operation.catch(() => {});
      return operation;
    },
    async logout() {
      try { if (cloud.hasSession()) await request('/auth/sign-out', { method: 'POST', body: {} }); }
      finally { localStorage.removeItem(TOKEN_KEY); revision = null; }
    },
    async changePassword(currentPassword, newPassword) {
      await request('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword, revokeOtherSessions: true } });
    }
  };
  window.HyperTimerCloud = Object.freeze(cloud);
})();
