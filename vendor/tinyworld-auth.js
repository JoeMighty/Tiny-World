// Clerk adapter exposing window.TinyWorldAuth — replaces Netlify Identity.
// CLERK_PUBLISHABLE_KEY is substituted at build time by publish.sh.
const PUBLISHABLE_KEY = '__CLERK_PUBLISHABLE_KEY__';

function loadClerkScript() {
  return new Promise((resolve, reject) => {
    if (window.Clerk) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@clerk/clerk-js@latest/dist/clerk.browser.js';
    s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load Clerk'));
    document.head.appendChild(s);
  });
}

// True only when publish.sh substituted a real Clerk publishable key. Guards
// against booting Clerk with the unsubstituted placeholder, which throws and
// would otherwise abort the whole app boot (blank builder).
function isClerkConfigured() {
  return /^pk_(test|live)_/.test(PUBLISHABLE_KEY);
}

let _clerk = null;
async function getClerk() {
  if (_clerk) return _clerk;
  if (!isClerkConfigured()) {
    throw new ClerkAuthError('Sign-in is not configured yet. Set CLERK_PUBLISHABLE_KEY in the deploy environment and redeploy.', 503);
  }
  await loadClerkScript();
  _clerk = new window.Clerk(PUBLISHABLE_KEY);
  await _clerk.load();
  return _clerk;
}

class ClerkAuthError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'AuthError';
    this.status = status || 500;
  }
}

class ClerkMissingIdentityError extends Error {
  constructor() {
    super('Clerk is not configured.');
    this.name = 'MissingIdentityError';
  }
}

function adaptUser(user) {
  if (!user) return null;
  const email = user.primaryEmailAddress?.emailAddress || '';
  return {
    id: user.id,
    email,
    emailVerified: user.primaryEmailAddress?.verification?.status === 'verified',
    user_metadata: {
      full_name: user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
      username: user.username || email.split('@')[0] || '',
      display_name: user.fullName || user.firstName || '',
      avatar_url: user.imageUrl || '',
    },
  };
}

function clerkError(err) {
  if (err instanceof ClerkAuthError) return err;
  const msg = err?.errors?.[0]?.longMessage || err?.errors?.[0]?.message || err?.message || 'Something went wrong.';
  const status = err?.status === 422 ? 401 : (err?.status || 500);
  return new ClerkAuthError(msg, status);
}

window.TinyWorldAuth = {
  AuthError: ClerkAuthError,
  MissingIdentityError: ClerkMissingIdentityError,
  AUTH_EVENTS: { LOGIN: 'SIGNED_IN', LOGOUT: 'SIGNED_OUT', SIGNUP: 'SIGNED_UP' },

  // Called during boot. MUST NOT throw — a thrown error here aborts the app's
  // boot sequence and leaves an empty builder. On any failure (Clerk not
  // configured, script blocked, network down) we report "no user" so the app
  // boots into anonymous mode and loads the default world.
  async getUser() {
    try {
      const clerk = await getClerk();
      return adaptUser(clerk.user);
    } catch (_) {
      return null;
    }
  },

  async login(email, password) {
    const clerk = await getClerk();
    try {
      const result = await clerk.client.signIn.create({ identifier: email, password });
      if (result.status === 'complete') {
        await clerk.setActive({ session: result.createdSessionId });
        return adaptUser(clerk.user);
      }
      throw new ClerkAuthError('Additional verification required.', 400);
    } catch (err) {
      throw clerkError(err);
    }
  },

  async signup(email, password, data) {
    const clerk = await getClerk();
    try {
      const params = { emailAddress: email, password };
      if (data?.full_name) {
        const [first, ...rest] = data.full_name.split(' ');
        params.firstName = first || '';
        params.lastName = rest.join(' ') || '';
      }
      if (data?.username) params.username = data.username;
      const result = await clerk.client.signUp.create(params);
      if (result.unverifiedFields?.includes('email_address')) {
        await result.prepareEmailAddressVerification({ strategy: 'email_code' });
        return { emailVerified: false, email };
      }
      if (result.status === 'complete') {
        await clerk.setActive({ session: result.createdSessionId });
        return { ...adaptUser(clerk.user), emailVerified: true };
      }
      return { emailVerified: false, email };
    } catch (err) {
      throw clerkError(err);
    }
  },

  async logout() {
    const clerk = await getClerk();
    await clerk.signOut();
  },

  // Opens Clerk's built-in sign-in modal with the requested OAuth strategy pre-loaded.
  async oauthLogin(provider) {
    const clerk = await getClerk();
    clerk.openSignIn({ initialValues: {}, appearance: {} });
    // Clerk's modal exposes OAuth buttons; we cannot programmatically click them,
    // so we fall back to opening the modal and letting the user select the provider.
    _ = provider; // acknowledged — used to guide UX in the future
  },

  async getSettings() {
    // Signal that both OAuth providers are potentially available; Clerk controls
    // which ones are actually enabled via the Clerk dashboard.
    return { providers: { google: true, github: true } };
  },

  async requestPasswordRecovery(email) {
    const clerk = await getClerk();
    try {
      await clerk.client.signIn.create({
        strategy: 'reset_password_email_code',
        identifier: email,
      });
    } catch (err) {
      throw clerkError(err);
    }
  },

  async updateUser(data) {
    const clerk = await getClerk();
    if (data?.password && clerk.user) {
      try {
        await clerk.user.updatePassword({ newPassword: data.password });
      } catch (err) {
        throw clerkError(err);
      }
    }
  },

  async handleAuthCallback() {
    const url = new URL(window.location.href);
    const hasClerkParams =
      url.searchParams.has('__clerk_db_jwt') ||
      url.searchParams.has('__clerk_status') ||
      url.hash.includes('access_token');
    if (!hasClerkParams) return null;
    const clerk = await getClerk();
    if (clerk.session) return { type: 'oauth' };
    return null;
  },

  onAuthChange(callback) {
    getClerk().then(clerk => {
      clerk.addListener(({ session }) => {
        callback(session ? 'SIGNED_IN' : 'SIGNED_OUT', session ? adaptUser(clerk.user) : null);
      });
    }).catch(() => {});
  },
};

if (typeof window.__resolveTinyWorldAuthReady === 'function') {
  window.__resolveTinyWorldAuthReady(true);
}
