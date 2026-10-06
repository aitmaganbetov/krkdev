"""Layout audit runner: every route x width x language -> screenshot + issues JSON.

Usage (inside the playwright container):
  python run.py --base http://127.0.0.1:5175 --out /out --pages login
Auth (optional): set KRK_STORAGE_STATE to a Playwright storage-state JSON with a logged-in session.
"""
import argparse, json, os, pathlib
from playwright.sync_api import sync_playwright

WIDTHS = [375, 768, 1280, 1440, 1920]
LANGS = ["ru", "kz", "en"]
HEIGHT = {375: 812, 768: 1024, 1280: 800, 1440: 900, 1920: 1080}

PAGES = {
    "login": {"path": "/login", "auth": False},
    "dashboard": {"path": "/dashboard"},
    "monitoring": {"path": "/monitoring"},
    "rooms-settings": {"path": "/rooms-settings"},
    "records": {"path": "/records"},
    "records-new": {"path": "/records/new"},
    "catalogs-questions": {"path": "/catalogs/questions"},
    "catalogs-academic-years": {"path": "/catalogs/academic-years"},
    "record-detail": {"path": "/records/{rid}"},
    "record-edit": {"path": "/records/{rid}/edit"},
    "users": {"path": "/users"},
    "ldap-users": {"path": "/ldap-users"},
    "settings": {"path": "/settings"},
    "audit-logs": {"path": "/audit-logs"},
}

CHECKS = pathlib.Path(__file__).with_name("checks.js").read_text()
I18N = json.loads(pathlib.Path(__file__).with_name("i18n.json").read_text())
import re
def tr(key):  # regex matching the label in any language
    return re.compile("^\\s*(" + "|".join(re.escape(I18N[l][key]) for l in I18N) + ")\\s*$")

def click_text(page, label, nth=0):
    loc = page.locator("main button:visible, main a:visible").filter(has_text=label)
    loc.nth(nth).click(timeout=5000)
    page.wait_for_timeout(700)

def select_year(pg, label="2025-2026"):
    sel = pg.locator("main select").filter(has=pg.locator("option", has_text=label)).first
    val = sel.locator("option", has_text=label).first.get_attribute("value")
    sel.select_option(val)
    pg.wait_for_load_state("networkidle"); pg.wait_for_timeout(800)

# Extra UI states per page: (state name, action, only_for_widths or None)
STATES = {
    "*": [("mobile-menu", lambda pg: (pg.get_by_role("button", name=tr("common.menu")).click(), pg.wait_for_timeout(500)), [375, 768])],
    "records": [("with-data", select_year, None)],
    "users": [("modal-create", lambda pg: click_text(pg, tr("users.addBtn")), None),
              ("inline-edit", lambda pg: click_text(pg, tr("users.editBtn")), None)],
    "rooms-settings": [("modal-room-form", lambda pg: click_text(pg, re.compile("Добавить кабинет")), None),
                       ("modal-live", lambda pg: click_text(pg, re.compile("Смотреть Live")), None)],
    "monitoring": [("tab-violations", lambda pg: click_text(pg, re.compile("^НАРУШЕНИЯ$", re.I)), None),
                   ("tab-archive", lambda pg: click_text(pg, re.compile("^АРХИВ$", re.I)), None),
                   ("tab-analytics", lambda pg: click_text(pg, re.compile("^АНАЛИТИКА$", re.I)), None),
                   ("modal-violation", lambda pg: click_text(pg, re.compile("Зафиксировать нарушение")), None)],
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:5175")
    ap.add_argument("--out", default="/out")
    ap.add_argument("--pages", default=",".join(PAGES))
    ap.add_argument("--widths", default=",".join(map(str, WIDTHS)))
    ap.add_argument("--langs", default=",".join(LANGS))
    args = ap.parse_args()
    out = pathlib.Path(args.out)
    (out / "shots").mkdir(parents=True, exist_ok=True)
    storage = os.environ.get("KRK_STORAGE_STATE")
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        rid = None
        if storage:
            c = browser.new_context(storage_state=storage); pg = c.new_page(); pg.goto(args.base + "/login")
            rid = pg.evaluate("fetch('/api/records?page=1&page_size=1',{credentials:'include'}).then(r=>r.json()).then(d=>d.items?.[0]?.id)")
            print("record id for detail pages:", rid); c.close()
        for name in args.pages.split(","):
            cfg = PAGES[name]
            if cfg.get("auth", True) and not storage:
                results.append({"page": name, "skipped": "no auth"})
                continue
            for lang in args.langs.split(","):
                for w in map(int, args.widths.split(",")):
                    ctx = browser.new_context(
                        viewport={"width": w, "height": HEIGHT[w]},
                        storage_state=storage if cfg.get("auth", True) else None,
                        locale="ru-RU",
                    )
                    ctx.add_init_script(f"localStorage.setItem('lang', '{lang}')")
                    page = ctx.new_page()
                    path = cfg["path"].replace("{rid}", str(rid))
                    states = [("default", None, None)]
                    if cfg.get("auth", True):
                        states += STATES["*"]
                    states += STATES.get(name, [])
                    if os.environ.get("ONLY_STATE"):
                        want = os.environ["ONLY_STATE"].split(",")
                        states = [s for s in states if s[0] in want or (s[0].startswith("tab-") and "tab-*" in want)]
                    for state, action, only in states:
                        if only and w not in only:
                            continue
                        page.goto(args.base + path, wait_until="networkidle")
                        page.wait_for_timeout(600)
                        rec = {"page": name, "state": state, "path": path, "lang": lang, "width": w}
                        try:
                            if action:
                                action(page)
                        except Exception as e:
                            rec["error"] = f"action failed: {str(e).splitlines()[0][:160]}"
                            results.append(rec); print(f"{name:20} {state:16} {lang} {w:5}  ACTION FAILED", flush=True)
                            continue
                        shot = f"shots/{name}__{state}__{lang}__{w}.jpg"
                        # modal / drawer states: viewport shot (fixed layers), page states: full page
                        page.screenshot(path=str(out / shot), full_page=(state in ("default", "with-data") or state.startswith("tab-")), type="jpeg", quality=70)
                        tall = state in ("default", "with-data") or state.startswith("tab-")
                        if tall:  # make the whole page "visible" so elementFromPoint works below the fold
                            hgt = min(page.evaluate("document.documentElement.scrollHeight"), 16000)
                            page.set_viewport_size({"width": w, "height": max(hgt, HEIGHT[w])}); page.wait_for_timeout(400)
                        issues = page.evaluate(CHECKS)
                        if tall:
                            page.set_viewport_size({"width": w, "height": HEIGHT[w]})
                        rec.update(url=page.url, screenshot=shot, issues=issues)
                        results.append(rec)
                        print(f"{name:20} {state:16} {lang} {w:5}  issues={len(issues)}", flush=True)
                    ctx.close()
        browser.close()
    (out / os.environ.get("RESULTS", "results.json")).write_text(json.dumps(results, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
