// Módulo: radar do mapa global (colónias, centros militares e recursos especiais de 10%).
IO.register({
  id: 'radar-mapa',
  name: 'Radar do Mapa',

  init(IO) {
    const { $, $$, esc, unhtml, toNumber, fmt, sleep } = IO.utils;
    const SAVE_NAME = 'io_map_radar';
    const WINDOW_TITLE = 'Radar do Mapa';
    const BUTTON_CLASS = 'footer-item-io-radar';
    const PREFS_KEY = 'io_map_radar_prefs';
    const DB_RECORD = 'map-radar-scan';

    const MAP = { size: 2000, block: 10, blocksPerRow: 200 };
    const BLOCKS_PER_REQUEST = 50;
    const BLOCKS_PER_REQUEST_FULL = 100; // o servidor aceita 100 blocos por pedido
    const REQUEST_DELAY_MS = 350;
    const PAGE_SIZE = 50;
    const RADIUS_OPTIONS = [
      { value: 50, label: '50' },
      { value: 100, label: '100' },
      { value: 200, label: '200' },
      { value: 400, label: '400' },
      { value: 0, label: 'Mapa inteiro' },
    ];

    const KINDS = {
      colony: { label: 'Colónias', single: 'Colónia', color: '#7a4a12' },
      military: { label: 'Centros Militares', single: 'Centro Militar', color: '#8a1f12' },
      resource: { label: 'Recursos especiais 10%', single: 'Recurso 10%', color: '#2e6b1f' },
    };
    const RESOURCE_BONUS = '10%';
    // A régua do mapa numera quadrantes de 4 coordenadas: o quadrante que começa em 4k aparece como k+1.
    const QUADRANT = 4;
    const quadrant = (v) => Math.floor(v / QUADRANT) + 1;
    const fromQuadrant = (q) => (q - 1) * QUADRANT + QUADRANT / 2; // centro do quadrante
    const distance = (a, b) => Math.floor(Math.hypot(a.x - b.x, a.y - b.y));

    // ações do menu do mapa (json/map_menu_actions.php) que a ferramenta expõe
    const ACT = { spyColony: 17 };

    const DEFAULT_PREFS = { radius: 100, kind: '', text: '', resource: '', bonus: '', maxDist: '', sort: 'dist', manualBase: null };
    const loadPrefs = () => IO.store.local.get(PREFS_KEY, DEFAULT_PREFS);
    const savePrefs = (p) => IO.store.local.set(PREFS_KEY, p);

    // Coordenadas do Império: argumentos que o jogo passa para displayMap ao abrir o Mapa Global.
    async function detectBase() {
      const xml = await IO.game.xajaxRaw('showGlobalMapJS', ['N0']);
      const m = xml.match(/func="displayMap">[\s\S]*?<k>N1<\/k><v>N(\d+)<\/v>[\s\S]*?<k>N2<\/k><v>N(\d+)<\/v>/);
      return m ? { x: +m[1], y: +m[2] } : null;
    }

    // Resposta de json/dynamic_map_objects.php: base64 intercalado com caracteres de controle.
    const DECODE_KEYS = { D: 6, I: 7, Y: 8, A: 9, N: 10 };
    function decodeMap(text) {
      try { return JSON.parse(text); } catch (e) { /* formato codificado */ }
      let k = 0, out = '';
      while (k < text.length - 1) {
        const step = DECODE_KEYS[text[k]];
        if (!step) break;
        out += text.substr(k + 1, step);
        k += step + 1;
      }
      return JSON.parse(decodeURIComponent(escape(atob(out))));
    }

    async function fetchBlocks(ids) {
      const res = await fetch('json/dynamic_map_objects.php?' + ids.map((b) => 'b=' + b).join('&'), { credentials: 'include' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return decodeMap(await res.text());
    }

    let mapImages = null;
    async function loadMapImages() {
      if (mapImages) return mapImages;
      try {
        const res = await fetch('json/map_config.php', { credentials: 'include' });
        const conf = decodeMap(await res.text());
        mapImages = {};
        Object.entries(conf.objects || {}).forEach(([type, o]) => { if (o && o.image) mapImages[type] = o.image; });
      } catch (e) { mapImages = {}; }
      return mapImages;
    }

    function blocksInRadius(base, radius) {
      const ids = [];
      const maxB = MAP.size / MAP.block;
      const clamp = (v) => Math.max(0, Math.min(maxB - 1, v));
      const [bx0, bx1, by0, by1] = radius > 0
        ? [clamp(Math.floor((base.x - radius) / MAP.block)), clamp(Math.floor((base.x + radius) / MAP.block)),
          clamp(Math.floor((base.y - radius) / MAP.block)), clamp(Math.floor((base.y + radius) / MAP.block))]
        : [0, maxB - 1, 0, maxB - 1];
      for (let by = by0; by <= by1; by++) {
        for (let bx = bx0; bx <= bx1; bx++) {
          if (radius > 0) {
            // ponto do bloco mais próximo da base
            const nx = Math.max(bx * MAP.block, Math.min(base.x, bx * MAP.block + MAP.block - 1));
            const ny = Math.max(by * MAP.block, Math.min(base.y, by * MAP.block + MAP.block - 1));
            if (Math.hypot(nx - base.x, ny - base.y) > radius) continue;
          }
          ids.push(by * MAP.blocksPerRow + bx);
        }
      }
      return ids;
    }

    function parseObject(cell, o, blockId) {
      const t = {};
      (o.ttp || []).forEach((e) => { if (e && e.key) t[String(e.key).trim()] = e.vl; });
      const x = +cell.x, y = +cell.y;
      const terrain = unhtml(t['Tipo de terreno'] || '');
      const srvDist = t['Distância para o Império'];
      const base = { id: String(o.id), type: String(o.type), x, y, block: blockId, acs: o.acs || [],
        srvDist: srvDist === undefined || srvDist === '' ? null : +srvDist };
      const size = unhtml(t['Tamanho do bónus'] || '').trim();
      const bonus = t['Tipo de bónus']
        ? { bonusType: unhtml(t['Tipo de bónus']), bonusSize: /^\d+([.,]\d+)?$/.test(size) ? size + '%' : size }
        : {};
      const resourceName = /^recurso especial/i.test(terrain) ? terrain.replace(/^recurso especial\s*/i, '') : '';

      // Impérios não são listados; servem só para achar o id do dono de colónias que vêm sem ele.
      if (t['Nome de utilizador'] !== undefined) {
        return { kind: 'owner', name: unhtml(t['Nome de utilizador']), userId: String(o.id) };
      }
      if (o.colony && t['Dono']) {
        const ownerId = String(o.id).split('|')[1] || '';
        return { ...base, kind: 'colony', name: unhtml(t['Dono']), userId: ownerId, points: toNumber(t['Pontos']),
          alliance: unhtml(t['Aliança'] || ''), raceId: o.race_id || 0, terrain, resourceName, ...bonus };
      }
      if (/^centro militar/i.test(terrain)) {
        return { ...base, kind: 'military', name: terrain, alliance: unhtml(t['Aliança'] || '') };
      }
      if (resourceName && bonus.bonusSize === RESOURCE_BONUS) {
        return { ...base, kind: 'resource', name: resourceName, resourceName, terrain, ...bonus };
      }
      return null;
    }

    function parseBlocks(json, owners) {
      const items = [];
      (json.blocks || []).forEach((block) => {
        (block.data || []).forEach((cell) => {
          (cell.obs || []).forEach((o) => {
            const item = parseObject(cell, o, block.id);
            if (!item) return;
            if (item.kind === 'owner') owners[item.name] = item.userId;
            else items.push(item);
          });
        });
      });
      return items;
    }

    // ---------- estado ----------
    const state = {
      prefs: loadPrefs(),
      scan: null, // { timestamp, base, radius, items, owners }
      detectedBase: null,
      scanning: false,
      cancel: false,
      page: 0,
      root: null,
    };
    const currentBase = () => state.prefs.manualBase || state.detectedBase || (state.scan && state.scan.base) || null;

    const RADAR_SVG = `
      <svg viewBox="0 0 50 50" width="42" height="42" aria-hidden="true">
        <defs>
          <radialGradient id="io-rd-paper" cx="50%" cy="45%" r="60%">
            <stop offset="0" stop-color="#f6e7bf"/><stop offset=".8" stop-color="#d9b877"/><stop offset="1" stop-color="#a97b36"/>
          </radialGradient>
          <linearGradient id="io-rd-brass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#ffe7a0"/><stop offset=".5" stop-color="#d49a2a"/><stop offset="1" stop-color="#7c4f10"/>
          </linearGradient>
        </defs>
        <circle cx="25" cy="25" r="19" fill="url(#io-rd-paper)" stroke="url(#io-rd-brass)" stroke-width="4"/>
        <circle cx="25" cy="25" r="19" fill="none" stroke="#4a2a08" stroke-width="1"/>
        <circle cx="25" cy="25" r="12" fill="none" stroke="#8a6a3a" stroke-width=".8" stroke-dasharray="2 2"/>
        <circle cx="25" cy="25" r="6" fill="none" stroke="#8a6a3a" stroke-width=".8"/>
        <path d="M25 25 L25 7 A18 18 0 0 1 40.6 16 Z" fill="rgba(46,107,31,.45)"/>
        <line x1="25" y1="25" x2="40.6" y2="16" stroke="#2e6b1f" stroke-width="1.6"/>
        <circle cx="33" cy="20" r="2.2" fill="#b3261e" stroke="#4a0e08" stroke-width=".6"/>
        <circle cx="18" cy="31" r="1.8" fill="#2f5d8a" stroke="#0e2238" stroke-width=".6"/>
        <circle cx="30" cy="33" r="1.6" fill="#7a4a12" stroke="#2a1604" stroke-width=".6"/>
        <circle cx="25" cy="25" r="2" fill="#4a2a08"/>
      </svg>`;

    IO.ui.injectStyles('io-rd-style', `
      .footer-links li.${BUTTON_CLASS} { width:52px; height:55px; }
      .footer-links li.${BUTTON_CLASS} a { display:flex; align-items:center; justify-content:center; width:52px; height:55px; background:none !important; }
      .footer-links li.${BUTTON_CLASS} svg { filter:drop-shadow(0 2px 2px rgba(0,0,0,.55)); transition:transform .15s, filter .15s; }
      .footer-links li.${BUTTON_CLASS}:hover svg { transform:scale(1.1); filter:drop-shadow(0 0 4px rgba(255,220,140,.8)) drop-shadow(0 2px 2px rgba(0,0,0,.55)); }

      .io-rd { width:760px; padding:10px 14px 6px; font:12px arial, verdana, sans-serif; color:#170e11; }
      .io-rd h3 { margin:10px 0 6px; font-size:13px; font-weight:bold; color:#3b2a14; border-bottom:1px solid #b09a6e; padding-bottom:3px; }
      .io-rd h3:first-child { margin-top:0; }
      .io-rd-bar { display:flex; flex-wrap:wrap; align-items:center; gap:8px 14px; }
      .io-rd-field { display:inline-flex; align-items:center; gap:5px; }
      .io-rd input[type=text], .io-rd input[type=number], .io-rd select { height:22px; box-sizing:border-box; padding:1px 5px;
        border:1px solid #8b7355; background:#fffdf6; color:#170e11; font:12px arial, verdana, sans-serif; }
      .io-rd input:focus, .io-rd select:focus { outline:none; border-color:#7a1f0e; box-shadow:0 0 3px rgba(122,31,14,.5); }
      .io-rd input.io-rd-coord { width:52px; }
      .io-rd .io-rd-muted { color:#6d5a3a; }
      .io-rd .io-rd-link { color:#7a1f0e; text-decoration:underline; cursor:pointer; background:none; border:0; padding:0; font:inherit; }

      .io-rd-progress { position:relative; flex:1 1 180px; height:16px; border:1px solid #8b7355; background:#efe2c2; border-radius:2px; overflow:hidden; }
      .io-rd-progress b { position:absolute; inset:0; transform:scaleX(0); transform-origin:left; background:linear-gradient(#c9973e,#8a5a12); transition:transform .2s; }
      .io-rd-progress span { position:relative; display:block; text-align:center; line-height:16px; font-size:11px; font-weight:bold; color:#2a1a08; }

      .io-rd-kinds { display:flex; flex-wrap:wrap; gap:4px; margin:6px 0; }
      .io-rd-kind { display:inline-flex; align-items:center; gap:5px; height:24px; padding:0 8px; border:1px solid #a8864a; border-radius:3px;
        background:rgba(255,255,255,.25); color:#3b2a14; font:12px arial, verdana, sans-serif; cursor:pointer; }
      .io-rd-kind:hover { background:rgba(255,255,255,.45); }
      .io-rd-kind.selected { border-color:#7a1f0e; background:rgba(122,31,14,.15); color:#7a1f0e; font-weight:bold; }
      .io-rd-kind i { display:inline-block; width:9px; height:9px; border-radius:50%; }
      .io-rd-kind em { font-style:normal; font-size:11px; color:#6d5a3a; }

      .io-rd table.data-grid { width:100%; margin:0; table-layout:fixed; }
      .io-rd table.data-grid th, .io-rd table.data-grid td { padding:3px 5px; vertical-align:middle; }
      .io-rd table.data-grid th.io-rd-sort { cursor:pointer; white-space:nowrap; }
      .io-rd table.data-grid th.io-rd-sort.active { text-decoration:underline; }
      .io-rd td.io-rd-num { text-align:right; white-space:nowrap; }
      .io-rd td.io-rd-center { text-align:center; white-space:nowrap; }
      .io-rd .io-rd-thumb { width:30px; height:30px; background:center/contain no-repeat; }
      .io-rd .io-rd-name { font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .io-rd .io-rd-sub { font-size:11px; color:#5b4526; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .io-rd .io-rd-tag { display:inline-block; padding:0 4px; border-radius:2px; color:#fff; font-size:10px; line-height:14px; margin-right:3px; }
      .io-rd .io-rd-bonus { color:#1f4f0e; font-weight:bold; }
      .io-rd .io-rd-actions { white-space:nowrap; text-align:right; }
      .io-rd .io-rd-actions button { height:20px; margin-left:2px; padding:0 5px; border:1px solid #8b6a3a; border-radius:2px;
        background:linear-gradient(#f3e3bc,#d8bd83); color:#3b2a14; font:11px arial, verdana, sans-serif; cursor:pointer; }
      .io-rd .io-rd-actions button:hover { background:linear-gradient(#fff1cf,#e6cb90); border-color:#7a1f0e; }
      .io-rd-confirm { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-top:6px; padding:5px 8px;
        border:1px solid #a8864a; background:rgba(255,236,180,.6); }
      .io-rd-confirm[hidden] { display:none; }
      .io-rd-pager { display:flex; justify-content:space-between; align-items:center; margin-top:6px; }
      .io-rd-empty { text-align:center; padding:18px 0; color:#6d5a3a; }
    `);

    // ---------- janela ----------
    async function openWindow() {
      const win = IO.ui.openWindow({ saveName: SAVE_NAME, title: WINDOW_TITLE });
      if (!win) return;
      if (state.root && win.box.contains(state.root)) return; // já aberta: mantém o estado

      win.box.innerHTML = windowHtml();
      win.applyTemplate();
      state.root = $(win.box, '.io-rd');
      bindWindow();

      if (!state.scan) state.scan = await IO.store.db.get(DB_RECORD);
      renderAll();
      loadMapImages().then(() => renderResults());
      if (!state.detectedBase) {
        detectBase().then((b) => { if (b) { state.detectedBase = b; renderBase(); renderResults(); } }).catch(() => {});
      }
    }

    function windowHtml() {
      const p = state.prefs;
      return IO.ui.windowFrame(`
        <div class="io-rd">
          <h3>Varredura</h3>
          <div class="io-rd-bar">
            <span class="io-rd-field" title="Quadrante do Império, como na régua do Mapa Global">Meu Império:
              <input class="io-rd-coord" data-base="x" type="number" min="1" max="500">
              <input class="io-rd-coord" data-base="y" type="number" min="1" max="500">
              <button type="button" class="io-rd-link io-rd-base-auto" title="Voltar à coordenada detectada">auto</button>
            </span>
            <span class="io-rd-field">Raio:
              <select data-pref="radius">${RADIUS_OPTIONS.map((r) => `<option value="${r.value}"${+p.radius === r.value ? ' selected' : ''}>${r.label}</option>`).join('')}</select>
            </span>
            <button type="button" class="button-v2 io-rd-scan">Varrer mapa</button>
            <div class="io-rd-progress" hidden><b></b><span></span></div>
          </div>
          <div class="io-rd-confirm" hidden>
            <span class="io-rd-confirm-text"></span>
            <button type="button" class="button-v2 io-rd-confirm-yes">Varrer mesmo assim</button>
            <button type="button" class="io-rd-link io-rd-confirm-no">cancelar</button>
          </div>
          <div class="io-rd-scaninfo io-rd-muted" style="margin-top:5px"></div>

          <h3>Filtros</h3>
          <div class="io-rd-kinds"></div>
          <div class="io-rd-bar">
            <span class="io-rd-field"><input type="text" data-pref="text" placeholder="Jogador ou aliança" style="width:150px" value="${esc(p.text)}"></span>
            <span class="io-rd-field">Recurso: <select data-pref="resource"></select></span>
            <span class="io-rd-field">Bónus: <select data-pref="bonus"></select></span>
            <span class="io-rd-field">Dist. máx.: <input type="number" min="0" data-pref="maxDist" style="width:60px" value="${esc(p.maxDist)}"></span>
          </div>

          <h3 class="io-rd-results-title">Resultados</h3>
          <div class="io-rd-results"></div>
        </div>`);
    }

    function bindWindow() {
      const root = state.root;
      $$(root, '[data-pref]').forEach((el) => {
        const handler = () => {
          state.prefs[el.dataset.pref] = el.value;
          savePrefs(state.prefs);
          if (el.dataset.pref !== 'radius') { state.page = 0; renderResults(); }
        };
        el.addEventListener(el.type === 'text' || el.type === 'number' ? 'input' : 'change', handler);
      });
      $$(root, '[data-base]').forEach((el) => {
        el.addEventListener('input', () => {
          const qx = parseInt($(root, '[data-base="x"]').value, 10), qy = parseInt($(root, '[data-base="y"]').value, 10);
          state.prefs.manualBase = Number.isFinite(qx) && Number.isFinite(qy) ? { x: fromQuadrant(qx), y: fromQuadrant(qy) } : null;
          savePrefs(state.prefs);
          renderResults();
        });
      });
      $(root, '.io-rd-base-auto').addEventListener('click', () => {
        state.prefs.manualBase = null; savePrefs(state.prefs); renderBase(); renderResults();
      });
      $(root, '.io-rd-scan').addEventListener('click', () => (state.scanning ? (state.cancel = true) : runScan()));
      $(root, '.io-rd-confirm-yes').addEventListener('click', () => { fullScanConfirmed = true; runScan(); });
      $(root, '.io-rd-confirm-no').addEventListener('click', hideFullScanConfirm);

      root.addEventListener('click', (e) => {
        const kindBtn = e.target.closest('.io-rd-kind');
        if (kindBtn) { state.prefs.kind = kindBtn.dataset.kind; savePrefs(state.prefs); state.page = 0; renderResults(); return; }
        const sortTh = e.target.closest('.io-rd-sort');
        if (sortTh) { state.prefs.sort = sortTh.dataset.sort; savePrefs(state.prefs); state.page = 0; renderResults(); return; }
        const pageBtn = e.target.closest('[data-page]');
        if (pageBtn) { state.page = +pageBtn.dataset.page; renderResults(); return; }
        const actBtn = e.target.closest('[data-act]');
        if (actBtn) runAction(actBtn.dataset.act, actBtn.dataset.idx);
      });
    }

    // ---------- varredura ----------
    let fullScanConfirmed = false;

    function showFullScanConfirm(text) {
      const box = state.root && $(state.root, '.io-rd-confirm');
      if (!box) return;
      $(box, '.io-rd-confirm-text').textContent = text;
      box.hidden = false;
    }

    function hideFullScanConfirm() {
      const box = state.root && $(state.root, '.io-rd-confirm');
      if (box) box.hidden = true;
    }

    async function runScan() {
      const root = state.root;
      let base = currentBase();
      if (!base) {
        base = await detectBase().catch(() => null);
        if (base) state.detectedBase = base;
      }
      const radius = +state.prefs.radius;
      if (!base && radius > 0) { setScanInfo('Não foi possível detectar a coordenada do Império. Preencha X e Y.'); return; }

      const ids = blocksInRadius(base || { x: 1000, y: 1000 }, radius);
      const perRequest = radius === 0 ? BLOCKS_PER_REQUEST_FULL : BLOCKS_PER_REQUEST;
      const requests = Math.ceil(ids.length / perRequest);
      // Confirmação dentro da janela (window.confirm pode ser bloqueado pelo navegador).
      if (radius === 0 && !fullScanConfirmed) {
        const minutes = Math.ceil(requests * (REQUEST_DELAY_MS + 1100) / 60000);
        showFullScanConfirm(`O mapa inteiro faz ${fmt(requests)} requisições e leva cerca de ${minutes} min.`);
        return;
      }
      fullScanConfirmed = false;
      hideFullScanConfirm();

      state.scanning = true; state.cancel = false;
      const btn = $(root, '.io-rd-scan'), bar = $(root, '.io-rd-progress');
      btn.textContent = 'Cancelar'; bar.hidden = false;
      const found = [];
      const owners = { ...((state.scan && state.scan.owners) || {}) };
      const scannedBlocks = new Set();
      let errors = 0;

      for (let i = 0; i < ids.length; i += perRequest) {
        if (state.cancel) break;
        const chunk = ids.slice(i, i + perRequest);
        try {
          const json = await fetchBlocks(chunk);
          found.push(...parseBlocks(json, owners));
          chunk.forEach((b) => scannedBlocks.add(String(b)));
        } catch (err) {
          errors++;
          if (errors >= 3) { setScanInfo('Varredura interrompida: o servidor recusou várias requisições seguidas (' + err.message + ').'); break; }
          await sleep(2000);
        }
        const done = Math.min(ids.length, i + perRequest);
        if (document.contains(bar)) {
          $(bar, 'b').style.transform = `scaleX(${done / ids.length})`;
          $(bar, 'span').textContent = `${Math.round(done / ids.length * 100)}% · ${fmt(found.length)} objetos`;
        }
        await sleep(REQUEST_DELAY_MS);
      }

      // mescla: substitui só os blocos que foram lidos agora (o servidor devolve o id do bloco como texto)
      const previous = ((state.scan && state.scan.items) || [])
        .filter((it) => KINDS[it.kind] && (it.kind !== 'resource' || it.bonusSize === RESOURCE_BONUS));
      const items = previous.filter((it) => !scannedBlocks.has(String(it.block))).concat(found);
      const unique = new Map(items.map((it) => [it.kind + ':' + it.id + ':' + it.x + ':' + it.y, it]));
      state.scan = { timestamp: Date.now(), base, radius, items: [...unique.values()], owners, partial: state.cancel };
      await IO.store.db.set(DB_RECORD, state.scan).catch(() => {});

      state.scanning = false;
      if (document.contains(btn)) { btn.textContent = 'Varrer mapa'; bar.hidden = true; }
      renderAll();
    }

    // ---------- ações ----------
    let lastList = [];

    function runAction(act, idx) {
      const it = lastList[+idx];
      if (!it) return;
      const cs = window.containersStuff;
      switch (act) {
        case 'map':
          window.xajax_showGlobalMapJS(cs.findContaner({ saveName: 'global_map', title: 'Mapa Global', positionTop: 60, positionLeft: 0, template: 'fullwidth', positionElementId: 'cycle-provinces' }));
          goToWhenReady(it.x, it.y);
          break;
        case 'profile':
          window.xajax_showGameProfiles(cs.findContaner({ saveName: 'profiles', title: 'Perfis', positionVisibleScreen: true }), 'NULL', it.userId);
          break;
        case 'spy':
          window.do_action2(ACT.spyColony, it.id);
          break;
        default:
      }
    }

    function goToWhenReady(x, y, tries = 0) {
      setTimeout(() => {
        try {
          if (document.getElementById('map_main') && window.map && typeof window.map.goTo === 'function') { window.map.goTo(x, y); return; }
        } catch (e) { /* mapa ainda iniciando */ }
        if (tries < 20) goToWhenReady(x, y, tries + 1);
      }, 400);
    }

    // ---------- renderização ----------
    function setScanInfo(text) { const el = state.root && $(state.root, '.io-rd-scaninfo'); if (el) el.textContent = text; }

    function renderAll() { renderBase(); renderScanInfo(); renderFilterOptions(); renderResults(); }

    function renderBase() {
      const root = state.root; if (!root) return;
      const b = currentBase();
      $(root, '[data-base="x"]').value = b ? quadrant(b.x) : '';
      $(root, '[data-base="y"]').value = b ? quadrant(b.y) : '';
      $(root, '.io-rd-base-auto').hidden = !state.prefs.manualBase;
    }

    function renderScanInfo() {
      if (!state.scan) { setScanInfo('Nenhuma varredura guardada. Escolha o raio e clique em "Varrer mapa".'); return; }
      const s = state.scan;
      const when = new Date(s.timestamp).toLocaleString('pt-PT');
      const area = s.radius > 0 ? `raio ${s.radius} a partir do quadrante ${quadrant(s.base.x)}:${quadrant(s.base.y)}` : 'mapa inteiro';
      setScanInfo(`Última varredura: ${when} · ${area} · ${fmt(s.items.length)} objetos guardados${s.partial ? ' · incompleta (cancelada)' : ''}`);
    }

    function renderFilterOptions() {
      const root = state.root; if (!root) return;
      const items = (state.scan && state.scan.items) || [];
      const resources = [...new Set(items.map((i) => i.resourceName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt'));
      const bonuses = [...new Set(items.map((i) => i.bonusSize).filter(Boolean))].sort((a, b) => parseFloat(a) - parseFloat(b));
      const fill = (sel, values, allLabel, current) => {
        sel.innerHTML = `<option value="">${allLabel}</option>` + values.map((v) => `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${esc(v)}</option>`).join('');
      };
      fill($(root, '[data-pref="resource"]'), resources, 'Todos', state.prefs.resource);
      fill($(root, '[data-pref="bonus"]'), bonuses, 'Todos', state.prefs.bonus);
    }

    function filtered() {
      const p = state.prefs;
      const base = currentBase();
      const text = String(p.text || '').trim().toLowerCase();
      const maxDist = parseInt(p.maxDist, 10);
      // Com a base detectada, a distância informada pelo servidor é a mesma usada pelo jogo.
      const useServerDist = !p.manualBase && state.detectedBase && state.scan && state.scan.base
        && state.scan.base.x === state.detectedBase.x && state.scan.base.y === state.detectedBase.y;
      const owners = (state.scan && state.scan.owners) || {};
      // descarta tipos que não são mais listados (varreduras antigas)
      const items = ((state.scan && state.scan.items) || [])
        .filter((i) => KINDS[i.kind] && (i.kind !== 'resource' || i.bonusSize === RESOURCE_BONUS));
      const all = items.map((it) => ({
        ...it,
        userId: it.userId || (it.kind === 'colony' ? owners[it.name] || '' : ''),
        dist: useServerDist && it.srvDist !== null && it.srvDist !== undefined ? it.srvDist : (base ? distance(base, it) : null),
      }));

      const counts = {};
      const list = all.filter((it) => {
        if (text && !(`${it.name || ''} ${it.alliance || ''}`.toLowerCase().includes(text))) return false;
        if (p.resource && it.resourceName !== p.resource) return false;
        if (p.bonus && it.bonusSize !== p.bonus) return false;
        if (Number.isFinite(maxDist) && it.dist !== null && it.dist > maxDist) return false;
        counts[it.kind] = (counts[it.kind] || 0) + 1;
        return !p.kind || it.kind === p.kind;
      });

      const sorters = {
        dist: (a, b) => (a.dist ?? 1e9) - (b.dist ?? 1e9),
        points: (a, b) => (b.points || 0) - (a.points || 0),
        name: (a, b) => String(a.name).localeCompare(String(b.name), 'pt'),
        alliance: (a, b) => String(a.alliance || '~').localeCompare(String(b.alliance || '~'), 'pt'),
      };
      list.sort(sorters[p.sort] || sorters.dist);
      return { list, counts };
    }

    function renderResults() {
      const root = state.root; if (!root || !document.contains(root)) return;
      const { list, counts } = filtered();
      lastList = list;

      const totalFiltered = Object.values(counts).reduce((a, b) => a + b, 0);
      $(root, '.io-rd-kinds').innerHTML = [['', 'Todos', null, totalFiltered]]
        .concat(Object.entries(KINDS).map(([k, v]) => [k, v.label, v.color, counts[k] || 0]))
        .map(([k, label, color, n]) => `<button type="button" class="io-rd-kind${state.prefs.kind === k ? ' selected' : ''}" data-kind="${k}">
            ${color ? `<i style="background:${color}"></i>` : ''}${label} <em>${fmt(n)}</em></button>`).join('');

      const out = $(root, '.io-rd-results');
      $(root, '.io-rd-results-title').textContent = `Resultados (${fmt(list.length)})`;
      if (!state.scan) { out.innerHTML = '<div class="io-rd-empty">Faça uma varredura para ver os objetos do mapa.</div>'; return; }
      if (!list.length) { out.innerHTML = '<div class="io-rd-empty">Nenhum objeto com esses filtros.</div>'; return; }

      const pages = Math.ceil(list.length / PAGE_SIZE);
      state.page = Math.min(state.page, pages - 1);
      const start = state.page * PAGE_SIZE;
      const images = mapImages || {};
      const sortTh = (key, label, width) => `<th class="io-rd-sort${state.prefs.sort === key ? ' active' : ''}" data-sort="${key}" style="width:${width}">${label}</th>`;
      const rows = list.slice(start, start + PAGE_SIZE).map((it, n) => {
        const idx = start + n;
        const k = KINDS[it.kind];
        const img = images[it.type] ? `style="background-image:url('${esc(images[it.type])}')"` : '';
        let sub = '';
        if (it.kind === 'colony') sub = it.resourceName ? `Recurso ${esc(it.resourceName)}` : esc(it.terrain);
        if (it.bonusType) sub = `${sub ? sub + ' · ' : ''}<span class="io-rd-bonus">${esc(it.bonusSize)}</span> ${esc(it.bonusType)}`;
        if (it.kind === 'resource') sub = `<span class="io-rd-bonus">${esc(it.bonusSize)}</span> ${esc(it.bonusType || '')}`;

        const canSpy = it.kind === 'colony' && it.acs.includes(ACT.spyColony);
        const actions = [
          `<button type="button" data-act="map" data-idx="${idx}" title="Mostrar no Mapa Global">Mapa</button>`,
          it.userId ? `<button type="button" data-act="profile" data-idx="${idx}" title="Perfil do jogador">Perfil</button>` : '',
          canSpy ? `<button type="button" data-act="spy" data-idx="${idx}" title="Abrir tela de espionagem">Espiar</button>` : '',
        ].join('');

        return `<tr>
          <td class="io-rd-center"><div class="io-rd-thumb" ${img} title="${esc(k.single)}"></div></td>
          <td><div class="io-rd-name"><span class="io-rd-tag" style="background:${k.color}">${esc(k.single)}</span>${esc(it.name)}</div>
              <div class="io-rd-sub">${sub}</div></td>
          <td><div class="io-rd-name" style="font-weight:normal">${esc(it.alliance || '—')}</div></td>
          <td class="io-rd-num">${it.points ? fmt(it.points) : '—'}</td>
          <td class="io-rd-center" title="Coordenada interna ${it.x}:${it.y}">${quadrant(it.x)}:${quadrant(it.y)}</td>
          <td class="io-rd-num">${it.dist === null ? '—' : fmt(it.dist)}</td>
          <td class="io-rd-actions">${actions}</td>
        </tr>`;
      }).join('');

      out.innerHTML = `
        <table class="data-grid espy">
          <tr><th style="width:38px"></th>${sortTh('name', 'Nome', '30%')}${sortTh('alliance', 'Aliança', '15%')}${sortTh('points', 'Pontos', '11%')}
            <th style="width:70px" title="Quadrante, como na régua do Mapa Global">Quadrante</th>${sortTh('dist', 'Dist.', '52px')}<th style="width:130px"></th></tr>
          ${rows}
        </table>
        <div class="io-rd-pager">
          <span class="io-rd-muted">${fmt(start + 1)}–${fmt(Math.min(list.length, start + PAGE_SIZE))} de ${fmt(list.length)}</span>
          <span>
            <button type="button" class="button-v2" data-page="${state.page - 1}"${state.page === 0 ? ' disabled' : ''}>Anterior</button>
            <span class="io-rd-muted">&nbsp;página ${state.page + 1} de ${pages}&nbsp;</span>
            <button type="button" class="button-v2" data-page="${state.page + 1}"${state.page >= pages - 1 ? ' disabled' : ''}>Seguinte</button>
          </span>
        </div>`;
    }

    IO.ui.addFooterButton({ className: BUTTON_CLASS, title: WINDOW_TITLE, html: RADAR_SVG, onClick: openWindow });
  },
});
