"""Скачивает эмодзи Noto (Google, лицензия CC BY 4.0) в frontend/public/emoji:
<код>.svg — статичный, <код>.webp — анимированный. Уже скачанные пропускает."""
import re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

root = Path(__file__).resolve().parent.parent
src = (root / "src/lib/emojiData.ts").read_text(encoding="utf-8")
chars = set()
for m in re.finditer(r'"([^"\n]+)"\.split\(" "\)', src):
    chars.update(m.group(1).split(" "))
chars.update(re.findall(r'icon:\s*"([^"]+)"', src))
chars.update(re.findall(r'RECENT_ICON\s*=\s*"([^"]+)"', src))
chars.discard("")

out = root / "public/emoji"
out.mkdir(parents=True, exist_ok=True)
BASE = "https://fonts.gstatic.com/s/e/notoemoji/latest/{code}/{name}"
KINDS = {"svg": "emoji.svg", "webp": "512.webp"}

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()

def job(args):
    ch, ext = args
    cps = [f"{ord(c):x}" for c in ch]
    stripped = "_".join(c for c in cps if c != "fe0f")
    dest = out / f"{stripped}.{ext}"
    if dest.exists() and dest.stat().st_size > 0:
        return ("skip", ch, ext)
    for code in dict.fromkeys(["_".join(cps), stripped]):
        try:
            data = get(BASE.format(code=code, name=KINDS[ext]))
            if data:
                dest.write_bytes(data)
                return ("ok", ch, ext)
        except Exception:
            continue
    return ("miss", ch, ext)

tasks = [(c, e) for c in sorted(chars) for e in KINDS]
with ThreadPoolExecutor(8) as ex:
    res = list(ex.map(job, tasks))
for ext in KINDS:
    ok = sum(1 for s, _, e in res if e == ext and s in ("ok", "skip"))
    miss = [c for s, c, e in res if e == ext and s == "miss"]
    print(f"{ext}: {ok} из {sum(1 for t in tasks if t[1]==ext)}; нет файла: {' '.join(miss) if miss else '—'}")
