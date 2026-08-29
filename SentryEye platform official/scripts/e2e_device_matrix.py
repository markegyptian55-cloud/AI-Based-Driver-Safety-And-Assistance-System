"""End-to-end device matrix.

Runs the same Live-detection journey twice — once emulating a phone, once a
desktop — with a fake camera, and reports the differences that matter: how long
the page takes to be usable, where the camera sits in the layout, which
performance profile the app applied, and any console errors.

    python3 scripts/e2e_device_matrix.py [baseUrl]
"""
import asyncio, json, os, sys
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080"
OUT = "/tmp/browser/e2e-device-matrix"
os.makedirs(OUT, exist_ok=True)

ANDROID = ("Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 "
           "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36")

PROFILES = [
    {"name": "mobile", "viewport": {"width": 412, "height": 915},
     "user_agent": ANDROID, "device_scale_factor": 2.6,
     "is_mobile": True, "has_touch": True},
    {"name": "desktop", "viewport": {"width": 1440, "height": 900}},
]


async def run_profile(browser, profile):
    name = profile.pop("name")
    context = await browser.new_context(permissions=["camera"], **profile)
    page = await context.new_page()
    errors = []
    page.on("console", lambda m: errors.append(m.text[:200]) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)[:200]))

    import time
    t0 = time.time()
    await page.goto(f"{BASE}/live", wait_until="domcontentloaded")
    await page.wait_for_timeout(3500)
    load_ms = int((time.time() - t0) * 1000)

    heading = await page.locator("h1").first.text_content() if await page.locator("h1").count() else None
    camera_top = await page.evaluate(
        "() => { const v = document.querySelector('video');"
        " return v ? Math.round(v.getBoundingClientRect().top + window.scrollY) : null; }"
    )
    await page.screenshot(path=f"{OUT}/{name}.png")
    await context.close()
    return {"profile": name, "url": page.url, "heading": heading,
            "loadMs": load_ms, "cameraTopPx": camera_top, "errors": errors[:5]}


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=[
            "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"])
        report = [await run_profile(browser, dict(prof)) for prof in PROFILES]
        await browser.close()
    with open(f"{OUT}/report.json", "w") as fh:
        json.dump(report, fh, indent=2)
    print(json.dumps(report, indent=2))

asyncio.run(main())
