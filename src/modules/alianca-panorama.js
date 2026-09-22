// Módulo: aba "Panorama" na janela da aliança — soma o exército e a economia de todos os membros.
IO.register({
  id: 'alianca-panorama',
  name: 'Panorama da aliança',

  init(IO) {
    const { $, $$, esc, fmt, sleep, toNumber } = IO.utils;
    const TAB_CLASS = 'io-alp-tab';
    const CACHE_KEY = 'alliance-panorama';
    const normalize = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').toLowerCase().trim();

    // Nome da unidade (como o jogo escreve) → código do sprite, por raça.
    const UNITS = {
      1: [
        ['lanceiros pesados', 'p2', 'Infantaria'], ['lanceiros', 'p1', 'Infantaria'], ['falanges', 'p3', 'Infantaria'],
        ['espadachins pesados', 'm2', 'Infantaria'], ['espadachins', 'm1', 'Infantaria'], ['guardioes', 'm3', 'Infantaria'],
        ['arqueiros de elite', 's3', 'Arqueiros'], ['arqueiros pesados', 's2', 'Arqueiros'], ['arqueiros', 's1', 'Arqueiros'],
        ['cavalaria pesada', 'k2', 'Cavalaria'], ['cavalaria leve', 'k1', 'Cavalaria'], ['paladinos', 'k3', 'Cavalaria'],
        ['arietes', 'c1', 'Cerco'], ['catapultas', 'c2', 'Cerco'], ['trabucos', 'c3', 'Cerco'], ['trebuchetes', 'c3', 'Cerco'], ['balistas', 'c4', 'Cerco'],
        ['carrinhos de transporte', 'ct', 'Apoio'], ['espiao', 'ks', 'Apoio'],
      ],
      2: [
        ['lancadores de dardos', 'p1', 'Infantaria'], ['lanceiros pesados', 'p2', 'Infantaria'],
        ['espadachins pesados', 'm2', 'Infantaria'], ['espadachins', 'm1', 'Infantaria'],
        ['arqueiros catafractarios', 'k5', 'Cavalaria'], ['arqueiros a cavalo', 'k4', 'Cavalaria'],
        ['arqueiros de elite', 's3', 'Arqueiros'], ['arqueiros pesados', 's2', 'Arqueiros'], ['arqueiros', 's1', 'Arqueiros'],
        ['cavalaria pesada', 'k2', 'Cavalaria'], ['cavalaria leve', 'k1', 'Cavalaria'], ['catafractarios', 'k3', 'Cavalaria'],
        ['arietes', 'c1', 'Cerco'], ['catapultas', 'c2', 'Cerco'], ['trabucos', 'c3', 'Cerco'], ['trebuchetes', 'c3', 'Cerco'], ['balistas', 'c4', 'Cerco'],
        ['carrinhos de transporte', 'ct', 'Apoio'], ['espiao', 'ks', 'Apoio'],
      ],
    };
    const CATEGORIES = ['Infantaria', 'Arqueiros', 'Cavalaria', 'Cerco', 'Apoio'];
    const RACES = { 1: 'Imperiais', 2: 'Nómades' };
    const RES = [
      { key: 'wood', label: 'Madeira' }, { key: 'iron', label: 'Ferro' },
      { key: 'stone', label: 'Pedra' }, { key: 'gold', label: 'Ouro' },
    ];

    function unitInfo(raceId, name) {
      const n = normalize(name);
      const hit = (UNITS[raceId] || UNITS[1]).find(([label]) => n.includes(label));
      return hit ? { code: hit[1], category: hit[2] } : { code: '', category: 'Apoio' };
    }

    // ---------- leitura dos dados ----------
    // Lista de membros: mesma aba que o jogo abre, lida sem mexer na janela.
    async function fetchMembers(tabArgs) {
      const xml = await IO.game.xajaxRaw('allianceTabs', tabArgs);
      const dom = IO.game.xajaxDom(xml);
      const members = [];
      $$(dom, 'a.username').forEach((a) => {
        const call = (a.getAttribute('href') || '') + (a.getAttribute('onclick') || '');
        const m = call.match(/'?NULL'?\s*,\s*(\d+)/);
        if (!m) return;
        const id = m[1];
        if (members.some((x) => x.id === id)) return;
        const row = a.closest('tr') || a.parentElement;
        const raceImg = row && row.querySelector('[class*="stats-race-"]');
        const race = raceImg ? (String(raceImg.className).match(/stats-race-(\d+)/) || [])[1] : '';
        // A 1ª célula numérica sem tooltip é a pontuação geral (as outras trazem números do tooltip).
        const numerals = row
          ? [...row.children]
            .filter((td) => td.classList.contains('numeral') && !td.querySelector('.tooltip'))
            .map((td) => toNumber(td.textContent))
          : [];
        members.push({
          id,
          name: (a.getAttribute('title') || a.textContent || '').trim(),
          race: race || '1',
          points: numerals[0] || 0,
          online: !!(row && row.querySelector('.online-status-icon.online')),
        });
      });
      return members;
    }

    // A tela traz duas tabelas: a dos treinos e a do exército (acaba em "Número do exército inteiro").
    async function fetchArmy(userId) {
      const xml = await IO.game.xajaxRaw('getAllianceTabArmyStats', ['Scontainer', `N${userId}`]);
      const dom = IO.game.xajaxDom(xml, 'messageboxcontainer');
      const table = $$(dom, 'table').find((t) => normalize(t.textContent).includes('exercito inteiro'));
      const units = [];
      let total = 0;
      if (table) {
        $$(table, 'tr').forEach((tr) => {
          const cells = [...tr.children];
          if (cells.length !== 2) return;
          const label = (cells[0].textContent || '').replace(/ /g, ' ').trim();
          const n = normalize(label);
          if (!n || n.includes('unidade')) return;
          const qty = toNumber(cells[1].textContent);
          if (n.includes('exercito inteiro')) { total = qty; return; }
          if (qty > 0) units.push({ name: label, qty });
        });
      }
      if (!total) total = units.reduce((s, u) => s + u.qty, 0);
      return { units, total };
    }

    // A tela repete o mesmo bloco de 5 tabelas por província; o primeiro bloco é todo o Império.
    async function fetchEconomy(userId) {
      const xml = await IO.game.xajaxRaw('getAllianceTabEconomyStats', ['Scontainer', `N${userId}`]);
      const dom = IO.game.xajaxDom(xml, 'messageboxcontainer');
      const out = { stock: {}, income: {}, maintenance: 0, population: 0, workers: 0, growth: 0 };
      const exact = (el) => {
        const span = el.querySelector('span[title]');
        return toNumber(span ? span.getAttribute('title') : el.textContent);
      };
      $$(dom, 'table').slice(0, 5).forEach((table) => {
        const rows = $$(table, 'tr');
        const head = normalize(table.textContent).slice(0, 40);
        // Madeira, ferro, pedra e ouro vêm um por linha, sempre nesta ordem.
        const fillFrom = (target) => {
          const values = $$(table, 'span[title]').map((s) => toNumber(s.getAttribute('title')));
          RES.forEach((r, i) => { target[r.key] = values[i] || 0; });
        };
        if (head.startsWith('recursos')) fillFrom(out.stock);
        else if (head.startsWith('lucro')) fillFrom(out.income);
        else if (head.startsWith('despesas')) {
          const row = rows.find((tr) => normalize(tr.textContent).includes('manuten'));
          if (row) out.maintenance = exact(row.children[row.children.length - 1]);
        } else if (head.startsWith('populacao')) {
          rows.forEach((tr) => {
            if (tr.children.length < 2) return;
            const n = normalize(tr.children[0].textContent);
            const v = exact(tr.children[1]);
            if (n.includes('toda a popula')) out.population = v;
            else if (n.includes('trabalhador')) out.workers = v;
            else if (n.includes('crescimento')) out.growth = v;
          });
        }
      });
      return out;
    }

    // Preço de treino de cada unidade, lido dos quartéis (só existe para a raça do jogador).
    const COSTS_KEY = (raceId) => `unit-costs-${raceId}`;

    async function fetchOwnCosts() {
      const costs = {};
      for (const barracks of [7, 8, 9, 10]) {
        const xml = await IO.game.xajaxRaw('soldiersTabs', ['N9', 'N0', `N${barracks}`]);
        const dom = IO.game.xajaxDom(xml);
        $$(dom, 'a.unit').forEach((a) => {
          const code = (a.className.match(/unit-(\w+)/) || [])[1];
          const wrap = a.closest('.hire-soldiers-wrap');
          if (!code || !wrap || costs[code]) return;
          const cost = { name: a.title || '' };
          $$(wrap, '.hire-soldiers-resources span').forEach((s) => {
            const key = s.className.replace('hire-soldiers-', '');
            cost[key] = toNumber(s.textContent);
          });
          costs[code] = cost;
        });
        await sleep(300);
      }
      return costs;
    }

    // Tela "Fim da era" (o link do relógio do servidor): "Restam 26 Dias 08:16:36".
    async function fetchEraDays() {
      const xml = await IO.game.xajaxRaw('getEndEraInfo', ['N9']);
      const text = normalize(IO.game.xajaxDom(xml).textContent);
      const m = text.match(/restam\s+(?:(\d+)\s*dias?\s*)?(\d+):(\d{2}):(\d{2})/);
      if (!m) return null;
      return (parseInt(m[1] || '0', 10)) + parseInt(m[2], 10) / 24 + parseInt(m[3], 10) / 1440;
    }

    // Imposto da aliança (%) na ordem madeira, ferro, pedra, ouro.
    async function fetchAllianceTax(tabArgs) {
      const args = tabArgs.slice();
      args[2] = 'N3'; // aba Tesouraria
      const xml = await IO.game.xajaxRaw('allianceTabs', args);
      const dom = IO.game.xajaxDom(xml);
      const table = $$(dom, 'table').find((t) => normalize(t.textContent).includes('imposto'));
      const tax = {};
      if (table) {
        const values = $$(table, 'tr')
          .filter((tr) => tr.children.length === 2 && $(tr, 'input'))
          .map((tr) => parseFloat(String($(tr, 'input').value).replace(',', '.')) || 0);
        RES.forEach((r, i) => { if (values[i] !== undefined) tax[r.key] = values[i]; });
      }
      return tax;
    }

    // ---------- estado ----------
    let data = null; // { when, members: [{ ..., army, eco }] }
    let loading = false;
    let progress = '';

    async function loadAll(tabArgs, onTick) {
      loading = true;
      try {
        const members = await fetchMembers(tabArgs);
        if (!members.length) throw new Error('não encontrei a lista de membros da aliança');
        for (let i = 0; i < members.length; i++) {
          progress = `A ler ${i + 1}/${members.length} — ${members[i].name}`;
          onTick();
          try { members[i].army = await fetchArmy(members[i].id); } catch (e) { members[i].error = e.message; }
          await sleep(350);
          try { members[i].eco = await fetchEconomy(members[i].id); } catch (e) { members[i].error = e.message; }
          await sleep(350);
        }
        progress = 'A ler impostos, custos e o fim da era';
        onTick();
        const ownRace = IO.game.playerRaceId();
        const [era, tax, ownCosts] = await Promise.all([
          fetchEraDays().catch(() => null),
          fetchAllianceTax(tabArgs).catch(() => ({})),
          fetchOwnCosts().catch(() => ({})),
        ]);
        if (Object.keys(ownCosts).length) IO.store.db.set(COSTS_KEY(ownRace), ownCosts);
        data = { when: Date.now(), members, era, tax, ownRace };
        IO.store.db.set(CACHE_KEY, data);
        costs[ownRace] = ownCosts;
      } finally {
        loading = false;
        progress = '';
        onTick();
      }
    }

    // ---------- agregação ----------
    function aggregate(members) {
      const byRace = {};
      const eco = { stock: {}, income: {}, maintenance: 0, population: 0, workers: 0, growth: 0 };
      members.forEach((m) => {
        const race = RACES[m.race] ? m.race : '1';
        const bucket = (byRace[race] = byRace[race] || { total: 0, units: new Map(), income: {}, members: 0 });
        bucket.members += 1;
        if (m.army) {
          m.army.units.forEach((u) => {
            const info = unitInfo(race, u.name);
            const key = info.code || normalize(u.name);
            if (!bucket.units.has(key)) bucket.units.set(key, { name: u.name, qty: 0, ...info });
            bucket.units.get(key).qty += u.qty;
            bucket.total += u.qty;
          });
        }
        if (m.eco) {
          RES.forEach((r) => {
            eco.stock[r.key] = (eco.stock[r.key] || 0) + (m.eco.stock[r.key] || 0);
            eco.income[r.key] = (eco.income[r.key] || 0) + (m.eco.income[r.key] || 0);
            bucket.income[r.key] = (bucket.income[r.key] || 0) + (m.eco.income[r.key] || 0);
          });
          eco.maintenance += m.eco.maintenance || 0;
          eco.population += m.eco.population || 0;
          eco.workers += m.eco.workers || 0;
          eco.growth += m.eco.growth || 0;
        }
      });
      return { byRace, eco };
    }

    // ---------- interface ----------
    IO.ui.injectStyles('io-alp-style', `
      .io-alp { padding:8px 10px 14px; }
      .io-alp .io-alp-bar { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
      .io-alp .io-alp-when { color:#6b5636; font-size:11px; }
      .io-alp h3 { margin:12px 0 4px; font-weight:bold; }
      .io-alp table.data-grid { width:100%; margin:0 0 6px; }
      .io-alp td, .io-alp th { padding:3px 6px; }
      .io-alp td.num, .io-alp th.num { text-align:right; white-space:nowrap; }
      .io-alp td.unit-cell { white-space:nowrap; }
      .io-alp td.unit-cell span.unit { display:inline-block; vertical-align:middle; margin-right:6px; }
      .io-alp .io-alp-cols { display:flex; gap:10px; align-items:flex-start; }
      .io-alp .io-alp-cols > div { flex:1 1 0; min-width:0; }
      .io-alp tr.total td { font-weight:bold; border-top:2px solid #c3b18b; }
      .io-alp th.sortable { cursor:pointer; }
      .io-alp .io-alp-cat td { background:rgba(0,0,0,.05); font-weight:bold; }
      .io-alp .io-alp-msg { padding:14px; text-align:center; }
      .io-alp .io-alp-sim-bar { display:flex; flex-wrap:wrap; gap:12px; align-items:center; margin:0 0 6px; }
      .io-alp .io-alp-sim-bar label { display:inline-flex; align-items:center; gap:4px; }
      .io-alp .io-alp-sim-bar input { width:auto; }
      .io-alp input.io-alp-cost { width:60px; text-align:right; }
      .io-alp td.io-alp-prio { white-space:nowrap; }
      .io-alp td.io-alp-prio button { padding:0 4px; }
      .io-alp tr.io-alp-off td { opacity:.55; }
      .io-alp td label { display:inline-flex; align-items:center; gap:6px; cursor:pointer; }
    `);

    let sortKey = 'army';
    let sortDir = -1;

    // ---------- simulador de produção ----------
    const SIM_KEY = 'io_alp_sim_v1';
    const costs = {}; // raça → { code: { wood, iron, name } }
    let sim = IO.store.local.get(SIM_KEY, { race: '', tax: {}, order: {}, on: {}, days: null });
    if (Array.isArray(sim.order)) sim.order = {}; // formato antigo: a ordem era comum às duas raças

    const saveSim = () => IO.store.local.set(SIM_KEY, sim);
    const unitCost = (race, code) => (costs[race] && costs[race][code]) || {};

    function unitName(race, code, byRace) {
      const known = unitCost(race, code).name;
      if (known) return known;
      const bucket = byRace && byRace[race];
      const unit = bucket && bucket.units.get(code);
      return (unit && unit.name) || code;
    }

    // Todos os códigos da raça: os que têm preço conhecido mais os que já existem no exército.
    function unitCodes(race, byRace) {
      const fromCosts = Object.keys(costs[race] || {});
      const fromArmy = byRace && byRace[race] ? [...byRace[race].units.keys()] : [];
      const known = [...new Set([...fromCosts, ...fromArmy])];
      const order = (UNITS[race] || []).map(([, code]) => code);
      known.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      return known;
    }

    function simOrder(race, byRace) {
      const codes = unitCodes(race, byRace);
      const chosen = ((sim.order && sim.order[race]) || []).filter((c) => codes.includes(c));
      return [...chosen, ...codes.filter((c) => !chosen.includes(c))];
    }

    function simulate(race, byRace) {
      const income = (byRace[race] && byRace[race].income) || {};
      const tax = sim.tax || {};
      const perDay = {};
      RES.forEach((r) => {
        const rate = Math.min(100, Math.max(0, Number(tax[r.key]) || 0));
        perDay[r.key] = (income[r.key] || 0) * 24 * (1 - rate / 100);
      });
      const left = { ...perDay };
      const rows = simOrder(race, byRace).map((code) => {
        const cost = unitCost(race, code);
        const used = RES.filter((r) => cost[r.key] > 0);
        const on = sim.on && sim.on[code];
        if (!on || !used.length) return { code, cost, qty: 0, on: !!on };
        const qty = Math.floor(Math.min(...used.map((r) => left[r.key] / cost[r.key])));
        used.forEach((r) => { left[r.key] -= qty * cost[r.key]; });
        return { code, cost, qty: Math.max(0, qty), on: true };
      });
      return { rows, perDay, left };
    }

    function simulatorHtml(byRace) {
      const races = Object.keys(byRace);
      if (!races.length) return '';
      const own = data.ownRace || IO.game.playerRaceId();
      if (!sim.race || !races.includes(sim.race)) sim.race = races.includes(own) ? own : races[0];
      if (!sim.tax || !Object.keys(sim.tax).length) sim.tax = { ...(data.tax || {}) };
      const race = sim.race;
      const days = sim.days != null ? sim.days : (data.era || 0);
      const { rows, perDay, left } = simulate(race, byRace);
      const bucket = byRace[race] || { members: 0 };
      const missing = rows.some((r) => r.on && !(r.cost.wood > 0 || r.cost.iron > 0));

      const row = (r, i) => `<tr class="${r.on ? '' : 'io-alp-off'}">
        <td class="io-alp-prio">
          <button type="button" class="io-alp-up" data-code="${esc(r.code)}"${i === 0 ? ' disabled' : ''}>▲</button>
          <button type="button" class="io-alp-down" data-code="${esc(r.code)}"${i === rows.length - 1 ? ' disabled' : ''}>▼</button>
        </td>
        <td><label><input type="checkbox" class="io-alp-pick" data-code="${esc(r.code)}"${r.on ? ' checked' : ''}>
          ${unitIcon(race, r.code)}${esc(unitName(race, r.code, byRace))}</label></td>
        <td class="num"><input class="io-alp-cost" data-code="${esc(r.code)}" data-res="wood" value="${r.cost.wood || ''}" size="6"></td>
        <td class="num"><input class="io-alp-cost" data-code="${esc(r.code)}" data-res="iron" value="${r.cost.iron || ''}" size="6"></td>
        <td class="num">${r.on ? fmt(r.qty) : '—'}</td>
        <td class="num">${r.on ? fmt(Math.floor(r.qty * days)) : '—'}</td>
      </tr>`;

      return `<h3>Simulador de produção</h3>
        <div class="io-alp-sim-bar">
          <label>Raça
            <select class="io-alp-race">
              ${races.map((r) => `<option value="${esc(r)}"${r === race ? ' selected' : ''}>${esc(RACES[r] || r)} (${byRace[r].members})</option>`).join('')}
            </select>
          </label>
          <label>Imposto madeira <input class="io-alp-tax" data-res="wood" value="${esc(sim.tax.wood || 0)}" size="3">%</label>
          <label>Imposto ferro <input class="io-alp-tax" data-res="iron" value="${esc(sim.tax.iron || 0)}" size="3">%</label>
          <label>Dias <input class="io-alp-days" value="${esc(Math.round(days * 10) / 10)}" size="4"></label>
          <button type="button" class="button-v2 io-alp-sim-reset">Repor</button>
        </div>
        <table class="data-grid espy">
          <tr><th>Prio.</th><th>Unidade</th><th class="num">Madeira</th><th class="num">Ferro</th>
            <th class="num">Por dia</th><th class="num">Em ${fmt(Math.round(days))} dias</th></tr>
          ${rows.map(row).join('')}
          <tr class="total"><td></td><td>Disponível por dia (após imposto)</td>
            <td class="num">${fmt(Math.round(perDay.wood || 0))}</td>
            <td class="num">${fmt(Math.round(perDay.iron || 0))}</td>
            <td class="num" colspan="2">sobra: ${fmt(Math.round(left.wood || 0))} madeira · ${fmt(Math.round(left.iron || 0))} ferro</td></tr>
        </table>
        <div class="io-alp-when">${bucket.members} membros ${esc(RACES[race] || race)} · ${data.era ? 'a era acaba em ' + (Math.round(data.era * 10) / 10) + ' dias' : 'fim da era desconhecido'} ·
          os preços são os do teu quartel${missing ? ' — preenche os preços das unidades da outra raça à mão' : ''}.</div>`;
    }

    function bindSimulator(target, refresh) {
      const raceSel = $(target, '.io-alp-race');
      if (raceSel) raceSel.addEventListener('change', () => { sim.race = raceSel.value; saveSim(); refresh(); });
      $$(target, '.io-alp-tax').forEach((input) => input.addEventListener('change', () => {
        sim.tax[input.dataset.res] = parseFloat(String(input.value).replace(',', '.')) || 0;
        saveSim(); refresh();
      }));
      const daysInput = $(target, '.io-alp-days');
      if (daysInput) daysInput.addEventListener('change', () => {
        sim.days = parseFloat(String(daysInput.value).replace(',', '.')) || 0;
        saveSim(); refresh();
      });
      $$(target, '.io-alp-pick').forEach((box) => box.addEventListener('change', () => {
        sim.on[box.dataset.code] = box.checked;
        saveSim(); refresh();
      }));
      $$(target, '.io-alp-cost').forEach((input) => input.addEventListener('change', () => {
        const code = input.dataset.code;
        const race = sim.race;
        costs[race] = costs[race] || {};
        costs[race][code] = { ...costs[race][code], [input.dataset.res]: toNumber(input.value) };
        IO.store.db.set(COSTS_KEY(race), costs[race]);
        refresh();
      }));
      const move = (code, delta) => {
        const order = simOrder(sim.race, aggregate(data.members).byRace);
        const i = order.indexOf(code);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= order.length) return;
        order.splice(j, 0, order.splice(i, 1)[0]);
        sim.order[sim.race] = order;
        saveSim(); refresh();
      };
      $$(target, '.io-alp-up').forEach((b) => b.addEventListener('click', () => move(b.dataset.code, -1)));
      $$(target, '.io-alp-down').forEach((b) => b.addEventListener('click', () => move(b.dataset.code, 1)));
      const reset = $(target, '.io-alp-sim-reset');
      if (reset) reset.addEventListener('click', () => {
        sim = { race: '', tax: { ...(data.tax || {}) }, order: {}, on: {}, days: null };
        saveSim(); refresh();
      });
    }

    const unitIcon = (race, code) => (code ? `<span class="unit race-${esc(race)} unit-${esc(code)}"></span>` : '');

    function armyTable(race, bucket) {
      if (!bucket || !bucket.units.size) return '<div class="io-alp-msg">Sem exército.</div>';
      const rows = [];
      CATEGORIES.forEach((cat) => {
        const list = [...bucket.units.values()].filter((u) => u.category === cat).sort((a, b) => b.qty - a.qty);
        if (!list.length) return;
        const sub = list.reduce((s, u) => s + u.qty, 0);
        rows.push(`<tr class="io-alp-cat"><td>${esc(cat)}</td><td class="num">${fmt(sub)}</td></tr>`);
        list.forEach((u) => rows.push(
          `<tr><td class="unit-cell">${unitIcon(race, u.code)}${esc(u.name)}</td><td class="num">${fmt(u.qty)}</td></tr>`));
      });
      return `<table class="data-grid espy">
        <tr><th>Unidade</th><th class="num">Total</th></tr>
        ${rows.join('')}
        <tr class="total"><td>Total</td><td class="num">${fmt(bucket.total)}</td></tr>
      </table>`;
    }

    function economyTable(eco, members) {
      const net = (eco.income.gold || 0) - (eco.maintenance || 0);
      return `<table class="data-grid espy">
        <tr><th>Recurso</th><th class="num">Produção/h</th><th class="num">Em stock</th></tr>
        ${RES.map((r) => `<tr><td>${r.label}</td><td class="num">${fmt(eco.income[r.key] || 0)}</td><td class="num">${fmt(eco.stock[r.key] || 0)}</td></tr>`).join('')}
        <tr><td>Manutenção do exército</td><td class="num">−${fmt(eco.maintenance)}</td><td class="num">—</td></tr>
        <tr class="total"><td>Ouro líquido/h</td><td class="num" style="color:${net < 0 ? '#a40000' : '#16610e'}">${fmt(net)}</td><td class="num">—</td></tr>
        <tr><td>População</td><td class="num">+${fmt(eco.growth)}</td><td class="num">${fmt(eco.population)}</td></tr>
        <tr class="total"><td>Trabalhadores</td><td class="num">—</td><td class="num">${fmt(eco.workers)}</td></tr>
      </table>
      <div class="io-alp-when">${members.length} membros somados.</div>
      <div class="io-alp-when">O ouro líquido é o lucro do Império menos a manutenção do exército; juros e imposto de aliança não aparecem nesta tela.</div>`;
    }

    function memberTable(members) {
      const rows = members.map((m) => {
        const eco = m.eco || { income: {}, stock: {} };
        return {
          m,
          army: m.army ? m.army.total : 0,
          gold: (eco.income.gold || 0) - (eco.maintenance || 0),
          res: RES.slice(0, 3).reduce((s, r) => s + (eco.income[r.key] || 0), 0),
          pop: eco.population || 0,
        };
      });
      const keyOf = {
        name: (r) => r.m.name.toLowerCase(), race: (r) => r.m.race, points: (r) => r.m.points || 0,
        army: (r) => r.army, gold: (r) => r.gold, res: (r) => r.res, pop: (r) => r.pop,
      };
      const get = keyOf[sortKey] || keyOf.army;
      rows.sort((a, b) => {
        const x = get(a); const y = get(b);
        return (typeof x === 'string' ? x.localeCompare(y, 'pt') : x - y) * sortDir;
      });
      const th = (key, label, cls) => `<th class="sortable ${cls || ''}" data-sort="${key}">${label}${sortKey === key ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
      return `<table class="data-grid espy">
        <tr>${th('name', 'Jogador')}${th('race', 'Raça')}${th('points', 'Pontos', 'num')}${th('army', 'Exército', 'num')}${th('res', 'Recursos/h', 'num')}${th('gold', 'Ouro líq./h', 'num')}${th('pop', 'População', 'num')}</tr>
        ${rows.map((r) => `<tr>
          <td>${esc(r.m.name)}${r.m.error ? ` <span style="color:#a40000" title="${esc(r.m.error)}">⚠</span>` : ''}</td>
          <td>${esc(RACES[r.m.race] || '?')}</td>
          <td class="num">${fmt(r.m.points || 0)}</td>
          <td class="num">${fmt(r.army)}</td>
          <td class="num">${fmt(r.res)}</td>
          <td class="num" style="color:${r.gold < 0 ? '#a40000' : 'inherit'}">${fmt(r.gold)}</td>
          <td class="num">${fmt(r.pop)}</td>
        </tr>`).join('')}
      </table>`;
    }

    function render(target, tabArgs) {
      if (!document.contains(target)) return;
      const refresh = () => render(target, tabArgs);

      let body;
      if (loading) {
        body = `<div class="io-alp-msg">${esc(progress || 'A carregar…')}</div>`;
      } else if (!data) {
        body = `<div class="io-alp-msg">Lê o exército e a economia de cada membro da aliança.<br>
          São 2 pedidos por membro, por isso demora alguns segundos.</div>`;
      } else {
        const { byRace, eco } = aggregate(data.members);
        const races = Object.keys(byRace).sort();
        body = `
          ${simulatorHtml(byRace)}
          <h3>Exército da aliança</h3>
          <div class="io-alp-cols">
            ${races.map((r) => `<div><b>${esc(RACES[r] || 'Raça ' + r)}</b>${armyTable(r, byRace[r])}</div>`).join('')}
          </div>
          <h3>Economia da aliança</h3>
          ${economyTable(eco, data.members)}
          <h3>Por membro</h3>
          ${memberTable(data.members)}`;
      }

      target.innerHTML = `<div class="io-alp">
        <div class="io-alp-bar">
          <span class="io-alp-when">${data ? 'Dados de ' + new Date(data.when).toLocaleString('pt-PT') : 'Sem dados guardados'}</span>
          <button type="button" class="button-v2 io-alp-refresh"${loading ? ' disabled' : ''}>${data ? 'Atualizar' : 'Carregar'}</button>
        </div>
        ${body}
      </div>`;

      const btn = $(target, '.io-alp-refresh');
      if (btn) {
        btn.addEventListener('click', () => {
          if (loading) return;
          loadAll(tabArgs, refresh).catch((e) => {
            target.innerHTML = `<div class="io-alp io-alp-msg">Erro: ${esc(e.message)}</div>`;
          });
          refresh();
        });
      }
      if (data) bindSimulator(target, refresh);
      $$(target, 'th.sortable').forEach((th) => th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (sortKey === key) sortDir = -sortDir;
        else { sortKey = key; sortDir = key === 'name' ? 1 : -1; }
        refresh();
      }));
    }

    // ---------- integração com a janela da aliança ----------
    // Reaproveita a chamada da aba de membros do jogo para ler a lista sem abrir a aba.
    function tabArgsFrom(strip) {
      const links = $$(strip, 'li a').map((a) => ({ a, call: String(a.getAttribute('onclick') || '') }));
      const pick = links.find(({ a }) => {
        const t = normalize((a.getAttribute('title') || '') + ' ' + a.textContent);
        return t.includes('membro') || t.includes('jogador');
      }) || links[0];
      if (!pick) return null;
      const m = pick.call.match(/xajax_allianceTabs\(([^)]*)\)/);
      if (!m) return null;
      return m[1].split(',').map((raw) => {
        const t = raw.trim();
        if (/^(true|false)$/i.test(t)) return 'B' + (t.toLowerCase() === 'true' ? '1' : '0');
        const v = t.replace(/^['"]|['"]$/g, '');
        return (/^-?\d+$/.test(v) ? 'N' : 'S') + v;
      });
    }

    function attach(strip) {
      if (strip.querySelector('.' + TAB_CLASS)) return;
      const tabArgs = tabArgsFrom(strip);
      if (!tabArgs) return;

      const li = document.createElement('li');
      li.className = TAB_CLASS;
      li.innerHTML = '<a href="javascript:;" title="Panorama"><span>Panorama</span></a>';
      strip.appendChild(li);

      // Ao voltar para uma aba do jogo, a nossa deixa de estar marcada.
      strip.addEventListener('click', (e) => {
        if (!li.contains(e.target)) li.className = TAB_CLASS;
      }, true);

      li.querySelector('a').addEventListener('click', () => {
        $$(strip, 'li').forEach((other) => {
          other.className = other === li
            ? TAB_CLASS + ' active last'
            : other.className.replace(/\b(active|postactive)\b/g, '').replace(/\s+/g, ' ').trim();
        });
        const content = strip.nextElementSibling;
        const target = (content && content.querySelector('[id^="messagebox"]')) || content;
        if (target) render(target, tabArgs);
      });
    }

    function scan() {
      $$(document, 'td.messageboxClass ul.tabstrip').forEach((strip) => {
        if ($(strip, 'a[onclick*="xajax_allianceTabs"]')) attach(strip);
      });
    }

    IO.store.db.get(CACHE_KEY).then((saved) => { if (saved && saved.members) data = saved; });
    Object.keys(UNITS).forEach((race) => {
      IO.store.db.get(COSTS_KEY(race)).then((saved) => { if (saved) costs[race] = saved; });
    });

    let scheduled = false;
    new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => { scheduled = false; scan(); }, 200);
    }).observe(document.body, { childList: true, subtree: true });
    scan();
  },
});
