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
    // Tropas que ficam sempre à vista no simulador; as outras escondem-se atrás do botão.
    const FEATURED = { 1: ['k3', 'p3', 'c4'], 2: ['k3', 'c4'] }; // Paladinos/Falanges/Balistas · Catafractários/Balistas
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

    // Preço de treino (madeira/ferro) das duas raças, lido dos quartéis do reino.
    // O quartel só mostra os preços da raça do jogador, por isso os da outra ficam aqui;
    // ao carregar os dados, os preços reais da tua raça substituem estes.
    const DEFAULT_COSTS = {
      1: {
        p1: { name: 'Lanceiros', wood: 245, iron: 5 }, p2: { name: 'Lanceiros pesados', wood: 326, iron: 16 },
        p3: { name: 'Falanges', wood: 571, iron: 49 }, m1: { name: 'Espadachins', wood: 218, iron: 65 },
        m2: { name: 'Espadachins Pesados', wood: 163, iron: 131 }, m3: { name: 'Guardiões', wood: 163, iron: 294 },
        s1: { name: 'Arqueiros', wood: 490, iron: 11 }, s2: { name: 'Arqueiros pesados', wood: 694, iron: 24 },
        s3: { name: 'Arqueiros de Elite', wood: 1306, iron: 65 }, k1: { name: 'Cavalaria Leve', wood: 544, iron: 109 },
        k2: { name: 'Cavalaria Pesada', wood: 490, iron: 228 }, k3: { name: 'Paladinos', wood: 653, iron: 522 },
        c1: { name: 'Aríetes', wood: 23120, iron: 816 }, c2: { name: 'Catapultas', wood: 36720, iron: 816 },
        c3: { name: 'Trabucos', wood: 73440, iron: 1632 }, c4: { name: 'Balistas', wood: 28560, iron: 2448 },
        ct: { name: 'Carrinhos de transporte', wood: 1800, iron: 40 }, ks: { name: 'Espião', wood: 500, iron: 100 },
      },
      2: {
        p1: { name: 'Lançadores de dardos', wood: 122, iron: 3 }, p2: { name: 'Lanceiros pesados', wood: 163, iron: 8 },
        m1: { name: 'Espadachins', wood: 109, iron: 33 }, m2: { name: 'Espadachins Pesados', wood: 82, iron: 65 },
        s1: { name: 'Arqueiros', wood: 245, iron: 5 }, s2: { name: 'Arqueiros pesados', wood: 347, iron: 12 },
        s3: { name: 'Arqueiros de Elite', wood: 653, iron: 33 }, k1: { name: 'Cavalaria Leve', wood: 408, iron: 82 },
        k2: { name: 'Cavalaria Pesada', wood: 367, iron: 171 }, k3: { name: 'Catafractários', wood: 490, iron: 392 },
        k4: { name: 'Arqueiros a cavalo', wood: 408, iron: 82 }, k5: { name: 'Arqueiros Catafractários', wood: 734, iron: 343 },
        c1: { name: 'Aríetes', wood: 23120, iron: 816 }, c2: { name: 'Catapultas', wood: 36720, iron: 816 },
        c3: { name: 'Trabucos', wood: 73440, iron: 1632 }, c4: { name: 'Balistas', wood: 28560, iron: 2448 },
        ct: { name: 'Carrinhos de transporte', wood: 1800, iron: 40 }, ks: { name: 'Espião', wood: 500, iron: 100 },
      },
    };

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
      .io-alp input.io-alp-cost:placeholder-shown { border-color:#a40000; }
      .io-alp td.io-alp-prio { white-space:nowrap; }
      .io-alp td.io-alp-prio button { padding:0 4px; }
      .io-alp tr.io-alp-off td { opacity:.55; }
      .io-alp tr.io-alp-toggle-row td { text-align:center; background:rgba(0,0,0,.05); }
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

    // Distribui os recursos do dia pelas unidades escolhidas.
    // "equilibrado" procura a mistura que gasta o máximo dos dois recursos; "prioridade" enche
    // a primeira unidade da lista até esgotar e só depois passa à seguinte.
    function allocate(picked, costOf, avail) {
      const qty = {};
      const left = { wood: avail.wood, iron: avail.iron };
      const take = (code, n) => {
        const units = Math.floor(n);
        if (!(units > 0)) return;
        qty[code] = (qty[code] || 0) + units;
        left.wood -= units * (costOf(code).wood || 0);
        left.iron -= units * (costOf(code).iron || 0);
      };
      const maxOf = (code, pool) => {
        const cost = costOf(code);
        const limits = RES.slice(0, 2).filter((r) => cost[r.key] > 0).map((r) => pool[r.key] / cost[r.key]);
        return limits.length ? Math.min(...limits) : 0;
      };

      if (sim.mode !== 'priority' && picked.length > 1) {
        // O ótimo de um problema com dois recursos está sempre em uma ou duas unidades:
        // testamos todas as hipóteses e ficamos com a que aproveita melhor madeira e ferro.
        const score = (w, f) => (avail.wood ? w / avail.wood : 0) + (avail.iron ? f / avail.iron : 0);
        let best = null;
        const consider = (plan, rank) => {
          const w = plan.reduce((t, [c, n]) => t + n * (costOf(c).wood || 0), 0);
          const f = plan.reduce((t, [c, n]) => t + n * (costOf(c).iron || 0), 0);
          if (w > avail.wood + 1e-6 || f > avail.iron + 1e-6) return;
          const value = score(w, f);
          if (!best || value > best.value + 1e-9 || (Math.abs(value - best.value) <= 1e-9 && rank < best.rank)) {
            best = { plan, value, rank };
          }
        };
        picked.forEach((code, i) => consider([[code, maxOf(code, avail)]], i));
        for (let i = 0; i < picked.length; i++) {
          for (let j = i + 1; j < picked.length; j++) {
            const a = costOf(picked[i]);
            const b = costOf(picked[j]);
            const det = (a.wood || 0) * (b.iron || 0) - (b.wood || 0) * (a.iron || 0);
            if (!det) continue;
            const x = (avail.wood * (b.iron || 0) - avail.iron * (b.wood || 0)) / det;
            const y = ((a.wood || 0) * avail.iron - (a.iron || 0) * avail.wood) / det;
            if (x >= 0 && y >= 0) consider([[picked[i], x], [picked[j], y]], i + j);
          }
        }
        if (best) best.plan.forEach(([code, n]) => take(code, n));
      }

      // Sobras (e o modo por prioridade): enche pela ordem da lista.
      picked.forEach((code) => take(code, maxOf(code, left)));
      return { qty, left };
    }

    function simulate(race, byRace) {
      const income = (byRace[race] && byRace[race].income) || {};
      const tax = sim.tax || {};
      const perDay = {};
      RES.forEach((r) => {
        const rate = Math.min(100, Math.max(0, Number(tax[r.key]) || 0));
        perDay[r.key] = (income[r.key] || 0) * 24 * (1 - rate / 100);
      });
      const order = simOrder(race, byRace);
      const costOf = (code) => unitCost(race, code);
      const picked = order.filter((code) => sim.on && sim.on[code]
        && (costOf(code).wood > 0 || costOf(code).iron > 0));
      const { qty, left } = allocate(picked, costOf, perDay);
      const rows = order.map((code) => ({
        code, cost: costOf(code), qty: qty[code] || 0, on: !!(sim.on && sim.on[code]),
      }));
      return { rows, perDay, left, income };
    }

    function simulatorHtml(byRace) {
      const races = Object.keys(byRace);
      if (!races.length) return '';
      const own = data.ownRace || IO.game.playerRaceId();
      if (!sim.race || !races.includes(sim.race)) sim.race = races.includes(own) ? own : races[0];
      if (!sim.tax || !Object.keys(sim.tax).length) sim.tax = { ...(data.tax || {}) };
      const race = sim.race;
      const days = sim.days != null ? sim.days : (data.era || 0);
      const { rows, perDay, left, income } = simulate(race, byRace);
      const bucket = byRace[race] || { members: 0 };
      // O jogo só mostra os preços de treino da raça do jogador; os da outra raça são escritos à mão.
      const noPrice = rows.filter((r) => !(r.cost.wood > 0 || r.cost.iron > 0));
      const missing = rows.some((r) => r.on && !(r.cost.wood > 0 || r.cost.iron > 0));
      // Em destaque: as tropas escolhidas para a raça, mais qualquer outra que esteja marcada.
      const stars = FEATURED[race] || [];
      const featured = rows.filter((r) => stars.includes(r.code) || r.on);
      const others = rows.filter((r) => !featured.includes(r));

      const row = (r, i) => `<tr class="${r.on ? '' : 'io-alp-off'}">
        <td class="io-alp-prio">
          <button type="button" class="io-alp-up" data-code="${esc(r.code)}"${i === 0 ? ' disabled' : ''}>▲</button>
          <button type="button" class="io-alp-down" data-code="${esc(r.code)}"${i === rows.length - 1 ? ' disabled' : ''}>▼</button>
        </td>
        <td><label><input type="checkbox" class="io-alp-pick" autocomplete="off" data-code="${esc(r.code)}"${r.on ? ' checked' : ''}>
          ${unitIcon(race, r.code)}${esc(unitName(race, r.code, byRace))}</label></td>
        <td class="num"><input class="io-alp-cost" autocomplete="off" data-code="${esc(r.code)}" data-res="wood" value="${r.cost.wood || ''}" placeholder="?" size="6"></td>
        <td class="num"><input class="io-alp-cost" autocomplete="off" data-code="${esc(r.code)}" data-res="iron" value="${r.cost.iron || ''}" placeholder="?" size="6"></td>
        <td class="num">${r.on ? num(r.qty) : '—'}</td>
        <td class="num">${r.on ? num(Math.floor(r.qty * days)) : '—'}</td>
      </tr>`;

      return `<h3>Simulador de produção</h3>
        <div class="io-alp-sim-bar">
          <label>Raça
            <select class="io-alp-race" autocomplete="off">
              ${races.map((r) => `<option value="${esc(r)}"${r === race ? ' selected' : ''}>${esc(RACES[r] || r)} (${byRace[r].members})</option>`).join('')}
            </select>
          </label>
          <label>Imposto madeira <input class="io-alp-tax" autocomplete="off" data-res="wood" value="${esc(sim.tax.wood || 0)}" size="3">%</label>
          <label>Imposto ferro <input class="io-alp-tax" autocomplete="off" data-res="iron" value="${esc(sim.tax.iron || 0)}" size="3">%</label>
          <label>Dias <input class="io-alp-days" autocomplete="off" value="${esc(Math.round(days * 10) / 10)}" size="4"></label>
          <label>Modo
            <select class="io-alp-mode" autocomplete="off">
              <option value="balanced"${sim.mode === 'priority' ? '' : ' selected'}>Equilibrado</option>
              <option value="priority"${sim.mode === 'priority' ? ' selected' : ''}>Por prioridade</option>
            </select>
          </label>
          <button type="button" class="button-v2 io-alp-sim-reset">Repor</button>
        </div>
        <table class="data-grid espy">
          <tr><th>Prio.</th><th>Unidade</th><th class="num">Madeira</th><th class="num">Ferro</th>
            <th class="num">Por dia</th><th class="num">Em ${fmt(Math.round(days))} dias</th></tr>
          ${featured.map((r) => row(r, rows.indexOf(r))).join('')}
          <tr class="io-alp-toggle-row"><td colspan="6">
            <button type="button" class="button-v2 io-alp-toggle">${sim.showAll ? 'Esconder as outras tropas' : `Mostrar as outras tropas (${others.length})`}</button>
          </td></tr>
          ${sim.showAll ? others.map((r) => row(r, rows.indexOf(r))).join('') : ''}
          <tr class="total"><td></td><td>Disponível por dia (após imposto)</td>
            <td class="num">${num(perDay.wood)}</td>
            <td class="num">${num(perDay.iron)}</td>
            <td class="num" colspan="2">sobra: ${num(left.wood)} madeira · ${num(left.iron)} ferro</td></tr>
        </table>
        <div class="io-alp-when">${bucket.members} membros ${esc(RACES[race] || race)} produzem ${num(income.wood)} madeira/h e ${num(income.iron)} ferro/h
          — em 24 h, menos o imposto, dá o disponível por dia acima.
          ${data.era ? 'A era acaba em ' + (Math.round(data.era * 10) / 10) + ' dias.' : 'Fim da era desconhecido.'}
          Os preços são os do teu quartel.
          ${race === own ? '' : `<br>Os preços dos ${esc(RACES[race] || race)} vêm da tabela do reino; podes corrigi-los nas caixas.`}
          ${missing ? '<br><b>As tropas marcadas sem preço não entram na conta.</b>' : ''}</div>`;
    }

    function bindSimulator(target, refresh) {
      const raceSel = $(target, '.io-alp-race');
      if (raceSel) raceSel.addEventListener('change', () => { sim.race = raceSel.value; saveSim(); refresh(); });
      $$(target, '.io-alp-tax').forEach((input) => input.addEventListener('change', () => {
        sim.tax[input.dataset.res] = parseFloat(String(input.value).replace(',', '.')) || 0;
        saveSim(); refresh();
      }));
      const toggle = $(target, '.io-alp-toggle');
      if (toggle) toggle.addEventListener('click', () => { sim.showAll = !sim.showAll; saveSim(); refresh(); });
      const modeSel = $(target, '.io-alp-mode');
      if (modeSel) modeSel.addEventListener('change', () => { sim.mode = modeSel.value; saveSim(); refresh(); });
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
        sim = { race: '', tax: { ...(data.tax || {}) }, order: {}, on: {}, days: null, mode: 'balanced' };
        saveSim(); refresh();
      });
    }

    // 1 234 → "1,2k" · 14 440 741 → "14,4M" · 9 292 414 239 → "9,3B" (o valor exato fica no title)
    function short(value) {
      const n = Math.round(Number(value) || 0);
      const abs = Math.abs(n);
      const cut = (div, suffix) => {
        const v = n / div;
        return String(Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10).replace('.', ',') + suffix;
      };
      if (abs >= 1e9) return cut(1e9, 'B');
      if (abs >= 1e6) return cut(1e6, 'M');
      if (abs >= 1e4) return cut(1e3, 'k');
      return fmt(n);
    }
    const num = (value) => `<span title="${esc(fmt(Math.round(Number(value) || 0)))}">${short(value)}</span>`;

    const unitIcon = (race, code) => (code ? `<span class="unit race-${esc(race)} unit-${esc(code)}"></span>` : '');

    function armyTable(race, bucket) {
      if (!bucket || !bucket.units.size) return '<div class="io-alp-msg">Sem exército.</div>';
      const rows = [];
      CATEGORIES.forEach((cat) => {
        const list = [...bucket.units.values()].filter((u) => u.category === cat).sort((a, b) => b.qty - a.qty);
        if (!list.length) return;
        const sub = list.reduce((s, u) => s + u.qty, 0);
        rows.push(`<tr class="io-alp-cat"><td>${esc(cat)}</td><td class="num">${num(sub)}</td></tr>`);
        list.forEach((u) => rows.push(
          `<tr><td class="unit-cell">${unitIcon(race, u.code)}${esc(u.name)}</td><td class="num">${num(u.qty)}</td></tr>`));
      });
      return `<table class="data-grid espy">
        <tr><th>Unidade</th><th class="num">Total</th></tr>
        ${rows.join('')}
        <tr class="total"><td>Total</td><td class="num">${num(bucket.total)}</td></tr>
      </table>`;
    }

    function economyTable(eco, members) {
      const net = (eco.income.gold || 0) - (eco.maintenance || 0);
      return `<table class="data-grid espy">
        <tr><th>Recurso</th><th class="num">Produção/h</th><th class="num">Em stock</th></tr>
        ${RES.map((r) => `<tr><td>${r.label}</td><td class="num">${num(eco.income[r.key])}</td><td class="num">${num(eco.stock[r.key])}</td></tr>`).join('')}
        <tr><td>Manutenção do exército</td><td class="num">−${num(eco.maintenance)}</td><td class="num">—</td></tr>
        <tr class="total"><td>Ouro líquido/h</td><td class="num" style="color:${net < 0 ? '#a40000' : '#16610e'}">${num(net)}</td><td class="num">—</td></tr>
        <tr><td>População</td><td class="num">+${num(eco.growth)}</td><td class="num">${num(eco.population)}</td></tr>
        <tr class="total"><td>Trabalhadores</td><td class="num">—</td><td class="num">${num(eco.workers)}</td></tr>
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
          <td class="num">${num(r.m.points)}</td>
          <td class="num">${num(r.army)}</td>
          <td class="num">${num(r.res)}</td>
          <td class="num" style="color:${r.gold < 0 ? '#a40000' : 'inherit'}">${num(r.gold)}</td>
          <td class="num">${num(r.pop)}</td>
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
    Object.keys(DEFAULT_COSTS).forEach((race) => {
      costs[race] = { ...DEFAULT_COSTS[race] };
      IO.store.db.get(COSTS_KEY(race)).then((saved) => {
        if (saved) costs[race] = { ...DEFAULT_COSTS[race], ...saved };
      });
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
