"""One-time human SSO login -> save Playwright storageState for deployed runs."""
from __future__ import annotations
import sys
from pathlib import Path


def main(app_url: str, out_path: str) -> None:
    from playwright.sync_api import sync_playwright  # noqa: imported lazily
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        ctx = browser.new_context()
        page = ctx.new_page()
        page.goto(app_url)
        print(f"\nComplete Databricks SSO + consent in the browser for:\n  {app_url}\n"
              f"When the app has loaded, return here and press Enter to save the session...")
        input()
        ctx.storage_state(path=out_path)
        browser.close()
    print(f"Saved auth state to {out_path}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
