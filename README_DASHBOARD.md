# Central do Campeonato — atualização da tela inicial

A tela inicial foi ajustada para funcionar como um painel de campeonato, mantendo o fluxo atual de importação.

## O que mudou

- Filtro de **Campeonato**.
- Filtro de **Geral do campeonato** ou **Etapa específica**.
- Cards de destaques:
  - Grand Chelem
  - Hat-trick
  - Melhor Volta
  - Pole Position
  - Mais ultrapassagens / posições ganhas
  - Melhor Largada
  - Mais voltas lideradas
  - Top Regularidade
- Pódio da etapa e Top 3 geral.
- Classificação geral com pontos, vitórias, pódios, poles e melhores voltas.
- Resultado da corrida e classificação/tomada na visão por etapa.
- Campo opcional **Foto URL** no cadastro do piloto; sem foto, o dashboard usa as iniciais.

## Fonte dos dados

A tela usa a estrutura Firestore já existente:

```text
campeonato/{campeonato}
  resultado_final/{etapa}
    pilotos_resultado/{piloto}
    classificacao/{piloto}
  volta_a_volta/{arquivo}

Pilotos/{piloto}
```

O fluxo de importação não foi alterado. Os cálculos extras usam os arquivos já salvos.

## Cálculos

- **Pole**: primeiro piloto do campeonato na classificação/tomada.
- **Melhor volta**: menor melhor tempo entre os pilotos do campeonato.
- **Melhor largada**: diferença entre a posição da classificação e a ordem após a primeira volta.
- **Ultrapassagens**: soma das posições ganhas entre uma volta e outra, estimada pela ordem de passagem registrada no arquivo volta a volta.
- **Voltas lideradas**: primeira passagem registrada em cada número de volta.
- **Regularidade**: desvio padrão das voltas limpas, excluindo a primeira volta, voltas acima de 5% da melhor e possíveis voltas anormalmente rápidas.
- **Hat-trick**: pole + vitória + melhor volta na mesma etapa.
- **Grand Chelem**: hat-trick + liderança em todas as voltas analisadas.

Quando o volta a volta não está disponível com conteúdo, os cards dependentes dele ficam sem dados; resultado, pole e melhor volta continuam funcionando.
