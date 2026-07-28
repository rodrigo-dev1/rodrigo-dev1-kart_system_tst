# Correção visual V5 — Home da etapa

## Ajustes aplicados

- nomes exibidos passam por uma única limpeza visual, removendo número do kart, `[driver_id]` e `RENTAL`;
- a home usa no máximo duas palavras para o nome do piloto, mantendo o nome completo limpo em tooltips/modais;
- quando existe cadastro canônico por `driver_id`, o nome cadastrado tem prioridade na apresentação;
- Regularidade revalida os pilotos oficiais da etapa na leitura do analytics;
- no modo **Pilotos do Campeonato** do Volta a Volta, posição, ganho/perda e gap são relativos apenas aos pilotos do campeonato;
- barra do Volta a Volta foi reduzida no desktop e principalmente no mobile;
- layout de ultrapassagens foi compactado;
- **Resultado da Etapa** e **Classificação / Tomada** agora possuem a coluna **Pos** separada e fixa durante o scroll horizontal;
- o sticky das tabelas foi reforçado para mobile (`position: sticky`, fundo opaco, z-index e tabela sem `overflow:hidden`).

## Testes

- `node --check script.js`
- `node --check driver_identity.js`
- `node --check kart_analytics.js`
- `node --test tests/driver_identity.test.js` — 9/9 testes aprovados
- parser do arquivo `files/202603202330-volta_a_volta.html` — 67 voltas / 5 pilotos identificados
