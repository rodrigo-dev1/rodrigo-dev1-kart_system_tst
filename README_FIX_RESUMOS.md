# Correção — resumos persistidos da etapa

## Problema corrigido

A tela inicial calculava as métricas do Volta a Volta somente quando era aberta. Isso dependia de localizar e reler o HTML bruto no Firestore, então cards como **Ultrapassagens**, **Melhor Largada**, **Voltas Lideradas** e **Regularidade** podiam ficar vazios mesmo depois da importação.

## Novo fluxo

A cada arquivo importado, o sistema agora:

1. salva normalmente o arquivo e os dados dos pilotos;
2. reúne o que já existe para a mesma **etapa + data**;
3. recalcula o resumo da etapa naquele momento;
4. persiste o resultado em `dashboardResumo`;
5. recalcula e persiste o acumulado do campeonato em `dashboardGeral`.

A ordem dos três arquivos não importa. Exemplo:

- Resultado Final → já salva vencedor, pódio, melhor volta e pontos disponíveis;
- Classificação → acrescenta pole, grid e permite calcular Hat-trick;
- Volta a Volta → acrescenta ultrapassagens, melhor largada, voltas lideradas, regularidade e Grand Chelem.

## Firestore

```text
campeonato/{campeonato}
  dashboardGeral

  resultado_final/{etapa_data}
    dashboardResumo
    pilotos_resultado/{piloto}
    classificacao/{piloto}
```

O HTML do Volta a Volta continua sendo mantido na estrutura já existente, mas a home não precisa mais abri-lo para montar os cards.

## Corridas já importadas

Na tela **Importar** foi adicionado o botão:

**🔄 REPROCESSAR RESUMOS DO CAMPEONATO**

Selecione o campeonato e execute esse botão uma vez. Ele cria `dashboardResumo` e `dashboardGeral` para as etapas antigas usando os dados já existentes no Firestore.
