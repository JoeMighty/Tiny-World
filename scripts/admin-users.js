// -------- admin user management --------
(function () {
  'use strict';

  var state = { users: [], selected: null, loading: false };
  var els = {};

  function byId(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function setStatus(msg, tone) {
    els.status.textContent = msg || '';
    els.status.dataset.tone = tone || '';
  }
  function walletToken() {
    try { return localStorage.getItem('tinyworld:auth:wallet-session.v1') || ''; } catch (_) { return ''; }
  }
  function cookieToken() {
    try { var m = document.cookie.match(/(?:^|; )nf_jwt=([^;]*)/); return m ? decodeURIComponent(m[1]) : ''; } catch (_) { return ''; }
  }
  function accessToken() {
    var A = window.TinyWorldAuth;
    if (A && typeof A.getUser === 'function') {
      return Promise.resolve(A.getUser()).then(function (u) {
        if (u && typeof u.jwt === 'function') {
          return Promise.resolve(u.jwt()).catch(function () { return ''; }).then(function (jwt) {
            return jwt || (u.token && u.token.access_token) || walletToken() || cookieToken() || '';
          });
        }
        return (u && u.token && u.token.access_token) || walletToken() || cookieToken() || '';
      }).catch(function () { return walletToken() || cookieToken() || ''; });
    }
    return Promise.resolve(walletToken() || cookieToken() || '');
  }
  function api(path, method, body) {
    return accessToken().then(function (token) {
      if (!token) throw new Error('Sign in as an admin to continue.');
      var opts = { method: method || 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, credentials: 'same-origin' };
      if (body) opts.body = JSON.stringify(body);
      return fetch(path, opts).then(function (res) {
        return res.text().then(function (text) {
          var data = null;
          try { data = text ? JSON.parse(text) : null; } catch (_) {}
          if (!res.ok) throw new Error((data && data.error) || ('Request failed: ' + res.status));
          return data || {};
        });
      });
    });
  }
  function selectedPayload() {
    return {
      id: Number(els.id.value),
      username: els.username.value,
      email: els.email.value,
      displayName: els.display.value,
      twitter: els.twitter.value,
      github: els.github.value,
      image: els.image.value,
      about: els.about.value,
      lobbyAccess: els.lobby.checked,
    };
  }
  function fillEditor(user) {
    state.selected = user || null;
    els.editor.hidden = !user;
    if (!user) return;
    els.id.value = user.id || '';
    els.idPill.textContent = 'Profile #' + user.id;
    els.username.value = user.username || '';
    els.email.value = user.email || '';
    els.display.value = user.displayName || '';
    els.twitter.value = user.twitter || '';
    els.github.value = user.github || '';
    els.image.value = user.image || '';
    els.about.value = user.about || '';
    els.lobby.checked = !!user.lobbyAccess;
    els.lobby.disabled = !!user.builtInAccess;
    els.resetNote.textContent = user.passwordResetRequestedAt ? ('Last reset requested: ' + new Date(user.passwordResetRequestedAt).toLocaleString()) : '';
  }
  function renderUsers() {
    if (!state.users.length) {
      els.list.innerHTML = '<tr><td colspan="5" class="admin-users-empty">No users found.</td></tr>';
      return;
    }
    els.list.innerHTML = state.users.map(function (u) {
      var socials = [];
      if (u.twitter) socials.push('X @' + u.twitter);
      if (u.github) socials.push('GH @' + u.github);
      return '<tr data-id="' + esc(u.id) + '">' +
        '<td><strong>' + esc(u.displayName || u.username) + '</strong><small>' + esc(u.username || '') + '</small></td>' +
        '<td>' + esc(u.email || '—') + '</td>' +
        '<td>' + esc(socials.join(' · ') || '—') + '</td>' +
        '<td>' + (u.lobbyAccess ? '<span class="admin-badge ok">Enabled</span>' : '<span class="admin-badge">Off</span>') + '</td>' +
        '<td><button type="button" class="secondary-action" data-edit="' + esc(u.id) + '">Edit</button></td>' +
      '</tr>';
    }).join('');
  }
  function loadUsers() {
    var q = els.search.value.trim();
    state.loading = true;
    setStatus('Loading users…');
    return api('/api/admin-users' + (q ? '?q=' + encodeURIComponent(q) : ''), 'GET').then(function (data) {
      state.users = data.users || [];
      renderUsers();
      setStatus('Loaded ' + state.users.length + ' user' + (state.users.length === 1 ? '' : 's') + '.');
      if (state.selected) {
        var again = state.users.find(function (u) { return Number(u.id) === Number(state.selected.id); });
        if (again) fillEditor(again);
      }
    }).catch(function (err) {
      setStatus(err.message || 'Unable to load users.', 'error');
      els.list.innerHTML = '<tr><td colspan="5" class="admin-users-empty">Admin access required.</td></tr>';
    }).finally(function () { state.loading = false; });
  }
  function bind() {
    els.searchBtn.addEventListener('click', loadUsers);
    els.refreshBtn.addEventListener('click', loadUsers);
    els.search.addEventListener('keydown', function (evt) { if (evt.key === 'Enter') { evt.preventDefault(); loadUsers(); } });
    els.list.addEventListener('click', function (evt) {
      var btn = evt.target && evt.target.closest && evt.target.closest('[data-edit]');
      if (!btn) return;
      var id = Number(btn.getAttribute('data-edit'));
      fillEditor(state.users.find(function (u) { return Number(u.id) === id; }));
    });
    els.editor.addEventListener('submit', function (evt) {
      evt.preventDefault();
      setStatus('Saving account…');
      api('/api/admin-users', 'PUT', selectedPayload()).then(function (data) {
        var user = data.user;
        state.users = state.users.map(function (u) { return Number(u.id) === Number(user.id) ? user : u; });
        renderUsers();
        fillEditor(user);
        setStatus('Account saved.');
      }).catch(function (err) { setStatus(err.message || 'Save failed.', 'error'); });
    });
    els.reset.addEventListener('click', function () {
      if (!state.selected) return;
      if (!confirm('Send a password reset email to ' + (els.email.value || state.selected.email || 'this user') + '?')) return;
      setStatus('Requesting password reset…');
      api('/api/admin-users', 'POST', { action: 'resetPassword', id: Number(els.id.value) }).then(function (data) {
        var sent = data.reset && data.reset.sent;
        fillEditor(data.user);
        setStatus(sent ? 'Password reset email requested.' : 'Reset recorded. Configure NETLIFY_AUTH_TOKEN + NETLIFY_SITE_ID to send recovery emails.', sent ? '' : 'warn');
      }).catch(function (err) { setStatus(err.message || 'Password reset failed.', 'error'); });
    });
  }
  function init() {
    els = {
      search: byId('admin-user-search'), searchBtn: byId('admin-user-search-btn'), refreshBtn: byId('admin-user-refresh-btn'),
      status: byId('admin-users-status'), list: byId('admin-users-list'), editor: byId('admin-user-editor'), idPill: byId('admin-user-id-pill'),
      id: byId('admin-user-id'), username: byId('admin-user-username'), email: byId('admin-user-email'), display: byId('admin-user-display'),
      twitter: byId('admin-user-twitter'), github: byId('admin-user-github'), image: byId('admin-user-image'), about: byId('admin-user-about'),
      lobby: byId('admin-user-lobby'), reset: byId('admin-user-reset-password'), resetNote: byId('admin-reset-note'),
    };
    bind();
    Promise.resolve(window.__tinyworldAuthReady).catch(function () {}).then(loadUsers);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();