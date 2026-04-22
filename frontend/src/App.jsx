/**
 * Loafly — Frontend React (v4 — Flask API)
 *
 * Changement majeur vs v3 :
 *   window.storage  →  fetch() vers l'API Flask
 *
 * Architecture de la couche données :
 *
 *   ApiClient           — fetch wrapper : base URL, headers, gestion erreurs
 *   AppContext           — état global : productTypes, bakeries, adminPin, loading
 *   useAdminAuth()      — login/logout, changement PIN
 *   useProductTypes()   — CRUD produits via API
 *   useBakeries()       — CRUD boulangeries via API
 *   useRatings()        — soumission avis + agrégation locale pour affichage
 *   useRankings()       — classements depuis /api/rankings/*  ← nouveau hook
 *
 * Variable d'environnement :
 *   VITE_API_URL=http://localhost:5000/api
 */

import { useState, useEffect, useCallback, useContext, createContext, useRef } from "react";

// ─────────────────────────────────────────────────────────────────────────────
//  ApiClient  —  src/api/client.js
//  Un seul endroit pour tous les appels fetch. Jamais de fetch() en dehors.
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = (
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL) ||
  "http://localhost:5000/api"
).replace(/\/$/, "");

class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code   = code;
    this.status = status;
  }
}

async function apiFetch(path, options = {}, adminPassword = null, userToken = null) {
  const headers = {
    "Content-Type": "application/json",
    ...(adminPassword ? { "X-Admin-Password": adminPassword } : {}),
    ...(userToken    ? { "Authorization": `Bearer ${userToken}` } : {}),
    ...options.headers,
  };

  const res  = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(body.error ?? "Erreur réseau", body.code, res.status);
  }
  return body.data ?? body;
}

const ApiClient = {
  // ── Auth ──────────────────────────────────────────────────────────────────
  auth: {
    verify: (username, password) =>
      apiFetch("/auth/verify", { method: "POST", body: JSON.stringify({ username, password }) }),
    changePassword: (newPassword, adminPassword) =>
      apiFetch("/auth/password", { method: "PUT", body: JSON.stringify({ new_password: newPassword }) }, adminPassword),
  },

  // ── Product types ─────────────────────────────────────────────────────────
  productTypes: {
    list: () =>
      apiFetch("/product-types/"),
    create: (name, emoji, adminPin) =>
      apiFetch("/product-types/", { method: "POST", body: JSON.stringify({ name, emoji }) }, adminPin),
    remove: (id, adminPin) =>
      apiFetch(`/product-types/${id}`, { method: "DELETE" }, adminPin),
    addCriterion: (ptId, name, adminPin) =>
      apiFetch(`/product-types/${ptId}/criteria`, { method: "POST", body: JSON.stringify({ name }) }, adminPin),
    removeCriterion: (ptId, critId, adminPin) =>
      apiFetch(`/product-types/${ptId}/criteria/${critId}`, { method: "DELETE" }, adminPin),
  },

  // ── Bakeries ──────────────────────────────────────────────────────────────
  bakeries: {
    list: () =>
      apiFetch("/bakeries/"),
    get: (id) =>
      apiFetch(`/bakeries/${id}`),
    create: (payload, adminPin, userToken) =>
      apiFetch("/bakeries/", { method: "POST", body: JSON.stringify(payload) }, adminPin, userToken),
    update: (id, payload, adminPin) =>
      apiFetch(`/bakeries/${id}`, { method: "PUT", body: JSON.stringify(payload) }, adminPin),
    remove: (id, adminPin) =>
      apiFetch(`/bakeries/${id}`, { method: "DELETE" }, adminPin),
  },

  // ── Users ─────────────────────────────────────────────────────────────────
  users: {
    signup: (username, email, password) =>
      apiFetch("/users/signup", { method: "POST", body: JSON.stringify({ username, email, password }) }),
    login: (email, password) =>
      apiFetch("/users/login", { method: "POST", body: JSON.stringify({ email, password }) }),
    list: (adminPin) =>
      apiFetch("/users/", {}, adminPin),
    remove: (id, adminPin) =>
      apiFetch(`/users/${id}`, { method: "DELETE" }, adminPin),
  },

  // ── Photos ────────────────────────────────────────────────────────────────
  photos: {
    upload: async (file, userToken) => {
      const form = new FormData();
      form.append("photo", file);
      const res  = await fetch(`${API_BASE}/photos/upload`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${userToken}` },
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(body.error ?? "Erreur upload", body.code, res.status);
      return body.data ?? body;
    },
  },

  // ── Ratings ───────────────────────────────────────────────────────────────
  ratings: {
    submit: (payload, userToken) =>
      apiFetch("/ratings/", { method: "POST", body: JSON.stringify(payload) }, null, userToken),
    list: (adminPin) =>
      apiFetch("/ratings/", {}, adminPin),
    remove: (id, adminPin) =>
      apiFetch(`/ratings/${id}`, { method: "DELETE" }, adminPin),
  },

  // ── Rankings ──────────────────────────────────────────────────────────────
  rankings: {
    byProduct: (productTypeId) =>
      apiFetch(`/rankings/product/${productTypeId}`),
    overall: () =>
      apiFetch("/rankings/overall"),
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  Geocoding  —  Nominatim (OpenStreetMap, gratuit, sans clé)
// ─────────────────────────────────────────────────────────────────────────────

async function geocodeAddress(address) {
  if (!address?.trim()) return null;
  try {
    const q   = encodeURIComponent(`${address.trim()}, Montréal, Canada`);
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`);
    const data = await res.json();
    if (data.length > 0) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {}
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  AppContext  —  store/AppContext.jsx
//  État global minimal : listes + adminPin (session-only)
// ─────────────────────────────────────────────────────────────────────────────

const AppContext = createContext(null);

function AppProvider({ children }) {
  const [productTypes, setProductTypes] = useState([]);
  const [bakeries,     setBakeries]     = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [adminPin,     setAdminPin]     = useState(null);
  const [user,         setUserState]    = useState(() => {
    try { return JSON.parse(localStorage.getItem("loafly_user")); } catch { return null; }
  });
  const [toast,        setToast]        = useState(null);
  const [confirm,      setConfirm]      = useState(null);

  const setUser = useCallback((u) => {
    setUserState(u);
    if (u) localStorage.setItem("loafly_user", JSON.stringify(u));
    else   localStorage.removeItem("loafly_user");
  }, []);

  // Chargement initial des données de référence
  const fetchBaseData = useCallback(async () => {
    try {
      const [pts, baks] = await Promise.all([
        ApiClient.productTypes.list(),
        ApiClient.bakeries.list(),
      ]);
      setProductTypes(Array.isArray(pts) ? pts : []);
      setBakeries(Array.isArray(baks) ? baks : []);
    } catch (e) {
      console.error("[AppContext] fetchBaseData error:", e);
    }
  }, []);

  useEffect(() => {
    fetchBaseData().finally(() => setLoading(false));
  }, [fetchBaseData]);

  const refresh = useCallback(() => fetchBaseData(), [fetchBaseData]);

  const notify = useCallback((msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const requestConfirm = useCallback((message, onConfirm) =>
    setConfirm({ message, onConfirm }), []);

  const dismissConfirm = useCallback(() => setConfirm(null), []);

  const isAdmin = adminPin !== null;

  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const fn = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  const isMobile = windowWidth < 768;

  const value = {
    productTypes, bakeries, loading,
    adminPin, isAdmin, setAdminPin,
    user, setUser, isMobile,
    refresh, notify, requestConfirm,
  };

  return (
    <AppContext.Provider value={value}>
      {children}
      {toast   && <Toast {...toast} />}
      {confirm && (
        <ConfirmDialog
          message={confirm.message}
          onConfirm={() => { confirm.onConfirm(); dismissConfirm(); }}
          onCancel={dismissConfirm}
        />
      )}
    </AppContext.Provider>
  );
}

const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp doit être dans <AppProvider>");
  return ctx;
};

// ─────────────────────────────────────────────────────────────────────────────
//  hooks/useAdminAuth.js
// ─────────────────────────────────────────────────────────────────────────────

function useAdminAuth() {
  const { adminPin, isAdmin, setAdminPin, notify } = useApp();

  const login = useCallback(async (username, password) => {
    try {
      const res = await ApiClient.auth.verify(username, password);
      if (res.valid) { setAdminPin(password); return true; }
      notify("Identifiants incorrects", "error");
      return false;
    } catch (e) {
      notify(e.message, "error");
      return false;
    }
  }, [setAdminPin, notify]);

  const logout = useCallback(() => setAdminPin(null), [setAdminPin]);

  const changePassword = useCallback(async (newPassword) => {
    if (!adminPin) { notify("Non connecté", "error"); return false; }
    try {
      await ApiClient.auth.changePassword(newPassword, adminPin);
      notify("Mot de passe modifié !");
      setAdminPin(newPassword);
      return true;
    } catch (e) {
      notify(e.message, "error");
      return false;
    }
  }, [adminPin, setAdminPin, notify]);

  return { isAdmin, login, logout, changePassword };
}

// ─────────────────────────────────────────────────────────────────────────────
//  hooks/useUserAuth.js
// ─────────────────────────────────────────────────────────────────────────────

function useUserAuth() {
  const { user, setUser, notify } = useApp();

  const signup = useCallback(async (username, email, password) => {
    try {
      const res = await ApiClient.users.signup(username, email, password);
      setUser({ token: res.token, username: res.username });
      notify(`Bienvenue, ${res.username} !`);
      return true;
    } catch (e) { notify(e.message, "error"); return false; }
  }, [setUser, notify]);

  const login = useCallback(async (email, password) => {
    try {
      const res = await ApiClient.users.login(email, password);
      setUser({ token: res.token, username: res.username });
      notify(`Bon retour, ${res.username} !`);
      return true;
    } catch (e) { notify(e.message, "error"); return false; }
  }, [setUser, notify]);

  const logout = useCallback(() => { setUser(null); notify("Déconnecté"); }, [setUser, notify]);

  return { user, signup, login, logout };
}

// ─────────────────────────────────────────────────────────────────────────────
//  hooks/useProductTypes.js
// ─────────────────────────────────────────────────────────────────────────────

function useProductTypes() {
  const { productTypes, adminPin, isAdmin, refresh, notify, requestConfirm } = useApp();

  const guard = (fn) => async (...args) => {
    if (!isAdmin) { notify("Action réservée à l'admin", "error"); return null; }
    return fn(...args);
  };

  const addProductType = guard(async (name, emoji) => {
    try {
      const pt = await ApiClient.productTypes.create(name, emoji, adminPin);
      await refresh();
      notify("Produit créé !");
      return pt;
    } catch (e) { notify(e.message, "error"); return null; }
  });

  const removeProductType = guard((ptId) => {
    requestConfirm("Supprimer ce produit et tous ses avis ?", async () => {
      try {
        await ApiClient.productTypes.remove(ptId, adminPin);
        await refresh();
        notify("Produit supprimé");
      } catch (e) { notify(e.message, "error"); }
    });
  });

  const addCriterion = guard(async (ptId, name) => {
    try {
      await ApiClient.productTypes.addCriterion(ptId, name, adminPin);
      await refresh();
      notify("Critère ajouté !");
    } catch (e) { notify(e.message, "error"); }
  });

  const removeCriterion = guard((ptId, critId, critName) => {
    requestConfirm(
      `Supprimer le critère "${critName}" ? Les avis existants ne seront pas affectés.`,
      async () => {
        try {
          await ApiClient.productTypes.removeCriterion(ptId, critId, adminPin);
          await refresh();
          notify("Critère supprimé");
        } catch (e) { notify(e.message, "error"); }
      }
    );
  });

  return { productTypes, addProductType, removeProductType, addCriterion, removeCriterion };
}

// ─────────────────────────────────────────────────────────────────────────────
//  hooks/useBakeries.js
// ─────────────────────────────────────────────────────────────────────────────

function useBakeries() {
  const { bakeries, adminPin, isAdmin, user, refresh, notify, requestConfirm } = useApp();

  const addBakery = useCallback(async (payload) => {
    if (!isAdmin && !user) { notify("Connectez-vous pour ajouter une boulangerie", "error"); return null; }
    const coords = payload.address ? (await geocodeAddress(payload.address)) ?? {} : {};
    try {
      const b = await ApiClient.bakeries.create({ ...payload, ...coords }, isAdmin ? adminPin : null, user?.token);
      await refresh();
      notify("Boulangerie ajoutée !");
      return b;
    } catch (e) { notify(e.message, "error"); return null; }
  }, [adminPin, isAdmin, user, refresh, notify]);

  const updateBakery = useCallback(async (bakeryId, payload) => {
    if (!isAdmin) { notify("Action réservée à l'admin", "error"); return null; }
    const coords = payload.address ? (await geocodeAddress(payload.address)) ?? {} : {};
    try {
      const b = await ApiClient.bakeries.update(bakeryId, { ...payload, ...coords }, adminPin);
      await refresh();
      notify("Boulangerie mise à jour !");
      return b;
    } catch (e) { notify(e.message, "error"); return null; }
  }, [adminPin, isAdmin, refresh, notify]);

  const removeBakery = useCallback((bakeryId) => {
    if (!isAdmin) { notify("Action réservée à l'admin", "error"); return; }
    requestConfirm("Supprimer cette boulangerie et tous ses avis ?", async () => {
      try {
        await ApiClient.bakeries.remove(bakeryId, adminPin);
        await refresh();
        notify("Boulangerie supprimée");
      } catch (e) { notify(e.message, "error"); }
    });
  }, [adminPin, isAdmin, refresh, notify, requestConfirm]);

  return { bakeries, addBakery, updateBakery, removeBakery };
}

// ─────────────────────────────────────────────────────────────────────────────
//  hooks/useRatings.js
// ─────────────────────────────────────────────────────────────────────────────

function useRatings() {
  const { notify, user } = useApp();

  const submitRating = useCallback(async (payload, photoFile) => {
    if (!user) { notify("Connectez-vous pour laisser un avis", "error"); return false; }
    let photo_url = null;
    if (photoFile) {
      try {
        const res = await ApiClient.photos.upload(photoFile, user.token);
        photo_url = res.url;
      } catch {
        notify("Photo non uploadée, on continue sans", "error");
      }
    }
    try {
      await ApiClient.ratings.submit({ ...payload, photo_url }, user.token);
      notify("Avis enregistré, merci !");
      return true;
    } catch (e) {
      notify(e.message, "error");
      return false;
    }
  }, [notify, user]);

  return { submitRating };
}

// ─────────────────────────────────────────────────────────────────────────────
//  hooks/useRankings.js   ← nouveau : données viennent de l'API, pas local
// ─────────────────────────────────────────────────────────────────────────────

function useRankings() {
  const [productRanking, setProductRanking] = useState([]);
  const [overallRanking, setOverallRanking] = useState([]);
  const [loadingProduct, setLoadingProduct] = useState(false);
  const [loadingOverall, setLoadingOverall] = useState(false);
  const { notify } = useApp();

  const fetchProductRanking = useCallback(async (productTypeId) => {
    if (!productTypeId) return;
    setLoadingProduct(true);
    try {
      const data = await ApiClient.rankings.byProduct(productTypeId);
      setProductRanking(Array.isArray(data) ? data : []);
    } catch (e) {
      notify(e.message, "error");
      setProductRanking([]);
    } finally {
      setLoadingProduct(false);
    }
  }, [notify]);

  const fetchOverallRanking = useCallback(async () => {
    setLoadingOverall(true);
    try {
      const data = await ApiClient.rankings.overall();
      setOverallRanking(Array.isArray(data) ? data : []);
    } catch (e) {
      notify(e.message, "error");
      setOverallRanking([]);
    } finally {
      setLoadingOverall(false);
    }
  }, [notify]);

  return {
    productRanking, overallRanking,
    loadingProduct, loadingOverall,
    fetchProductRanking, fetchOverallRanking,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Design tokens + styles
// ─────────────────────────────────────────────────────────────────────────────

const T = {
  bg: "#FAF3E4", dark: "#2C1810", gold: "#C8912A",
  muted: "#8B6550", border: "#E8D5B5", danger: "#8B2E1C", success: "#2C6E2C",
};

const css = {
  input:    { width: "100%", padding: "10px 14px", border: `1.5px solid ${T.border}`, borderRadius: 8, fontSize: 15, background: "white", color: T.dark, fontFamily: "inherit" },
  btnDark:  { background: T.dark,  color: "#FAF3E4", border: "none", padding: "10px 20px", borderRadius: 8, fontSize: 14, cursor: "pointer", fontFamily: "inherit" },
  btnGold:  { background: T.gold,  color: "white",   border: "none", padding: "12px 24px", borderRadius: 8, fontSize: 15, cursor: "pointer", width: "100%", fontFamily: "inherit" },
  btnGhost: { background: "none",  border: `1px solid ${T.border}`, color: T.danger, padding: "10px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontFamily: "inherit" },
  btnSm:    { background: `${T.gold}22`, color: T.gold, border: `1px solid ${T.gold}55`, padding: "7px 14px", borderRadius: 6, fontSize: 13, cursor: "pointer", fontFamily: "inherit" },
};

const MONTREAL_NEIGHBORHOODS = [
  "Ahuntsic", "Anjou", "Cartierville", "Côte-des-Neiges", "Griffintown",
  "Hochelaga-Maisonneuve", "Lachine", "LaSalle", "Maisonneuve", "Mercier",
  "Mile End", "Mile-Ex", "Montréal-Nord", "Notre-Dame-de-Grâce", "Outremont",
  "Parc-Extension", "Petite-Patrie", "Plateau-Mont-Royal", "Pointe-Saint-Charles",
  "Rivière-des-Prairies", "Rosemont", "Saint-Laurent", "Saint-Léonard",
  "Saint-Michel", "Sud-Ouest", "Verdun", "Vieux-Montréal", "Ville-Marie",
  "Villeray", "Westmount",
].sort();

// ─────────────────────────────────────────────────────────────────────────────
//  UI components (inchangés vs v3 — purement présentationnels)
// ─────────────────────────────────────────────────────────────────────────────

function Stars({ value = 0, onChange, size = 22, readOnly = false }) {
  const [hover, setHover] = useState(0);
  const labels = ["", "Très mauvais", "Mauvais", "Correct", "Bon", "Excellent"];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ display: "flex", gap: 3 }}>
        {[1,2,3,4,5].map((n) => (
          <span key={n} onMouseEnter={() => !readOnly && setHover(n)} onMouseLeave={() => !readOnly && setHover(0)}
            onClick={() => !readOnly && onChange?.(n)} title={labels[n]}
            style={{ fontSize: size, cursor: readOnly ? "default" : "pointer", color: n <= (hover || value) ? T.gold : T.border, transition: "color 0.1s", lineHeight: 1, userSelect: "none" }}>★</span>
        ))}
      </div>
      {!readOnly && (hover || value) > 0 && (
        <span style={{ fontSize: 12, color: T.muted, fontStyle: "italic" }}>{labels[hover || value]}</span>
      )}
    </div>
  );
}

function Modal({ title, onClose, children, maxWidth = 460 }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(28,15,7,0.55)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "60px 16px 40px" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: T.bg, borderRadius: 16, padding: 32, width: "100%", maxWidth, boxShadow: "0 8px 40px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h3 style={{ fontFamily: '"Playfair Display", serif', fontSize: 20, color: T.dark }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 26, color: T.muted, cursor: "pointer", lineHeight: 1, padding: 0 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(28,15,7,0.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: T.bg, borderRadius: 14, padding: 28, maxWidth: 380, width: "100%", boxShadow: "0 8px 40px rgba(0,0,0,0.3)" }}>
        <p style={{ fontSize: 16, color: T.dark, marginBottom: 24, lineHeight: 1.5 }}>{message}</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onCancel}  style={{ ...css.btnDark, background: "none", border: `1px solid ${T.border}`, color: T.muted }}>Annuler</button>
          <button onClick={onConfirm} style={{ ...css.btnDark, background: T.danger }}>Confirmer</button>
        </div>
      </div>
    </div>
  );
}

function Toast({ msg, type }) {
  return (
    <div style={{ position: "fixed", top: 76, right: 20, zIndex: 400, background: type === "success" ? T.success : T.danger, color: "#FAF3E4", padding: "12px 20px", borderRadius: 10, fontSize: 14, boxShadow: "0 4px 20px rgba(0,0,0,0.25)" }}>
      {msg}
    </div>
  );
}

function Field({ label, children, style }) {
  return (
    <div style={{ marginBottom: 16, ...style }}>
      <label style={{ display: "block", fontSize: 12, color: T.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</label>
      {children}
    </div>
  );
}

function EmptyState({ emoji = "🥐", text }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 20px", color: T.muted }}>
      <div style={{ fontSize: 44, marginBottom: 14 }}>{emoji}</div>
      <p style={{ fontStyle: "italic", fontSize: 15 }}>{text}</p>
    </div>
  );
}

function ScoreBar({ label, score }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 13, color: "#4A3020" }}>{label}</span>
        <span style={{ fontSize: 12, color: T.gold, fontWeight: 600 }}>{Number(score).toFixed(1)}/5</span>
      </div>
      <div style={{ background: "#F0E8D5", borderRadius: 99, height: 6, overflow: "hidden" }}>
        <div style={{ width: `${score * 20}%`, height: "100%", background: `linear-gradient(90deg, ${T.gold}, #E8B84B)`, borderRadius: 99, transition: "width 0.4s ease" }} />
      </div>
    </div>
  );
}

function Spinner() {
  return <div style={{ textAlign: "center", padding: 40, color: T.muted, fontStyle: "italic" }}>Chargement…</div>;
}


function AdminGate({ children }) {
  const { isAdmin }              = useApp();
  const { login }                = useAdminAuth();
  const [username, setUsername]  = useState("loafadmin");
  const [password, setPassword]  = useState("");

  if (isAdmin) return children;

  return (
    <div style={{ maxWidth: 360, margin: "80px auto", textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
      <h2 style={{ fontFamily: '"Playfair Display", serif', fontSize: 22, color: T.dark, marginBottom: 8 }}>Accès administrateur</h2>
      <p style={{ color: T.muted, fontSize: 14, marginBottom: 28, fontStyle: "italic" }}>Connectez-vous pour accéder à l'espace admin.</p>
      <Field label="Nom d'utilisateur">
        <input value={username} onChange={(e) => setUsername(e.target.value)} style={css.input} />
      </Field>
      <Field label="Mot de passe">
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") login(username, password).then(ok => { if (ok) setPassword(""); }); }}
          placeholder="••••••••" style={css.input} />
      </Field>
      <button onClick={async () => { const ok = await login(username, password); if (ok) setPassword(""); }}
        style={{ ...css.btnGold, marginTop: 8 }}>Se connecter</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  views/RankingsView
// ─────────────────────────────────────────────────────────────────────────────

function AddRatingModal({ bakery, productTypes, defaultPtId, onClose, onSave }) {
  const [ptId,       setPtId]       = useState(defaultPtId ?? productTypes[0]?.id ?? "");
  const [scores,     setScores]     = useState({});
  const [note,       setNote]       = useState("");
  const [authorName, setAuthorName] = useState("");
  const [photoFile,  setPhotoFile]  = useState(null);
  const [preview,    setPreview]    = useState(null);
  const pt = productTypes.find((p) => p.id === ptId);

  const handlePhoto = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setPhotoFile(f);
    setPreview(URL.createObjectURL(f));
  };

  return (
    <Modal title={`Donner mon avis — ${bakery.name}`} onClose={onClose} maxWidth={480}>
      <Field label="Prénom / pseudo"><input value={authorName} onChange={(e) => setAuthorName(e.target.value)} placeholder="Ex : Marie" style={css.input} /></Field>
      <Field label="Produit">
        <select value={ptId} onChange={(e) => { setPtId(e.target.value); setScores({}); }} style={css.input}>
          {productTypes.map((p) => <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>)}
        </select>
      </Field>
      {pt?.criteria.map((c) => (
        <Field key={c.id} label={c.name}>
          <Stars value={scores[c.name] ?? 0} onChange={(v) => setScores((s) => ({ ...s, [c.name]: v }))} />
        </Field>
      ))}
      <Field label="Commentaire (optionnel)">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Un mot sur votre dégustation…" style={{ ...css.input, resize: "vertical", minHeight: 72 }} />
      </Field>
      <Field label="Photo (optionnel)">
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhoto}
          style={{ fontSize: 13, color: T.muted }} />
        {preview && <img src={preview} alt="preview" style={{ marginTop: 8, width: "100%", maxHeight: 160, objectFit: "cover", borderRadius: 8 }} />}
      </Field>
      <button onClick={() => onSave({ product_type_id: ptId, scores, note, author_name: authorName }, photoFile)}
        style={{ ...css.btnGold, marginTop: 4 }}>Envoyer mon avis</button>
    </Modal>
  );
}

function ProductRankingView() {
  const { productTypes }                                          = useApp();
  const { submitRating }                                          = useRatings();
  const { productRanking, loadingProduct, fetchProductRanking }   = useRankings();
  const [ptId, setPtId]         = useState(() => productTypes[0]?.id ?? null);
  const [ratingTarget, setRatingTarget] = useState(null);
  const medals = ["🥇", "🥈", "🥉"];

  useEffect(() => {
    if (ptId) fetchProductRanking(ptId);
  }, [ptId]);

  const handleSave = async (payload, photoFile) => {
    const ok = await submitRating({ bakery_id: ratingTarget.id, ...payload }, photoFile);
    if (ok) { setRatingTarget(null); fetchProductRanking(ptId); }
  };

  const pt = productTypes.find((p) => p.id === ptId);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 28 }}>
        {productTypes.map((p) => (
          <button key={p.id} onClick={() => setPtId(p.id)}
            style={{ padding: "9px 18px", border: `2px solid ${ptId === p.id ? T.gold : T.border}`, background: ptId === p.id ? T.gold : "white", color: ptId === p.id ? "white" : T.muted, borderRadius: 30, fontSize: 14, cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s" }}>
            {p.emoji} {p.name}
          </button>
        ))}
      </div>

      {loadingProduct ? <Spinner /> : productRanking.length === 0 ? (
        <EmptyState text={pt ? `Aucun avis pour « ${pt.name} » encore.` : "Sélectionnez un produit."} />
      ) : (
        <>
          {productRanking.length >= 2 && (
            <div style={{ background: `linear-gradient(135deg, ${T.dark}, #4A2A18)`, border: `2px solid ${T.gold}`, color: "#FAF3E4", padding: "18px 24px", borderRadius: 14, marginBottom: 24, display: "flex", alignItems: "center", gap: 18 }}>
              <span style={{ fontSize: 36 }}>🏆</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: T.gold, textTransform: "uppercase", letterSpacing: "0.12em" }}>Meilleure {pt?.name} de Montréal</div>
                <div style={{ fontFamily: '"Playfair Display", serif', fontSize: 22, fontWeight: 700, marginTop: 2 }}>{productRanking[0].bakery.name}</div>
                <div style={{ fontSize: 13, color: "#FAF3E4AA", marginTop: 2 }}>
                  {productRanking[0].overall_average.toFixed(2)} / 5 · {productRanking[0].rating_count} avis · {productRanking[0].bakery.neighborhood || "Montréal"}
                </div>
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))", gap: 20 }}>
            {productRanking.map(({ bakery, aggregated_scores, overall_average, rating_count }, i) => (
              <div key={bakery.id} style={{ background: "white", borderRadius: 16, overflow: "hidden", border: `2px solid ${i === 0 ? T.gold : T.border}`, boxShadow: i === 0 ? `0 4px 20px ${T.gold}33` : "0 2px 10px rgba(0,0,0,0.06)" }}>
                <div style={{ background: T.dark, padding: "16px 20px", color: "#FAF3E4" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 20, marginBottom: 2 }}>{medals[i] ?? `#${i + 1}`}</div>
                      <div style={{ fontFamily: '"Playfair Display", serif', fontSize: 17, fontWeight: 700 }}>{bakery.name}</div>
                      {bakery.neighborhood && <div style={{ fontSize: 12, color: "#FAF3E480", marginTop: 2 }}>{bakery.neighborhood}</div>}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 30, fontWeight: 700, color: T.gold, lineHeight: 1 }}>{overall_average.toFixed(1)}</div>
                      <div style={{ fontSize: 11, color: "#FAF3E455" }}>{rating_count} avis</div>
                    </div>
                  </div>
                </div>
                <div style={{ padding: "16px 20px" }}>
                  {pt?.criteria.map((c) => <ScoreBar key={c.id} label={c.name} score={aggregated_scores[c.name] ?? 0} />)}
                  <button onClick={() => setRatingTarget(bakery)} style={{ ...css.btnSm, marginTop: 14, width: "100%" }}>★ Donner mon avis</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {ratingTarget && (
        <AddRatingModal bakery={ratingTarget} productTypes={productTypes} defaultPtId={ptId} onClose={() => setRatingTarget(null)} onSave={handleSave} />
      )}
    </div>
  );
}

function OverallRankingView() {
  const { productTypes }                                      = useApp();
  const { submitRating }                                      = useRatings();
  const { overallRanking, loadingOverall, fetchOverallRanking } = useRankings();
  const [ratingTarget, setRatingTarget] = useState(null);
  const medals = ["🥇", "🥈", "🥉"];

  useEffect(() => { fetchOverallRanking(); }, []);

  const handleSave = async (payload, photoFile) => {
    const ok = await submitRating({ bakery_id: ratingTarget.id, ...payload }, photoFile);
    if (ok) { setRatingTarget(null); fetchOverallRanking(); }
  };

  if (loadingOverall) return <Spinner />;
  if (overallRanking.length === 0) return <EmptyState emoji="🏅" text="Pas encore assez d'avis pour un classement général." />;

  return (
    <div>
      {overallRanking.length >= 2 && (
        <div style={{ background: `linear-gradient(135deg, ${T.dark}, #4A2A18)`, border: `2px solid ${T.gold}`, color: "#FAF3E4", padding: "20px 28px", borderRadius: 14, marginBottom: 28 }}>
          <div style={{ fontSize: 11, color: T.gold, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 12 }}>🏆 Meilleure boulangerie de Montréal</div>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            {overallRanking.slice(0, 3).map(({ bakery, overall_average, product_count, total_ratings }, i) => (
              <div key={bakery.id} style={{ flex: i === 0 ? "1 1 auto" : "0 1 auto" }}>
                <div style={{ fontSize: i === 0 ? 28 : 20, marginBottom: 2 }}>{medals[i]}</div>
                <div style={{ fontFamily: '"Playfair Display", serif', fontSize: i === 0 ? 22 : 17, fontWeight: 700 }}>{bakery.name}</div>
                <div style={{ fontSize: 13, color: "#FAF3E4BB", marginTop: 2 }}>{overall_average.toFixed(2)} / 5 · {product_count} produit{product_count > 1 ? "s" : ""} · {total_ratings} avis</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {overallRanking.map(({ bakery, overall_average, total_ratings, product_averages }, i) => (
          <div key={bakery.id} style={{ background: "white", borderRadius: 14, padding: "18px 22px", border: `2px solid ${i === 0 ? T.gold : T.border}`, display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ fontSize: 24, minWidth: 36, textAlign: "center" }}>{medals[i] ?? `#${i + 1}`}</div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontFamily: '"Playfair Display", serif', fontSize: 18, color: T.dark }}>{bakery.name}</span>
                {bakery.neighborhood && <span style={{ fontSize: 13, color: T.muted }}>{bakery.neighborhood}</span>}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                {product_averages.map(({ product_type, average, rating_count }) => (
                  <div key={product_type.id} style={{ display: "flex", alignItems: "center", gap: 5, background: T.bg, padding: "4px 10px", borderRadius: 20, fontSize: 13 }}>
                    <span>{product_type.emoji}</span>
                    <span style={{ color: T.dark }}>{product_type.name}</span>
                    <span style={{ color: T.gold, fontWeight: 600 }}>{average.toFixed(1)}</span>
                    <span style={{ color: T.muted, fontSize: 11 }}>({rating_count})</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ textAlign: "right", minWidth: 80 }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: T.gold, lineHeight: 1 }}>{overall_average.toFixed(1)}</div>
              <div style={{ fontSize: 11, color: T.muted }}>{total_ratings} avis</div>
              <button onClick={() => setRatingTarget(bakery)} style={{ ...css.btnSm, marginTop: 8 }}>★ Évaluer</button>
            </div>
          </div>
        ))}
      </div>

      {ratingTarget && (
        <AddRatingModal bakery={ratingTarget} productTypes={productTypes} onClose={() => setRatingTarget(null)} onSave={handleSave} />
      )}
    </div>
  );
}

function RankingsView() {
  const [sub, setSub] = useState("product");
  const SUB = [["product", "🥖 Par produit"], ["overall", "🏅 Classement général"]];
  return (
    <div>
      <div style={{ display: "flex", gap: 4, background: "white", border: `1px solid ${T.border}`, borderRadius: 10, padding: 4, marginBottom: 28, width: "fit-content" }}>
        {SUB.map(([id, label]) => (
          <button key={id} onClick={() => setSub(id)} style={{ padding: "8px 20px", border: "none", borderRadius: 7, background: sub === id ? T.dark : "transparent", color: sub === id ? "#FAF3E4" : T.muted, fontSize: 14, cursor: "pointer", fontFamily: "inherit", transition: "all 0.18s" }}>{label}</button>
        ))}
      </div>
      {sub === "product" && <ProductRankingView />}
      {sub === "overall" && <OverallRankingView />}
    </div>
  );
}

function AddBakeryModal({ onClose, onSave }) {
  const [f, setF]     = useState({ name: "", neighborhood: "", address: "" });
  const [errors, setErrors] = useState({});
  const set = (k) => (e) => { setF((p) => ({ ...p, [k]: e.target.value })); setErrors((p) => ({ ...p, [k]: false })); };

  const handleSubmit = () => {
    const errs = {};
    if (!f.name.trim())         errs.name         = true;
    if (!f.neighborhood.trim()) errs.neighborhood  = true;
    if (!f.address.trim())      errs.address       = true;
    if (Object.keys(errs).length) { setErrors(errs); return; }
    onSave(f);
  };

  const inputStyle = (k) => ({ ...css.input, borderColor: errors[k] ? T.danger : undefined });

  return (
    <Modal title="Ajouter une boulangerie" onClose={onClose}>
      <Field label="Nom *">
        <input value={f.name} onChange={set("name")} placeholder="Ex : Première Moisson" style={inputStyle("name")} />
        {errors.name && <p style={{ color: T.danger, fontSize: 12, marginTop: 4 }}>Champ requis</p>}
      </Field>
      <Field label="Quartier *">
        <select value={f.neighborhood} onChange={set("neighborhood")} style={inputStyle("neighborhood")}>
          <option value="">— Choisir un quartier —</option>
          {MONTREAL_NEIGHBORHOODS.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {errors.neighborhood && <p style={{ color: T.danger, fontSize: 12, marginTop: 4 }}>Champ requis</p>}
      </Field>
      <Field label="Adresse *">
        <input value={f.address} onChange={set("address")} placeholder="Ex : 1234 rue Saint-Denis" style={inputStyle("address")} />
        {errors.address && <p style={{ color: T.danger, fontSize: 12, marginTop: 4 }}>Champ requis</p>}
      </Field>
      <p style={{ fontSize: 12, color: T.muted, fontStyle: "italic", marginBottom: 12 }}>📍 L'adresse sera géolocalisée automatiquement pour la carte.</p>
      <button onClick={handleSubmit} style={{ ...css.btnGold, marginTop: 4 }}>Ajouter</button>
    </Modal>
  );
}

function EditBakeryModal({ bakery, onClose, onSave }) {
  const [f, setF]       = useState({ name: bakery.name, neighborhood: bakery.neighborhood ?? "", address: bakery.address ?? "" });
  const [errors, setErrors] = useState({});
  const set = (k) => (e) => { setF((p) => ({ ...p, [k]: e.target.value })); setErrors((p) => ({ ...p, [k]: false })); };

  const handleSubmit = () => {
    const errs = {};
    if (!f.name.trim())         errs.name         = true;
    if (!f.neighborhood.trim()) errs.neighborhood  = true;
    if (!f.address.trim())      errs.address       = true;
    if (Object.keys(errs).length) { setErrors(errs); return; }
    onSave(f);
  };

  const inputStyle = (k) => ({ ...css.input, borderColor: errors[k] ? T.danger : undefined });

  return (
    <Modal title={`Modifier — ${bakery.name}`} onClose={onClose}>
      <Field label="Nom *">
        <input value={f.name} onChange={set("name")} style={inputStyle("name")} />
        {errors.name && <p style={{ color: T.danger, fontSize: 12, marginTop: 4 }}>Champ requis</p>}
      </Field>
      <Field label="Quartier *">
        <select value={f.neighborhood} onChange={set("neighborhood")} style={inputStyle("neighborhood")}>
          <option value="">— Choisir un quartier —</option>
          {MONTREAL_NEIGHBORHOODS.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {errors.neighborhood && <p style={{ color: T.danger, fontSize: 12, marginTop: 4 }}>Champ requis</p>}
      </Field>
      <Field label="Adresse *">
        <input value={f.address} onChange={set("address")} placeholder="Ex : 1234 rue Saint-Denis" style={inputStyle("address")} />
        {errors.address && <p style={{ color: T.danger, fontSize: 12, marginTop: 4 }}>Champ requis</p>}
      </Field>
      <p style={{ fontSize: 12, color: T.muted, fontStyle: "italic", marginBottom: 12 }}>📍 L'adresse sera regéolocalisée automatiquement.</p>
      <button onClick={handleSubmit} style={{ ...css.btnGold, marginTop: 4 }}>Enregistrer</button>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  views/BakeriesView
// ─────────────────────────────────────────────────────────────────────────────

function BakeriesView() {
  const { productTypes, isAdmin, user }                       = useApp();
  const { bakeries, addBakery, updateBakery, removeBakery }   = useBakeries();
  const canAddBakery = isAdmin || !!user;
  const { submitRating }                                      = useRatings();

  const [selectedId,    setSelectedId]    = useState(null);
  const [bakeryDetail,  setBakeryDetail]  = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showAddBakery, setShowAddBakery] = useState(false);
  const [showEditBakery, setShowEditBakery] = useState(false);
  const [showAddRating, setShowAddRating] = useState(false);
  const [filterNeighborhood, setFilterNeighborhood] = useState("");

  const selected = bakeries.find((b) => b.id === selectedId);
  const filtered = filterNeighborhood
    ? bakeries.filter((b) => b.neighborhood?.toLowerCase().includes(filterNeighborhood.toLowerCase()))
    : bakeries;

  useEffect(() => {
    if (!selectedId) { setBakeryDetail(null); return; }
    setLoadingDetail(true);
    ApiClient.bakeries.get(selectedId)
      .then(setBakeryDetail)
      .catch(() => setBakeryDetail(null))
      .finally(() => setLoadingDetail(false));
  }, [selectedId]);

  const handleAddBakery = async (payload) => {
    const created = await addBakery(payload);
    if (created) { setSelectedId(created.id); setShowAddBakery(false); }
  };

  const handleEditBakery = async (payload) => {
    const updated = await updateBakery(selectedId, payload);
    if (updated) {
      setShowEditBakery(false);
      const detail = await ApiClient.bakeries.get(selectedId);
      setBakeryDetail(detail);
    }
  };

  const handleAddRating = async (payload, photoFile) => {
    const ok = await submitRating({ bakery_id: selectedId, ...payload }, photoFile);
    if (ok) {
      setShowAddRating(false);
      const detail = await ApiClient.bakeries.get(selectedId);
      setBakeryDetail(detail);
    }
  };

  const handleDelete = () => {
    removeBakery(selectedId);
    setSelectedId(null);
    setBakeryDetail(null);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 28, alignItems: "start" }}>
      {/* ── Colonne gauche : filtre + liste ── */}
      <div>
        {canAddBakery && (
          <button onClick={() => setShowAddBakery(true)} style={{ ...css.btnDark, width: "100%", marginBottom: 12 }}>
            + Ajouter une boulangerie
          </button>
        )}

        <select
          value={filterNeighborhood}
          onChange={(e) => { setFilterNeighborhood(e.target.value); setSelectedId(null); }}
          style={{ ...css.input, marginBottom: 14, fontSize: 13 }}
        >
          <option value="">Tous les quartiers</option>
          {MONTREAL_NEIGHBORHOODS.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>

        {filtered.length === 0 && (
          <p style={{ color: T.muted, fontStyle: "italic", fontSize: 14 }}>
            {filterNeighborhood ? `Aucune boulangerie à ${filterNeighborhood}.` : "Aucune boulangerie."}
          </p>
        )}
        {filtered.map((b) => (
          <div key={b.id} onClick={() => setSelectedId(b.id)}
            style={{ padding: "12px 16px", marginBottom: 8, borderRadius: 10, cursor: "pointer", background: selectedId === b.id ? T.dark : "white", color: selectedId === b.id ? "#FAF3E4" : T.dark, border: `2px solid ${selectedId === b.id ? T.gold : T.border}`, transition: "all 0.2s" }}>
            <div style={{ fontFamily: '"Playfair Display", serif', fontWeight: 600, fontSize: 15 }}>{b.name}</div>
            {b.neighborhood && <div style={{ fontSize: 12, opacity: 0.65, marginTop: 2 }}>{b.neighborhood}</div>}
            <div style={{ fontSize: 12, opacity: 0.55, marginTop: 4 }}>{b.rating_count ?? 0} avis</div>
          </div>
        ))}
      </div>

      {/* ── Colonne droite : détail ── */}
      <div>
        {!selected ? <EmptyState emoji="🏪" text="Sélectionnez une boulangerie" /> : loadingDetail ? <Spinner /> : bakeryDetail && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
              <div>
                <h2 style={{ fontFamily: '"Playfair Display", serif', fontSize: 24, color: T.dark }}>{bakeryDetail.name}</h2>
                {bakeryDetail.neighborhood && <p style={{ color: T.muted, marginTop: 4 }}>{bakeryDetail.neighborhood}</p>}
                {bakeryDetail.address && <p style={{ color: T.muted, fontSize: 13 }}>{bakeryDetail.address}</p>}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button onClick={() => setShowAddRating(true)} style={{ ...css.btnDark, background: T.gold }}>★ Donner mon avis</button>
                {isAdmin && (
                  <>
                    <button onClick={() => setShowEditBakery(true)} style={css.btnSm}>✏️ Modifier</button>
                    <button onClick={handleDelete} style={css.btnGhost}>Supprimer</button>
                  </>
                )}
              </div>
            </div>

            {(!bakeryDetail.products || bakeryDetail.products.length === 0) ? (
              <EmptyState text="Aucun avis pour cette boulangerie." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {bakeryDetail.products.map(({ product_type, aggregated_scores, overall_average, rating_count, individual_ratings }) => (
                  <div key={product_type.id} style={{ background: "white", borderRadius: 14, padding: 22, border: `1px solid ${T.border}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                      <span style={{ fontFamily: '"Playfair Display", serif', fontSize: 17 }}>{product_type.emoji} {product_type.name}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ background: `${T.gold}22`, color: T.gold, border: `1px solid ${T.gold}55`, padding: "3px 10px", borderRadius: 20, fontSize: 12 }}>{rating_count} avis</span>
                        <span style={{ background: T.gold, color: "white", padding: "4px 14px", borderRadius: 20, fontSize: 14, fontWeight: 600 }}>⌀ {overall_average.toFixed(2)} / 5</span>
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8, marginBottom: 16 }}>
                      {Object.entries(aggregated_scores).map(([name, score]) => <ScoreBar key={name} label={name} score={score} />)}
                    </div>
                    <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 14 }}>
                      <div style={{ fontSize: 12, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>Avis individuels</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {individual_ratings.map((r) => (
                          <div key={r.id} style={{ background: T.bg, borderRadius: 8, padding: "10px 14px", display: "flex", gap: 12 }}>
                            <div style={{ width: 32, height: 32, borderRadius: "50%", background: T.dark, display: "flex", alignItems: "center", justifyContent: "center", color: T.gold, fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                              {(r.author_name || "A")[0].toUpperCase()}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: T.dark }}>{r.author_name}</span>
                                <span style={{ fontSize: 12, color: T.gold, fontWeight: 600 }}>{(Object.values(r.scores).reduce((a, b) => a + b, 0) / Object.values(r.scores).length).toFixed(1)}/5</span>
                              </div>
                              {r.note && <p style={{ fontSize: 13, color: T.muted, fontStyle: "italic", marginTop: 4 }}>« {r.note} »</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {showAddBakery  && <AddBakeryModal onClose={() => setShowAddBakery(false)} onSave={handleAddBakery} />}
      {showEditBakery && bakeryDetail && <EditBakeryModal bakery={bakeryDetail} onClose={() => setShowEditBakery(false)} onSave={handleEditBakery} />}
      {showAddRating  && selected && <AddRatingModal bakery={selected} productTypes={productTypes} onClose={() => setShowAddRating(false)} onSave={handleAddRating} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  views/ModerationView
// ─────────────────────────────────────────────────────────────────────────────

function ModerationView() {
  const { adminPin, requestConfirm, notify } = useApp();
  const [sub,     setSub]     = useState("ratings");
  const [ratings, setRatings] = useState([]);
  const [users,   setUsers]   = useState([]);
  const [loading, setLoading] = useState(false);

  const loadRatings = useCallback(async () => {
    setLoading(true);
    try { setRatings(await ApiClient.ratings.list(adminPin)); }
    catch (e) { notify(e.message, "error"); }
    finally { setLoading(false); }
  }, [adminPin, notify]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try { setUsers(await ApiClient.users.list(adminPin)); }
    catch (e) { notify(e.message, "error"); }
    finally { setLoading(false); }
  }, [adminPin, notify]);

  useEffect(() => { sub === "ratings" ? loadRatings() : loadUsers(); }, [sub]);

  const deleteRating = (id) => requestConfirm("Supprimer cet avis ?", async () => {
    try {
      await ApiClient.ratings.remove(id, adminPin);
      setRatings((r) => r.filter((x) => x.id !== id));
      notify("Avis supprimé");
    } catch (e) { notify(e.message, "error"); }
  });

  const deleteUser = (id, username) => requestConfirm(`Supprimer l'utilisateur « ${username} » ?`, async () => {
    try {
      await ApiClient.users.remove(id, adminPin);
      setUsers((u) => u.filter((x) => x.id !== id));
      notify("Utilisateur supprimé");
    } catch (e) { notify(e.message, "error"); }
  });

  return (
    <div>
      <div style={{ display: "flex", gap: 4, background: "white", border: `1px solid ${T.border}`, borderRadius: 10, padding: 4, marginBottom: 24, width: "fit-content" }}>
        {[["ratings", "💬 Commentaires"], ["users", "👤 Utilisateurs"]].map(([id, label]) => (
          <button key={id} onClick={() => setSub(id)}
            style={{ padding: "8px 20px", border: "none", borderRadius: 7, background: sub === id ? T.dark : "transparent", color: sub === id ? "#FAF3E4" : T.muted, fontSize: 14, cursor: "pointer", fontFamily: "inherit", transition: "all 0.18s" }}>
            {label}
          </button>
        ))}
      </div>

      {loading ? <Spinner /> : sub === "ratings" ? (
        ratings.length === 0 ? <EmptyState emoji="💬" text="Aucun commentaire." /> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {ratings.map((r) => (
              <div key={r.id} style={{ background: "white", borderRadius: 12, padding: "14px 18px", border: `1px solid ${T.border}`, display: "flex", gap: 14, alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, color: T.dark, fontSize: 14 }}>{r.author_name}</span>
                    <span style={{ background: T.bg, padding: "2px 10px", borderRadius: 12, fontSize: 12, color: T.muted, border: `1px solid ${T.border}` }}>{r.bakeries?.name}</span>
                    <span style={{ fontSize: 12, color: T.gold }}>{r.product_types?.emoji} {r.product_types?.name}</span>
                    <span style={{ fontSize: 11, color: T.muted, marginLeft: "auto" }}>{new Date(r.created_at).toLocaleDateString("fr-CA")}</span>
                  </div>
                  {r.note
                    ? <p style={{ fontSize: 13, color: T.muted, fontStyle: "italic" }}>« {r.note} »</p>
                    : <p style={{ fontSize: 12, color: T.border }}>Pas de commentaire</p>
                  }
                </div>
                <button onClick={() => deleteRating(r.id)} style={{ ...css.btnGhost, flexShrink: 0 }}>Supprimer</button>
              </div>
            ))}
          </div>
        )
      ) : (
        users.length === 0 ? <EmptyState emoji="👤" text="Aucun utilisateur." /> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {users.map((u) => (
              <div key={u.id} style={{ background: "white", borderRadius: 12, padding: "14px 18px", border: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: T.dark, display: "flex", alignItems: "center", justifyContent: "center", color: T.gold, fontWeight: 700, fontSize: 15, flexShrink: 0 }}>
                  {u.username[0].toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: T.dark, fontSize: 14 }}>@{u.username}</div>
                  <div style={{ fontSize: 13, color: T.muted }}>{u.email}</div>
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>Inscrit le {new Date(u.created_at).toLocaleDateString("fr-CA")}</div>
                </div>
                <button onClick={() => deleteUser(u.id, u.username)} style={{ ...css.btnGhost, flexShrink: 0 }}>Supprimer</button>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  views/AdminView
// ─────────────────────────────────────────────────────────────────────────────

function AdminView() {
  const { productTypes }                                                                   = useApp();
  const { addProductType, removeProductType, addCriterion, removeCriterion }              = useProductTypes();
  const { logout, changePassword }                                                        = useAdminAuth();

  const [selectedPtId, setSelectedPtId] = useState(() => productTypes[0]?.id ?? null);
  const [tab,          setTab]          = useState("products");
  const [showAddPt,    setShowAddPt]    = useState(false);
  const [newPt,        setNewPt]        = useState({ name: "", emoji: "🍞" });
  const [newCrit,      setNewCrit]      = useState("");
  const [pinForm,      setPinForm]      = useState({ next: "", confirm: "" });

  useEffect(() => {
    if (!selectedPtId && productTypes.length > 0) setSelectedPtId(productTypes[0].id);
  }, [productTypes]);

  const handleAddPt = async () => {
    const created = await addProductType(newPt.name, newPt.emoji);
    if (created) { setSelectedPtId(created.id); setShowAddPt(false); setNewPt({ name: "", emoji: "🍞" }); }
  };

  const selectedPt = productTypes.find((p) => p.id === selectedPtId);

  return (
    <AdminGate>
      <div>
        <div style={{ display: "flex", gap: 4, background: "white", border: `1px solid ${T.border}`, borderRadius: 10, padding: 4, marginBottom: 28, width: "fit-content" }}>
          {[["products", "📦 Produits & critères"], ["moderation", "🛡️ Modération"], ["security", "🔑 Sécurité"]].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{ padding: "8px 20px", border: "none", borderRadius: 7, background: tab === id ? T.dark : "transparent", color: tab === id ? "#FAF3E4" : T.muted, fontSize: 14, cursor: "pointer", fontFamily: "inherit", transition: "all 0.18s" }}>{label}</button>
          ))}
        </div>

        {tab === "moderation" && <ModerationView />}

        {tab === "security" && (
          <div style={{ background: "white", borderRadius: 14, padding: 26, border: `1px solid ${T.border}`, maxWidth: 380 }}>
            <div style={{ fontFamily: '"Playfair Display", serif', fontSize: 18, color: T.dark, marginBottom: 20 }}>🔑 Changer le mot de passe</div>
            <Field label="Nouveau mot de passe">
              <input type="password" value={pinForm.next} onChange={(e) => setPinForm((p) => ({ ...p, next: e.target.value }))} placeholder="••••••••" style={css.input} />
            </Field>
            <Field label="Confirmer">
              <input type="password" value={pinForm.confirm} onChange={(e) => setPinForm((p) => ({ ...p, confirm: e.target.value }))} placeholder="••••••••" style={css.input} />
            </Field>
            {pinForm.next && pinForm.confirm && pinForm.next !== pinForm.confirm && (
              <p style={{ color: T.danger, fontSize: 13, marginBottom: 12 }}>Les mots de passe ne correspondent pas.</p>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={async () => { if (pinForm.next === pinForm.confirm) { const ok = await changePassword(pinForm.next); if (ok) setPinForm({ next: "", confirm: "" }); } }} style={{ ...css.btnGold, flex: 1, width: "auto" }}>Modifier</button>
              <button onClick={logout} style={{ ...css.btnGhost, color: T.muted }}>Déconnexion</button>
            </div>
          </div>
        )}

        {tab === "products" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h2 style={{ fontFamily: '"Playfair Display", serif', fontSize: 22, color: T.dark }}>Produits & critères</h2>
              <button onClick={() => setShowAddPt(true)} style={css.btnDark}>+ Nouveau produit</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 24, alignItems: "start" }}>
              <div>
                {productTypes.map((pt) => (
                  <div key={pt.id} onClick={() => setSelectedPtId(pt.id)}
                    style={{ padding: "12px 16px", marginBottom: 8, borderRadius: 10, cursor: "pointer", background: selectedPtId === pt.id ? T.dark : "white", color: selectedPtId === pt.id ? "#FAF3E4" : T.dark, border: `2px solid ${selectedPtId === pt.id ? T.gold : T.border}`, transition: "all 0.2s", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>{pt.emoji} {pt.name}</span>
                    <span style={{ fontSize: 12, opacity: 0.6 }}>{pt.criteria.length} critères</span>
                  </div>
                ))}
              </div>
              {selectedPt ? (
                <div style={{ background: "white", borderRadius: 14, padding: 26, border: `1px solid ${T.border}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                    <div style={{ fontFamily: '"Playfair Display", serif', fontSize: 20, color: T.dark }}>{selectedPt.emoji} {selectedPt.name}</div>
                    <button onClick={() => removeProductType(selectedPt.id)} style={css.btnGhost}>Supprimer</button>
                  </div>
                  <div style={{ fontSize: 12, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Critères</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
                    {selectedPt.criteria.map((c) => (
                      <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, background: T.bg, padding: "7px 14px", borderRadius: 30, border: `1px solid ${T.border}` }}>
                        <span style={{ fontSize: 14, color: T.dark }}>{c.name}</span>
                        <button onClick={() => removeCriterion(selectedPt.id, c.id, c.name)} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <input value={newCrit} onChange={(e) => setNewCrit(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { addCriterion(selectedPt.id, newCrit); setNewCrit(""); } }} placeholder="Nouveau critère…" style={{ ...css.input, flex: 1 }} />
                    <button onClick={() => { addCriterion(selectedPt.id, newCrit); setNewCrit(""); }} style={css.btnDark}>Ajouter</button>
                  </div>
                </div>
              ) : <EmptyState text="Sélectionnez un produit" />}
            </div>
          </>
        )}

        {showAddPt && (
          <Modal title="Nouveau produit" onClose={() => setShowAddPt(false)}>
            <div style={{ display: "flex", gap: 12 }}>
              <Field label="Emoji" style={{ width: 90 }}><input value={newPt.emoji} onChange={(e) => setNewPt((p) => ({ ...p, emoji: e.target.value }))} style={{ ...css.input, textAlign: "center", fontSize: 22 }} /></Field>
              <Field label="Nom *" style={{ flex: 1 }}><input value={newPt.name} onChange={(e) => setNewPt((p) => ({ ...p, name: e.target.value }))} placeholder="Ex : Pain de campagne" style={css.input} /></Field>
            </div>
            <button onClick={handleAddPt} style={css.btnGold}>Créer</button>
          </Modal>
        )}
      </div>
    </AdminGate>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Footer
// ─────────────────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer style={{ background: T.dark, color: "#FAF3E4", padding: "40px 32px", marginTop: 64, textAlign: "center" }}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>🥖</div>
      <div style={{ fontFamily: '"Playfair Display", serif', fontSize: 18, color: T.gold, marginBottom: 6 }}>Loafly</div>
      <p style={{ fontSize: 13, color: "#FAF3E444", fontStyle: "italic" }}>
        Guide collaboratif des boulangeries artisanales · Montréal, QC · Loafly
      </p>
    </footer>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  HomeView  —  page d'accueil
// ─────────────────────────────────────────────────────────────────────────────

function HomeView({ onNavigate, onShowAuth }) {
  const { bakeries, productTypes, user } = useApp();
  const {
    overallRanking, loadingOverall, fetchOverallRanking,
    productRanking, loadingProduct, fetchProductRanking,
  } = useRankings();
  const [activePt, setActivePt] = useState(null);
  const medals = ["🥇", "🥈", "🥉"];

  useEffect(() => { fetchOverallRanking(); }, []);

  useEffect(() => {
    if (productTypes.length > 0 && !activePt) {
      const first = productTypes[0].id;
      setActivePt(first);
      fetchProductRanking(first);
    }
  }, [productTypes]);

  const handlePtChange = (id) => { setActivePt(id); fetchProductRanking(id); };
  const top3     = overallRanking.slice(0, 3);
  const totalAvis = overallRanking.reduce((a, b) => a + b.total_ratings, 0);

  return (
    <div>
      {/* ── Hero ─────────────────────────────────────────── */}
      <div style={{ background: `linear-gradient(135deg, ${T.dark} 0%, #3D1F0D 60%, #5C3020 100%)`, padding: "88px 32px 72px", textAlign: "center", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -10, left: "5%",  fontSize: 160, opacity: 0.04, transform: "rotate(-20deg)", lineHeight: 1 }}>🥖</div>
        <div style={{ position: "absolute", bottom: -20, right: "8%", fontSize: 180, opacity: 0.03, transform: "rotate(15deg)", lineHeight: 1 }}>🥐</div>
        <div style={{ position: "relative", zIndex: 1, maxWidth: 640, margin: "0 auto" }}>
          <div style={{ display: "inline-block", background: `${T.gold}22`, border: `1px solid ${T.gold}44`, color: T.gold, fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", padding: "6px 16px", borderRadius: 20, marginBottom: 22 }}>
            Boulangeries artisanales · Montréal
          </div>
          <h1 style={{ fontFamily: '"Playfair Display", serif', fontSize: "clamp(36px, 6vw, 60px)", fontWeight: 900, color: "#FAF3E4", lineHeight: 1.1, marginBottom: 18 }}>
            Les meilleures<br />boulangeries de<br />
            <span style={{ color: T.gold }}>Montréal</span>
          </h1>
          <p style={{ fontSize: 17, color: "#FAF3E499", fontStyle: "italic", marginBottom: 38, lineHeight: 1.7 }}>
            Découvrez, évaluez et partagez vos coups de cœur<br />parmi les artisans boulangers de la métropole.
          </p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={() => onNavigate("rankings")}
              style={{ background: T.gold, color: "white", border: "none", padding: "14px 30px", borderRadius: 10, fontSize: 15, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, boxShadow: `0 4px 20px ${T.gold}55` }}>
              🏆 Voir le classement
            </button>
            <button onClick={() => onNavigate("bakeries")}
              style={{ background: "transparent", color: "#FAF3E4", border: "2px solid #FFFFFF30", padding: "14px 30px", borderRadius: 10, fontSize: 15, cursor: "pointer", fontFamily: "inherit" }}>
              🏪 Explorer
            </button>
          </div>
        </div>
      </div>

      {/* ── Stats ────────────────────────────────────────── */}
      <div style={{ background: T.gold, padding: "22px 32px", display: "flex", justifyContent: "center", gap: "clamp(24px, 6vw, 72px)", flexWrap: "wrap" }}>
        {[
          ["🏪", bakeries.length,      "boulangeries"],
          ["🥖", productTypes.length,  "produits notés"],
          ["⭐", totalAvis || "—",     "avis déposés"],
        ].map(([icon, num, label]) => (
          <div key={label} style={{ textAlign: "center", color: "white" }}>
            <div style={{ fontSize: 22 }}>{icon}</div>
            <div style={{ fontSize: 30, fontWeight: 700, fontFamily: '"Playfair Display", serif', lineHeight: 1.1 }}>{num}</div>
            <div style={{ fontSize: 12, opacity: 0.82, marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "56px 32px" }}>

        {/* ── Top boulangeries ─────────────────────────── */}
        {!loadingOverall && top3.length > 0 && (
          <section style={{ marginBottom: 64 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 28 }}>
              <div>
                <h2 style={{ fontFamily: '"Playfair Display", serif', fontSize: 30, color: T.dark }}>🏆 Meilleures boulangeries</h2>
                <p style={{ color: T.muted, fontSize: 14, marginTop: 4, fontStyle: "italic" }}>Classées sur la moyenne de tous les produits évalués</p>
              </div>
              <button onClick={() => onNavigate("rankings")}
                style={{ background: "none", border: "none", color: T.gold, cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}>
                Classement complet →
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
              {top3.map(({ bakery, overall_average, total_ratings, product_averages }, i) => (
                <div key={bakery.id} onClick={() => onNavigate("bakeries")}
                  style={{ background: i === 0 ? `linear-gradient(140deg, ${T.dark} 0%, #4A2A18 100%)` : "white", color: i === 0 ? "#FAF3E4" : T.dark, borderRadius: 18, padding: "26px 24px", border: `2px solid ${i === 0 ? T.gold : T.border}`, cursor: "pointer", boxShadow: i === 0 ? `0 8px 32px ${T.gold}33` : "0 2px 12px rgba(0,0,0,0.06)", transition: "transform 0.18s" }}
                  onMouseEnter={(e) => e.currentTarget.style.transform = "translateY(-3px)"}
                  onMouseLeave={(e) => e.currentTarget.style.transform = "translateY(0)"}>
                  <div style={{ fontSize: 34, marginBottom: 10 }}>{medals[i]}</div>
                  <div style={{ fontFamily: '"Playfair Display", serif', fontSize: 20, fontWeight: 700, marginBottom: 3 }}>{bakery.name}</div>
                  {bakery.neighborhood && <div style={{ fontSize: 13, opacity: 0.6, marginBottom: 16 }}>{bakery.neighborhood}</div>}
                  <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
                    <span style={{ fontSize: 38, fontWeight: 700, color: T.gold, lineHeight: 1, fontFamily: '"Playfair Display", serif' }}>{overall_average.toFixed(1)}</span>
                    <div>
                      <div style={{ display: "flex", gap: 2 }}>
                        {[1,2,3,4,5].map(s => <span key={s} style={{ color: s <= Math.round(overall_average) ? T.gold : (i === 0 ? "#FFFFFF25" : T.border), fontSize: 15 }}>★</span>)}
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.55, marginTop: 3 }}>{total_ratings} avis</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {product_averages.slice(0, 3).map(({ product_type, average }) => (
                      <span key={product_type.id} style={{ background: i === 0 ? "#FFFFFF14" : T.bg, padding: "4px 12px", borderRadius: 20, fontSize: 12, border: `1px solid ${i === 0 ? "#FFFFFF18" : T.border}` }}>
                        {product_type.emoji} {average.toFixed(1)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Par produit ───────────────────────────────── */}
        {productTypes.length > 0 && (
          <section style={{ marginBottom: 64 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 20 }}>
              <div>
                <h2 style={{ fontFamily: '"Playfair Display", serif', fontSize: 30, color: T.dark }}>Explorer par produit</h2>
                <p style={{ color: T.muted, fontSize: 14, marginTop: 4, fontStyle: "italic" }}>Qui fait le meilleur croissant ? La meilleure baguette ?</p>
              </div>
              <button onClick={() => onNavigate("rankings")}
                style={{ background: "none", border: "none", color: T.gold, cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}>
                Voir tout →
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
              {productTypes.map(pt => (
                <button key={pt.id} onClick={() => handlePtChange(pt.id)}
                  style={{ padding: "10px 22px", border: `2px solid ${activePt === pt.id ? T.gold : T.border}`, background: activePt === pt.id ? T.gold : "white", color: activePt === pt.id ? "white" : T.muted, borderRadius: 30, fontSize: 14, cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s", fontWeight: activePt === pt.id ? 600 : 400 }}>
                  {pt.emoji} {pt.name}
                </button>
              ))}
            </div>
            {loadingProduct ? <Spinner /> : productRanking.length === 0 ? (
              <EmptyState text="Aucun avis pour ce produit encore." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {productRanking.slice(0, 5).map(({ bakery, overall_average, rating_count }, i) => (
                  <div key={bakery.id} style={{ background: "white", borderRadius: 14, padding: "16px 22px", border: `1px solid ${i === 0 ? T.gold : T.border}`, display: "flex", alignItems: "center", gap: 18, boxShadow: i === 0 ? `0 2px 12px ${T.gold}22` : "none" }}>
                    <div style={{ fontSize: 22, minWidth: 34, textAlign: "center" }}>{medals[i] ?? `#${i+1}`}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: '"Playfair Display", serif', fontSize: 17, color: T.dark }}>{bakery.name}</div>
                      {bakery.neighborhood && <div style={{ fontSize: 13, color: T.muted }}>{bakery.neighborhood}</div>}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 26, fontWeight: 700, color: T.gold, lineHeight: 1, fontFamily: '"Playfair Display", serif' }}>{overall_average.toFixed(1)}</div>
                      <div style={{ fontSize: 11, color: T.muted }}>{rating_count} avis</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── CTA inscription ───────────────────────────── */}
        {!user && (
          <section style={{ background: `linear-gradient(135deg, ${T.dark} 0%, #4A2A18 100%)`, borderRadius: 22, padding: "48px 40px", textAlign: "center", color: "#FAF3E4", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", right: -20, top: -20, fontSize: 120, opacity: 0.05 }}>✍️</div>
            <div style={{ position: "relative", zIndex: 1 }}>
              <div style={{ fontSize: 44, marginBottom: 14 }}>✍️</div>
              <h3 style={{ fontFamily: '"Playfair Display", serif', fontSize: 26, marginBottom: 10 }}>Vous avez un avis à partager ?</h3>
              <p style={{ color: `${T.gold}BB`, marginBottom: 28, fontStyle: "italic", lineHeight: 1.6 }}>
                Créez un compte gratuit pour noter les boulangeries,<br />ajouter des établissements et contribuer au guide.
              </p>
              <button onClick={onShowAuth}
                style={{ background: T.gold, color: "white", border: "none", padding: "14px 32px", borderRadius: 10, fontSize: 15, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, boxShadow: `0 4px 20px ${T.gold}44` }}>
                Créer un compte gratuit
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  views/MapView
// ─────────────────────────────────────────────────────────────────────────────

function MapView() {
  const { bakeries }                                        = useApp();
  const { overallRanking, fetchOverallRanking }             = useRankings();
  const mapRef         = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef     = useRef([]);

  useEffect(() => { fetchOverallRanking(); }, []);

  // Init carte
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;
    const L = window.L;
    if (!L) return;

    mapInstanceRef.current = L.map(mapRef.current).setView([45.5088, -73.5878], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(mapInstanceRef.current);

    return () => {
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Marqueurs
  useEffect(() => {
    const L = window.L;
    if (!L || !mapInstanceRef.current) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const rankMap = Object.fromEntries(overallRanking.map((r) => [r.bakery.id, r]));

    bakeries.forEach((b) => {
      if (!b.lat || !b.lng) return;
      const r     = rankMap[b.id];
      const score = r?.overall_average?.toFixed(1);

      const icon = L.divIcon({
        className: "",
        html: `<div style="width:42px;height:42px;background:${T.dark};border:2.5px solid ${T.gold};border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,0.45)"><span style="transform:rotate(45deg);color:${T.gold};font-weight:700;font-size:12px;font-family:Georgia,serif;line-height:1">${score ?? "🥖"}</span></div>`,
        iconSize: [42, 42],
        iconAnchor: [21, 42],
        popupAnchor: [0, -46],
      });

      const prods = r?.product_averages
        ?.sort((a, b2) => b2.average - a.average)
        ?.slice(0, 4)
        ?.map((p) => `<span style="background:#FAF3E4;padding:3px 9px;border-radius:12px;font-size:11px;margin:2px;display:inline-block;border:1px solid #E8D5B5">${p.product_type.emoji} ${p.product_type.name} <b style="color:#C8912A">${p.average.toFixed(1)}</b></span>`)
        ?.join("") ?? "";

      const popup = `
        <div style="font-family:Georgia,serif;min-width:190px;padding:2px 4px">
          <div style="font-size:16px;font-weight:700;color:#2C1810;margin-bottom:2px">${b.name}</div>
          ${b.neighborhood ? `<div style="font-size:12px;color:#8B6550;margin-bottom:8px">${b.neighborhood}</div>` : ""}
          ${score
            ? `<div style="font-size:26px;font-weight:700;color:#C8912A;line-height:1;margin-bottom:8px;font-family:'Playfair Display',Georgia,serif">${score}<span style="font-size:12px;color:#8B6550;font-weight:400"> / 5 · ${r.total_ratings} avis</span></div>`
            : `<div style="font-size:12px;color:#8B6550;margin-bottom:8px">${b.rating_count} avis</div>`
          }
          ${prods ? `<div style="line-height:2;margin-bottom:6px">${prods}</div>` : ""}
          ${b.address ? `<div style="font-size:11px;color:#8B6550;border-top:1px solid #E8D5B5;padding-top:6px;margin-top:4px">📍 ${b.address}</div>` : ""}
        </div>`;

      markersRef.current.push(
        L.marker([b.lat, b.lng], { icon })
          .addTo(mapInstanceRef.current)
          .bindPopup(popup, { maxWidth: 300 })
      );
    });
  }, [bakeries, overallRanking]);

  const withCoords    = bakeries.filter((b) => b.lat && b.lng);
  const withoutCoords = bakeries.filter((b) => !b.lat || !b.lng);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontFamily: '"Playfair Display", serif', fontSize: 26, color: T.dark }}>Carte des boulangeries</h2>
          <p style={{ color: T.muted, fontSize: 14, marginTop: 4, fontStyle: "italic" }}>{withCoords.length} boulangerie{withCoords.length !== 1 ? "s" : ""} sur la carte · Cliquez sur un marqueur pour le détail</p>
        </div>
      </div>

      <div ref={mapRef} style={{ height: 560, borderRadius: 16, overflow: "hidden", border: `2px solid ${T.border}`, boxShadow: "0 4px 24px rgba(0,0,0,0.09)", marginBottom: 16 }} />

      {withoutCoords.length > 0 && (
        <div style={{ padding: "12px 18px", background: `${T.gold}11`, border: `1px solid ${T.gold}33`, borderRadius: 10, fontSize: 13, color: T.muted }}>
          ⚠️ {withoutCoords.length} boulangerie{withoutCoords.length > 1 ? "s" : ""} sans coordonnées ({withoutCoords.map((b) => b.name).join(", ")}) — assurez-vous d'entrer une adresse précise lors de l'ajout.
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  AuthModal  —  connexion / inscription
// ─────────────────────────────────────────────────────────────────────────────

function AuthModal({ onClose }) {
  const { signup, login } = useUserAuth();
  const [tab,      setTab]      = useState("login");
  const [email,    setEmail]    = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async () => {
    const ok = tab === "login"
      ? await login(email, password)
      : await signup(username, email, password);
    if (ok) onClose();
  };

  return (
    <Modal title={tab === "login" ? "Se connecter" : "Créer un compte"} onClose={onClose} maxWidth={380}>
      <div style={{ display: "flex", gap: 4, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, padding: 4, marginBottom: 24 }}>
        {[["login", "Connexion"], ["signup", "Créer un compte"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ flex: 1, padding: "7px 0", border: "none", borderRadius: 6, background: tab === id ? T.dark : "transparent", color: tab === id ? "#FAF3E4" : T.muted, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>{label}</button>
        ))}
      </div>
      {tab === "signup" && (
        <Field label="Nom d'utilisateur">
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Ex : marie_mtl" style={css.input} />
        </Field>
      )}
      <Field label="Email">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@exemple.com" style={css.input} />
      </Field>
      <Field label="Mot de passe">
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="••••••••" style={css.input} />
      </Field>
      <button onClick={handleSubmit} style={{ ...css.btnGold, marginTop: 8 }}>
        {tab === "login" ? "Se connecter" : "Créer mon compte"}
      </button>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  App.jsx
// ─────────────────────────────────────────────────────────────────────────────

const VIEWS = [
  { id: "home",     icon: "🏠", label: "Accueil" },
  { id: "rankings", icon: "🏆", label: "Classements" },
  { id: "bakeries", icon: "🏪", label: "Boulangeries" },
  { id: "map",      icon: "🗺️", label: "Carte" },
];

function Shell() {
  const { loading, isAdmin, isMobile } = useApp();
  const { user, logout }               = useUserAuth();
  const [view,      setView]      = useState("home");
  const [showAuth,  setShowAuth]  = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "Georgia, serif", color: T.muted, background: T.bg }}>
      Chargement…
    </div>
  );

  const adminBtnBottom = isMobile ? 70 : 20;

  return (
    <div style={{ fontFamily: '"EB Garamond", Georgia, serif', background: T.bg, minHeight: "100vh", color: T.dark }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        input, textarea, select, button { font-family: inherit; }
        input:focus, textarea:focus, select:focus { outline: none; border-color: ${T.gold} !important; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-thumb { background: ${T.gold}; border-radius: 4px; }
      `}</style>

      {/* ── Header ── */}
      <header style={{ background: T.dark, color: "#FAF3E4", padding: isMobile ? "0 16px" : "0 24px", display: "flex", alignItems: "stretch", justifyContent: "space-between", height: 58, position: "sticky", top: 0, zIndex: 150 }}>
        <button onClick={() => setView("home")} style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", color: "#FAF3E4", cursor: "pointer", padding: 0 }}>
          <span style={{ fontSize: 22 }}>🥖</span>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontFamily: '"Playfair Display", serif', fontSize: isMobile ? 17 : 20, fontWeight: 900, lineHeight: 1.1 }}>Loafly</div>
            {!isMobile && <div style={{ fontSize: 11, color: T.gold, fontStyle: "italic" }}>Boulangeries artisanales · Montréal</div>}
          </div>
        </button>

        <div style={{ display: "flex", alignItems: "stretch", gap: 2 }}>
          {/* Nav desktop uniquement */}
          {!isMobile && (
            <nav style={{ display: "flex", alignItems: "stretch", gap: 2 }}>
              {VIEWS.map(({ id, icon, label }) => (
                <button key={id} onClick={() => setView(id)}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 16px", border: "none", background: view === id ? `${T.gold}22` : "transparent", color: view === id ? T.gold : "#FAF3E470", borderBottom: `2px solid ${view === id ? T.gold : "transparent"}`, fontSize: 14, cursor: "pointer", transition: "all 0.18s" }}>
                  <span style={{ fontSize: 15 }}>{icon}</span> {label}
                </button>
              ))}
            </nav>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: isMobile ? 0 : 16, borderLeft: isMobile ? "none" : `1px solid #FFFFFF18` }}>
            {user ? (
              <>
                {!isMobile && <span style={{ fontSize: 13, color: T.gold }}>@{user.username}</span>}
                <button onClick={logout} style={{ background: "none", border: `1px solid #FFFFFF30`, color: "#FAF3E470", padding: "5px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>
                  {isMobile ? "↪" : "Déconnexion"}
                </button>
              </>
            ) : (
              <button onClick={() => setShowAuth(true)} style={{ background: T.gold, border: "none", color: "white", padding: "7px 14px", borderRadius: 6, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
                {isMobile ? "Connexion" : "Se connecter"}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── Contenu principal ── */}
      <main style={{ paddingBottom: isMobile ? 64 : 0 }}>
        {view === "home" && <HomeView onNavigate={setView} onShowAuth={() => setShowAuth(true)} />}
        {view !== "home" && (
          <div style={{ padding: isMobile ? "16px" : "32px", maxWidth: 1080, margin: "0 auto" }}>
            {view === "rankings" && <RankingsView />}
            {view === "bakeries" && <BakeriesView />}
            {view === "map"      && <MapView />}
          </div>
        )}
      </main>

      {/* ── Footer (desktop seulement) ── */}
      {!isMobile && <Footer />}

      {/* ── Panel admin ── */}
      {showAdmin && (
        <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(28,15,7,0.7)", overflowY: "auto" }}>
          <div style={{ background: T.bg, minHeight: "100vh", padding: isMobile ? 16 : 32, maxWidth: 1080, margin: "0 auto", position: "relative" }}>
            <button onClick={() => setShowAdmin(false)} style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", fontSize: 28, color: T.muted, cursor: "pointer" }}>×</button>
            <AdminView />
          </div>
        </div>
      )}

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}

      {/* ── Bouton admin (flottant) ── */}
      <button onClick={() => setShowAdmin(true)} title="Admin"
        style={{ position: "fixed", bottom: adminBtnBottom, right: 16, background: T.dark, border: `1px solid ${T.gold}44`, color: `${T.gold}88`, width: 34, height: 34, borderRadius: "50%", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.3)", zIndex: 200 }}>
        🔐
      </button>
      {isAdmin && <span style={{ position: "fixed", bottom: adminBtnBottom + 26, right: 19, width: 8, height: 8, borderRadius: "50%", background: "#2C6E2C", zIndex: 201 }} />}

      {/* ── Navigation mobile en bas ── */}
      {isMobile && (
        <nav style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: T.dark, borderTop: `1px solid ${T.gold}33`, display: "flex", zIndex: 190, height: 58 }}>
          {VIEWS.map(({ id, icon, label }) => (
            <button key={id} onClick={() => setView(id)}
              style={{ flex: 1, background: view === id ? `${T.gold}18` : "none", border: "none", borderTop: `2px solid ${view === id ? T.gold : "transparent"}`, color: view === id ? T.gold : "#FAF3E450", fontSize: 9, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, padding: "6px 2px 8px" }}>
              <span style={{ fontSize: 19 }}>{icon}</span>
              {label}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
