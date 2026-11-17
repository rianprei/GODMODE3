#!/usr/bin/env python3
"""
apply-godmode3.py — instala (ou reinstala) a integração GODMODE3 no OpenCode e no Codex.

Idempotente. Substitui o conteúdo entre <!-- GODMODE3:START --> e <!-- GODMODE3:END -->
NO MESMO LUGAR do arquivo (preservando tudo antes e depois). Arquivos sem os
marcadores recebem o bloco inteiro ao final.

Antes de escrever, cria backup datado em <config-dir>/backups/godmode3-apply-<ts>/.

Uso:  ./apply-godmode3.py [--check]
        --check   mostra o que seria alterado, não escreve nada
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path

START = "<!-- GODMODE3:START -->"
END = "<!-- GODMODE3:END -->"

SCRIPT_DIR = Path(__file__).resolve().parent
BLOCK_FILE = SCRIPT_DIR / "godmode3-integration.md"

OPENCODE_DIR = Path(os.environ.get("OPENCODE_DIR", Path.home() / ".config/opencode"))
CODEX_DIR = Path(os.environ.get("CODEX_DIR", Path.home() / ".codex"))

TARGETS = [
    (OPENCODE_DIR / "AGENTS.md", "OpenCode — instruções globais"),
    (OPENCODE_DIR / "agent/god-agi.md", "OpenCode — prompt do agente god-agi"),
    (OPENCODE_DIR / "GODMODE3.md", "OpenCode — cópia standalone"),
    (CODEX_DIR / "AGENTS.md", "Codex — instruções globais"),
    (CODEX_DIR / "instructions.md", "Codex — instructions.md"),
    (CODEX_DIR / "GODMODE3.md", "Codex — cópia standalone"),
]


def splice(text: str, block: str) -> tuple[str, str]:
    """Substitui o bloco entre os marcadores in-place. Retorna (novo_texto, modo)."""
    s = text.find(START)
    if s == -1:
        mode = "append"
        new = text.rstrip("\n")
        new = f"{new}\n\n{START}\n{block}\n{END}\n" if new else f"{START}\n{block}\n{END}\n"
        return new, mode

    e = text.find(END, s)
    if e == -1:
        # Marcador de abertura sem fechamento: insere o bloco logo após a abertura.
        mode = "repair-open"
        head = text[: s + len(START)]
        tail = text[s + len(START) :]
        return f"{head}\n{block}\n{tail}", mode

    mode = "replace"
    # Preserva o que está depois do marcador de fechamento (inclusive o resto da linha).
    tail = text[e + len(END) :]
    return f"{text[:s]}{START}\n{block}\n{END}{tail}", mode


def _relative_label(path: Path) -> Path:
    """Caminho legível do arquivo para organizar o backup."""
    home = Path.home()
    try:
        return path.relative_to(home)
    except ValueError:
        pass
    for base in (OPENCODE_DIR, CODEX_DIR):
        try:
            return Path(base.name) / path.relative_to(base)
        except ValueError:
            continue
    return Path(path.name)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    if not BLOCK_FILE.is_file():
        print(f"ERRO: bloco não encontrado em {BLOCK_FILE}", file=sys.stderr)
        return 1

    block = BLOCK_FILE.read_text(encoding="utf-8").rstrip("\n")

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_root = OPENCODE_DIR / "backups" / f"godmode3-apply-{stamp}"

    changed = skipped = 0
    backups: list[str] = []

    for path, desc in TARGETS:
        if not path.is_file():
            print(f"  [skip] {desc:<46} (arquivo não existe)")
            skipped += 1
            continue

        original = path.read_text(encoding="utf-8")
        new, mode = splice(original, block)

        if new == original:
            print(f"  [same] {desc:<46} (já atualizado)")
            skipped += 1
            continue

        changed += 1
        if args.check:
            print(f"  [would] {desc:<45} ({mode})")
            continue

        rel = _relative_label(path)
        dest = backup_root / rel
        if dest.resolve() == path.resolve():
            dest = backup_root / (path.name + ".bak")
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, dest)
        backups.append(str(rel))

        path.write_text(new, encoding="utf-8")
        print(f"  [write] {desc:<45} ({mode})")

    print()
    if args.check:
        print(f"CHECK: {changed} arquivo(s) seriam alterados, {skipped} inalterado(s). Nada foi escrito.")
        return 0

    if changed:
        print(f"Aplicado em {changed} arquivo(s).")
        print(f"Backups: {backup_root}")
        for b in backups:
            print(f"  - {b}")
    else:
        print(f"Nada a fazer — {skipped} arquivo(s) já estavam atualizados.")
        if backup_root.exists():
            shutil.rmtree(backup_root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
