// ==UserScript==
// @name         Imperia Suite
// @namespace    imperia-scripts
// @version      2.0.0
// @description  Carregador das ferramentas do Imperia Online (resumo de treinos, calculadora de marcha e radar do mapa).
// @author       AndersonLLeite
// @match        https://*.imperiaonline.org/imperia/game_v5/game/*
// @grant        none
// @run-at       document-idle
// @homepageURL  https://github.com/AndersonLLeite/IO
// @downloadURL  https://raw.githubusercontent.com/AndersonLLeite/IO/main/imperia.user.js
// @updateURL    https://raw.githubusercontent.com/AndersonLLeite/IO/main/imperia.user.js
// Os módulos são fixados por commit: o Tampermonkey guarda @require em cache,
// e um link fixo garante que a versão baixada é exatamente a desta versão do carregador.
// @require      https://raw.githubusercontent.com/AndersonLLeite/IO/__REV__/src/core.js
// @require      https://raw.githubusercontent.com/AndersonLLeite/IO/__REV__/src/modules/soldados-treino.js
// @require      https://raw.githubusercontent.com/AndersonLLeite/IO/__REV__/src/modules/calculadora-marcha.js
// @require      https://raw.githubusercontent.com/AndersonLLeite/IO/__REV__/src/modules/radar-mapa.js
// ==/UserScript==

(function () {
  'use strict';

  if (!window.IO || typeof window.IO.start !== 'function') {
    console.error('[Imperia Suite] núcleo não carregou. Verifique os @require no Tampermonkey.');
    return;
  }

  window.IO.start();
  console.info('[Imperia Suite] módulos ativos:', window.IO.modules.map((m) => m.id).join(', '));
})();
