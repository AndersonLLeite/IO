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

    const DEFAULT_PREFS = { radius: 100, kind: '', text: '', resource: '', bonus: '', maxDist: '', sort: 'dist', manualBase: null, tab: 'scan' };
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

    // O jogo troca os rótulos conforme o idioma (pt-PT: "Dono", "Tamanho do bónus";
    // pt-BR: "Dono da colônia", "Bônus"), então a busca ignora acentos e aceita variantes.
    const normalize = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    function pickKey(t, test) {
      const hit = Object.keys(t).find((k) => test(normalize(k)));
      return hit === undefined ? undefined : t[hit];
    }

    function parseObject(cell, o, blockId) {
      const t = {};
      (o.ttp || []).forEach((e) => { if (e && e.key) t[String(e.key).trim()] = e.vl; });
      const x = +cell.x, y = +cell.y;
      const terrain = unhtml(pickKey(t, (k) => k.includes('terreno')) || '');
      const srvDist = pickKey(t, (k) => k.startsWith('dist'));
      const base = { id: String(o.id), type: String(o.type), x, y, block: blockId, acs: o.acs || [],
        srvDist: srvDist === undefined || srvDist === '' ? null : +srvDist };
      const bonusType = pickKey(t, (k) => k.includes('bonus') && k.includes('tipo'));
      const size = unhtml(pickKey(t, (k) => k === 'bonus' || k.includes('tamanho')) || '').trim();
      const bonus = bonusType
        ? { bonusType: unhtml(bonusType), bonusSize: /^\d+([.,]\d+)?$/.test(size) ? size + '%' : size }
        : {};
      // Recursos especiais aparecem como "Recurso especial X" e, nos de 10%, "Campo rico em Recurso especial X".
      const resMatch = terrain.match(/recurso especial\s+(.+)$/i);
      const resourceName = resMatch ? resMatch[1].trim() : '';
      const richField = /campo rico/i.test(terrain);
      const userName = pickKey(t, (k) => k.includes('nome') && (k.includes('utilizador') || k.includes('usuario')));
      const ownerName = pickKey(t, (k) => k.startsWith('dono'));
      const alliance = unhtml(pickKey(t, (k) => k.startsWith('alian')) || '');
      const points = toNumber(pickKey(t, (k) => k.startsWith('pontos')));

      // Impérios não são listados; servem só para achar o id do dono de colónias que vêm sem ele.
      if (userName !== undefined) {
        return { kind: 'owner', name: unhtml(userName), userId: String(o.id) };
      }
      if (o.colony && ownerName) {
        const ownerId = String(o.id).split('|')[1] || '';
        return { ...base, kind: 'colony', name: unhtml(ownerName), userId: ownerId, points,
          alliance, raceId: o.race_id || 0, terrain, resourceName, ...bonus };
      }
      if (/^castelo/i.test(terrain)) {
        const castleName = unhtml(pickKey(t, (k) => k === 'nome') || terrain);
        return { ...base, kind: 'castle', name: castleName, terrain, alliance, cid: String(o.id).replace(/^castle/i, '') };
      }
      if (/^centro militar/i.test(terrain)) {
        // O jogo identifica cada CM pelo id sem o prefixo "castle" (ex.: castle380 → 380, castle6365_306 → 6365_306);
        // o "número" visível é o último grupo de dígitos. Um CM destruído e reconstruído recebe número novo.
        const cid = String(o.id).replace(/^castle/i, '');
        const numMatch = String(o.id).match(/(\d+)(?!.*\d)/);
        return { ...base, kind: 'military', name: terrain, alliance, cid, number: numMatch ? numMatch[1] : cid };
      }
      if (resourceName && bonus.bonusSize === RESOURCE_BONUS) {
        return { ...base, kind: 'resource', name: resourceName, resourceName, richField, terrain, ...bonus };
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
      .io-rd-tabs { display:flex; gap:4px; border-bottom:2px solid #a8864a; margin-bottom:8px; }
      .io-rd-tab { padding:5px 14px; border:1px solid #a8864a; border-bottom:0; border-radius:4px 4px 0 0; margin-bottom:-2px;
        background:linear-gradient(#e7d4a6,#cdb074); color:#4a3410; font:bold 12px arial, verdana, sans-serif; cursor:pointer; }
      .io-rd-tab:hover { background:linear-gradient(#f1e0b6,#d8bd83); }
      .io-rd-tab.active { background:#fffdf6; color:#7a1f0e; border-bottom:2px solid #fffdf6; }
      .io-rd-pane[hidden] { display:none; }
      .io-rd-atk { border:1px solid #a8864a; background:rgba(255,236,180,.55); padding:6px 8px; margin:4px 0; }
      .io-rd-atk[hidden] { display:none; }
      .io-rd-atk-head { border-bottom:1px solid #c3b18b; padding-bottom:3px; margin-bottom:3px; }
      .io-rd-atk-log { margin-top:4px; background:#f6efdd; border:1px solid #c8b184; padding:4px 6px; max-height:200px;
        overflow:auto; white-space:pre-wrap; font:11px/1.45 Consolas, monospace; }
      .io-rd-atk-log .io-rd-ok { color:#1f6b22; } .io-rd-atk-log .io-rd-err { color:#a3160a; }
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

      if (!state.scan) state.scan = await durableGet(DB_RECORD + '-' + realmId());
      renderAll();
      loadMapImages().then(() => renderResults());
      if (!state.detectedBase) {
        detectBase().then((b) => { if (b) { state.detectedBase = b; renderBase(); renderResults(); } }).catch(() => {});
      }
    }

    function windowHtml() {
      const p = state.prefs;
      const tab = state.prefs.tab === 'monitor' ? 'monitor' : 'scan';
      return IO.ui.windowFrame(`
        <div class="io-rd">
          <div class="io-rd-tabs">
            <button type="button" class="io-rd-tab${tab === 'scan' ? ' active' : ''}" data-tab="scan">Varredura do mapa</button>
            <button type="button" class="io-rd-tab${tab === 'monitor' ? ' active' : ''}" data-tab="monitor">Monitor de CMs</button>
          </div>

          <div class="io-rd-pane io-rd-pane-scan"${tab === 'scan' ? '' : ' hidden'}>
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
          </div>

          <div class="io-rd-pane io-rd-pane-monitor"${tab === 'monitor' ? '' : ' hidden'}>
          <h3>Monitor de Centros Militares</h3>
          <div class="io-rd-monitor">
            <div class="io-rd-bar">
              <label class="io-rd-field"><input type="checkbox" class="io-rd-mon-on"> Monitorizar (a cada ${MON_MIN_MIN}–${MON_MAX_MIN} min)</label>
              <button type="button" class="button-v2 io-rd-mon-now">Verificar agora</button>
            </div>
            <div class="io-rd-mon-status io-rd-muted" style="margin:3px 0"></div>
            <div class="io-rd-atk" hidden></div>
            <div class="io-rd-mon-results"></div>
          </div>
          </div>
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
      bindMonitor();
      $(root, '.io-rd-confirm-yes').addEventListener('click', () => { fullScanConfirmed = true; runScan(); });
      $(root, '.io-rd-confirm-no').addEventListener('click', hideFullScanConfirm);

      root.addEventListener('click', (e) => {
        const tabBtn = e.target.closest('.io-rd-tab');
        if (tabBtn) {
          state.prefs.tab = tabBtn.dataset.tab; savePrefs(state.prefs);
          $$(root, '.io-rd-tab').forEach((b) => b.classList.toggle('active', b === tabBtn));
          $(root, '.io-rd-pane-scan').hidden = tabBtn.dataset.tab !== 'scan';
          $(root, '.io-rd-pane-monitor').hidden = tabBtn.dataset.tab !== 'monitor';
          return;
        }
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
      const missing = []; // blocos pedidos que o servidor não devolveu (para reidos no fim)
      let errors = 0, aborted = false;

      // Guarda só os blocos que voltaram mesmo; os que faltaram ficam para uma segunda tentativa.
      const readChunk = (chunk, json) => {
        found.push(...parseBlocks(json, owners));
        const back = new Set((json.blocks || []).map((b) => String(b.id)));
        chunk.forEach((b) => (back.has(String(b)) ? scannedBlocks.add(String(b)) : missing.push(b)));
      };
      const progress = (done) => {
        if (!document.contains(bar)) return;
        $(bar, 'b').style.transform = `scaleX(${done / ids.length})`;
        $(bar, 'span').textContent = `${Math.round(done / ids.length * 100)}% · ${fmt(found.length)} objetos`;
      };

      for (let i = 0; i < ids.length; i += perRequest) {
        if (state.cancel) break;
        const chunk = ids.slice(i, i + perRequest);
        try {
          readChunk(chunk, await fetchBlocks(chunk));
          errors = 0;
        } catch (err) {
          errors++;
          if (errors >= 3) { setScanInfo('Varredura incompleta: o servidor recusou várias requisições seguidas (' + err.message + ').'); aborted = true; break; }
          await sleep(2000);
          i -= perRequest; // repete o mesmo trecho depois da pausa
          continue;
        }
        progress(Math.min(ids.length, i + perRequest));
        await sleep(REQUEST_DELAY_MS);
      }

      // Segunda passagem só nos blocos que o servidor não devolveu à primeira.
      if (!state.cancel && !aborted && missing.length) {
        const retry = missing.splice(0);
        setScanInfo(`A reler ${fmt(retry.length)} blocos que o servidor não devolveu…`);
        for (let i = 0; i < retry.length; i += perRequest) {
          if (state.cancel) break;
          try { readChunk(retry.slice(i, i + perRequest), await fetchBlocks(retry.slice(i, i + perRequest))); } catch (err) { /* deixa por ler */ }
          await sleep(REQUEST_DELAY_MS);
        }
      }
      progress(ids.length);

      // mescla: substitui só os blocos que foram lidos agora (o servidor devolve o id do bloco como texto)
      const previous = ((state.scan && state.scan.items) || [])
        .filter((it) => KINDS[it.kind] && (it.kind !== 'resource' || it.bonusSize === RESOURCE_BONUS));
      const items = previous.filter((it) => !scannedBlocks.has(String(it.block))).concat(found);
      const unique = new Map(items.map((it) => [it.kind + ':' + it.id + ':' + it.x + ':' + it.y, it]));
      state.scan = { timestamp: Date.now(), base, radius, items: [...unique.values()], owners, partial: state.cancel || aborted || missing.length > 0 };
      await durableSet(DB_RECORD + '-' + realmId(), state.scan);

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

    function renderAll() { renderBase(); renderScanInfo(); renderFilterOptions(); renderResults(); renderMonitor(); }

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
      setScanInfo(`Última varredura: ${when} · ${area} · ${fmt(s.items.length)} objetos guardados${s.partial ? ' · ⚠ incompleta (alguns blocos não foram lidos)' : ''}`);
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
        if (it.kind === 'resource') sub = `${it.richField ? 'Campo rico · ' : ''}<span class="io-rd-bonus">${esc(it.bonusSize)}</span> ${esc(it.bonusType || '')}`;

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

    // ---------- monitor de Centros Militares ----------
    const MONITOR_KEY = 'cm-monitor';
    const MONITOR_ON_KEY = 'io_cm_monitor_on';
    const MON_RADIUS = 100;
    const MON_MIN_MIN = 10, MON_MAX_MIN = 15; // intervalo aleatório entre verificações
    // Os 9 castelos são fixos (quadrantes como na régua), iguais em qualquer reino.
    const CASTLES = [
      { label: 'Noroeste', qx: 85, qy: 85 }, { label: 'Norte', qx: 250, qy: 85 }, { label: 'Nordeste', qx: 420, qy: 85 },
      { label: 'Oeste', qx: 85, qy: 250 }, { label: 'Central', qx: 250, qy: 250 }, { label: 'Leste', qx: 420, qy: 250 },
      { label: 'Sudoeste', qx: 85, qy: 415 }, { label: 'Sul', qx: 250, qy: 415 }, { label: 'Sudeste', qx: 415, qy: 415 },
    ];

    // O reino é identificado pelo parâmetro realm da página; o último válido fica guardado
    // para nunca cair em '0' (o que faria os dados parecer que sumiram).
    const REALM_KEY = 'io_last_realm';
    function realmId() {
      const h = document.documentElement.innerHTML;
      const m = h.match(/register\.php\?realm=(\d+)/) || h.match(/showBattleOfDay\((\d+)/) || h.match(/[?&]realm=(\d+)/);
      if (m) { try { localStorage.setItem(REALM_KEY, m[1]); } catch (e) { /* ignorado */ } return m[1]; }
      try { return localStorage.getItem(REALM_KEY) || '0'; } catch (e) { return '0'; }
    }

    // Impede o navegador de limpar o IndexedDB sob pressão de espaço (dados permanentes).
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* ignorado */ }

    // Guarda em IndexedDB e também no localStorage (mais durável); lê com recurso ao backup.
    // Assim os dados sobrevivem mesmo que o navegador limpe o IndexedDB.
    async function durableGet(key) {
      let v = null;
      try { v = await IO.store.db.get(key); } catch (e) { /* ignorado */ }
      if (v == null) {
        try { const s = localStorage.getItem('io_bak_' + key); if (s) { v = JSON.parse(s); IO.store.db.set(key, v).catch(() => {}); } } catch (e) { /* ignorado */ }
      }
      return v;
    }
    async function durableSet(key, value) {
      try { await IO.store.db.set(key, value); } catch (e) { /* ignorado */ }
      try { localStorage.setItem('io_bak_' + key, JSON.stringify(value)); } catch (e) { /* localStorage cheio: fica só no IndexedDB */ }
    }

    const monitor = {
      data: null,
      on: !!IO.store.local.get(MONITOR_ON_KEY, { on: false }).on,
      realm: realmId(),
      timer: null, running: false, nextAt: null, status: '',
    };

    async function monitorLoad() {
      if (!monitor.data) monitor.data = (await durableGet(MONITOR_KEY)) || { realms: {} };
      return monitor.data;
    }
    function realmData(data) {
      const r = monitor.realm;
      if (!data.realms[r]) data.realms[r] = { cms: {} };
      return data.realms[r];
    }

    function monitorStatus(text) { monitor.status = text; renderMonitor(); }

    async function monitorCycle() {
      if (monitor.running || state.scanning) return; // não concorre com uma varredura manual
      monitor.running = true;
      renderMonitor();
      try {
        const data = await monitorLoad();
        const rd = realmData(data);
        const blockSet = new Set();
        CASTLES.forEach((c) => blocksInRadius({ x: fromQuadrant(c.qx), y: fromQuadrant(c.qy) }, MON_RADIUS).forEach((b) => blockSet.add(b)));
        const ids = [...blockSet];
        const owners = {};
        const found = [];
        let errors = 0, fetchFailed = false;
        for (let i = 0; i < ids.length; i += BLOCKS_PER_REQUEST) {
          try { found.push(...parseBlocks(await fetchBlocks(ids.slice(i, i + BLOCKS_PER_REQUEST)), owners)); errors = 0; }
          catch (e) { fetchFailed = true; if (++errors >= 3) { monitorStatus('Verificação falhada: o servidor recusou várias requisições.'); return; } await sleep(1500); }
          await sleep(REQUEST_DELAY_MS);
        }
        const now = Date.now();
        const nearest = (it) => {
          let best = '', bd = Infinity;
          CASTLES.forEach((c) => { const d = Math.hypot(fromQuadrant(c.qx) - it.x, fromQuadrant(c.qy) - it.y); if (d < bd) { bd = d; best = c.label; } });
          return best;
        };
        let novos = 0;
        const seen = new Set();
        found.filter((it) => it.kind === 'military').forEach((it) => {
          const key = it.cid || String(it.id);
          seen.add(key);
          const attackable = (it.acs || []).includes(18); // ação 18 = Atacar (só surge dentro de um domínio)
          const prev = rd.cms[key];
          if (!prev) {
            rd.cms[key] = { cid: key, number: it.number || key, terrain: it.name, alliance: it.alliance || '', x: it.x, y: it.y, castle: nearest(it), attackable, firstSeen: now, lastSeen: now };
            novos++;
          } else {
            prev.lastSeen = now; // firstSeen nunca muda enquanto o CM existir
            prev.alliance = it.alliance || prev.alliance; prev.x = it.x; prev.y = it.y; prev.castle = nearest(it); prev.attackable = attackable;
          }
        });
        // CMs que já não estão no mapa (destruídos) saem da lista — mas só se a verificação foi completa,
        // para uma falha de rede não apagar dados bons.
        let removidos = 0;
        if (!fetchFailed) Object.keys(rd.cms).forEach((key) => { if (!seen.has(key)) { delete rd.cms[key]; removidos++; } });
        // Castelos: só informação, substituídos a cada verificação completa.
        if (!fetchFailed) {
          rd.castles = {};
          found.filter((it) => it.kind === 'castle').forEach((it) => {
            rd.castles[it.cid] = { cid: it.cid, name: it.name, alliance: it.alliance || '', x: it.x, y: it.y, region: nearest(it), lastSeen: now };
          });
        }
        rd.lastRun = now;
        await durableSet(MONITOR_KEY, data);
        monitor.status = `Última verificação: ${new Date(now).toLocaleString('pt-PT')} · ${novos} novo(s) · ${removidos} removido(s) · ${Object.keys(rd.cms).length} CMs`;
      } finally {
        monitor.running = false;
        renderMonitor();
      }
    }

    function scheduleMonitor() {
      clearTimeout(monitor.timer);
      if (!monitor.on) { monitor.nextAt = null; renderMonitor(); return; }
      const ms = (MON_MIN_MIN + Math.random() * (MON_MAX_MIN - MON_MIN_MIN)) * 60000;
      monitor.nextAt = Date.now() + ms;
      monitor.timer = setTimeout(async () => { await monitorCycle(); scheduleMonitor(); }, ms);
      renderMonitor();
    }

    function setMonitorOn(on) {
      monitor.on = on;
      IO.store.local.set(MONITOR_ON_KEY, { on });
      if (on) { monitorCycle().then(scheduleMonitor); } else { clearTimeout(monitor.timer); monitor.nextAt = null; renderMonitor(); }
    }

    function renderMonitor() {
      const root = state.root; if (!root || !document.contains(root)) return;
      const box = $(root, '.io-rd-monitor'); if (!box) return;
      const rd = (monitor.data && monitor.data.realms[monitor.realm]) || { cms: {} };
      const chk = $(box, '.io-rd-mon-on'); if (chk) chk.checked = monitor.on;
      const nextTxt = monitor.running ? 'a verificar…' : (monitor.on && monitor.nextAt ? 'próxima ~' + new Date(monitor.nextAt).toLocaleTimeString('pt-PT').slice(0, 5) : 'desligado');
      $(box, '.io-rd-mon-status').textContent = `Reino ${monitor.realm} · ${Object.keys(rd.cms).length} CMs · ${nextTxt}${monitor.status ? ' · ' + monitor.status : ''}`;

      const cms = Object.values(rd.cms).sort((a, b) => b.firstSeen - a.firstSeen);
      const results = $(box, '.io-rd-mon-results');
      const when = (t) => new Date(t).toLocaleString('pt-PT');
      const castles = Object.values(rd.castles || {}).sort((a, b) => CASTLES.findIndex((c) => c.label === a.region) - CASTLES.findIndex((c) => c.label === b.region));
      const castlesHtml = castles.length ? `<h3>Castelos</h3><table class="data-grid espy">
        <tr><th>Região</th><th>Nome</th><th>Aliança</th><th>Quadrante</th><th>Visto em</th><th></th></tr>
        ${castles.map((c) => `<tr>
          <td>${esc(c.region || '—')}</td><td>${esc(c.name)}</td><td>${esc(c.alliance || '—')}</td>
          <td class="io-rd-center">${quadrant(c.x)}:${quadrant(c.y)}</td><td class="io-rd-muted">${esc(when(c.lastSeen))}</td>
          <td class="io-rd-actions"><button type="button" disabled title="Sem função">Atacar</button><button type="button" disabled title="Sem função">Massa</button></td>
        </tr>`).join('')}
      </table><h3>Centros Militares</h3>` : '';
      if (!cms.length) { results.innerHTML = castlesHtml + '<div class="io-rd-empty">Nenhum Centro Militar registado ainda neste reino.</div>'; return; }
      results.innerHTML = castlesHtml + `<table class="data-grid espy">
        <tr><th>Nº</th><th>Castelo</th><th>Aliança</th><th>Quadrante</th><th>1ª vez visto</th><th>Última vez</th><th></th></tr>
        ${cms.map((c) => `<tr>
          <td>${esc(c.number)}</td><td>${esc(c.castle || '—')}</td><td>${esc(c.alliance || '—')}</td>
          <td class="io-rd-center">${quadrant(c.x)}:${quadrant(c.y)}</td>
          <td>${esc(when(c.firstSeen))}</td><td class="io-rd-muted">${esc(when(c.lastSeen))}</td>
          <td class="io-rd-actions">${c.attackable
            ? `<button type="button" data-atk-native="${esc(c.cid)}" title="Abrir a tela de ataque do jogo">Atacar</button>
               <button type="button" data-atk-mass="${esc(c.cid)}" title="Enviar vários ataques dividindo a tropa">Massa</button>`
            : '<span class="io-rd-muted" title="Só aparece dentro de um domínio da aliança">—</span>'}</td>
        </tr>`).join('')}
      </table>`;
    }

    // ---------- ataque a Centros Militares ----------
    const ACT_ATTACK = 18;          // ação de mapa "Atacar" um CM
    const MODES = { 2: 'Batalha campal', 1: 'Cerco à Fortaleza' };
    let atkRunning = false;
    let atkCm = null; // CM atualmente no painel

    function waitFor(test, timeoutMs = 9000) {
      return new Promise((resolve, reject) => {
        const t0 = Date.now();
        (function poll() {
          let r; try { r = test(); } catch (e) { r = null; }
          if (r) return resolve(r);
          if (Date.now() - t0 > timeoutMs) return reject(new Error('demorou demasiado'));
          setTimeout(poll, 150);
        })();
      });
    }

    // Espera a resposta de uma chamada xajax pelo nome da função (hook do XHR, uma vez só).
    const xajaxWaiters = [];
    (function hookXhr() {
      if (window.__ioRadarXhrHook) return;
      window.__ioRadarXhrHook = true;
      const proto = window.XMLHttpRequest.prototype;
      const open = proto.open, send = proto.send;
      proto.open = function (m, u) { this.__ioUrl = u; return open.apply(this, arguments); };
      proto.send = function (body) {
        const fn = (String(body || '').match(/xjxfun=([^&]+)/) || [])[1];
        if (fn) this.addEventListener('loadend', () => {
          for (let i = xajaxWaiters.length - 1; i >= 0; i--) {
            if (xajaxWaiters[i].fn === fn) { xajaxWaiters[i].resolve(String(this.responseText || '')); xajaxWaiters.splice(i, 1); }
          }
        });
        return send.apply(this, arguments);
      };
    })();
    function waitXajax(fn, timeout = 20000) {
      return new Promise((resolve, reject) => {
        const w = { fn, resolve }; xajaxWaiters.push(w);
        setTimeout(() => { const i = xajaxWaiters.indexOf(w); if (i >= 0) { xajaxWaiters.splice(i, 1); reject(new Error('tempo esgotado: ' + fn)); } }, timeout);
      });
    }

    // Avisos/mensagens da resposta do jogo (para saber se o ataque foi aceite ou recusado).
    function responseMessages(resp) {
      const out = [];
      const html = [...String(resp).matchAll(/<!\[CDATA\[S?([\s\S]*?)\]\]>/g)].map((m) => m[1]).join('\n');
      const div = document.createElement('div');
      div.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, '');
      $$(div, '[class*="notice"],[class*="error"],[class*="message"],[class*="alert"],.msg').forEach((el) => {
        const text = el.textContent.replace(/\s+/g, ' ').trim();
        if (text) out.push({ negative: /negativ|erro|error|n[aã]o pode|insuficien|m[ií]nimo/i.test(el.className + ' ' + text), text });
      });
      [...String(resp).matchAll(/toast\('([^']+)'/g)].forEach((m) => {
        try { const h = decodeURIComponent(window.atob(m[1])); const d = document.createElement('div'); d.innerHTML = h; out.push({ negative: /negativ/.test(h), text: d.textContent.replace(/\s+/g, ' ').trim() }); } catch (e) { /* ignora */ }
      });
      return out;
    }

    const atkBox = () => state.root && $(state.root, '.io-rd-atk');
    function atkLog(msg, cls) {
      const box = atkBox(); if (!box) return;
      const log = $(box, '.io-rd-atk-log'); if (!log) return;
      const line = document.createElement('div'); if (cls) line.className = 'io-rd-' + cls; line.textContent = msg;
      log.appendChild(line); log.scrollTop = log.scrollHeight;
    }
    function atkLogClear() { const box = atkBox(); const log = box && $(box, '.io-rd-atk-log'); if (log) log.innerHTML = ''; }

    // "Atacar" simples: abre a tela de ataque do próprio jogo (igual ao botão do mapa).
    function nativeAttack(cid) {
      try { window.do_action2(ACT_ATTACK, 'castle' + cid); }
      catch (e) { atkLog('Não deu para abrir o ataque: ' + e.message, 'err'); }
    }

    function openMassPanel(cm) {
      const box = atkBox(); if (!box) return;
      atkCm = cm;
      box.hidden = false;
      box.innerHTML = `
        <div class="io-rd-atk-head"><b>Atacar em massa</b> — Centro Militar ${esc(cm.number)} (${esc(cm.alliance || '?')})
          <button type="button" class="io-rd-link io-rd-atk-close" style="float:right">fechar</button></div>
        <div class="io-rd-bar" style="margin:5px 0">
          <span class="io-rd-field">Nº de ataques: <input type="number" class="io-rd-atk-n" min="1" max="200" value="10" style="width:56px"></span>
          <span class="io-rd-field">Modo:
            <select class="io-rd-atk-mode"><option value="2">Batalha campal</option><option value="1">Cerco à Fortaleza</option></select></span>
          <span class="io-rd-field">Intervalo (ms): <input type="number" class="io-rd-atk-delay" min="0" step="100" value="800" style="width:64px"></span>
        </div>
        <div class="io-rd-bar" style="margin:5px 0">
          <button type="button" class="button-v2 io-rd-atk-sim">Simular</button>
          <button type="button" class="button-v2 io-rd-atk-fire">Atacar</button>
        </div>
        <div class="io-rd-atk-log"></div>`;
      $(box, '.io-rd-atk-close').addEventListener('click', () => { box.hidden = true; box.innerHTML = ''; atkCm = null; });
      $(box, '.io-rd-atk-sim').addEventListener('click', () => runMass(false));
      $(box, '.io-rd-atk-fire').addEventListener('click', confirmThenAttack);
    }

    function confirmThenAttack() {
      const box = atkBox(); if (!box) return;
      const n = Math.max(1, parseInt($(box, '.io-rd-atk-n').value, 10) || 1);
      atkLogClear();
      atkLog(`Confirma enviar ${n} ataque(s) reais ao CM ${atkCm ? atkCm.number : ''}?`, 'err');
      const bar = document.createElement('div'); bar.className = 'io-rd-bar'; bar.style.margin = '4px 0';
      bar.innerHTML = '<button type="button" class="button-v2 io-rd-atk-confirm">Confirmar envio</button><button type="button" class="io-rd-link io-rd-atk-no">cancelar</button>';
      $(box, '.io-rd-atk-log').appendChild(bar);
      $(bar, '.io-rd-atk-confirm').addEventListener('click', () => { bar.remove(); runMass(true); });
      $(bar, '.io-rd-atk-no').addEventListener('click', () => { bar.remove(); atkLog('Cancelado.'); });
    }

    // Abre a tela de ataque ao CM e espera o formulário ficar pronto; devolve o id da janela.
    async function openAttackScreen(cm, castleId) {
      const win = window.containersStuff.findContaner({ saveName: 'io_mass_atk', title: 'Ataque em massa', template: 'untabbed' });
      const done = waitXajax('viewAllianceOperationCenter').catch(() => {});
      window.xajax_viewAllianceOperationCenter(win, { tab: 2, castleId, attackParams: String(cm.cid) });
      await done;
      await waitFor(() => document.querySelector('#messagebox' + win + ' #sendAttackForm input[id^="M_"]'));
      return win;
    }

    function readArmy(win) {
      const box = document.getElementById('messagebox' + win); if (!box) return [];
      return [...box.querySelectorAll('#sendAttackForm input[id^="M_"]')].map((inp) => {
        const code = inp.id.slice(2);
        const oc = [...(inp.closest('tr,div,td') || inp.parentElement).querySelectorAll('[onclick]')]
          .map((e) => e.getAttribute('onclick')).find((o) => o && o.indexOf(inp.id) >= 0 && /value=\d+/.test(o));
        const max = oc ? parseInt((oc.match(/value=(\d+)/) || [])[1], 10) : 0;
        return { code, max };
      }).filter((u) => u.max > 0);
    }

    // Simular (really=false) só mostra o plano; Atacar (really=true) envia.
    async function runMass(really) {
      if (atkRunning) return;
      const box = atkBox(); const cm = atkCm; if (!box || !cm) return;
      atkLogClear();
      const n = Math.max(1, parseInt($(box, '.io-rd-atk-n').value, 10) || 1);
      const mode = $(box, '.io-rd-atk-mode').value === '1' ? 1 : 2;
      const delay = Math.max(0, parseInt($(box, '.io-rd-atk-delay').value, 10) || 0);
      const castleId = window.castle_id_changed;
      if (!castleId) { atkLog('Precisas de estar dentro de um domínio da aliança (entra num castelo/CM teu).', 'err'); return; }
      const foundId = String(cm.cid).split('_')[0];
      const nomer = String(cm.cid).split('_')[1] || cm.number;
      atkRunning = true;
      const btns = $$(box, '.io-rd-atk-sim,.io-rd-atk-fire'); btns.forEach((b) => (b.disabled = true));
      let win;
      try {
        win = await openAttackScreen(cm, castleId);
        const units = readArmy(win);
        if (!units.length) throw new Error('sem tropas disponíveis neste domínio');
        const split = units.map((u) => ({ code: u.code, per: Math.floor(u.max / n), max: u.max }));
        atkLog(`Alvo: CM ${nomer} (${cm.alliance || '?'}) · ${n} ataque(s) · ${MODES[mode]}`);
        atkLog('Por ataque: ' + split.map((u) => `${u.code}=${fmt(u.per)}`).join(', ') + ` · intervalo ${delay} ms`);
        if (split.every((u) => u.per < 1)) throw new Error('cada ataque ficaria sem tropas (reduz o nº de ataques)');
        if (!really) { atkLog('Simulação: nada foi enviado.', 'ok'); return; }

        let ok = 0;
        for (let i = 0; i < n; i++) {
          try {
            if (i > 0) win = await openAttackScreen(cm, castleId); // estado fresco a cada ataque
            const b = document.getElementById('messagebox' + win);
            b.querySelectorAll('#sendAttackForm input[id^="M_"]').forEach((inp) => {
              const u = split.find((s) => s.code === inp.id.slice(2));
              inp.value = u && u.per > 0 ? String(u.per) : '';
            });
            const fv = window.xajax.getFormValues('sendAttackForm');
            const done = waitXajax('sendAllianceAttackAlliance');
            window.xajax_sendAllianceAttackAlliance(win, castleId, fv, foundId, mode);
            const resp = await done;
            const msgs = responseMessages(resp);
            const neg = msgs.filter((m) => m.negative);
            if (neg.length) throw new Error(neg.map((m) => m.text).join(' '));
            ok++;
            atkLog(`#${i + 1} enviado${msgs.length ? ' — ' + msgs.map((m) => m.text).join(' ') : ''}`, 'ok');
          } catch (e) {
            atkLog(`#${i + 1} falhou: ${e.message}`, 'err');
          }
          if (i < n - 1 && delay) await sleep(delay);
        }
        atkLog(`Concluído: ${ok}/${n} ataque(s) enviado(s).`, ok === n ? 'ok' : 'err');
      } catch (e) {
        atkLog('Erro: ' + e.message, 'err');
      } finally {
        atkRunning = false;
        btns.forEach((b) => (b.disabled = false));
      }
    }

    function bindMonitor() {
      const box = $(state.root, '.io-rd-monitor'); if (!box) return;
      $(box, '.io-rd-mon-on').addEventListener('change', (e) => setMonitorOn(e.target.checked));
      $(box, '.io-rd-mon-now').addEventListener('click', () => monitorCycle());
      box.addEventListener('click', (e) => {
        const nat = e.target.closest('[data-atk-native]');
        if (nat) { nativeAttack(nat.dataset.atkNative); return; }
        const mass = e.target.closest('[data-atk-mass]');
        if (mass) {
          const rd = (monitor.data && monitor.data.realms[monitor.realm]) || { cms: {} };
          const cm = rd.cms[mass.dataset.atkMass];
          if (cm) openMassPanel(cm);
        }
      });
    }

    monitorLoad().then(() => { renderMonitor(); if (monitor.on) scheduleMonitor(); });

    IO.ui.addFooterButton({ className: BUTTON_CLASS, title: WINDOW_TITLE, html: RADAR_SVG, onClick: openWindow });
  },
});
