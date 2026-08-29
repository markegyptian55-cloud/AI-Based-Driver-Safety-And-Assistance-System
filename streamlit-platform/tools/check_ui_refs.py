"""
Static check: every t() key and theme attribute referenced in the UI exists.

Streamlit renders pages lazily, so a typo in a translation key or a theme
field only surfaces when a user happens to open that page -- and a missing
key renders as the raw key string rather than raising, which is worse: it
ships a visibly broken label instead of failing a test. This walks the
source instead and fails loudly.

Run:  python tools/check_ui_refs.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

PLATFORM_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PLATFORM_ROOT))

SKIP_PARTS = {"env", "__pycache__", "backups", "tools"}

T_CALL = re.compile(r"""\bt\(\s*["']([a-zA-Z0-9_.]+)["']""")

# Attribute access on a `theme` variable only. The lookbehind rejects the
# two things that otherwise match and are not attribute access at all:
# translation keys that happen to be named "theme.dark" (preceded by a
# quote) and module paths like "ui/theme.py" (preceded by a slash or word
# character).
THEME_ATTR = re.compile(r"""(?<!["'/\w.])\btheme\.([a-zA-Z_][a-zA-Z_0-9]*)""")


def main() -> int:
    from ui.i18n import TRANSLATIONS
    from ui.theme import THEMES

    langs = {code: set(table) for code, table in TRANSLATIONS.items()}
    theme_fields = set(next(iter(THEMES.values())).__dataclass_fields__)
    # Properties and methods are legitimate attribute access too.
    theme_fields |= {n for n in dir(next(iter(THEMES.values())))
                     if not n.startswith("_")}

    problems: list[str] = []

    for path in sorted(PLATFORM_ROOT.rglob("*.py")):
        if SKIP_PARTS & set(path.parts):
            continue
        rel = path.relative_to(PLATFORM_ROOT)
        src = path.read_text(encoding="utf-8")

        for key in sorted(set(T_CALL.findall(src))):
            for code, keys in langs.items():
                if key not in keys:
                    problems.append(f"{rel}: t('{key}') missing from '{code}'")

        for attr in sorted(set(THEME_ATTR.findall(src))):
            if attr not in theme_fields:
                problems.append(f"{rel}: theme.{attr} is not a Theme field")

    if problems:
        print(f"{len(problems)} problem(s):")
        for p in problems:
            print(f"  {p}")
        return 1

    counts = ", ".join(f"{c}={len(k)}" for c, k in sorted(langs.items()))
    print(f"OK - all t() keys and theme attributes resolve ({counts})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
