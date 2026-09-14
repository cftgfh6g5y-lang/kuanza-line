/* Kuanza Line — payment-ui.js
 * Integração visual do módulo de pagamentos — server.js 1.9.4
 */
(() => {
  "use strict";

  const ORDERS_API = "/api/orders";
  const PAYMENT_API = id => `/api/orders/${encodeURIComponent(id)}/payment`;
  const ATTR = "data-kuanza-payment-ui";

  const STATUS = {
    "Pendente": "Pendente",
    "Aguardando confirmação": "Aguardando confirmação",
    "Pago": "Pago",
    "Falhou": "Falhou",
    "Cancelado": "Cancelado",
    "Reembolsado": "Reembolsado"
  };

  const METHODS = {
    multicaixa_express: "Multicaixa Express",
    bank_transfer: "Transferência bancária",
    card: "Cartão"
  };

  const state = { orders: [], lastFetch: 0, timer: null, rendering: false };

  function token() {
    const keys = ["kuanza_token", "access_token", "authToken", "token", "jwt"];
    for (const key of keys) {
      try {
        const value = localStorage.getItem(key);
        if (value && value.length > 20) return value.replace(/^Bearer\s+/i, "");
      } catch (_) {}
    }

    for (const key of ["session", "user_session", "auth_session", "supabase_session"]) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const data = JSON.parse(raw);
        const value =
          data?.access_token ||
          data?.accessToken ||
          data?.session?.access_token ||
          data?.data?.session?.access_token;
        if (value) return String(value).replace(/^Bearer\s+/i, "");
      } catch (_) {}
    }

    if (window.authToken) return String(window.authToken).replace(/^Bearer\s+/i, "");
    if (window.accessToken) return String(window.accessToken).replace(/^Bearer\s+/i, "");
    return "";
  }

  function headers(extra = {}) {
    const t = token();
    return {
      Accept: "application/json",
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
      ...extra
    };
  }

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function idOf(order) {
    return String(order?.id || order?.orderId || order?._id || "").trim();
  }

  function paymentOf(order) {
    return order?.payment || order?.paymentInfo || order?.pagamento || {
      status: order?.paymentStatus || "Pendente",
      method: order?.paymentMethod || "",
      reference: order?.paymentReference || ""
    };
  }

  function normalize(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.orders)) return payload.orders;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.items)) return payload.items;
    return [];
  }

  function saveOrders(payload) {
    const list = normalize(payload).filter(x => idOf(x));
    if (list.length) {
      state.orders = list;
      state.lastFetch = Date.now();
    }
    scheduleRender(100);
  }

  async function loadOrders(force = false) {
    if (!force && state.orders.length && Date.now() - state.lastFetch < 3000) {
      scheduleRender(30);
      return state.orders;
    }

    try {
      const res = await window.fetch(ORDERS_API, {
        method: "GET",
        headers: headers(),
        credentials: "include"
      });
      if (!res.ok) return state.orders;
      saveOrders(await res.json());
    } catch (_) {}

    return state.orders;
  }

  function findContainer(id) {
    for (const selector of [
      `[data-order-id="${id}"]`,
      `[data-id="${id}"]`,
      `[data-order="${id}"]`
    ]) {
      try {
        const found = document.querySelector(selector);
        if (found) return found;
      } catch (_) {}
    }

    const shortId = id.length > 8 ? id.slice(-8) : id;
    const elements = Array.from(document.querySelectorAll("article,li,section,tr,div"));

    for (const marker of [`#${shortId}`, id, shortId]) {
      for (const el of elements) {
        if (el.hasAttribute(ATTR)) continue;
        const text = el.textContent || "";
        if (!text.includes(marker) || text.length < 40 || text.length > 5000) continue;

        let candidate = el;
        for (let i = 0; i < 4 && candidate.parentElement; i++) {
          const parent = candidate.parentElement;
          const parentText = parent.textContent || "";
          if (parentText.includes(marker) && parentText.length >= 50 && parentText.length <= 5000) {
            candidate = parent;
          } else break;
        }
        return candidate;
      }
    }
    return null;
  }

  function statusClass(status) {
    return String(status || "Pendente")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-");
  }

  function card(order, payment) {
    const id = idOf(order);
    const status = payment?.status || "Pendente";
    const method = METHODS[payment?.method] || payment?.method || "Não definido";
    const reference = payment?.reference || "";

    let body = "";

    if (status === "Pendente") {
      body = `
        <div class="kl-payment-action">
          <label class="kl-payment-label" for="kl-payment-ref-${esc(id)}">Referência do pagamento</label>
          <div class="kl-payment-row">
            <input id="kl-payment-ref-${esc(id)}" class="kl-payment-input"
              type="text" maxlength="120" autocomplete="off"
              placeholder="Ex.: referência Multicaixa" value="${esc(reference)}">
            <button type="button" class="kl-payment-button"
              data-kl-payment-submit="${esc(id)}">Enviar referência</button>
          </div>
          <div class="kl-payment-help">Depois de enviar, ficará a aguardar confirmação.</div>
        </div>`;
    } else if (status === "Aguardando confirmação") {
      body = `<div class="kl-payment-info">Referência enviada. Aguardando confirmação da plataforma.</div>`;
    } else if (status === "Pago") {
      body = `<div class="kl-payment-success">Pagamento confirmado com sucesso.</div>`;
    } else if (status === "Falhou") {
      body = `<div class="kl-payment-error">O pagamento foi marcado como falhado.</div>`;
    } else if (status === "Cancelado") {
      body = `<div class="kl-payment-error">Este pagamento foi cancelado.</div>`;
    } else if (status === "Reembolsado") {
      body = `<div class="kl-payment-info">Este pagamento foi reembolsado.</div>`;
    }

    return `
      <div class="kl-payment-card kl-payment-${esc(statusClass(status))}" ${ATTR}="${esc(id)}">
        <div class="kl-payment-header">
          <div>
            <div class="kl-payment-title">Pagamento</div>
            <div class="kl-payment-method">${esc(method)}</div>
          </div>
          <span class="kl-payment-status">${esc(STATUS[status] || status)}</span>
        </div>
        ${reference ? `<div class="kl-payment-reference">Referência: <strong>${esc(reference)}</strong></div>` : ""}
        ${body}
      </div>`;
  }

  function render() {
    if (state.rendering || !state.orders.length) return;
    state.rendering = true;

    try {
      for (const order of state.orders) {
        const id = idOf(order);
        const container = findContainer(id);
        if (!container) continue;

        const wrapper = document.createElement("div");
        wrapper.innerHTML = card(order, paymentOf(order)).trim();
        const fresh = wrapper.firstElementChild;
        if (!fresh) continue;

        let old = null;
        try { old = document.querySelector(`[${ATTR}="${id}"]`); } catch (_) {}

        if (old) old.replaceWith(fresh);
        else container.appendChild(fresh);
      }
    } finally {
      state.rendering = false;
    }
  }

  function scheduleRender(delay = 150) {
    clearTimeout(state.timer);
    state.timer = setTimeout(render, delay);
  }

  async function submitReference(id, input, button) {
    const reference = String(input?.value || "").trim();

    if (!reference) {
      alert("Digite a referência do pagamento.");
      input?.focus();
      return;
    }

    if (button) {
      button.disabled = true;
      button.textContent = "A enviar...";
    }

    try {
      const res = await window.fetch(PAYMENT_API(id), {
        method: "POST",
        headers: headers({ "Content-Type": "application/json" }),
        credentials: "include",
        body: JSON.stringify({ reference })
      });

      let data = {};
      try { data = await res.json(); } catch (_) {}

      if (!res.ok) {
        throw new Error(data?.error || data?.message || "Não foi possível enviar a referência.");
      }

      const index = state.orders.findIndex(x => idOf(x) === id);
      if (index >= 0) {
        state.orders[index].payment = {
          ...paymentOf(state.orders[index]),
          ...(data?.payment || {}),
          status: data?.payment?.status || "Aguardando confirmação",
          reference: data?.payment?.reference || reference
        };
      }

      render();
      alert("Referência enviada. Aguardando confirmação.");
    } catch (error) {
      alert(error?.message || "Erro ao enviar a referência.");
      if (button) {
        button.disabled = false;
        button.textContent = "Enviar referência";
      }
    }
  }

  function styles() {
    if (document.getElementById("kuanza-payment-ui-styles")) return;

    const style = document.createElement("style");
    style.id = "kuanza-payment-ui-styles";
    style.textContent = `
      .kl-payment-card{box-sizing:border-box;width:100%;margin:14px 0 4px;padding:16px;border:1px solid rgba(0,0,0,.10);border-radius:14px;background:#fff;font-family:inherit}
      .kl-payment-header{display:flex;align-items:center;justify-content:space-between;gap:12px}
      .kl-payment-title{font-size:16px;font-weight:700}
      .kl-payment-method{margin-top:4px;font-size:13px;opacity:.72}
      .kl-payment-status{display:inline-flex;align-items:center;min-height:30px;padding:5px 10px;border-radius:999px;background:rgba(0,0,0,.07);font-size:12px;font-weight:700;white-space:nowrap}
      .kl-payment-reference,.kl-payment-action{margin-top:13px;font-size:13px}
      .kl-payment-label{display:block;margin-bottom:7px;font-weight:600}
      .kl-payment-row{display:flex;gap:8px}
      .kl-payment-input{min-width:0;flex:1;box-sizing:border-box;padding:11px 12px;border:1px solid rgba(0,0,0,.18);border-radius:10px;background:#fff;color:inherit;font:inherit;outline:none}
      .kl-payment-button{flex:0 0 auto;border:0;border-radius:10px;padding:10px 13px;background:#111;color:#fff;font:inherit;font-weight:700;cursor:pointer}
      .kl-payment-button:disabled{opacity:.55;cursor:wait}
      .kl-payment-help{margin-top:7px;font-size:12px;opacity:.65}
      .kl-payment-success,.kl-payment-error,.kl-payment-info{margin-top:12px;padding:10px 12px;border-radius:10px;font-size:13px}
      .kl-payment-success{background:rgba(46,160,67,.10)}
      .kl-payment-error{background:rgba(210,50,50,.10)}
      .kl-payment-info{background:rgba(0,0,0,.05)}
      @media(max-width:560px){.kl-payment-row{flex-direction:column}.kl-payment-button{width:100%}.kl-payment-header{align-items:flex-start}}
    `;
    document.head.appendChild(style);
  }

  function events() {
    if (document.documentElement.dataset.klPaymentEvents === "1") return;
    document.documentElement.dataset.klPaymentEvents = "1";

    document.addEventListener("click", event => {
      const button = event.target.closest("[data-kl-payment-submit]");
      if (!button) return;

      const id = button.getAttribute("data-kl-payment-submit");
      let input = null;

      try {
        input = document.querySelector(`#kl-payment-ref-${CSS.escape(id)}`);
      } catch (_) {}

      submitReference(id, input, button);
    });
  }

  function fetchHook() {
    if (window.__kuanzaPaymentFetchInstalled) return;
    window.__kuanzaPaymentFetchInstalled = true;

    const original = window.fetch.bind(window);

    window.fetch = async function(input, init) {
      const response = await original(input, init);

      try {
        const url = typeof input === "string" ? input : input?.url || "";
        const parsed = new URL(url, location.href);
        const method = String(init?.method || input?.method || "GET").toUpperCase();

        if (parsed.pathname === ORDERS_API && method === "GET") {
          response.clone().json().then(saveOrders).catch(() => {});
        }

        if (
          parsed.pathname.includes("/api/orders/") &&
          parsed.pathname.endsWith("/payment") &&
          ["POST", "PATCH"].includes(method)
        ) {
          setTimeout(() => loadOrders(true), 300);
        }
      } catch (_) {}

      return response;
    };
  }

  function observer() {
    if (!document.body) return;

    new MutationObserver(() => scheduleRender(120)).observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function navigation() {
    const push = history.pushState;
    const replace = history.replaceState;

    history.pushState = function(...args) {
      const result = push.apply(this, args);
      setTimeout(() => loadOrders(true), 300);
      return result;
    };

    history.replaceState = function(...args) {
      const result = replace.apply(this, args);
      setTimeout(() => loadOrders(true), 300);
      return result;
    };

    window.addEventListener("popstate", () => setTimeout(() => loadOrders(true), 300));
  }

  async function init() {
    styles();
    events();
    fetchHook();
    navigation();
    observer();
    await loadOrders(true);
    scheduleRender(300);
    setTimeout(() => loadOrders(true), 1800);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
