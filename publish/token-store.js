// Where the publish page keeps the faculty member's GitHub token: for the
// browser session by default, or on the computer when they tick
// "Remember on this computer". Blocked storage never breaks the page.
const KEY = 'cbs-github-token';

export function createTokenStore({ session, local }) {
  const get = (store) => { try { return store.getItem(KEY); } catch { return null; } };
  const set = (store, value) => { try { store.setItem(KEY, value); } catch { /* blocked */ } };
  const drop = (store) => { try { store.removeItem(KEY); } catch { /* blocked */ } };
  return {
    save(token, remember) {
      drop(remember ? session : local);
      set(remember ? local : session, token);
    },
    load() {
      return get(local) || get(session) || null;
    },
    remembered() {
      return Boolean(get(local));
    },
    clear() {
      drop(local);
      drop(session);
    },
  };
}
