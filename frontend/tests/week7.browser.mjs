import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const server = spawn("npx", ["vite", "preview", "--host", "127.0.0.1", "--port", "4173"], {stdio: "inherit"});
const browser = await chromium.launch({headless:true});
const origin = "http://127.0.0.1:4173/intercepted/";
try {
  for(let i=0;i<100;i++) {
    try { if((await fetch(origin)).ok)break; } catch {}
    await new Promise(r=>setTimeout(r,100));
  }
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/site.api.espn.com/**", route=>route.fulfill({json:{events:[]}}));
  const predictions = await (await fetch(origin + "predictions.json")).json();
  const first = [...predictions.games].sort((a,b)=>a.game_date.localeCompare(b.game_date)||a.game_id.localeCompare(b.game_id))[0];
  await page.goto(origin);
  await page.getByRole("button",{name:"Updated QB+", exact:true}).waitFor();
  await page.getByRole("button",{name:"Gradient Boosted",exact:true}).click();
  assert.equal(await page.getByRole("button",{name:"Gradient Boosted",exact:true}).getAttribute("aria-pressed"),"true");
  await page.waitForFunction(expected => document.querySelector(".dash-prob-pill")?.textContent === expected,
    (Math.max(first.home_win_prob_v5_boosted,1-first.home_win_prob_v5_boosted)*100).toFixed(1)+"%");
  await page.getByRole("button",{name:"Base",exact:true}).click();
  await page.getByLabel("Prediction week").selectOption("2026-6");
  await page.getByText("Saved pregame forecasts", {exact:false}).waitFor();
  await page.getByRole("button",{name:"QB+ (original)",exact:true}).waitFor();
  assert.equal(await page.getByRole("button",{name:"Gradient Boosted",exact:true}).count(),0);
  await page.getByRole("button",{name:"Full matchup analysis",exact:false}).click();
  assert.equal(await page.getByRole("tab",{name:"Vegas Odds"}).isDisabled(),true);
  await page.getByRole("button",{name:"Close matchup"}).click();
  await mkdir("qa",{recursive:true});
  await page.screenshot({path:"qa/week6-archive-desktop.png",fullPage:true});
  await page.getByLabel("Prediction week").selectOption("current");
  await page.getByRole("button",{name:"Gradient Boosted",exact:true}).waitFor();
  await page.screenshot({path:"qa/week7-desktop.png",fullPage:true});
  await page.setViewportSize({width:375,height:900});
  await page.screenshot({path:"qa/week7-mobile.png",fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > window.innerWidth),false);
  await page.getByRole("link",{name:"Performance",exact:false}).click();
  await page.getByLabel("Model",{exact:true}).selectOption("v5_boosted");
  await page.getByRole("heading",{name:"Performance",exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log("PASS: real Chromium model controls, archive navigation, archived modal, mobile overflow, and Performance.");
} finally {
  await browser.close(); server.kill();
}
