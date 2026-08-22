# Contrato legado restaurado no Stage Import V2

## Investigação Git

O Stage Import V2 entrou em `f6bd90c`; portanto a referência funcional imediatamente anterior é `f6bd90c^` (`16711a6`). A comparação de `script.js`, `kart_parser.py` e `index.html` mostrou que o parser continuou produzindo os dados, mas a nova orquestração passou a gravar documentos canônicos próprios e deixou de executar os savers e a descoberta do arquivo bruto usados pelo reprocessamento.

## Contrato confirmado no fluxo antigo

| Fonte | Caminho/documento | ID e campos consumidos |
| --- | --- | --- |
| Classificação | `campeonato/{campeonatoDocId}/resultado_final/{etapa_data}/classificacao/{pilot_uid}` | `driver_id`, `id_piloto`, `driver_name`, `pilot_uid`, `posicao_geral_arquivo`, `posicao_final2`, `melhor_tempo`, `melhor_tempo_segundos`, `melhor_tempo_ponto`, `idImportacao`, `caminhoBackup` |
| Resultado final | `campeonato/{campeonatoDocId}/resultado_final/{etapa_data}/pilotos_resultado/{pilot_uid}` | os campos de identidade acima, `pontos`, `voltas`, `total_tempo`, `total_tempo_segundos` e campos de posição |
| Volta a volta (fonte) | `campeonato/{campeonatoDocId}/volta_a_volta/{etapa_data}_{idImportacao normalizado}` | conteúdo HTML bruto, `idImportacao`, `tipoArquivo`, `dataCorrida`, `etapa` e `caminhoBackup`; este documento é a fonte descoberta pelo reprocessamento |
| Volta a volta (piloto oficial) | `campeonato/{campeonatoDocId}/resultado_final/{etapa_data}/volta_a_volta_pilotos/{driver_id normalizado}` | identidade, total e melhor volta, `idImportacao`, `nomeArquivo` e `caminhoBackup` |
| Backup | `backups_importacao/{idImportacao}` | arquivo integral, metadados da etapa e tipo da fonte |

O documento pai `resultado_final/{etapa_data}` recebe `classificacaoResumo`, `resultadoFinalResumo` e `voltaAVoltaResumo`, cada um referenciando seu `idImportacao`. O reprocessamento lê as duas subcollections de resultado/classificação e encontra as voltas pelo documento bruto em `volta_a_volta`; por isso apenas gravar 30 documentos V2 em `volta_a_volta_pilotos` não satisfazia o contrato.

## Regressão e correção

O contrato quebrado foi a **descoberta e o formato legado de persistência**, não o parse. A implementação V2 gravava uma quarta representação diretamente em subcollections, não criava o documento bruto em `campeonato/.../volta_a_volta` e fornecia campos V2 (`positionChampionship`, `bestLap`) onde os consumidores esperam campos legados (`posicao_final2`, `melhor_tempo`, `melhor_tempo_ponto`).

Agora a identidade dos 30 participantes é resolvida antes do filtro, os cinco oficiais são adaptados para os três payloads antigos, e as funções existentes `salvarSelecionadosNoFirestore`, `salvarArquivoSemPreviewNoFirestore` e `salvarPilotosSelecionadosVoltaAVoltaNoFirestore` são chamadas. O resumo só é processado depois dos três saves.
