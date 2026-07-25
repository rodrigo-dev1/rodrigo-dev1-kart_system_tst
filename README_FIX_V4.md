# Correção V4 — Dashboard após importação e exclusão

Esta versão corrige o erro exibido ao reprocessar:

```text
(pilotosCampeonato || []) is not iterable
```

## 1. Importação passa a gerar o resumo novamente

A função que cruza Resultado Final, Classificação e Volta a Volta agora aceita corretamente a estrutura retornada pelo filtro de pilotos do campeonato (`ids`, `nomes` e lista canônica de pilotos).

Fluxo após cada importação:

1. arquivo é salvo no Firestore;
2. dados derivados do arquivo são persistidos;
3. a etapa é recalculada;
4. `dashboardResumo` é salvo em `campeonatos/{campeonato}/resultado_final/{etapa_data}`;
5. `dashboardGeral` é atualizado no documento do campeonato;
6. a home apenas consulta os resumos persistidos.

O reprocessamento manual também volta a funcionar.

## 2. Exclusão de arquivo agora recalcula a etapa

Ao excluir um arquivo em **Consultar > Arquivos**, o sistema agora:

1. remove o backup selecionado;
2. remove somente os registros derivados daquele `idImportacao`;
3. limpa os metadados que apontavam para o arquivo excluído;
4. verifica quais arquivos/dados ainda restam para a etapa;
5. recalcula e persiste `dashboardResumo` com os dados restantes;
6. recalcula `dashboardGeral`;
7. atualiza a tela inicial.

Exemplos:

- excluir **Classificação**: pole, grid, hat-trick, Grand Chelem e melhor largada são recalculados sem a classificação;
- excluir **Volta a Volta**: ultrapassagens, voltas lideradas, regularidade e melhor largada deixam de usar esse arquivo;
- excluir **Resultado Final**: vencedor, pódio, pontos e melhor volta vindos do resultado são retirados;
- excluir o último arquivo de uma etapa: a etapa fica marcada como vazia e deixa de aparecer no dashboard.

## 3. Etapas vazias não reaparecem

Foi adicionado `dashboardOculto` para documentos de etapa que ficaram sem nenhuma fonte após exclusões. O reprocessamento manual verifica se ainda há dados antes de reconstruir o resumo, evitando ressuscitar etapas vazias.

## 4. Vínculo do Volta a Volta

A lista de pilotos do campeonato agora também é enviada ao processo de canonicalização das voltas. Isso permite cruzar melhor:

- `driver_id`;
- nome;
- kart;
- cadastro escolhido no vínculo.

Também foi ampliada a limpeza dos cadastros antigos criados no formato `041 - NOME - RENTAL`: o cadastro canônico pode não possuir `driver_id`, desde que seja o único cadastro normal com aquele nome e esteja vinculado ao campeonato.

## Como corrigir a etapa que já está no Firebase

Depois de publicar a V4:

1. abra **Importar**;
2. selecione o campeonato;
3. clique em **REPROCESSAR RESUMOS DO CAMPEONATO**;
4. informe a senha ADM.

O erro de `is not iterable` não deve mais ocorrer e o `dashboardResumo` das etapas existentes será reconstruído.
