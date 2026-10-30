// Shared session + API helpers for the HopWire owner dashboard (login.html,
// signup.html, dashboard.html). Talks directly to the live HopWire_API on
// Railway — writes here land in the same MySQL database the app reads from.
const HW = (() => {
    const API_BASE = "https://vibrant-heart-production-45a3.up.railway.app";
    const STORAGE_KEY = "hw_owner_session";
    // Site-admin session (admin.html) — kept separate from the owner session
    // so acting as a brewery and switching to another never loses it.
    const ADMIN_STORAGE_KEY = "hw_admin_session";

    function getSession() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    function setSession(session) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    }

    function clearSession() {
        localStorage.removeItem(STORAGE_KEY);
    }

    function getAdminSession() {
        try {
            const raw = localStorage.getItem(ADMIN_STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    function setAdminSession(session) {
        localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(session));
    }

    function clearAdminSession() {
        localStorage.removeItem(ADMIN_STORAGE_KEY);
    }

    // Redirects to login if there's no session; returns the session otherwise.
    // Call at the top of any page that requires a logged-in brewery owner.
    function requireSession() {
        const session = getSession();
        if (!session || !session.token || !session.breweryId) {
            window.location.href = "login.html";
            return null;
        }
        return session;
    }

    async function apiFetch(path, options = {}) {
        const session = getSession();
        const headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
        if (session && session.token) headers["Authorization"] = `Bearer ${session.token}`;

        const res = await fetch(`${API_BASE}${path}`, Object.assign({}, options, { headers }));

        if (res.status === 401 || res.status === 403) {
            // Token missing/rejected — send the owner back to log in rather than
            // silently failing every subsequent call. An admin acting as a
            // brewery goes back to the admin console instead.
            clearSession();
            window.location.href = getAdminSession() ? "admin.html" : "login.html";
            throw new Error("Not authorized.");
        }

        return res;
    }

    // Same as apiJson, but authenticated with the admin console's token.
    async function adminJson(path, options = {}) {
        const admin = getAdminSession();
        const headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
        if (admin && admin.token) headers["Authorization"] = `Bearer ${admin.token}`;

        const res = await fetch(`${API_BASE}${path}`, Object.assign({}, options, { headers }));
        let body = null;
        try { body = await res.json(); } catch { /* no JSON body */ }

        if (res.status === 401 || res.status === 403) {
            clearAdminSession();
            window.location.href = "login.html";
            throw new Error("Not authorized.");
        }
        if (!res.ok) throw new Error((body && body.message) || `Request failed (${res.status}).`);
        return body;
    }

    async function apiJson(path, options = {}) {
        const res = await apiFetch(path, options);
        let body = null;
        try { body = await res.json(); } catch { /* no JSON body */ }
        if (!res.ok) {
            const message = (body && body.message) || `Request failed (${res.status}).`;
            throw new Error(message);
        }
        return body;
    }

    // Reads a <input type="file"> as a base64 string the API can deserialize
    // straight into a byte[] (System.Text.Json's default byte[] encoding).
    function fileToBase64(file) {
        return new Promise((resolve, reject) => {
            if (!file) { resolve(null); return; }
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(",")[1]);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    function showAlert(el, message, type = "error") {
        el.textContent = message;
        el.className = `alert ${type}`;
        el.style.display = "block";
    }

    function hideAlert(el) {
        el.style.display = "none";
    }

    return {
        API_BASE, getSession, setSession, clearSession, requireSession, apiFetch, apiJson,
        getAdminSession, setAdminSession, clearAdminSession, adminJson,
        fileToBase64, showAlert, hideAlert
    };
})();
