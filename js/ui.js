/* Hormuz Command — watch interface. All numbers shown here are illustrative. */
(function () {
  "use strict";

  const H = window.Hormuz;
  const KEY = "hormuz-command-save-v1";
  const app = document.getElementById("app");

  const ui = {
    campaign: null,
    orders: null,
    report: null,
    screen: "start",
  };
  let lockedUntil = 0;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function pct(n) {
    return (n * 100).toFixed(1) + "%";
  }

  function save() {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          campaign: ui.campaign,
          orders: ui.orders,
          report: ui.report,
          screen: ui.screen,
        })
      );
    } catch (e) {
      /* private mode or a full disk: the watch still runs */
    }
  }

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!raw || !raw.campaign || !raw.campaign.seed) return null;
      raw.campaign = H.restore(raw.campaign);
      return raw;
    } catch (e) {
      return null;
    }
  }

  function clearSave() {
    try {
      localStorage.removeItem(KEY);
    } catch (e) {}
  }

  function startNew(seed) {
    let s = seed;
    if (!Number.isFinite(s)) s = Math.floor(Math.random() * 1e9);
    s = s >>> 0;
    ui.campaign = H.createCampaign(s || 1);
    ui.orders = H.suggestedOrders(H.poolsFor(ui.campaign));
    ui.report = null;
    ui.screen = "game";
    save();
    showGame();
  }

  function resume() {
    const data = load();
    if (!data) return showStart();
    ui.campaign = data.campaign;
    ui.orders = data.orders;
    ui.report = data.report;
    if (data.screen === "end" || ui.campaign.phase === "end") return showEnd();
    ui.screen = "game";
    showGame();
  }

  app.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-act]");
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    if (act === "new") {
      const el = document.getElementById("seed");
      const raw = el ? el.value.trim() : "";
      return startNew(raw === "" ? NaN : Number(raw));
    }
    if (Date.now() < lockedUntil && (act === "issue" || act === "next")) return;
    if (act === "resume") return resume();
    if (act === "help") return showHelp();
    if (act === "sources") return showSources();
    if (act === "back") return ui.campaign && ui.screen !== "start" ? (ui.campaign.phase === "end" || ui.screen === "end" ? showEnd() : showGame()) : showStart();
    if (act === "abandon") {
      if (!confirm("Abandon this watch? The record on this browser will be cleared.")) return;
      clearSave();
      ui.campaign = null;
      ui.orders = null;
      ui.report = null;
      return showStart();
    }
    if (act === "nudge") {
      nudge(btn.dataset.group, btn.dataset.key, Number(btn.dataset.delta));
      refreshPlan();
      save();
      return;
    }
    if (act === "strike") {
      nudgeStrike(Number(btn.dataset.delta));
      refreshPlan();
      save();
      return;
    }
    if (act === "seg") {
      ui.orders[btn.dataset.field] = btn.dataset.value;
      refreshPlan();
      save();
      return;
    }
    if (act === "target") {
      if (!ui.orders.strikePackages) return;
      ui.orders.strikeTarget = btn.dataset.value;
      refreshPlan();
      save();
      return;
    }
    if (act === "proposal") {
      ui.orders = H.suggestedOrders(H.poolsFor(ui.campaign));
      showGame();
      save();
      return;
    }
    if (act === "issue") return onIssue();
    if (act === "next") return onNext();
    if (act === "again") return startNew();
    if (act === "same") return startNew(ui.campaign.seed);
  });

  function nudge(group, key, delta) {
    const dist = ui.orders[group];
    const flex = group === "escort" || group === "mcm" ? "alongside" : "ready";
    if (delta > 0) {
      if ((dist[flex] || 0) > 0) {
        dist[flex] -= 1;
        dist[key] += 1;
      } else {
        const donor = Object.keys(dist)
          .filter((k) => k !== key && dist[k] > 0)
          .sort((a, b) => dist[b] - dist[a])[0];
        if (!donor) return;
        dist[donor] -= 1;
        dist[key] += 1;
      }
    } else if (dist[key] > 0) {
      dist[key] -= 1;
      dist[flex] = (dist[flex] || 0) + 1;
    }
  }

  function nudgeStrike(delta) {
    const pools = H.poolsFor(ui.campaign);
    const max = Math.floor(pools.cap / 2);
    const next = Math.max(0, Math.min(max, ui.orders.strikePackages + delta));
    const diff = next - ui.orders.strikePackages;
    if (!diff) return;
    ui.orders.strikePackages = next;
    let need = diff * 2;
    const cap = ui.orders.cap;
    if (need > 0) {
      const order = ["ready", "convoy", "north", "south"];
      while (need > 0) {
        const donor = order.find((k) => cap[k] > 0);
        if (!donor) break;
        cap[donor] -= 1;
        need -= 1;
      }
    } else {
      cap.ready += -need;
    }
  }

  function onIssue() {
    try {
      ui.report = H.resolveDay(ui.campaign, ui.orders);
    } catch (err) {
      alert("Orders were not accepted. " + err.message);
      return;
    }
    ui.screen = "game";
    lockedUntil = Date.now() + 500;
    save();
    showGame();
    const heading = document.getElementById("day-title");
    if (heading) heading.focus();
  }

  function onNext() {
    lockedUntil = Date.now() + 500;
    if (ui.report && ui.report.done) {
      ui.screen = "end";
      save();
      showEnd();
      return;
    }
    H.beginMorning(ui.campaign);
    ui.orders = H.fitOrders(ui.orders, H.poolsFor(ui.campaign));
    ui.report = null;
    ui.screen = "game";
    save();
    showGame();
  }

  function showStart() {
    ui.screen = "start";
    const saved = load();
    const resumeBtn = saved
      ? '<button class="btn secondary" data-act="resume">' +
        (saved.screen === "end" || (saved.campaign && saved.campaign.phase === "end")
          ? "Read the after-action review"
          : "Resume the watch") +
        "</button>"
      : "";
    app.innerHTML =
      '<main class="sheet">' +
      '<div class="eyebrow">Illustrative watch · November 2026 · Not operational advice</div>' +
      "<h1>Hormuz Command</h1>" +
      "<p>Fourteen days. You command the escort and mine-countermeasures force for the Strait of Hormuz. Oil is moving, well below the old twenty million barrels a day. The public flow figure your staff uses sits in a band of thirteen to fourteen. Owners sail when the last few days were survivable and the insurance is not absurd. Iranian forces are still putting drones, missiles, and mines into this water.</p>" +
      "<p>You will not have enough ships to do every job. Bigger convoys cover more hulls and make a denser target. Bare sailings move oil and get hit more often. Strikes on military launch sites buy a short quiet and raise the chance the war spreads. A mine claim is not a mine until the desk or your hunters say so.</p>" +
      "<p class='muted'>Every figure in this watch is illustrative. It is not official data and it is not a way to run a real operation.</p>" +
      '<div class="seed"><label for="seed">Seed</label><input id="seed" inputmode="numeric" placeholder="Random if blank" aria-label="Campaign seed"></div>' +
      '<div class="row"><button class="btn" data-act="new">Take the watch</button>' +
      resumeBtn +
      '<button class="btn ghost" data-act="help">How to play</button>' +
      '<button class="btn ghost" data-act="sources">Sources and caveats</button></div>' +
      "</main>";
  }

  function showHelp() {
    const back = ui.campaign ? "Back to the watch" : "Back";
    app.innerHTML =
      '<main class="wrap prose"><button class="linkish" data-act="back">' +
      back +
      "</button>" +
      '<div class="eyebrow">How to play</div><h1>The watch</h1>' +
      "<p>You have 14 days, 18 November through 1 December 2026. Each morning you read the feed, assign what you have, and issue orders. The day resolves. Luck is real. The staff estimate is not a promise.</p>" +
      "<h2>What you assign</h2><ul>" +
      "<li><b>Escorts.</b> On the convoy screen, each one covers a group of merchants. On a lane, a picket discourages boats. It does not hunt mines, and it can be shot at. Ships alongside do nothing.</li>" +
      "<li><b>Hunters (MCM).</b> They sweep a lane. One maritime-patrol sortie, or an ISR orbit on the strait, makes the sweep faster and the picture better. GPS jamming takes that support away. Sonar still works.</li>" +
      "<li><b>CAP.</b> Fighters over the convoys cut drone and missile hits. Fighters over a lane help the ships on that lane, including a picket. A strike package costs two CAP sorties.</li>" +
      "<li><b>Maritime patrol.</b> Best used to support the hunters. A second sortie over the convoys helps a little. The Gulf of Aden is a long way south. Patrol sent there is not over the strait.</li>" +
      "<li><b>ISR.</b> One orbit watches launch areas, which is what makes a strike worth the escalation. One watches the strait and can spot a severe minefield. It is not a sweep. One can watch the Gulf for drones aimed at partners. You have two orbits.</li>" +
      "</ul>" +
      "<h2>Convoys and who sails bare</h2>" +
      "<p>Small groups put four merchants on an escort. Standard puts six. Massed puts nine. Massed convoys cover more ships. When one ship in a massed group is found, follow-on hits are more likely. Small groups do the opposite, and you will not make the barrel target if you run them every day.</p>" +
      "<p>Escort-only: uncovered owners wait, mostly off Fujairah. Some cancel if the queue and the insurance get bad. Mixed: some of the uncovered sail anyway when recent days were tolerable. Flow-first: everyone willing sails. What you cannot escort goes bare.</p>" +
      "<p>Bare transits start at a " +
      (H.MODEL.hitUnescorted * 100).toFixed(1) +
      "% hit chance. Escorted transits start at " +
      (H.MODEL.hitEscorted * 100).toFixed(1) +
      "%. Air cover, mines, the lane, jamming, convoy density, and escalation move those numbers. The northern lane, Iranian side, is the more exposed coast. The southern lane, Musandam side, is quieter until the mines catch up with the traffic.</p>" +
      "<h2>Mines and the feed</h2>" +
      "<p>Your lane chip is the picture you have, not the truth. A fresh sweep tells you the band. A strait picture can tell you a lane is severe, or that it is not. It will not count every mine. Claims from opposing channels are unconfirmed. Some are later substantiated by the desk. Some are not. Pulling every hunter onto a claim, and sending all the traffic the other way, is how a false report fouls the lane you stopped sweeping.</p>" +
      "<p>Confirmed items are your maritime desk, in the style of public JMIC and UKMTO notes. They are not real warning products, and they do not use real warning numbers. Unconfirmed items are press and opposing claims. A claim of three tankers destroyed is usually inflation. A ship going dark is often a master switching AIS off. Sometimes it is a hit you already counted. Do not add it twice.</p>" +
      "<h2>Strikes</h2>" +
      "<p>You may strike military launch positions along the Qeshm coast, or fast-attack boat bases. That is the whole list. There is no option to hit civilian areas, ports, or cities, and it would not help the watch if there were. A strike with ISR on the launch areas knocks drone and missile trouble down for a short time. The crews move. The drop does not last. Escalation does not come down as fast. Higher escalation means more attacks, drones toward Gulf partners such as Bahrain, a worse insurance index, and owners who stay alongside. A strike with no picture still raises escalation. The damage assessment will say it does not know.</p>" +
      "<p>On day 6 the carrier air wing extends on station: one more escort and two more CAP sorties, in reserve until you assign them.</p>" +
      "<h2>How the watch is graded</h2>" +
      "<p>The target band is 13 to 14 million barrels a day, the public flow assessment this scenario uses. The middle of that band is the staff target. You are also graded on ships hit, crew deaths, your own losses, how hot escalation got, whether you left the lanes mined, strikes without a picture, and whether you chased mine claims that the desk did not substantiate. A clean lane and a full queue is not a win. A full flow with a wider war is not a win either.</p>" +
      '<p><button class="linkish" data-act="sources">Sources and caveats</button></p></main>';
  }

  function showSources() {
    const back = ui.campaign ? "Back to the watch" : "Back";
    const m = H.MODEL;
    app.innerHTML =
      '<main class="wrap prose"><button class="linkish" data-act="back">' +
      back +
      "</button>" +
      '<div class="eyebrow">Sources and caveats</div><h1>What this is</h1>' +
      "<p>Hormuz Command is an illustrative game. It is not official data, not a forecast, and not operational advice. Nothing in it is a target list, a tactic, or a recommendation for anyone actually at sea or in a headquarters. Do not use it that way.</p>" +
      "<p>The situation is a US-led escort and counter-mine campaign in the Strait of Hormuz in November 2026, as a decision exercise for an adult who follows the public record. The incidents are composites. They are not replays of named ships, named casualties, or named strikes. Real people are not characters in the game.</p>" +
      "<h2>Where the numbers come from</h2>" +
      "<p>The per-transit hit rates start at the defaults of an open lab sketch that sits next to this project: <b>" +
      (m.hitUnescorted * 100).toFixed(1) +
      "%</b> unescorted and <b>" +
      (m.hitEscorted * 100).toFixed(1) +
      "%</b> escorted, before air cover, mines, lane, density, jamming, and escalation. A later snapshot knob had the unescorted rate at 5.0% with the same 1.2% escorted. This game uses 5.5 and 1.2.</p>" +
      "<p>Baseline demand is <b>" +
      m.baseShips +
      " ships a day</b>, with a mild weekly swing and about ±4 ships of noise. That sits in the same range as recent public tallies of US-facilitated transits, roughly 28 to 34 a day. It is not a live count.</p>" +
      "<p>Average cargo in the sketch is <b>" +
      m.bblPerShip.toLocaleString("en-US") +
      " barrels a ship</b>. Thirty ships at that figure are about 13 million barrels. The staff target for the watch is <b>" +
      m.targetMbDay +
      " million barrels a day</b>, the middle of the 13 to 14 million barrel public flow assessment associated with US Energy Secretary Wright. Peacetime flow through the strait, for contrast only, is carried as about " +
      m.peacetimeMbDay +
      " million barrels a day. None of these are official prints inside the game. They are the planning numbers the staff is told to use.</p>" +
      "<p>A sample 14-day draw from the simpler lab sketch, seed 26, is in <a href=\"data/lab-last-run.csv\">data/lab-last-run.csv</a>. It averaged about 13.6 million barrels a day with 12 hit events, under generous escort slots and with no mines, no owner cancellations, and no escalation. The game adds those. Do not expect the same row of numbers.</p>" +
      "<h2>What the events are patterned on</h2>" +
      "<p>The feed is patterned on the public shape of this campaign, not on a classified log and not on any one day's reporting. Confirmed notes behave like the public products people actually see: a maritime desk that confirms late, distinguishes a hit from a claim, and often says a mine report has no substantiation. The institutions whose public reporting that pattern comes from are the Joint Maritime Information Center, UKMTO, and US CENTCOM. In-game notes are marked as the desk of this watch. They are not those products and they do not invent warning numbers.</p>" +
      "<ul>" +
      "<li>Projectile hits and engine-room fires on tankers, and one-way attack drones.</li>" +
      "<li>Mine claims that arrive before any master report and are confirmed or dropped a day or two later.</li>" +
      "<li>GPS and AIS interference, and ships that go dark because the master switched the set off.</li>" +
      "<li>Crew casualties as a count, on a minority of hits. Most hits in the public pattern damage a ship and leave the crew safe. The game keeps that shape. It does not depict wounds.</li>" +
      "<li>Suspicious craft in the Gulf of Aden, off Yemen, as a distraction from the strait.</li>" +
      "<li>A carrier air wing already in the theater extending on station.</li>" +
      "<li>One-way drones toward Gulf partners, including Bahrain, as a consequence of a hotter exchange. The player cannot order those attacks. They are a cost.</li>" +
      "</ul>" +
      "<h2>What the game will not do</h2>" +
      "<p>It will not tell you how to find, prioritize, or attack a real target. Strikes, when you order them, resolve as a change to an abstract threat index. There are no coordinates, no aimpoints, and no weapon settings. Civilian shipping, ports, and cities are not targets. Hitting them is not a strategy available in this watch, and the grade treats a wider war as a failure mode.</p>" +
      "<p>Insurance is an index that starts at 1.00. It is not a quoted war-risk premium. Owner behavior is a simplified willingness number. Lane mining is a single danger score per lane, not a chart.</p>" +
      "</main>";
  }

  function nominal(pools, c) {
    const day = c.day;
    const escortBase = day >= H.MODEL.reinforceDay ? H.MODEL.escortsReinforced : H.MODEL.escortsStart;
    const capBase = day >= H.MODEL.reinforceDay ? H.MODEL.capReinforced : H.MODEL.capStart;
    return {
      escortOut: Math.max(0, escortBase - pools.escort),
      mcmOut: Math.max(0, H.MODEL.mcm - pools.mcm),
      escortBase,
      capBase,
    };
  }

  function assessSentence(c, lane) {
    const a = c.assess[lane];
    if (!a) return "No picture.";
    if (a.fresh && !a.coarse && a.knownThreat != null) {
      return a.band + " · sweep, threat about " + a.knownThreat + ". Current.";
    }
    if (a.source === "picture" && a.notSevere && a.band !== "HIGH" && a.band !== "SEVERE") {
      return "No severe field seen from the picture. Not a sweep. Last band on file: " + a.band + ".";
    }
    if (a.coarse && (a.band === "HIGH" || a.band === "SEVERE")) {
      return a.band + " · from the picture, not a sweep.";
    }
    if (a.coarse && a.age === 0) return a.band + " · picture only, not a count.";
    if (a.age >= 2) return "Stale (" + a.age + " days). Last band: " + a.band + ".";
    return a.band + " · " + a.age + " day old.";
  }

  function statsHtml(c) {
    const doneDays = c.history.length;
    const cum = c.totals.barrels / 1e6;
    const pace = H.MODEL.targetMbDay * Math.max(doneDays, 0);
    const crew = c.totals.injured + " injured · " + c.totals.killed + " killed";
    return (
      '<section class="stats" aria-label="Watch totals">' +
      stat("Barrels", cum.toFixed(1) + " mb", doneDays ? "pace " + pace.toFixed(0) + " mb so far" : "target 189 mb / 14 days") +
      stat("Merchants hit", String(c.totals.hits), c.totals.hitsEscorted + " escorted · " + c.totals.hitsUnescorted + " bare") +
      stat("Merchant crew", String(c.totals.killed), crew) +
      stat("Escalation", String(Math.round(c.escalation)), "hotter exchange, more attacks") +
      stat("Insurance", c.insurance.toFixed(2), "index, baseline 1.00") +
      stat("Fujairah holding", String(c.queue), c.totals.cancelled + " cancelled to date") +
      "</section>"
    );
  }

  function stat(label, value, sub) {
    return '<div class="stat"><span>' + esc(label) + '</span><b class="num">' + esc(value) + '</b><span class="faint" style="letter-spacing:0;text-transform:none">' + esc(sub) + "</span></div>";
  }

  function feedHtml(c) {
    const items = c.feed.slice().reverse();
    if (!items.length) return '<p class="muted">No traffic on the feed.</p>';
    return items
      .map((item) => {
        const conf = item.conf === "confirmed" ? "Confirmed" : "Unconfirmed";
        return (
          '<article class="item ' +
          (item.conf === "confirmed" ? "confirmed" : "unconfirmed") +
          '"><header><span>' +
          esc(item.kicker) +
          " · " +
          conf +
          '</span><span>Day ' +
          item.day +
          "</span></header><p>" +
          esc(item.text) +
          "</p></article>"
        );
      })
      .join("");
  }

  function chartHtml(queue) {
    return (
      '<div class="chart" id="chart">' +
      '<svg viewBox="0 0 1000 560" role="img" aria-label="Schematic chart of the Strait of Hormuz, not to scale">' +
      '<rect width="1000" height="560" fill="#0c181e"/>' +
      '<g opacity="0.18" stroke="#7fa3b3" stroke-width="1">' +
      '<path d="M0 140 H1000 M0 280 H1000 M0 420 H1000 M200 0 V560 M500 0 V560 M800 0 V560"/>' +
      "</g>" +
      '<path fill="#4a4034" stroke="#6e6458" stroke-width="2" d="M0,0 H1000 V128 C930,138 860,188 780,156 C700,124 640,196 560,168 C490,144 430,186 350,160 C270,134 180,176 90,150 C40,138 0,156 0,148 Z"/>' +
      '<path fill="#4a4034" stroke="#6e6458" stroke-width="2" d="M548,162 C600,146 678,154 714,182 C734,202 704,224 640,218 C578,212 520,190 548,162 Z"/>' +
      '<path fill="#3c4a40" stroke="#6a756c" stroke-width="2" d="M355,560 L470,560 L458,455 L498,385 L452,308 L418,348 L398,440 L368,510 Z"/>' +
      '<path fill="#3c4a40" stroke="#6a756c" stroke-width="2" d="M0,400 C80,352 160,368 210,420 L170,560 H0 Z"/>' +
      '<path fill="#3c4a40" stroke="#6a756c" stroke-width="2" d="M575,560 L655,485 L760,452 L845,478 L940,530 L1000,500 V560 Z"/>' +
      '<path id="lane-n" d="M30,248 C180,268 340,226 520,242 C690,256 820,292 980,318" fill="none" stroke="#4d7ea8" stroke-width="4" stroke-dasharray="12 8"/>' +
      '<path id="lane-s" d="M30,292 C180,312 340,270 500,286 C670,302 800,338 960,362" fill="none" stroke="#3d8f8a" stroke-width="4" stroke-dasharray="12 8"/>' +
      '<g id="markers"></g>' +
      "</svg>" +
      '<span class="tag" style="left:30%;top:16%">Bandar Abbas</span>' +
      '<span class="tag" style="left:63%;top:34%">Qeshm</span>' +
      '<span class="tag" style="left:44%;top:60%">Khasab</span>' +
      '<span class="tag optional dim" style="left:41%;top:86%">Musandam</span>' +
      '<span class="tag leftish" style="left:3%;top:74%">Ras al Khaimah</span>' +
      '<span class="tag rightish" style="left:97%;top:80%">Fujairah · ' +
      (Number(queue) || 0) +
      "</span>" +
      '<span class="tag lane-n" style="left:16%;top:41%">Northern lane</span>' +
      '<span class="tag lane-s" style="left:16%;top:57%">Southern lane</span>' +
      '<span class="tag optional dim" style="left:14%;top:30%">Arabian Gulf</span>' +
      '<span class="tag optional dim rightish" style="left:98%;top:46%">Gulf of Oman</span>' +
      "</div>" +
      '<p class="caption">Schematic, not to scale. Gulf to the west, Gulf of Oman to the east. Bahrain, Qatar, and Yemen are off this chart.</p>' +
      '<div class="legend"><span><i class="swatch group"></i>Escorted group</span><span><i class="swatch bare"></i>Unescorted</span><span><i class="swatch hit"></i>Hit</span><span><i class="swatch claim"></i>Unconfirmed mine claim</span></div>'
    );
  }

  function placeMarkers() {
    const svg = document.querySelector("#chart svg");
    if (!svg || !ui.campaign) return;
    const g = svg.querySelector("#markers");
    const north = svg.querySelector("#lane-n");
    const south = svg.querySelector("#lane-s");
    g.textContent = "";
    const pic = ui.campaign.lastPicture || { groups: [], claims: [], queue: 0 };
    const buckets = { north: [], south: [] };
    (pic.groups || []).forEach((gr) => {
      if (buckets[gr.lane]) buckets[gr.lane].push(gr);
    });
    ["north", "south"].forEach((lane) => {
      const path = lane === "north" ? north : south;
      const len = path.getTotalLength();
      buckets[lane].forEach((gr, i) => {
        const t = 0.22 + (0.58 * (i + 1)) / (buckets[lane].length + 1);
        const p = path.getPointAtLength(len * t);
        const hit = gr.hits > 0;
        if (gr.escorted) {
          const r = svgEl("rect", {
            x: p.x - 11,
            y: p.y - 8,
            width: 22,
            height: 16,
            rx: 2,
            fill: hit ? "#a65448" : "#d7d0c2",
          });
          g.appendChild(r);
          const tEl = svgEl("text", {
            x: p.x,
            y: p.y + 4,
            "text-anchor": "middle",
            "font-size": "11",
            fill: "#1a1408",
          });
          tEl.textContent = String(gr.n);
          g.appendChild(tEl);
        } else {
          g.appendChild(
            svgEl("circle", {
              cx: p.x,
              cy: p.y,
              r: hit ? 7 : 5,
              fill: hit ? "#a65448" : "none",
              stroke: "#d7d0c2",
              "stroke-width": 2,
            })
          );
        }
      });
    });
    (pic.claims || []).forEach((lane) => {
      const path = lane === "north" ? north : south;
      const p = path.getPointAtLength(path.getTotalLength() * 0.7);
      g.appendChild(
        svgEl("circle", {
          cx: p.x,
          cy: p.y - 18,
          r: 11,
          fill: "none",
          stroke: "#e0c27a",
          "stroke-width": 2.5,
        })
      );
    });
  }

  function svgEl(name, attrs) {
    const n = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.keys(attrs).forEach((k) => n.setAttribute(k, attrs[k]));
    return n;
  }

  function lanesHtml(c) {
    const claim = c.pending.find((p) => p.kind === "mine");
    return (
      '<div class="lanes">' +
      laneCard("north", "Northern lane", c, claim) +
      laneCard("south", "Southern lane", c, claim) +
      "</div>"
    );
  }

  function laneCard(id, title, c, claim) {
    const claimNote =
      claim && claim.lane === id ? '<p class="warn">Unconfirmed mine claim open. Not in the sweep number.</p>' : "";
    return (
      '<div class="lane ' +
      id +
      '"><strong>' +
      title +
      "</strong><p>" +
      esc(assessSentence(c, id)) +
      "</p>" +
      claimNote +
      "</div>"
    );
  }

  function step(group, key, name, note) {
    const val = ui.orders[group][key];
    return (
      '<div class="step"><button type="button" data-act="nudge" data-group="' +
      group +
      '" data-key="' +
      key +
      '" data-delta="-1" aria-label="Fewer, ' +
      esc(name) +
      '">−</button><span class="val num" data-val="' +
      group +
      "." +
      key +
      '">' +
      val +
      '</span><button type="button" data-act="nudge" data-group="' +
      group +
      '" data-key="' +
      key +
      '" data-delta="1" aria-label="More, ' +
      esc(name) +
      '">+</button><div><div class="name">' +
      esc(name) +
      '</div><div class="note">' +
      esc(note) +
      "</div></div></div>"
    );
  }

  function seg(field, value, label) {
    const on = ui.orders[field] === value;
    return (
      '<button type="button" role="radio" aria-checked="' +
      (on ? "true" : "false") +
      '" data-act="seg" data-field="' +
      field +
      '" data-value="' +
      value +
      '">' +
      esc(label) +
      "</button>"
    );
  }

  function ordersHtml(c) {
    const pools = H.poolsFor(c);
    const meta = nominal(pools, c);
    const repair =
      (meta.escortOut ? meta.escortOut + " escort in repair. " : "") +
      (meta.mcmOut ? meta.mcmOut + " hunter in repair." : "");
    return (
      '<section class="panel" id="order-panel"><h2>Orders</h2>' +
      '<p class="hint">' +
      esc(
        "On hand: " +
          pools.escort +
          " escorts, " +
          pools.mcm +
          " hunters, " +
          pools.cap +
          " CAP, " +
          pools.mpa +
          " patrol, " +
          pools.isr +
          " ISR. " +
          (repair || "Nothing in repair.")
      ) +
      ' <button class="linkish" data-act="proposal" style="min-height:0;padding:0 0 0 6px">Load the staff proposal</button></p>' +
      '<div class="order-grid">' +
      '<div class="card"><h3>Escorts</h3><p class="hint">Screen covers merchants. A picket is not a minesweeper.</p>' +
      step("escort", "screen", "Convoy screen", "Sets how many ships you can escort.") +
      step("escort", "north", "Northern picket", "Discourages boats on the northern lane.") +
      step("escort", "south", "Southern picket", "Same, southern lane.") +
      step("escort", "alongside", "Alongside", "Not in the strait.") +
      "</div>" +
      '<div class="card"><h3>Hunters</h3><p class="hint">Clearance is slow without a patrol or a strait orbit to support it.</p>' +
      step("mcm", "north", "Northern lane", "Sweep the Iranian-side lane.") +
      step("mcm", "south", "Southern lane", "Sweep the Musandam-side lane.") +
      step("mcm", "alongside", "Not hunting", "The lane you ignore will be mined.") +
      "</div>" +
      '<div class="card"><h3>CAP</h3><p class="hint">Two sorties make one strike package. What you spend there is not over the merchants.</p>' +
      step("cap", "convoy", "Over the convoys", "The main cut to drone and missile hits on escorted ships.") +
      step("cap", "north", "Northern lane", "Covers that lane, including a picket.") +
      step("cap", "south", "Southern lane", "Covers that lane.") +
      step("cap", "ready", "Unassigned", "Sorties you did not task.") +
      '<div class="step"><button type="button" data-act="strike" data-delta="-1" aria-label="Fewer strike packages">−</button><span class="val num" data-val="strike.packages">' +
      ui.orders.strikePackages +
      '</span><button type="button" data-act="strike" data-delta="1" aria-label="More strike packages">+</button><div><div class="name">Strike packages</div><div class="note">Military targets only. Two CAP each. Escalation rises whether or not the picture was good.</div></div></div>' +
      '<div class="seg" role="radiogroup" aria-label="Strike target">' +
      '<button type="button" data-act="target" data-value="launch" aria-checked="' +
      (ui.orders.strikeTarget !== "fiac" ? "true" : "false") +
      '">Launch sites</button>' +
      '<button type="button" data-act="target" data-value="fiac" aria-checked="' +
      (ui.orders.strikeTarget === "fiac" ? "true" : "false") +
      '">Fast-attack bases</button></div>' +
      '<p class="hint">Launch sites are the drone and missile problem. Boat bases are the smaller share unless boats are actually up. No civilian targets.</p>' +
      "</div>" +
      '<div class="card"><h3>Maritime patrol</h3>' +
      step("mpa", "mines", "Support the hunters", "Faster clearance and a better lane picture.") +
      step("mpa", "convoy", "Over the convoys", "A smaller cut in hit chance. Confirms more of what you see.") +
      step("mpa", "goa", "Gulf of Aden", "Off this chart. Not the strait.") +
      step("mpa", "ready", "Unassigned", "Held back.") +
      "</div>" +
      '<div class="card"><h3>ISR</h3>' +
      step("isr", "launch", "Launch areas", "Makes a strike's damage assessment real, and trims surprise attacks.") +
      step("isr", "strait", "Strait picture", "Catches a severe minefield. Does not clear it.") +
      step("isr", "gulf", "Gulf watch", "Earlier warning if drones go at Bahrain and the southern Gulf.") +
      step("isr", "ready", "Unassigned", "An orbit on the deck.") +
      "</div>" +
      '<div class="card wide"><h3>How the traffic runs</h3>' +
      '<div class="seg" role="radiogroup" aria-label="Convoy pattern">' +
      seg("pattern", "dispersed", "Small groups") +
      seg("pattern", "standard", "Standard") +
      seg("pattern", "mass", "Massed") +
      "</div><p class=\"hint\" id=\"pattern-hint\"></p>" +
      '<div class="seg" role="radiogroup" aria-label="Who may sail without escort">' +
      seg("sail", "escort", "Escort only") +
      seg("sail", "mixed", "Mixed") +
      seg("sail", "flow", "Flow first") +
      "</div><p class=\"hint\" id=\"sail-hint\"></p>" +
      '<div class="seg" role="radiogroup" aria-label="Lane for today\'s traffic">' +
      seg("route", "north", "Northern lane") +
      seg("route", "split", "Split the lanes") +
      seg("route", "south", "Southern lane") +
      "</div><p class=\"hint\" id=\"route-hint\"></p>" +
      "</div></div></section>"
    );
  }

  const HINTS = {
    pattern: {
      dispersed: "Four merchants on an escort. Fewer ships covered. A hit usually stays with one ship.",
      standard: "Six merchants on an escort.",
      mass: "Nine merchants on an escort. You cover more. If the group is found, follow-on hits are more likely.",
    },
    sail: {
      escort: "Only ships you can cover sail. The rest wait at Fujairah. Some will cancel.",
      mixed: "Some uncovered owners sail anyway when the recent days were tolerable.",
      flow: "Everyone willing sails. Bare ships take several times the escorted hit rate.",
    },
    route: {
      north: "All of today's traffic on the northern lane, Iranian side. More exposed.",
      split: "Half and half. You are not betting the day on one lane.",
      south: "All traffic on the southern lane, Musandam side. Quieter, until the mines follow the traffic.",
    },
  };

  function estimateHtml() {
    const c = ui.campaign;
    const p = H.preview(c, ui.orders);
    const lines = [];
    lines.push(
      "<p><b>Staff estimate, before luck.</b> Not a promise. Demand noise on the day is about ±4 ships. Figures are illustrative.</p>"
    );
    const jam = c.jammingBelief;
    lines.push(
      "<dl>" +
        row("Demand midpoint", String(p.arrivalsMid)) +
        row("Willing", p.ready + " of the pool, index " + c.insurance.toFixed(2)) +
        row("Slots", p.orders.escort.screen + " escorts × " + p.per + " = " + p.slots) +
        row("Escorted", String(p.escorted)) +
        row("Bare", String(p.bare)) +
        row("Held", p.held + ", queue after about " + p.queueAfter) +
        row("Southern, escorted", pct(p.pEsc.south)) +
        row("Southern, bare", pct(p.pBare.south)) +
        row("Northern, escorted", pct(p.pEsc.north)) +
        row("Northern, bare", pct(p.pBare.north)) +
        "</dl>"
    );
    lines.push(
      "<p class='small muted'>Baseline before modifiers: " +
        (H.MODEL.hitEscorted * 100).toFixed(1) +
        "% escorted, " +
        (H.MODEL.hitUnescorted * 100).toFixed(1) +
        "% bare. The percentages above are projectile only.</p>"
    );
    ["north", "south"].forEach((lane) => {
      const known = p.mineKnown[lane];
      const name = lane === "north" ? "Northern" : "Southern";
      if (known == null) {
        lines.push("<p class='small'>" + name + " mines: not in the estimate. Picture is stale or only a glance.</p>");
      } else {
        const a = c.assess[lane];
        lines.push(
          "<p class='small'>" +
            name +
            " mines, from the current sweep: about " +
            pct(H.mineChance(known, true)) +
            " escorted, " +
            pct(H.mineChance(known, false)) +
            " bare" +
            (a && a.fresh ? "." : " (treat as rough).") +
            "</p>"
        );
      }
    });
    if (jam === "reported") {
      lines.push(
        "<p class='warn'>AIS trouble is on the feed and is not confirmed. If it is real interference, expected hits move from about " +
          p.expHits.toFixed(1) +
          " to about " +
          p.expHitsIfJam.toFixed(1) +
          ". The percentages above do not assume it is real.</p>"
      );
    } else if (jam === "confirmed") {
      lines.push("<p class='warn'>Confirmed GPS and AIS interference today. The percentages include it.</p>");
    }
    if (p.claim) {
      lines.push(
        "<p class='warn'>Unconfirmed mine claim on the " +
          (p.claim.lane === "north" ? "northern" : "southern") +
          " lane. It is not inside the mine percentage.</p>"
      );
    }
    lines.push(
      "<p>Point estimate of hits: <b class='num'>" +
        p.expHits.toFixed(1) +
        "</b>. Rough deliveries if the point estimate lands: <b class='num'>" +
        p.expMb.toFixed(1) +
        " mb</b>. A single day moves off that.</p>"
    );
    if (p.bare > 0) {
      lines.push("<p class='warn'>" + p.bare + " ships sail bare under this plan. That is where most of the extra hits come from.</p>");
    }
    if (p.badRoute) {
      lines.push("<p class='warn'>Your own fresh sweep says this lane is dangerous and the other one is not. You are sending the day onto the bad one.</p>");
    }
    if (p.orders.strikePackages > 0 && !(p.orders.isr.launch > 0)) {
      lines.push("<p class='warn'>Strike without a launch-area orbit. Expect a weak damage assessment. Escalation still goes up.</p>");
    } else if (p.orders.strikePackages > 0) {
      lines.push("<p class='oknote'>Strike is in the plan, with ISR on the launch areas. Threat in the percentages is the post-strike figure. Escalation still goes up, and the crews come back.</p>");
    }
    if (p.orders.mpa.goa > 0) {
      lines.push("<p class='warn'>Maritime patrol is tasked to the Gulf of Aden. That sortie is not helping the hunters.</p>");
    }
    const sum =
      p.escorted +
      " escorted · " +
      p.bare +
      " bare · ~" +
      p.expMb.toFixed(1) +
      " mb";
    return { html: lines.join(""), sum: sum, preview: p };
  }

  function row(dt, dd) {
    return "<dt>" + esc(dt) + "</dt><dd class='num'>" + esc(dd) + "</dd>";
  }

  function refreshPlan() {
    document.querySelectorAll("[data-val]").forEach((node) => {
      if (node.dataset.val === "strike.packages") node.textContent = String(ui.orders.strikePackages);
      else {
        const parts = node.dataset.val.split(".");
        node.textContent = String(ui.orders[parts[0]][parts[1]]);
      }
    });
    document.querySelectorAll("[data-act='seg'], [data-act='target']").forEach((btn) => {
      if (btn.dataset.act === "seg") btn.setAttribute("aria-checked", ui.orders[btn.dataset.field] === btn.dataset.value ? "true" : "false");
      else btn.setAttribute("aria-checked", ui.orders.strikeTarget === btn.dataset.value ? "true" : "false");
    });
    const ph = document.getElementById("pattern-hint");
    const sh = document.getElementById("sail-hint");
    const rh = document.getElementById("route-hint");
    if (ph) ph.textContent = HINTS.pattern[ui.orders.pattern];
    if (sh) sh.textContent = HINTS.sail[ui.orders.sail];
    if (rh) rh.textContent = HINTS.route[ui.orders.route];
    const est = document.getElementById("estimate");
    const sum = document.getElementById("action-sum");
    if (est) {
      const built = estimateHtml();
      est.innerHTML = built.html;
      if (sum) sum.textContent = built.sum;
    }
  }

  function headerHtml(c, titleRight) {
    const phaseDay = c.phase === "result" && ui.report ? ui.report.day : c.day;
    const date = H.formatDate(phaseDay);
    return (
      '<header class="top"><div><div class="eyebrow">Illustrative · not a forecast · not operational advice</div><h1>Hormuz Command</h1></div>' +
      '<div class="when"><div class="daynum" id="day-title" tabindex="-1">Day ' +
      phaseDay +
      " of " +
      H.MODEL.days +
      "</div><div>" +
      esc(date) +
      '</div><div class="faint small">Seed ' +
      c.seed +
      "</div></div>" +
      '<nav class="nav"><button class="btn ghost" data-act="help">How to play</button><button class="btn ghost" data-act="sources">Sources</button><button class="btn ghost" data-act="abandon">Abandon</button></nav></header>'
    );
  }

  function showGame() {
    ui.screen = "game";
    const c = ui.campaign;
    if (!c) return showStart();
    if (c.phase === "plan") ui.orders = H.fitOrders(ui.orders || H.suggestedOrders(H.poolsFor(c)), H.poolsFor(c));
    const result = c.phase === "result";
    const queue = (c.lastPicture && c.lastPicture.queue) || c.queue || 0;
    let body;
    if (result && ui.report) {
      body =
        '<section class="panel"><h2>Day result</h2><div class="log">' +
        ui.report.lines
          .map((l) => '<p class="' + esc(l.kind) + '">' + esc(l.text) + "</p>")
          .join("") +
        "</div></section>";
    } else if (result) {
      body = '<section class="panel"><h2>Day result</h2><p>The day is in the record. Use the feed.</p></section>';
    } else {
      body = ordersHtml(c) + '<section class="estimate" id="estimate" aria-live="polite"></section>';
    }
    const action = result
      ? '<div class="sum" id="action-sum">' +
        (ui.report
          ? esc(ui.report.delivered + " delivered · " + ui.report.mb.toFixed(2) + " mb · " + ui.report.hits + " hit")
          : "") +
        '</div><button class="btn" data-act="next">' +
        (ui.report && ui.report.done ? "After-action review" : "Next morning") +
        "</button>"
      : '<div class="sum" id="action-sum"></div><button class="btn" id="issue" data-act="issue">Issue orders</button>';

    app.innerHTML =
      '<main class="wrap">' +
      headerHtml(c) +
      statsHtml(c) +
      '<div class="layout"><section class="chart-card">' +
      chartHtml(queue) +
      lanesHtml(c) +
      '</section><div class="stack"><section class="panel"><h2>Intel feed</h2><div class="feed">' +
      feedHtml(c) +
      "</div></section>" +
      body +
      "</div></div>" +
      '<footer class="actionbar">' +
      action +
      "</footer></main>";
    placeMarkers();
    if (!result) refreshPlan();
  }

  function showEnd() {
    ui.screen = "end";
    const c = ui.campaign;
    const review = H.aar(c);
    const t = c.totals;
    const transits = t.escorted + t.unescorted;
    app.innerHTML =
      '<main class="wrap end"><header class="top"><div><div class="eyebrow">After-action review · illustrative</div><h1>End of the watch</h1></div>' +
      '<nav class="nav"><button class="btn ghost" data-act="sources">Sources</button><button class="btn ghost" data-act="help">How to play</button></nav></header>' +
      '<div class="grade"><div class="letter">' +
      esc(review.letter) +
      "</div><div><h2>" +
      esc(review.title) +
      '</h2><p class="muted">Seed ' +
      c.seed +
      ". " +
      H.formatDate(1) +
      " – " +
      H.formatDate(14) +
      ". Not a forecast. Not operational advice.</p></div></div>" +
      '<section class="end-stats">' +
      stat("Average flow", review.avg.toFixed(2) + " mb/d", "band used here 13–14") +
      stat("Delivered", (t.barrels / 1e6).toFixed(1) + " mb", "target about 189") +
      stat("Transits", String(transits), t.escorted + " escorted · " + t.unescorted + " bare") +
      stat("Merchants hit", String(t.hits), t.hitsEscorted + " escorted · " + t.hitsUnescorted + " bare") +
      stat("Disabled / lost", t.disabled + " / " + t.lost, "merchant ships") +
      stat("Merchant crew", t.injured + " / " + t.killed, "injured / killed") +
      stat("Own force", t.ownDamaged + " damaged", t.ownLost + " lost · " + t.ownInjured + " injured · " + t.ownKilled + " killed") +
      stat("Escalation", Math.round(review.peak) + " peak", "ended " + Math.round(c.escalation)) +
      stat("Political cost", String(Math.round(c.political)), "insurance " + c.insurance.toFixed(2)) +
      "</section>" +
      '<section class="aar prose">' +
      review.paragraphs.map((p) => "<p>" + esc(p) + "</p>").join("") +
      "</section>" +
      '<div class="row"><button class="btn" data-act="again">New watch</button><button class="btn secondary" data-act="same">Replay this seed</button><button class="btn ghost" data-act="sources">Sources and caveats</button></div>' +
      "</main>";
    save();
  }

  const saved = load();
  if (saved && saved.screen === "game") {
    ui.campaign = saved.campaign;
    ui.orders = saved.orders;
    ui.report = saved.report;
    showGame();
  } else if (saved && saved.screen === "end") {
    ui.campaign = saved.campaign;
    showEnd();
  } else {
    showStart();
  }
})();
