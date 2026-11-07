"""Screenshots for the README: python3 scripts/screenshots.py <trace id>"""
import sys
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
trace = sys.argv[1]
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.goto(BASE + "/")
    pg.wait_for_timeout(2500)
    pg.screenshot(path="docs/img/home.png", full_page=True)
    pg.goto(f"{BASE}/traces/{trace}")
    pg.wait_for_function("document.documentElement && document.documentElement.dataset.firstRows === '1'", timeout=60000)
    pg.wait_for_timeout(800)
    pg.screenshot(path="docs/img/explorer.png")
    pg.fill("input[type=search]", "relation \"orders_2025\"")
    pg.wait_for_timeout(2500)
    pg.screenshot(path="docs/img/search.png")
    first = pg.locator("[role=option]").first
    if first.count():
        first.click()
        pg.wait_for_timeout(2500)
        pg.screenshot(path="docs/img/reveal.png")
    pg.get_by_role("tab", name="Agent steps").click()
    pg.wait_for_timeout(2500)
    pg.screenshot(path="docs/img/agent-steps.png")
    m = b.new_page(viewport={"width": 390, "height": 844})
    m.goto(f"{BASE}/traces/{trace}")
    m.wait_for_timeout(3000)
    m.screenshot(path="docs/img/mobile.png")
    b.close()
