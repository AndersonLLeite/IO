// ==UserScript==
// @name         Imperia Suite
// @namespace    imperia-scripts
// @version      2.6.0
// @description  Carregador das ferramentas do Imperia Online (resumo de treinos, calculadora de marcha, radar do mapa e panorama da aliança).
// @author       AndersonLLeite
// @match        https://*.imperiaonline.org/imperia/game_v5/game/*
// @grant        none
// @run-at       document-idle
// @homepageURL  https://github.com/AndersonLLeite/IO
// @downloadURL  https://raw.githubusercontent.com/AndersonLLeite/IO/main/imperia.user.js
// @updateURL    https://raw.githubusercontent.com/AndersonLLeite/IO/main/imperia.user.js
// Os módulos são fixados por commit: o Tampermonkey guarda @require em cache,
// e um link fixo garante que a versão baixada é exatamente a desta versão do carregador.
// @require      https://raw.githubusercontent.com/AndersonLLeite/IO/861819c7cc0704be07a813d3463f2a5d7a9766f7/src/core.js
// @require      https://raw.githubusercontent.com/AndersonLLeite/IO/861819c7cc0704be07a813d3463f2a5d7a9766f7/src/modules/soldados-treino.js
// @require      https://raw.githubusercontent.com/AndersonLLeite/IO/861819c7cc0704be07a813d3463f2a5d7a9766f7/src/modules/calculadora-marcha.js
// @require      https://raw.githubusercontent.com/AndersonLLeite/IO/861819c7cc0704be07a813d3463f2a5d7a9766f7/src/modules/radar-mapa.js
// @require      https://raw.githubusercontent.com/AndersonLLeite/IO/861819c7cc0704be07a813d3463f2a5d7a9766f7/src/modules/alianca-panorama.js
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
