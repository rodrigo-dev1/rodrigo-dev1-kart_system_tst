# Correção V3 — vínculo do Volta a volta + Melhor Largada

## Problemas corrigidos

1. **Cabeçalho do Volta a volta sem `driver_id`**
   - Arquivos no formato `041 - BRENO MANTOVANI - RENTAL` agora são separados corretamente em kart, nome e classe.
   - O texto inteiro não é mais usado como nome do piloto.

2. **Vínculo manual/automático agora é canônico**
   - Quando um piloto do arquivo é vinculado a um cadastro existente, o `driver_id` e o nome do cadastro escolhido passam a prevalecer.
   - O ID/nome originais do arquivo são mantidos apenas como campos de auditoria (`driver_id_arquivo` e `driver_name_arquivo`).
   - Isso impede criação de piloto duplicado quando o usuário já vinculou o registro.

3. **Volta a volta não cria mais participantes no Resultado Final**
   - `pilotos_resultado` só contém pilotos vindos do arquivo Resultado Final.
   - Dados de volta/história apenas complementam uma linha de resultado que já existe.

4. **Melhor Largada**
   - Antes, Classificação e Volta a volta podiam representar o mesmo piloto com chaves diferentes (`id` x nome), deixando o card vazio.
   - As voltas agora são canonicalizadas por `driver_id`, nome e kart antes do cálculo.
   - O sistema usa também os vínculos persistidos em `volta_a_volta_pilotos`.

5. **Correção de dados antigos**
   - O botão `REPROCESSAR RESUMOS DO CAMPEONATO` remove linhas-fantasma de `pilotos_resultado` criadas pelo bug anterior.
   - Também remove, de forma conservadora, cadastros automáticos antigos cujo nome ficou no formato `kart - nome - classe`, desde que exista exatamente um cadastro canônico correspondente no campeonato.
   - Recalcula e persiste `dashboardResumo` e `dashboardGeral` usando a versão 3.

## Depois de publicar

Para campeonatos que já foram importados:

1. Abra **Importar**.
2. Selecione o campeonato.
3. Clique em **🔄 REPROCESSAR RESUMOS DO CAMPEONATO**.
4. Informe a senha administrativa.

Não é necessário importar novamente os três arquivos se os backups antigos ainda estiverem salvos no Firestore.
