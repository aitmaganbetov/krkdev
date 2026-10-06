"""Build docs/redesign/audit.md from out/results.json and copy referenced screenshots."""
import json, pathlib, shutil, sys, collections, re

SRC = pathlib.Path(__file__).parent / "out"
DST = pathlib.Path(sys.argv[1])  # docs/redesign
SHOTS = DST / "screenshots" / "before"
SHOTS.mkdir(parents=True, exist_ok=True)

SEVERITY = [
    ("text-overlap", "P1", "Текст наезжает на текст"),
    ("covered-by-neighbour", "P1", "Текст вылезает из своего блока и уходит под соседний"),
    ("text-clipped", "P1", "Текст обрезан контейнером (overflow:hidden)"),
    ("textarea-content-hidden", "P1", "Текст в textarea срезан (фиксированная высота)"),
    ("body-horizontal-scroll", "P1", "Горизонтальный скролл страницы"),
    ("out-of-viewport-x", "P1", "Элемент выходит за пределы экрана"),
    ("modal-out-of-viewport", "P1", "Модалка/слой выходит за экран"),
    ("modal-taller-than-viewport (outer scroll)", "P2", "Модалка выше экрана, скроллится целиком (шапка/футер уезжают)"),
    ("main-horizontal-scroll", "P2", "Горизонтальный скролл основной области"),
    ("control-text-clipped", "P2", "Значение/placeholder не помещается в поле"),
    ("spills-parent", "P2", "Содержимое вылезает за родителя"),
    ("ellipsis-no-title", "P2", "Обрезка многоточием без title/tooltip"),
    ("small-tap-target", "P3", "Мелкая зона нажатия (<32px) на мобильном"),
    ("ellipsis-with-title", "P3", "Обрезка многоточием (есть title)"),
]
SEV = {k: (p, d) for k, p, d in SEVERITY}
ORDER = {k: i for i, (k, _, _) in enumerate(SEVERITY)}

results = json.loads((SRC / "results-final2.json").read_text())
runs = [r for r in results if "issues" in r]
failed = [r for r in results if "error" in r]

# group: (page, state-kind, type, selector-normalized)
def norm_sel(s):
    return re.sub(r":nth-of-type\(\d+\)", "", s)

def state_kind(s):
    return s

groups = collections.OrderedDict()
for r in runs:
    for i in r["issues"]:
        key = (r["page"], state_kind(r["state"]), i["type"], norm_sel(i["selector"]))
        g = groups.setdefault(key, {"widths": set(), "langs": set(), "examples": [], "shots": collections.Counter(), "count": 0})
        g["widths"].add(r["width"]); g["langs"].add(r["lang"]); g["count"] += 1
        if len(g["examples"]) < 3:
            g["examples"].append(i)
        g["shots"][r["screenshot"]] += 1
        g.setdefault("path", r["path"])

used_shots = set()

def shot_for(g):
    # prefer narrowest width, kz (longest text)
    def rank(s):
        m = re.search(r"__(ru|kz|en)__(\d+)\.jpg$", s)
        return (int(m.group(2)), {"kz": 0, "ru": 1, "en": 2}[m.group(1)])
    s = sorted(g["shots"], key=rank)[0]
    used_shots.add(s)
    return "screenshots/before/" + pathlib.Path(s).name

def fmt_w(ws):
    return ", ".join(str(w) for w in sorted(ws))

def fmt_l(ls):
    return ", ".join(l.upper() for l in ["ru", "kz", "en"] if l in ls)

# ---- summary tables ----
pages = list(dict.fromkeys(r["page"] for r in runs))
type_tot = collections.Counter()
page_type = collections.defaultdict(collections.Counter)
for (page, state, t, sel), g in groups.items():
    type_tot[t] += 1
    page_type[page][t] += 1

per_width = collections.defaultdict(collections.Counter)
for r in runs:
    for i in r["issues"]:
        per_width[r["width"]][SEV[i["type"]][0]] += 1

lines = []
w = lines.append
w("# Аудит вёрстки КРК Мониторинг — до редизайна")
w("")
w("Дата: 2026-10-06 · Стенд: dev (`http://127.0.0.1:5175`, `krkdev_*`) · Роль: admin (фиктивный пользователь `ui-audit`)")
w("")
w(f"Покрытие: {len(pages)} маршрутов, {len(runs)} снимков состояний (страница × состояние × язык × ширина), "
  "ширины 375 / 768 / 1280 / 1440 / 1920, языки RU / KZ / EN. Состояния: страница по умолчанию, мобильное меню (375/768), "
  "модалки (пользователь: создание; кабинет: форма/Live; мониторинг: фиксация нарушения), инлайн-редактирование пользователя, вкладки мониторинга, «Записи» с данными за 2025-2026 (по умолчанию выбран пустой 2026-2027).")
w("")
w("Метод: Playwright (Chromium) + детектор в `page.evaluate` — см. раздел «Методика» в конце.")
w("")
w("## Сводка")
w("")
w("Уникальная проблема = (страница, состояние, тип, селектор); одна и та же проблема на разных ширинах/языках считается один раз.")
w("")
w("| Приоритет | Тип | Уникальных | ")
w("|---|---|---|")
for t, p, d in SEVERITY:
    if type_tot[t]:
        w(f"| {p} | {d} | {type_tot[t]} |")
w(f"| | **Всего** | **{sum(type_tot.values())}** |")
w("")
w("### По страницам (уникальные проблемы P1 / P2 / P3)")
w("")
w("| Страница | Маршрут | P1 | P2 | P3 |")
w("|---|---|---|---|---|")
for page in pages:
    c = collections.Counter()
    for t, n in page_type[page].items():
        c[SEV[t][0]] += n
    path = next(r["path"] for r in runs if r["page"] == page)
    w(f"| [{page}](#{page}) | `{path}` | {c['P1'] or ''} | {c['P2'] or ''} | {c['P3'] or ''} |")
w("")
w("### По ширинам (все срабатывания, без дедупликации)")
w("")
w("| Ширина | P1 | P2 | P3 |")
w("|---|---|---|---|")
for width in sorted(per_width):
    c = per_width[width]
    w(f"| {width} | {c['P1']} | {c['P2']} | {c['P3']} |")
w("")
if failed:
    w("### Состояния, которые не удалось открыть")
    w("")
    for r in failed:
        w(f"- {r['page']} / {r['state']} / {r['lang']} / {r['width']}: {r['error']}")
    w("")

w("@@MANUAL@@")
w("")
w("## Детально по страницам")
w("")
for page in pages:
    items = [(k, g) for k, g in groups.items() if k[0] == page]
    w(f"### {page}")
    w("")
    if not items:
        w("Автоматическая проверка проблем не нашла.")
        w("")
        continue
    items.sort(key=lambda kg: (ORDER[kg[0][2]], kg[0][1]))
    w("| Пр. | Тип | Состояние | Селектор | Пример текста / размеры | Ширины | Языки | Скриншот |")
    w("|---|---|---|---|---|---|---|---|")
    for (pg, state, t, sel), g in items:
        ex = g["examples"][0]
        text = (ex.get("text") or "").replace("|", "/")[:50]
        if ex.get("otherText"):
            text += " ⟷ " + ex["otherText"].replace("|", "/")[:40]
        detail = ex.get("size") or ex.get("overlap") or ""
        sel_short = sel if len(sel) < 90 else "…" + sel[-88:]
        w(f"| {SEV[t][0]} | {SEV[t][1]} | {state} | `{sel_short}` | {text} — {detail} | {fmt_w(g['widths'])} | {fmt_l(g['langs'])} | [img]({shot_for(g)}) |")
    w("")

w("## Методика")
w("")
w("""Детектор (`checks.js`) выполняется в странице после `networkidle` + 600 мс:

- **text-overlap** (найдено: 0 — наложений текста на текст нет) — прямоугольники текстовых узлов (`Range.getClientRects`, а не боксы элементов), обрезанные клипующими предками; пары не вложенных друг в друга элементов из одного слоя (страница/модалка) с пересечением > 1px по обеим осям, и хотя бы один из них реально отрисован сверху (`elementFromPoint`).
- **text-clipped** — глифы текста выходят за предка с `overflow:hidden|clip` более чем на 2px (скролл-контейнеры `auto|scroll` считаются намеренными и не учитываются).
- **ellipsis-*** — `text-overflow: ellipsis` / `line-clamp`, которые реально обрезают текст; отдельно — есть ли `title`.
- **control-text-clipped** — значение/placeholder/выбранная опция шире полезной области поля (измерение через canvas).
- **out-of-viewport-x** — видимая часть элемента вне `[0, innerWidth]` (элементы целиком за экраном, например закрытый off-canvas, исключены).
- **spills-parent** — элемент с текстом выходит за правую границу родителя без `overflow`.
- **modal-*** — первый крупный потомок `position:fixed`-слоя выходит за viewport.
- **body/main-horizontal-scroll** — `scrollWidth > innerWidth` у документа / у `main`.
- **small-tap-target** — кнопки/ссылки/поля меньше 32px на ширинах < 768.

Для полностраничных состояний viewport перед проверкой растягивается на всю высоту страницы, чтобы `elementFromPoint` работал ниже первого экрана.
- **textarea-content-hidden** — текст `textarea` не помещается в видимую высоту поля.
- **covered-by-neighbour** — вылезшая за родителя часть перекрыта другим элементом того же слоя.

Детектор проверен на синтетической странице с заложенными дефектами всех типов.
Скриншоты: `full_page` для страниц и вкладок, viewport — для модалок и меню. Сохранены только снимки, на которые ссылается отчёт.""")

md = "\n".join(lines)
manual = pathlib.Path(__file__).with_name("manual.md")
md = md.replace("@@MANUAL@@", manual.read_text() if manual.exists() else "")
(DST / "audit.md").write_text(md)
for s in used_shots:
    shutil.copy(SRC / s, SHOTS / pathlib.Path(s).name)
print("groups", len(groups), "shots copied", len(used_shots))
print({k: v for k, v in type_tot.items()})
