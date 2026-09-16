# Imperia Suite

Ferramentas de apoio para o **Imperia Online** (versão web v5), feitas como userscripts que rodam dentro da página do jogo e se integram à interface dele.

> As ferramentas **leem e mostram** informação que o jogo já envia ao navegador, e abrem as telas oficiais do jogo para qualquer ação. Nenhuma ação é executada sozinha.
> Ainda assim, usar scripts pode violar os Termos de Uso do jogo. Use por sua conta e risco.

## Instalação

1. Instale a extensão [Tampermonkey](https://www.tampermonkey.net/).
2. Abra este link e confirme a instalação:
   `https://raw.githubusercontent.com/AndersonLLeite/IO/main/imperia.user.js`
3. Abra o jogo. Um ícone de bússola aparece no menu da direita e um de radar na barra do rodapé.

Só esse script fica ativo no Tampermonkey; ele carrega os módulos sozinho.

## Ferramentas

| Módulo | O que faz | Onde aparece |
|---|---|---|
| `soldados-treino` | Soma por tropa das unidades em treino, concluídas e pendentes | dentro da janela "Soldados a treinar" |
| `calculadora-marcha` | Tempo de marcha e horário de retorno, por tropa, cartografia e velocidade do reino | botão de bússola no menu da direita |
| `radar-mapa` | Varre o mapa e lista colónias, centros militares e recursos especiais de 10%, com filtros e distância | botão de radar no rodapé |

## Estrutura

```
imperia.user.js          carregador instalado no Tampermonkey (@require dos módulos)
src/core.js              funções comuns: xajax, janelas do jogo, botões, armazenamento
src/modules/*.js         uma ferramenta por arquivo
```

Cada módulo se registra no núcleo:

```js
IO.register({
  id: 'meu-modulo',
  name: 'Minha Ferramenta',
  init(IO) { /* ... */ },
});
```

## Criar uma ferramenta nova

1. Crie `src/modules/minha-ferramenta.js` com o `IO.register` acima.
2. Faça o commit e o push.
3. No `imperia.user.js`, acrescente a linha `@require` do arquivo novo, troque o commit de todos os `@require` pelo commit atual e suba a `@version`.
4. No Tampermonkey, mande buscar atualizações do script.

O commit fixo nos `@require` existe porque o Tampermonkey guarda esses arquivos em cache: com um link fixo, cada versão do carregador sempre baixa exatamente os módulos daquele commit.
