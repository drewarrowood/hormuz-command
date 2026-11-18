"use strict";

const H = require("../js/model.js");

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function play(seed, policy) {
  const state = H.createCampaign(seed);
  let guard = 0;
  while (!state.complete) {
    const orders = policy(state);
    const report = H.resolveDay(state, orders);
    assert(Number.isFinite(report.mb), "mb not finite");
    assert(report.barrels === report.delivered * H.MODEL.bblPerShip, "barrel identity");
    if (orders.sail === "escort" || report.unescorted === 0) {
      /* checked below from history when the fitted order is escort */
    }
    if (!report.done) H.beginMorning(state);
    guard += 1;
    if (guard > 20) throw new Error("loop");
  }
  assert(state.history.length === 14, "not 14 days");
  const summed = state.history.reduce((a, h) => a + h.barrels, 0);
  assert(summed === state.totals.barrels, "history barrels drifted");
  return state;
}

function smart(state) {
  const pools = H.poolsFor(state);
  const o = H.suggestedOrders(pools);
  o.escort = { screen: pools.escort, north: 0, south: 0, alongside: 0 };
  o.pattern = "standard";
  o.sail = "escort";
  o.strikePackages = 0;
  o.strikeTarget = "launch";
  const kn = state.assess.north;
  const ks = state.assess.south;
  const score = (a) => (a.fresh && a.knownThreat != null ? a.knownThreat : 40);
  const n = score(kn);
  const s = score(ks);
  if (n + 12 < s) o.route = "north";
  else if (s + 12 < n) o.route = "south";
  else o.route = "split";
  const claim = state.pending.find((p) => p.kind === "mine");
  if (pools.mcm >= 2) {
    let primary = n >= s ? "north" : "south";
    if (claim) primary = claim.lane;
    const other = primary === "north" ? "south" : "north";
    o.mcm = { north: 0, south: 0, alongside: 0 };
    o.mcm[other] = 1;
    o.mcm[primary] = pools.mcm - 1;
  } else {
    o.mcm = { north: pools.mcm ? 1 : 0, south: 0, alongside: 0 };
  }
  o.cap = { convoy: pools.cap, north: 0, south: 0, ready: 0 };
  o.mpa = { mines: pools.mpa, convoy: 0, goa: 0, ready: 0 };
  if (kn.fresh && ks.fresh && n < 28 && s < 28 && pools.mpa > 1) {
    o.mpa = { mines: pools.mpa - 1, convoy: 1, goa: 0, ready: 0 };
  }
  o.isr = { launch: 0, strait: Math.min(1, pools.isr), gulf: 0, ready: 0 };
  if (pools.isr > 1) o.isr.launch = pools.isr - 1;
  if (state.drone > 64 && state.escalation < 38 && o.isr.launch > 0 && pools.cap >= 6) {
    o.strikePackages = 1;
    o.cap = { convoy: pools.cap - 2, north: 0, south: 0, ready: 0 };
  }
  return H.fitOrders(o, pools);
}

function staff(state) {
  return H.suggestedOrders(H.poolsFor(state));
}

function reckless(state) {
  const pools = H.poolsFor(state);
  return H.fitOrders(
    {
      escort: { screen: pools.escort, north: 0, south: 0, alongside: 0 },
      mcm: { north: 0, south: 0, alongside: pools.mcm },
      cap: { convoy: pools.cap, north: 0, south: 0, ready: 0 },
      strikePackages: 0,
      strikeTarget: "launch",
      mpa: { mines: 0, convoy: pools.mpa, goa: 0, ready: 0 },
      isr: { launch: 0, strait: 0, gulf: 0, ready: pools.isr },
      pattern: "mass",
      sail: "flow",
      route: "south",
    },
    pools
  );
}

function striker(state) {
  const pools = H.poolsFor(state);
  const packages = Math.min(2, Math.floor(pools.cap / 2));
  return H.fitOrders(
    {
      escort: { screen: pools.escort, north: 0, south: 0, alongside: 0 },
      mcm: { north: Math.ceil(pools.mcm / 2), south: Math.floor(pools.mcm / 2), alongside: 0 },
      cap: { convoy: Math.max(0, pools.cap - packages * 2), north: 0, south: 0, ready: 0 },
      strikePackages: packages,
      strikeTarget: "launch",
      mpa: { mines: 1, convoy: Math.max(0, pools.mpa - 1), goa: 0, ready: 0 },
      isr: { launch: pools.isr ? 1 : 0, strait: Math.max(0, pools.isr - 1), gulf: 0, ready: 0 },
      pattern: "standard",
      sail: "escort",
      route: "split",
    },
    pools
  );
}

function cautious(state) {
  const pools = H.poolsFor(state);
  const pickets = Math.min(2, pools.escort);
  return H.fitOrders(
    {
      escort: {
        screen: Math.max(0, pools.escort - pickets),
        north: pickets > 0 ? 1 : 0,
        south: pickets > 1 ? 1 : 0,
        alongside: 0,
      },
      mcm: { north: Math.ceil(pools.mcm / 2), south: Math.floor(pools.mcm / 2), alongside: 0 },
      cap: {
        convoy: Math.max(0, pools.cap - Math.min(2, pools.cap)),
        north: pools.cap ? 1 : 0,
        south: pools.cap > 1 ? 1 : 0,
        ready: 0,
      },
      strikePackages: 0,
      strikeTarget: "launch",
      mpa: { mines: pools.mpa, convoy: 0, goa: 0, ready: 0 },
      isr: { launch: 0, strait: pools.isr, gulf: 0, ready: 0 },
      pattern: "dispersed",
      sail: "escort",
      route: "split",
    },
    pools
  );
}

function summarize(name, states) {
  const avg = (fn) => states.reduce((a, s) => a + fn(s), 0) / states.length;
  const mb = avg((s) => s.totals.barrels / 1e6 / 14);
  const hits = avg((s) => s.totals.hits);
  const hitRate = avg((s) => s.totals.hits / Math.max(1, s.totals.escorted + s.totals.unescorted));
  const peak = avg((s) => s.history.reduce((m, h) => Math.max(m, h.escalation), 0));
  const killed = avg((s) => s.totals.killed);
  const mine = avg((s) => {
    const last = s.history[s.history.length - 1].mine;
    return (last.north + last.south) / 2;
  });
  const grades = {};
  states.forEach((s) => {
    const g = H.gradeWatch(s).letter;
    grades[g] = (grades[g] || 0) + 1;
  });
  const bare = avg((s) => s.totals.unescorted);
  console.log(
    name.padEnd(10),
    "mb/d",
    mb.toFixed(2),
    "hits",
    hits.toFixed(1),
    "hit%",
    (hitRate * 100).toFixed(2),
    "peakEsc",
    peak.toFixed(0),
    "killed",
    killed.toFixed(2),
    "mine",
    mine.toFixed(0),
    "bare",
    bare.toFixed(0),
    "grades",
    JSON.stringify(grades)
  );
  return { mb, hits, hitRate, peak, killed, mine };
}

function quantile(arr, q) {
  const s = arr.slice().sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))));
  return s[i];
}

const seeds = [];
for (let i = 1; i <= 40; i++) seeds.push(i);

const policies = { smart, staff, reckless, striker, cautious };
const results = {};
Object.keys(policies).forEach((name) => {
  results[name] = seeds.map((seed) => play(seed, policies[name]));
  summarize(name, results[name]);
  const mbs = results[name].map((s) => s.totals.barrels / 1e6 / 14);
  console.log("   mb/d p10", quantile(mbs, 0.1).toFixed(2), "p90", quantile(mbs, 0.9).toFixed(2));
});

results.smart.forEach((s) => {
  assert(
    s.history.every((h) => h.unescorted === 0),
    "escort-only sailed bare"
  );
});

const sample = H.createCampaign(4);
const pools = H.poolsFor(sample);
const fitted = H.fitOrders(H.suggestedOrders(pools), pools);
["escort", "mcm", "mpa", "isr"].forEach((g) => {
  const sum = Object.values(fitted[g]).reduce((a, b) => a + b, 0);
  assert(sum === pools[g], g + " sum " + sum + " != " + pools[g]);
});
const capSum = Object.values(fitted.cap).reduce((a, b) => a + b, 0) + fitted.strikePackages * 2;
assert(capSum === pools.cap, "cap sum");

const probe = H.createCampaign(2);
probe.mine.north = 0;
probe.mine.south = 0;
probe.escalation = 16;
probe.drone = 50;
probe.missile = 40;
probe.fiac = 30;
probe.jamming = false;
const screen = {
  escort: { screen: 5, north: 0, south: 0, alongside: 0 },
  mcm: { north: 0, south: 0, alongside: 3 },
  cap: { convoy: 6, north: 0, south: 0, ready: 0 },
  strikePackages: 0,
  strikeTarget: "launch",
  mpa: { mines: 0, convoy: 0, goa: 0, ready: 2 },
  isr: { launch: 0, strait: 0, gulf: 0, ready: 2 },
  pattern: "standard",
  sail: "escort",
  route: "split",
};
const pE = H.projectileChance(probe, screen, "south", true, 30);
const pU = H.projectileChance(probe, screen, "south", false, 30);
console.log("baseline south escorted", pE.toFixed(4), "unescorted", pU.toFixed(4));
assert(Math.abs(pE - 0.012 * 0.94 * 0.64) < 1e-6, "escorted baseline " + pE);
assert(Math.abs(pU - 0.055 * 0.94) < 1e-6, "unescorted baseline " + pU);

let sawReal = false;
let sawFalse = false;
for (let s = 1; s <= 80 && !(sawReal && sawFalse); s++) {
  const st = H.createCampaign(s);
  const claim = st.claims[0];
  assert(claim && claim.kind === "mine", "opening claim");
  const start = H.MODEL.startMine[claim.lane];
  assert(st.assess[claim.lane].knownThreat === start, "picture includes hidden claim");
  if (claim.real) {
    assert(st.mine[claim.lane] >= start + 12, "real claim did not lay");
    sawReal = true;
  } else {
    assert(st.mine[claim.lane] === start, "false claim laid mines");
    sawFalse = true;
  }
}
assert(sawReal && sawFalse, "need both claim types");

const rngBefore = probe.rng;
H.preview(probe, screen);
assert(probe.rng === rngBefore, "preview consumed rng");
assert(probe.totals.hits === 0, "preview mutated totals");

function playRestore(seed, policy) {
  let state = H.createCampaign(seed);
  let n = 0;
  while (!state.complete) {
    H.resolveDay(state, policy(state));
    n += 1;
    if (n === 7) state = H.restore(JSON.parse(JSON.stringify(state)));
    if (!state.complete) H.beginMorning(state);
  }
  return state;
}
const a = play(9, smart);
const b = playRestore(9, smart);
assert(a.totals.barrels === b.totals.barrels, "restore barrels " + a.totals.barrels + " vs " + b.totals.barrels);
assert(a.totals.hits === b.totals.hits, "restore hits");
assert(a.escalation === b.escalation, "restore escalation");

const review = H.aar(results.smart[0]);
assert(review.paragraphs.length >= 5, "aar short");
assert("ABCDF".includes(review.letter), "grade");
console.log("sample grade", review.letter, review.title);
console.log(review.paragraphs[review.paragraphs.length - 2]);

const smartMb = results.smart.map((s) => s.totals.barrels / 1e6 / 14);
const smartMean = smartMb.reduce((x, y) => x + y, 0) / smartMb.length;
const recklessRate =
  results.reckless.reduce((x, s) => x + s.totals.hits / (s.totals.escorted + s.totals.unescorted), 0) /
  results.reckless.length;
const smartRate =
  results.smart.reduce((x, s) => x + s.totals.hits / (s.totals.escorted + s.totals.unescorted), 0) /
  results.smart.length;
const strikePeak =
  results.striker.reduce((x, s) => x + s.history.reduce((m, h) => Math.max(m, h.escalation), 0), 0) /
  results.striker.length;
const smartPeak =
  results.smart.reduce((x, s) => x + s.history.reduce((m, h) => Math.max(m, h.escalation), 0), 0) /
  results.smart.length;
const cautiousMb =
  results.cautious.reduce((x, s) => x + s.totals.barrels / 1e6 / 14, 0) / results.cautious.length;

assert(smartMean > 12.2 && smartMean < 15.2, "smart flow out of band " + smartMean);
assert(recklessRate > smartRate + 0.004, "reckless not more dangerous");
assert(strikePeak > smartPeak + 25, "strikes did not escalate");
assert(cautiousMb < smartMean - 0.7, "caution did not cost flow");
assert(results.striker.every((s) => s.totals.strikes >= 14), "striker did not strike");

console.log("ok");
