from __future__ import annotations

import json
import re
from io import StringIO
from typing import Optional

import pandas as pd
from js import document, window
from pyodide.ffi.wrappers import add_event_listener

COLUNAS_RENAME = {
    "Pos": "posicao_final",
    "No.": "kart_numero",
    "Nome": "piloto_original",
    "Classe": "classe",
    "Comentários": "comentarios",
    "Pitstops": "pitstops",
    "Voltas": "voltas",
    "Total Tempo": "total_tempo",
    "Melhor Tempo": "melhor_tempo",
    "Diff": "diff",
    "Espaço": "espaco",
    "S1 Melhor Vlt": "s1_melhor_vlt",
    "S2 Melhor Vlt": "s2_melhor_vlt",
    "S3 Melhor Vlt": "s3_melhor_vlt",
    "SFSpd Melhor Vlt": "sfspd_melhor_vlt",
}

# Mesma pontuação informada para a importação atual.
PONTUACAO_PADRAO = {
    1: 20,
    2: 17,
    3: 15,
    4: 13,
    5: 11,
    6: 9,
    7: 7,
    8: 5,
    9: 3,
    10: 1,
}

LAST_DF: Optional[pd.DataFrame] = None


def limpar_texto(valor: object) -> Optional[str]:
    if pd.isna(valor):
        return None

    texto = str(valor).strip()
    texto = re.sub(r"\s+", " ", texto)

    return texto or None


def tempo_para_segundos(valor: object) -> Optional[float]:
    """
    Converte tempos como:
    15:22.148 -> 922.148
    1:00.523  -> 60.523
    47.131    -> 47.131
    """
    texto = limpar_texto(valor)

    if not texto:
        return None

    texto = texto.replace(",", ".")

    if not re.match(r"^\d+(:\d{2})?(\.\d+)?$", texto):
        return None

    partes = texto.split(":")

    if len(partes) == 2:
        minutos = int(partes[0])
        segundos = float(partes[1])
        return round((minutos * 60) + segundos, 3)

    return round(float(texto), 3)


def extrair_metadados_html_texto(html: str, nome_arquivo: str) -> dict:
    def buscar(pattern: str) -> Optional[str]:
        match = re.search(pattern, html, flags=re.IGNORECASE | re.DOTALL)

        if not match:
            return None

        texto = re.sub(r"<.*?>", "", match.group(1))
        return limpar_texto(texto)

    gerado_em = buscar(r'<div class="save">\s*Gerada em\s*(.*?)\s*</div>')

    return {
        "kartodromo": buscar(r'<div class="headerbig">(.*?)</div>'),
        "evento": buscar(r'<div class="headersmall">(.*?)</div>'),
        "gerado_em": pd.to_datetime(gerado_em, dayfirst=True, errors="coerce") if gerado_em else pd.NaT,
        "arquivo_origem": nome_arquivo,
    }


def carregar_tabela_corrida_html_texto(
    html: str,
    nome_arquivo: str = "arquivo.html",
    tipo_arquivo: str = "resultado_final",
) -> pd.DataFrame:
    """
    Lê HTML/HTM/XML de Resultado Final ou Classificação enviado no front.
    Retorna um DataFrame com driver_id, driver_name e dados principais da tabela.
    """
    tabelas = pd.read_html(
        StringIO(html),
        flavor="bs4",
        decimal=",",
        thousands=None,
        converters={
            "No.": lambda x: str(x).strip().zfill(3),
        },
    )

    if not tabelas:
        raise ValueError("Nenhuma tabela foi encontrada no arquivo.")

    df = tabelas[0].rename(columns=COLUNAS_RENAME)

    colunas_obrigatorias = {
        "posicao_final",
        "kart_numero",
        "piloto_original",
    }

    colunas_faltantes = colunas_obrigatorias - set(df.columns)

    if colunas_faltantes:
        raise ValueError(f"Colunas obrigatórias não encontradas: {sorted(colunas_faltantes)}")

    for coluna in [
        "piloto_original",
        "classe",
        "comentarios",
        "diff",
        "espaco",
        "total_tempo",
        "melhor_tempo",
    ]:
        if coluna in df.columns:
            df[coluna] = df[coluna].apply(limpar_texto)

    piloto_extraido = df["piloto_original"].astype(str).str.extract(
        r"^\[(?P<driver_id>\d+)\]\s*(?P<driver_name>.*)$"
    )

    df["driver_id"] = piloto_extraido["driver_id"]
    df["driver_name"] = piloto_extraido["driver_name"].apply(limpar_texto)
    df["driver_name"] = df["driver_name"].fillna(df["piloto_original"])

    df["posicao_final"] = pd.to_numeric(df["posicao_final"], errors="coerce").astype("Int64")

    if "voltas" in df.columns:
        df["voltas"] = pd.to_numeric(df["voltas"], errors="coerce").astype("Int64")

    if "pitstops" in df.columns:
        df["pitstops"] = pd.to_numeric(df["pitstops"], errors="coerce").astype("Int64")

    for coluna in [
        "s1_melhor_vlt",
        "s2_melhor_vlt",
        "s3_melhor_vlt",
        "sfspd_melhor_vlt",
    ]:
        if coluna in df.columns:
            df[coluna] = pd.to_numeric(df[coluna], errors="coerce")

    df["total_tempo_segundos"] = df["total_tempo"].apply(tempo_para_segundos) if "total_tempo" in df.columns else None
    df["melhor_tempo_segundos"] = df["melhor_tempo"].apply(tempo_para_segundos) if "melhor_tempo" in df.columns else None

    metadados = extrair_metadados_html_texto(html, nome_arquivo)

    for chave, valor in metadados.items():
        df[chave] = valor

    df["tipo_arquivo"] = tipo_arquivo

    ordem_colunas = [
        "driver_id",
        "driver_name",
        "posicao_final",
        "kart_numero",
        "arquivo_origem",
        "tipo_arquivo",
        "kartodromo",
        "evento",
        "gerado_em",
        "classe",
        "voltas",
        "total_tempo",
        "total_tempo_segundos",
        "melhor_tempo",
        "melhor_tempo_segundos",
        "diff",
        "espaco",
        "s1_melhor_vlt",
        "s2_melhor_vlt",
        "s3_melhor_vlt",
        "sfspd_melhor_vlt",
        "comentarios",
        "pitstops",
        "piloto_original",
    ]

    colunas_existentes = [coluna for coluna in ordem_colunas if coluna in df.columns]

    return df[colunas_existentes].sort_values("posicao_final").reset_index(drop=True)


def filter_piloto(df: pd.DataFrame, pilotos: dict) -> pd.DataFrame:
    """
    Exemplo equivalente ao que será feito pela seleção dos checkboxes no front.
    Recebe um dict de pilotos e retorna somente os driver_id selecionados.
    """
    pilotos_ids_str = [str(id_) for id_ in pilotos.values()]
    df_filtrado = df[df["driver_id"].astype(str).isin(pilotos_ids_str)].copy()
    return df_filtrado


def get_position_and_points(df_filtrado: pd.DataFrame) -> pd.DataFrame:
    df_filtrado = df_filtrado.copy()
    df_filtrado.loc[:, "posicao_final2"] = df_filtrado["posicao_final"].rank(method="min").astype(int)
    df_filtrado.loc[:, "pontos"] = df_filtrado["posicao_final2"].map(PONTUACAO_PADRAO).fillna(0).astype(int)
    return df_filtrado


def select_end(df: pd.DataFrame) -> pd.DataFrame:
    colunas = [
        "arquivo_origem",
        "evento",
        "driver_id",
        "driver_name",
        "diff",
        "total_tempo",
        "posicao_final2",
        "pontos",
    ]
    return df[colunas]


def set_html(element_id: str, html: str) -> None:
    element = document.getElementById(element_id)
    if element is not None:
        element.innerHTML = html


def tipo_arquivo_atual() -> str:
    select = document.getElementById("imp_tipo_arquivo")
    return str(select.value) if select is not None else ""


def label_tipo_arquivo(tipo: str) -> str:
    return {
        "resultado_final": "Resultado final",
        "classificacao": "Classificação",
        "volta_a_volta": "Volta a volta",
    }.get(tipo, tipo or "-")


def serializar_para_js(df: pd.DataFrame, nome_arquivo: str, tipo_arquivo: str) -> None:
    df_js = df.copy()

    for coluna in df_js.columns:
        if pd.api.types.is_datetime64_any_dtype(df_js[coluna]):
            df_js[coluna] = df_js[coluna].dt.strftime("%Y-%m-%d %H:%M:%S")

    df_js = df_js.astype(object).where(pd.notna(df_js), None)
    registros = df_js.to_dict(orient="records")

    payload = {
        "arquivo": nome_arquivo,
        "tipo": tipo_arquivo,
        "registros": registros,
    }

    payload_json = json.dumps(payload, ensure_ascii=False, default=str)
    window.IMPORTACAO_PYSCRIPT_JSON = payload_json

    if hasattr(window, "receberImportacaoPyScript"):
        window.receberImportacaoPyScript(payload_json)
    elif hasattr(window, "receberResultadoFinalPyScript"):
        window.receberResultadoFinalPyScript(payload_json)


async def get_text_from_file(file) -> str:
    array_buffer = await file.arrayBuffer()
    data = array_buffer.to_bytes()

    for encoding in ("utf-8", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue

    return data.decode("utf-8", errors="ignore")


async def ler_arquivo_importacao(event) -> None:
    global LAST_DF

    try:
        tipo_arquivo = tipo_arquivo_atual()
        file_list = event.target.files
        file = file_list.item(0) if file_list and file_list.length else None

        if file is None:
            set_html("pyStatus", "Selecione o tipo de arquivo e depois escolha o arquivo.")
            window.IMPORTACAO_PYSCRIPT_JSON = ""
            return

        nome_arquivo = str(file.name)

        if tipo_arquivo == "volta_a_volta":
            LAST_DF = None
            window.IMPORTACAO_PYSCRIPT_JSON = ""
            set_html("pyStatus", f"⏳ Lendo {nome_arquivo} para seleção de pilotos da história...")
            html = await get_text_from_file(file)

            if hasattr(window, "prepararPreviewVoltaAVoltaPyScript"):
                window.prepararPreviewVoltaAVoltaPyScript(html, nome_arquivo)
            else:
                set_html("pyStatus", "✅ Volta a volta lido. A seleção será montada pelo JavaScript.")

            return

        if tipo_arquivo not in {"resultado_final", "classificacao"}:
            LAST_DF = None
            window.IMPORTACAO_PYSCRIPT_JSON = ""
            set_html("pyStatus", "ℹ️ Selecione Resultado final, Classificação ou Volta a volta.")
            return

        set_html("pyStatus", f"⏳ Lendo {nome_arquivo} com PyScript/Python...")

        html = await get_text_from_file(file)
        df = carregar_tabela_corrida_html_texto(html, nome_arquivo, tipo_arquivo)
        LAST_DF = df

        serializar_para_js(df, nome_arquivo, tipo_arquivo)
        set_html("pyStatus", f"✅ Leitura concluída: {len(df)} piloto(s) identificado(s). Use a lista única abaixo para marcar os pilotos e gerar a prévia.")

    except Exception as exc:
        LAST_DF = None
        set_html("pyStatus", f"❌ Erro ao ler arquivo com PyScript: {exc}")
        window.IMPORTACAO_PYSCRIPT_JSON = ""


def inicializar() -> None:
    input_importacao = document.getElementById("fileImportacaoUnico")

    if input_importacao is None:
        set_html("pyStatus", "❌ Input fileImportacaoUnico não encontrado no HTML.")
        return

    add_event_listener(input_importacao, "change", ler_arquivo_importacao)
    set_html("pyStatus", "✅ PyScript carregado. Selecione Resultado final, Classificação ou Volta a volta e escolha o arquivo.")


inicializar()
