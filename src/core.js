// Imperia Suite — núcleo comum dos módulos.
// Carregado antes dos módulos pelo userscript imperia.user.js.
// Roda no contexto da página (@grant none), então tem acesso a xajax_*, containersStuff etc.

(function () {
  'use strict';

  if (window.IO && window.IO.register) return; // já carregado

  // ---------- utilidades ----------
  const $ = (root, sel) => root.querySelector(sel);
  const $$ = (root, sel) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const unhtml = (s) => { const d = document.createElement('textarea'); d.innerHTML = String(s == null ? '' : s); return d.value; };
  const pad2 = (n) => String(n).padStart(2, '0');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // "21,1M" → 21100000 · "30 063" → 30063 · "488,5K" → 488500
  function parseAmount(text) {
    const s = unhtml(text).replace(/\s| /g, '').trim();
    const m = s.match(/^(-?[\d.]*,?\d+)\s*([KM])?$/i);
    if (!m) return parseInt(s.replace(/\D/g, ''), 10) || 0;
    const value = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
    const mult = m[2] ? (m[2].toUpperCase() === 'M' ? 1e6 : 1e3) : 1;
    return Math.round(value * mult);
  }

  // inteiro simples, ignorando separadores ("1&nbsp;166&nbsp;791" → 1166791)
  const toNumber = (s) => parseInt(unhtml(s).replace(/\D/g, ''), 10) || 0;
  const fmt = (n) => Number(n || 0).toLocaleString('pt-PT').replace(/ |\s/g, ' ');

  function formatDuration(totalSeconds) {
    const s = Math.round(totalSeconds);
    return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
  }

  // ---------- comunicação com o jogo ----------
  // Faz a mesma requisição que uma chamada xajax_* faria, sem mexer na interface.
  async function xajaxRaw(fn, args = []) {
    const body = `xjxfun=${fn}&xjxr=${Date.now()}&` + args.map((a) => 'xjxargs[]=' + encodeURIComponent(a)).join('&');
    const res = await fetch('xajax_loader.php?tFunct=' + fn, {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.text();
  }

  // Extrai o HTML de um <cmd cmd="as"> da resposta. Sem elementId, junta todos.
  function xajaxHtml(xml, elementId) {
    const re = elementId
      ? new RegExp(`<cmd cmd="as" id="${elementId}"[^>]*><!\\[CDATA\\[S([\\s\\S]*?)\\]\\]></cmd>`)
      : /<!\[CDATA\[S([\s\S]*?)\]\]>/g;
    if (elementId) {
      const m = xml.match(re);
      return m ? m[1] : '';
    }
    return [...xml.matchAll(re)].map((m) => m[1]).join('\n');
  }

  // HTML da resposta como elemento pronto para consulta (sem executar nada).
  function xajaxDom(xml, elementId) {
    const div = document.createElement('div');
    div.innerHTML = xajaxHtml(xml, elementId).replace(/<script[\s\S]*?<\/script>/g, '');
    return div;
  }

  const gameClock = () => {
    const el = document.getElementById('game-clock');
    const m = el && el.textContent.match(/\d{1,2}:\d{2}:\d{2}/);
    return m ? m[0] : null;
  };

  const playerRaceId = () => String(window.playerRaceId || (document.body.className.match(/race-id-(\d+)/) || [])[1] || 1);

  // ---------- janelas nativas ----------
  // Abre (ou traz para a frente) uma janela do jogo e devolve o <td> do conteúdo.
  function openWindow({ saveName, title, template = 'untabbed', ...rest }) {
    const cs = window.containersStuff;
    if (!cs) return null;
    const winId = cs.findContaner({ saveName, title, template, ...rest });
    const box = document.getElementById('messagebox' + winId);
    if (!box) return null;
    return { winId, box, applyTemplate: () => {
      try { cs.switchTemplate(String(winId), template); } catch (e) { /* ignorado */ }
      try { cs.afterPositioning(); } catch (e) { /* ignorado */ }
    } };
  }

  // Moldura padrão das janelas do jogo em volta do conteúdo do módulo.
  const windowFrame = (inner) => `
    <span class="window-decor-left"></span><span class="window-decor-right"></span>
    <div class="window-size window-middle">
      ${inner}
      <div class="window-footer"><div class="window-footer-top"></div><div class="window-footer-content"><div></div></div></div>
    </div>`;

  // ---------- estilos e botões ----------
  function injectStyles(id, css) {
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
  }

  // Botão redondo na coluna de ícones à direita da aldeia.
  function addMenuButton({ id, title, html, onClick, check }) {
    const place = () => {
      const menu = document.querySelector('#cuirass ul.right-menu');
      if (!menu) return;
      let li = document.getElementById(id);
      if (!li) {
        li = document.createElement('li');
        li.id = id;
        li.className = 'visible';
        li.innerHTML = `<a href="javascript:void(0)" title="${esc(title)}">${html}</a>`;
        li.querySelector('a').addEventListener('click', (e) => { e.preventDefault(); onClick(); });
        menu.appendChild(li);
      }
      if (check) check(li);
    };
    place();
    setInterval(place, 2000);
  }

  // Botão na barra de ícones do rodapé.
  function addFooterButton({ className, title, html, onClick }) {
    const place = () => {
      const ul = document.querySelector('.footer-links ul');
      if (!ul || ul.querySelector('li.' + className)) return;
      const li = document.createElement('li');
      li.className = className;
      li.innerHTML = `<a href="javascript:void(0)" title="${esc(title)}">${html}</a>`;
      li.querySelector('a').addEventListener('click', (e) => { e.preventDefault(); onClick(); });
      ul.insertBefore(li, ul.firstChild);
    };
    place();
    setInterval(place, 3000);
  }

  // ---------- armazenamento ----------
  const local = {
    get(key, fallback = {}) {
      try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch (e) { return { ...fallback }; }
    },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignorado */ } },
  };

  const DB_NAME = 'imperia-scripts';
  const DB_STORE = 'kv';
  function idb(mode, fn) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(DB_STORE);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction(DB_STORE, mode);
        const req = fn(tx.objectStore(DB_STORE));
        tx.oncomplete = () => { resolve(req && req.result); open.result.close(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }
  const db = {
    get: (key) => idb('readonly', (s) => s.get(key)).catch(() => null),
    set: (key, value) => idb('readwrite', (s) => s.put(value, key)),
  };

  // ---------- registo de módulos ----------
  const modules = [];

  const IO = {
    version: '2.0.0',
    modules,
    register(mod) {
      if (!mod || !mod.id || typeof mod.init !== 'function') return;
      if (modules.some((m) => m.id === mod.id)) return;
      modules.push(mod);
      if (IO.started) IO.startModule(mod);
    },
    startModule(mod) {
      if (mod.started) return;
      mod.started = true;
      try { mod.init(IO); } catch (err) { console.error('[Imperia Suite] falhou o módulo ' + mod.id, err); }
    },
    start() {
      IO.started = true;
      modules.forEach(IO.startModule);
    },
    started: false,
    utils: { $, $$, esc, unhtml, pad2, sleep, parseAmount, toNumber, fmt, formatDuration },
    game: { xajaxRaw, xajaxHtml, xajaxDom, gameClock, playerRaceId },
    ui: { openWindow, windowFrame, injectStyles, addMenuButton, addFooterButton },
    store: { local, db },
  };

  window.IO = IO;
})();
