// Módulo: calculadora de tempo de marcha e horário de retorno.
IO.register({
  id: 'calculadora-marcha',
  name: 'Calculadora de Marcha',

  init(IO) {
    const { $, $$, formatDuration, pad2 } = IO.utils;
    const SAVE_NAME = 'io_march_calc';
    const WINDOW_TITLE = 'Calculadora de Marcha';
    const STORAGE_KEY = 'io_march_calc_v2';
    const BUTTON_ID = 'item-io-march';
    const SPRITE = 'https://ihcdn3.ioimg.org/iov5live/gui/village-2/step-3.png?4';

    // Velocidades lidas dos tooltips dos quartéis de cada raça.
    const RACES = {
      1: {
        name: 'Imperiais',
        groups: [
          { group: 'Infantaria', troops: [
            { code: 'p1', name: 'Lanceiros', speed: 1.0 },
            { code: 'm1', name: 'Espadachins', speed: 0.9 },
            { code: 'p2', name: 'Lanceiros pesados', speed: 0.8 },
            { code: 'm2', name: 'Espadachins Pesados', speed: 0.8 },
            { code: 'm3', name: 'Guardiões', speed: 0.7 },
            { code: 'p3', name: 'Falanges', speed: 0.6 },
          ] },
          { group: 'Arqueiros', troops: [
            { code: 's1', name: 'Arqueiros', speed: 1.2 },
            { code: 's2', name: 'Arqueiros pesados', speed: 1.0 },
            { code: 's3', name: 'Arqueiros de Elite', speed: 1.0 },
          ] },
          { group: 'Cavalaria', troops: [
            { code: 'k1', name: 'Cavalaria Leve', speed: 3.0 },
            { code: 'k2', name: 'Cavalaria Pesada', speed: 2.5 },
            { code: 'k3', name: 'Paladinos', speed: 2.0 },
            { code: 'ks', name: 'Espião', speed: 45.0 },
          ] },
          { group: 'Cerco e transporte', troops: [
            { code: 'ct', name: 'Carrinhos de transporte', speed: 1.0 },
            { code: 'c1', name: 'Aríetes', speed: 0.5 },
            { code: 'c2', name: 'Catapultas', speed: 0.5 },
            { code: 'c3', name: 'Trebuchetes', speed: 0.5 },
            { code: 'c4', name: 'Balistas', speed: 0.5 },
          ] },
        ],
      },
      2: {
        name: 'Nómadas',
        groups: [
          { group: 'Infantaria', troops: [
            { code: 'p1', name: 'Lançadores de dardos', speed: 1.5 },
            { code: 'm1', name: 'Espadachins', speed: 1.2 },
            { code: 'p2', name: 'Lanceiros pesados', speed: 1.0 },
            { code: 'm2', name: 'Espadachins pesados', speed: 1.0 },
          ] },
          { group: 'Arqueiros', troops: [
            { code: 's1', name: 'Arqueiros', speed: 1.5 },
            { code: 's2', name: 'Arqueiros pesados', speed: 1.2 },
            { code: 's3', name: 'Arqueiros de Elite', speed: 1.2 },
          ] },
          { group: 'Cavalaria', troops: [
            { code: 'k1', name: 'Cavalaria Leve', speed: 4.0 },
            { code: 'k4', name: 'Arqueiros a cavalo', speed: 4.0 },
            { code: 'k2', name: 'Cavalaria Pesada', speed: 3.0 },
            { code: 'k5', name: 'Arqueiros Catafractários', speed: 3.0 },
            { code: 'k3', name: 'Catafractários', speed: 2.5 },
            { code: 'ks', name: 'Espião', speed: 45.0 },
          ] },
          { group: 'Cerco e transporte', troops: [
            { code: 'ct', name: 'Carrinhos de transporte', speed: 1.0 },
            { code: 'c1', name: 'Aríetes', speed: 0.6 },
            { code: 'c2', name: 'Catapultas', speed: 0.6 },
            { code: 'c3', name: 'Trebuchetes', speed: 0.6 },
            { code: 'c4', name: 'Balistas', speed: 0.6 },
          ] },
        ],
      },
    };
    const WONDER_BONUS = 0.10;
    const REALM_SPEEDS = [
      { value: 1, label: '1x (Normal)' },
      { value: 2, label: '2x' },
      { value: 4, label: '4x (Blitz)' },
      { value: 10, label: '10x (Mega)' },
    ];

    const playerRace = () => (RACES[IO.game.playerRaceId()] ? IO.game.playerRaceId() : '1');
    const raceData = (race) => RACES[race] || RACES[playerRace()];
    const raceTroops = (race) => raceData(race).groups.flatMap((g) => g.troops);

    const DEFAULT_STATE = { race: '', troop: 'k3', dist: '', cart: '', impact: '', realm: 1, wonder: false };

    function loadState() {
      const state = IO.store.local.get(STORAGE_KEY, DEFAULT_STATE);
      if (!RACES[state.race]) state.race = playerRace();
      state.wonder = state.wonder === true || state.wonder === 'true' || Number(state.wonder) > 0;
      return state;
    }
    const saveState = (state) => IO.store.local.set(STORAGE_KEY, state);

    // Fórmula original: tempo em horas = dist / (vel × 80) / vel_reino / (1 + cartografia × 0,1) × (1 − maravilha)
    function travelSeconds(dist, troopSpeed, realmSpeed, wonderPct, level) {
      const minutes = (((dist / (troopSpeed * 80)) / realmSpeed) / (1 + (level * 0.10))) * (1 - wonderPct) * 60;
      return minutes * 60;
    }

    function parseClock(str) {
      const m = String(str || '').trim().match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
      if (!m) return null;
      const h = +m[1], min = +m[2], sec = m[3] ? +m[3] : 0;
      if (h > 23 || min > 59 || sec > 59) return null;
      return h * 3600 + min * 60 + sec;
    }

    function clockPlus(baseSeconds, addSeconds) {
      const total = Math.round(baseSeconds + addSeconds);
      const days = Math.floor(total / 86400);
      const t = ((total % 86400) + 86400) % 86400;
      const clock = `${pad2(Math.floor(t / 3600))}:${pad2(Math.floor((t % 3600) / 60))}:${pad2(t % 60)}`;
      return days > 0 ? `${clock} <span class="io-mc-day">+${days}d</span>` : clock;
    }

    const COMPASS_SVG = `
      <svg viewBox="0 0 40 40" width="30" height="30" aria-hidden="true">
        <defs><linearGradient id="io-mc-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffe9a3"/><stop offset=".55" stop-color="#e0a92e"/><stop offset="1" stop-color="#8a5a12"/>
        </linearGradient></defs>
        <circle cx="20" cy="20" r="16.5" fill="#f3e2b8" stroke="#5a3510" stroke-width="2.2"/>
        <circle cx="20" cy="20" r="13" fill="none" stroke="#b08a4e" stroke-width="1" stroke-dasharray="1.2 2.2"/>
        <path d="M20 5 L23.2 20 L20 35 L16.8 20 Z" fill="url(#io-mc-gold)" stroke="#4a2a08" stroke-width="1"/>
        <path d="M5 20 L20 16.8 L35 20 L20 23.2 Z" fill="#c9b48a" stroke="#4a2a08" stroke-width="1"/>
        <path d="M20 5 L23.2 20 L16.8 20 Z" fill="#b3261e" stroke="#4a2a08" stroke-width="1"/>
        <circle cx="20" cy="20" r="2.2" fill="#4a2a08"/>
      </svg>`;

    IO.ui.injectStyles('io-mc-style', `
      #${BUTTON_ID} { position:absolute; left:-87px; top:402px; width:70px; height:60px; }
      #${BUTTON_ID}.io-mc-shifted { left:-157px; }
      #${BUTTON_ID} .io-mc-frame { position:absolute; inset:0; background:url(${SPRITE}) -112px -322px;
        filter:sepia(1) saturate(2.4) hue-rotate(-12deg) brightness(.78) contrast(1.1); }
      #${BUTTON_ID} a { position:absolute; inset:0; display:block; }
      #${BUTTON_ID} svg { position:absolute; left:21px; top:9px; filter:drop-shadow(0 1px 1px rgba(0,0,0,.6)); transition:transform .15s; }
      #${BUTTON_ID}:hover svg { transform:scale(1.12) rotate(-8deg); }

      .io-mc { width:520px; padding:12px 14px 4px; }
      .io-mc h3 { margin:10px 0 6px; font-size:13px; font-weight:bold; color:#3b2a14; border-bottom:1px solid #b09a6e; padding-bottom:3px; }
      .io-mc h3:first-child { margin-top:0; }
      .io-mc-groups > div { display:flex; align-items:center; gap:8px; margin-bottom:4px; }
      .io-mc-group-name { width:118px; flex:none; font-size:12px; color:#5b4526; }
      .io-mc-units { display:flex; flex-wrap:wrap; gap:3px; }
      .io-mc-unit { position:relative; width:46px; height:46px; padding:0; border:2px solid transparent; border-radius:3px;
        background:rgba(0,0,0,.06); cursor:pointer; }
      .io-mc-unit:hover { border-color:#a8864a; }
      .io-mc-unit.selected { border-color:#7a1f0e; background:rgba(122,31,14,.12); box-shadow:0 0 4px rgba(122,31,14,.6); }
      .io-mc-unit .unit { display:block; width:42px; height:42px; pointer-events:none; }
      .io-mc h3.io-mc-troop-title { display:flex; align-items:flex-end; justify-content:space-between; }
      .io-mc-races { display:flex; gap:4px; }
      .io-mc-race { display:flex; align-items:center; gap:4px; height:24px; padding:0 8px 0 3px; border:1px solid #a8864a; border-radius:3px;
        background:rgba(255,255,255,.25); color:#3b2a14; font:12px arial, verdana, sans-serif; cursor:pointer; }
      .io-mc-race:hover { background:rgba(255,255,255,.45); }
      .io-mc-race.selected { border-color:#7a1f0e; background:rgba(122,31,14,.15); color:#7a1f0e; font-weight:bold; }
      .io-mc-race .stats-icon-race { display:inline-block; flex:none; }
      .io-mc-check { display:inline-flex; align-items:center; gap:6px; font-size:12px; cursor:pointer; }
      .io-mc-check input { margin:0; width:15px; height:15px; accent-color:#7a1f0e; cursor:pointer; }
      .io-mc-unit .io-mc-speed { position:absolute; right:1px; bottom:0; font-size:10px; font-weight:bold; color:#fff;
        text-shadow:0 0 2px #000, 0 0 2px #000; }
      .io-mc-picked { margin-top:6px; font-size:12px; color:#3b2a14; }
      .io-mc-picked b { color:#7a1f0e; }

      .io-mc table.data-grid { width:100%; margin:0; }
      .io-mc table.data-grid td, .io-mc table.data-grid th { padding:4px 6px; }
      .io-mc .io-mc-params td.io-mc-label { width:34%; font-size:12px; }
      .io-mc .io-mc-hint { font-size:11px; color:#6d5a3a; }
      .io-mc input.io-mc-input, .io-mc select.io-mc-input { width:110px; height:22px; box-sizing:border-box; padding:1px 5px;
        border:1px solid #8b7355; background:#fffdf6; color:#170e11; font:13px arial, verdana, sans-serif; }
      .io-mc input.io-mc-input:focus, .io-mc select.io-mc-input:focus { outline:none; border-color:#7a1f0e; box-shadow:0 0 3px rgba(122,31,14,.5); }
      .io-mc input.io-mc-input.invalid { border-color:#c00; background:#fde8e4; }
      .io-mc .button-v2.io-mc-now { margin-left:6px; }

      .io-mc-result { text-align:center; padding:8px 0 4px; }
      .io-mc-big { font:bold 26px/1.1 arial, verdana, sans-serif; color:#7a1f0e; letter-spacing:1px; }
      .io-mc-sub { font-size:12px; color:#5b4526; margin-top:2px; }
      .io-mc-return { margin-top:6px; font-size:13px; }
      .io-mc-return b { font-size:15px; color:#1f4f0e; }
      .io-mc-levels td { text-align:center; }
      .io-mc-levels td.io-mc-ret { color:#1f4f0e; font-weight:bold; }
      .io-mc-day { font-size:10px; color:#7a1f0e; font-weight:bold; }
      .io-mc-empty { text-align:center; color:#6d5a3a; padding:10px 0; font-size:12px; }
    `);

    function renderTroops(state) {
      return raceData(state.race).groups.map((g) => `
        <div>
          <div class="io-mc-group-name">${g.group}</div>
          <div class="io-mc-units">
            ${g.troops.map((t) => `
              <button type="button" class="io-mc-unit${t.code === state.troop ? ' selected' : ''}" data-code="${t.code}"
                title="${t.name} — velocidade ${t.speed}">
                <span class="unit race-${state.race} unit-${t.code}"></span><span class="io-mc-speed">${t.speed}</span>
              </button>`).join('')}
          </div>
        </div>`).join('');
    }

    function windowHtml() {
      const state = loadState();
      return IO.ui.windowFrame(`
        <div class="io-mc">
          <h3 class="io-mc-troop-title">Tropa mais lenta do exército
            <span class="io-mc-races">
              ${Object.entries(RACES).map(([id, r]) => `
                <button type="button" class="io-mc-race${id === state.race ? ' selected' : ''}" data-race="${id}">
                  <span class="stats-icon-race race${id}"></span>${r.name}
                </button>`).join('')}
            </span>
          </h3>
          <div class="io-mc-groups"></div>
          <div class="io-mc-picked"></div>

          <h3>Parâmetros</h3>
          <table class="data-grid espy io-mc-params">
            <tr>
              <td class="io-mc-label">Distância</td>
              <td><input class="io-mc-input" data-field="dist" type="number" min="0" step="any" placeholder="ex.: 150" value="${state.dist}"></td>
            </tr>
            <tr>
              <td class="io-mc-label">Cartografia</td>
              <td><input class="io-mc-input" data-field="cart" type="number" min="0" placeholder="1 a 10" value="${state.cart}">
                <span class="io-mc-hint">vazio = mostra os níveis 1 a 10</span></td>
            </tr>
            <tr>
              <td class="io-mc-label">Velocidade do reino</td>
              <td><select class="io-mc-input" data-field="realm">
                ${REALM_SPEEDS.map((r) => `<option value="${r.value}"${+state.realm === r.value ? ' selected' : ''}>${r.label}</option>`).join('')}
              </select></td>
            </tr>
            <tr>
              <td class="io-mc-label">Bónus de maravilha</td>
              <td><label class="io-mc-check"><input data-field="wonder" type="checkbox"${state.wonder ? ' checked' : ''}>
                Tenho a maravilha (+${WONDER_BONUS * 100}% de velocidade)</label></td>
            </tr>
            <tr>
              <td class="io-mc-label">Hora do impacto</td>
              <td><input class="io-mc-input" data-field="impact" type="text" maxlength="8" placeholder="HH:MM:SS" value="${state.impact}">
                <button type="button" class="button-v2 io-mc-now" title="Preencher com o relógio do jogo">Agora</button></td>
            </tr>
          </table>

          <h3>Resultado</h3>
          <div class="io-mc-output"></div>
        </div>`);
    }

    function renderOutput(root, state) {
      const troops = raceTroops(state.race);
      const troop = troops.find((t) => t.code === state.troop) || troops[0];
      const dist = parseFloat(state.dist) || 0;
      const realm = parseFloat(state.realm) || 1;
      const wonderPct = state.wonder ? WONDER_BONUS : 0;
      const cartRaw = String(state.cart).trim();
      const impactRaw = String(state.impact).trim();
      const impactSec = parseClock(impactRaw);

      $(root, '.io-mc-picked').innerHTML =
        `Selecionado: <b>${troop.name}</b> (${raceData(state.race).name}, velocidade ${troop.speed})`;
      $(root, '[data-field="impact"]').classList.toggle('invalid', impactRaw !== '' && impactSec === null);

      const out = $(root, '.io-mc-output');
      if (dist <= 0) {
        out.innerHTML = '<div class="io-mc-empty">Informe a distância para calcular.</div>';
        return;
      }

      if (cartRaw !== '') {
        const level = parseFloat(cartRaw) || 0;
        const secs = travelSeconds(dist, troop.speed, realm, wonderPct, level);
        out.innerHTML = `
          <div class="io-mc-result">
            <div class="io-mc-sub">Tempo de marcha (ida) com cartografia ${level}</div>
            <div class="io-mc-big">${formatDuration(secs)}</div>
            <div class="io-mc-sub">${(secs / 60).toFixed(2)} minutos</div>
            ${impactSec !== null ? `<div class="io-mc-return">Retorno estimado: <b>${clockPlus(impactSec, secs)}</b></div>` : ''}
          </div>`;
        return;
      }

      const rows = [];
      for (let lvl = 1; lvl <= 10; lvl++) {
        const secs = travelSeconds(dist, troop.speed, realm, wonderPct, lvl);
        rows.push(`<tr><td><b>${lvl}</b></td><td>${formatDuration(secs)}</td>
          <td class="io-mc-ret">${impactSec !== null ? clockPlus(impactSec, secs) : '--:--:--'}</td></tr>`);
      }
      out.innerHTML = `
        <table class="data-grid espy io-mc-levels">
          <tr><th>Cartografia</th><th>Ida</th><th>Retorno${impactSec === null ? ' (informe a hora do impacto)' : ''}</th></tr>
          ${rows.join('')}
        </table>`;
    }

    function bindWindow(root) {
      if (!root) return;
      const state = loadState();

      const update = () => {
        $$(root, '[data-field]').forEach((el) => {
          state[el.dataset.field] = el.type === 'checkbox' ? el.checked : el.value;
        });
        saveState(state);
        renderOutput(root, state);
      };

      const drawTroops = () => {
        if (!raceTroops(state.race).some((t) => t.code === state.troop)) state.troop = raceTroops(state.race)[0].code;
        const groups = $(root, '.io-mc-groups');
        groups.innerHTML = renderTroops(state);
        $$(groups, '.io-mc-unit').forEach((btn) => {
          btn.addEventListener('click', () => {
            $$(groups, '.io-mc-unit.selected').forEach((b) => b.classList.remove('selected'));
            btn.classList.add('selected');
            state.troop = btn.dataset.code;
            update();
          });
        });
      };

      $$(root, '.io-mc-race').forEach((btn) => {
        btn.addEventListener('click', () => {
          $$(root, '.io-mc-race.selected').forEach((b) => b.classList.remove('selected'));
          btn.classList.add('selected');
          state.race = btn.dataset.race;
          drawTroops();
          update();
        });
      });
      drawTroops();
      $$(root, '[data-field]').forEach((el) => {
        el.addEventListener('input', update);
        el.addEventListener('change', update);
      });
      $(root, '.io-mc-now').addEventListener('click', () => {
        const clock = IO.game.gameClock();
        if (!clock) return;
        $(root, '[data-field="impact"]').value = clock;
        update();
      });

      renderOutput(root, state);
    }

    function openWindow() {
      const win = IO.ui.openWindow({ saveName: SAVE_NAME, title: WINDOW_TITLE });
      if (!win) return;
      win.box.innerHTML = windowHtml();
      win.applyTemplate();
      bindWindow($(win.box, '.io-mc'));
    }

    IO.ui.addMenuButton({
      id: BUTTON_ID,
      title: WINDOW_TITLE,
      html: `<span class="io-mc-frame"></span>${COMPASS_SVG}`,
      onClick: openWindow,
      // Usa o espaço do botão "Missões de transporte"; se ele aparecer, fica ao lado.
      check: (li) => {
        const transport = document.getElementById('item-transport');
        const visible = transport && getComputedStyle(transport).display !== 'none';
        li.classList.toggle('io-mc-shifted', !!visible);
      },
    });
  },
});
