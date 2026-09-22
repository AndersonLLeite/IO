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
          ? $$(row, 'td.numeral').filter((td) => !td.querySelector('.tooltip')).map((td) => toNumber(td.textContent))
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
        data = { when: Date.now(), members };
        IO.store.db.set(CACHE_KEY, data);
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
        const bucket = (byRace[race] = byRace[race] || { total: 0, units: new Map() });
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
    `);

    let sortKey = 'army';
    let sortDir = -1;

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

    let scheduled = false;
    new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => { scheduled = false; scan(); }, 200);
    }).observe(document.body, { childList: true, subtree: true });
    scan();
  },
});
