// Módulo: resumo por tropa na janela "Soldados a treinar".
IO.register({
  id: 'soldados-treino',
  name: 'Resumo de soldados em treino',

  init(IO) {
    const { $, $$, fmt, toNumber } = IO.utils;
    const SUMMARY_CLASS = 'io-trn-summary';
    const SECTIONS = [
      { key: 'started', label: 'Em treino', headerText: 'Unidades em treinamento' },
      { key: 'completed', label: 'Concluídos', headerText: 'Treinamentos concluídos' },
      { key: 'pending', label: 'Pendentes', headerText: 'Treinamentos pendentes' },
    ];

    // Mesma requisição do link "Mostrar mais"; só o HTML da lista é lido.
    async function fetchSectionRows(winId, type) {
      const args = [`N${winId}`, 'N0', 'N0', 'N0', 'N0', 'N0', 'N0', `S${type}`];
      const xml = await IO.game.xajaxRaw('currentTrainings', args);
      const listId = 'unitsList' + type.charAt(0).toUpperCase() + type.slice(1);
      const box = IO.game.xajaxDom(xml, listId);
      return $$(box, 'tr')
        .filter((tr) => tr.querySelector('a.unit') && tr.children.length > 2)
        .map((tr) => {
          const a = tr.querySelector('a.unit');
          const code = [...a.classList].find((c) => /^unit-/.test(c)) || a.title;
          return {
            code,
            name: a.title,
            raceClass: [...a.classList].find((c) => /^race-/.test(c)) || '',
            qty: toNumber(tr.children[2].textContent),
          };
        });
    }

    function readHeaderTotals(root) {
      const totals = {};
      $$(root, 'table.data-grid td').forEach((td) => {
        const section = SECTIONS.find((s) => td.textContent.trim() === s.headerText);
        if (section && td.nextElementSibling) totals[section.key] = toNumber(td.nextElementSibling.textContent);
      });
      return totals;
    }

    IO.ui.injectStyles('io-trn-style', `
      .${SUMMARY_CLASS} { width:625px; margin:1em 1em 0; }
      .${SUMMARY_CLASS} table.data-grid { width:100%; margin:0; }
      .${SUMMARY_CLASS} th, .${SUMMARY_CLASS} td { padding:3px 6px; }
      .${SUMMARY_CLASS} td.num { text-align:right; white-space:nowrap; }
      .${SUMMARY_CLASS} td.unit-cell { white-space:nowrap; }
      .${SUMMARY_CLASS} td.unit-cell a.unit { display:inline-block; vertical-align:middle; margin-right:6px; pointer-events:none; }
      .${SUMMARY_CLASS} tr.total td { font-weight:bold; border-top:2px solid #c3b18b; }
      .${SUMMARY_CLASS} .io-trn-bar { display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; font-weight:bold; }
      .${SUMMARY_CLASS} .io-trn-warn { color:#a40000; font-weight:normal; margin-top:4px; }
    `);

    function renderTable(container, bySection, headerTotals) {
      const units = new Map();
      SECTIONS.forEach(({ key }) => {
        bySection[key].forEach((row) => {
          if (!units.has(row.code)) units.set(row.code, { name: row.name, code: row.code, raceClass: row.raceClass, started: 0, completed: 0, pending: 0 });
          units.get(row.code)[key] += row.qty;
        });
      });

      const sums = { started: 0, completed: 0, pending: 0 };
      const rowsHtml = [...units.values()]
        .sort((a, b) => a.name.localeCompare(b.name, 'pt'))
        .map((u) => {
          SECTIONS.forEach(({ key }) => { sums[key] += u[key]; });
          const total = u.started + u.completed + u.pending;
          return `<tr>
            <td class="unit-cell"><a class="unit ${u.raceClass} ${u.code}"></a>${u.name}</td>
            ${SECTIONS.map(({ key }) => `<td class="num">${fmt(u[key])}</td>`).join('')}
            <td class="num"><b>${fmt(total)}</b></td>
          </tr>`;
        }).join('');

      const grand = sums.started + sums.completed + sums.pending;
      const mismatches = SECTIONS
        .filter(({ key }) => headerTotals[key] !== undefined && headerTotals[key] !== sums[key])
        .map(({ key, label }) => `${label}: somado ${fmt(sums[key])}, jogo mostra ${fmt(headerTotals[key])}`);

      $(container, '.io-trn-body').innerHTML = `
        <table class="data-grid espy">
          <tr><th>Unidade</th>${SECTIONS.map((s) => `<th>${s.label}</th>`).join('')}<th>Total</th></tr>
          ${rowsHtml || '<tr><td colspan="5" style="text-align:center">Nenhuma tropa em treino.</td></tr>'}
          <tr class="total"><td>Total</td>${SECTIONS.map(({ key }) => `<td class="num">${fmt(sums[key])}</td>`).join('')}<td class="num">${fmt(grand)}</td></tr>
        </table>
        ${mismatches.length ? `<div class="io-trn-warn">⚠ Diferença com o jogo — ${mismatches.join('; ')}</div>` : ''}
      `;
    }

    async function buildSummary(windowRoot, winId) {
      const main = $(windowRoot, '.barracks-alltrn');
      if (!main) return;

      let container = $(main, '.' + SUMMARY_CLASS);
      if (!container) {
        container = document.createElement('div');
        container.className = SUMMARY_CLASS;
        container.innerHTML = `
          <div class="io-trn-bar"><span>Resumo por tropa</span>
            <button type="button" class="button-v2 io-trn-refresh">Atualizar</button></div>
          <div class="io-trn-body"></div>`;
        main.insertBefore(container, main.firstElementChild);
        $(container, '.io-trn-refresh').addEventListener('click', () => buildSummary(windowRoot, winId));
      }

      const body = $(container, '.io-trn-body');
      body.textContent = 'A carregar…';
      try {
        const results = await Promise.all(SECTIONS.map(({ key }) => fetchSectionRows(winId, key)));
        const bySection = {};
        SECTIONS.forEach(({ key }, i) => { bySection[key] = results[i]; });
        if (!document.contains(container)) return; // janela fechada ou redesenhada
        renderTable(container, bySection, readHeaderTotals(main));
      } catch (err) {
        body.textContent = 'Erro ao carregar o resumo: ' + err.message;
      }
    }

    // Detecta a janela "Soldados a treinar" (td#messageboxN > .barracks-alltrn).
    function scan() {
      $$(document, 'td.messageboxClass').forEach((box) => {
        const main = $(box, '.barracks-alltrn');
        if (!main || $(main, '.' + SUMMARY_CLASS) || main.dataset.ioTrnPending) return;
        const winId = parseInt(box.id.replace('messagebox', ''), 10);
        if (Number.isNaN(winId)) return;
        main.dataset.ioTrnPending = '1';
        buildSummary(box, winId);
      });
    }

    let scheduled = false;
    new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => { scheduled = false; scan(); }, 150);
    }).observe(document.body, { childList: true, subtree: true });
    scan();
  },
});
