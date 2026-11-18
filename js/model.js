/* Hormuz Command — campaign model.
   Illustrative logistics. Not a forecast. Not operational advice.
   Per-transit hit rates start from the lab sketch defaults
   (0.055 unescorted, 0.012 escorted) and then move with
   air cover, threat, mines, convoy density, and escalation. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Hormuz = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MODEL = Object.freeze({
    days: 14,
    baseShips: 30,
    hitUnescorted: 0.055,
    hitEscorted: 0.012,
    bblPerShip: 433000,
    targetMbDay: 13.5,
    targetBand: Object.freeze([13, 14]),
    peacetimeMbDay: 20,
    escortsStart: 5,
    escortsReinforced: 6,
    mcm: 3,
    capStart: 6,
    capReinforced: 8,
    mpa: 2,
    isr: 2,
    reinforceDay: 6,
    perEscort: Object.freeze({ dispersed: 4, standard: 6, mass: 9 }),
    startMine: Object.freeze({ north: 36, south: 22 }),
  });

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function attachRng(state) {
    state.rand = function rand() {
      let a = state.rng | 0;
      a = (a + 0x6d2b79f5) | 0;
      state.rng = a >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return state;
  }

  function formatDate(dayNumber) {
    const dt = new Date(Date.UTC(2026, 10, 18));
    dt.setUTCDate(dt.getUTCDate() + (dayNumber - 1));
    return dt.getUTCDate() + " " + MONTHS[dt.getUTCMonth()] + " " + dt.getUTCFullYear();
  }

  function laneName(lane) {
    return lane === "north" ? "northern" : "southern";
  }

  function otherLane(lane) {
    return lane === "north" ? "south" : "north";
  }

  function bandOf(threat) {
    if (threat < 18) return "CLEAR";
    if (threat < 34) return "RESIDUAL";
    if (threat < 52) return "ELEVATED";
    if (threat < 70) return "HIGH";
    return "SEVERE";
  }

  function emptyTotals() {
    return {
      arrivals: 0,
      escorted: 0,
      unescorted: 0,
      clear: 0,
      delivered: 0,
      hits: 0,
      hitsEscorted: 0,
      hitsUnescorted: 0,
      drone: 0,
      missile: 0,
      mine: 0,
      injured: 0,
      killed: 0,
      ownInjured: 0,
      ownKilled: 0,
      disabled: 0,
      lost: 0,
      barrels: 0,
      ownDamaged: 0,
      ownLost: 0,
      gulfEvents: 0,
      strikes: 0,
      blindStrikes: 0,
      launchStrikes: 0,
      fiacStrikes: 0,
      cancelled: 0,
      badRouteDays: 0,
      falseChases: 0,
      trueClaims: 0,
      falseClaims: 0,
      goaDays: 0,
      massDays: 0,
      standardDays: 0,
      dispersedDays: 0,
      sailEscort: 0,
      sailMixed: 0,
      sailFlow: 0,
    };
  }

  function freshAssess(threat) {
    return {
      band: bandOf(threat),
      age: 0,
      fresh: true,
      coarse: false,
      notSevere: false,
      knownThreat: threat,
      source: "handover",
    };
  }

  function createCampaign(seed) {
    const s = seed >>> 0;
    const state = {
      seed: s,
      rng: s,
      day: 1,
      phase: "plan",
      complete: false,
      drone: 50,
      missile: 40,
      fiac: 30,
      mine: { north: MODEL.startMine.north, south: MODEL.startMine.south },
      assess: {
        north: freshAssess(MODEL.startMine.north),
        south: freshAssess(MODEL.startMine.south),
      },
      escalation: 16,
      political: 12,
      insurance: 1,
      queue: 0,
      recentHits: [0, 0, 0],
      jamming: false,
      jammingBelief: null,
      repair: [],
      pending: [],
      claims: [],
      feed: [],
      history: [],
      totals: emptyTotals(),
      nextId: 1,
      morningPending: null,
      lastPicture: { groups: [], queue: 0, claims: [] },
    };
    attachRng(state);
    pushFeed(state, {
      day: 1,
      conf: "confirmed",
      kicker: "Desk",
      text:
        "Handover. Facilitated traffic has been running about 28 to 34 ships a day. Staff planning figure for flow is 13 to 14 million barrels a day. Both numbers are illustrative. Your target for this watch is the middle of that band, 13.5, across 14 days.",
    });
    pushFeed(state, {
      day: 1,
      conf: "confirmed",
      kicker: "Desk",
      text:
        "Lane picture at handover, from the outgoing sweep, before any overnight claim. Northern lane: elevated residual mining. Southern lane: residual. This picture will go stale if nobody looks.",
    });
    pushFeed(state, {
      day: 1,
      conf: "confirmed",
      kicker: "Desk",
      text:
        "Carrier air wing extends on station on day 6 (23 Nov): one more escort and two more CAP sorties. They arrive in reserve. Assign them or they sit.",
    });
    openMineClaim(state, 1);
    state.lastPicture = {
      groups: [],
      queue: 0,
      claims: openMineLanes(state),
    };
    return state;
  }

  function pushFeed(state, item) {
    state.feed.push({
      id: state.nextId++,
      day: item.day,
      conf: item.conf,
      kicker: item.kicker,
      text: item.text,
      resolved: false,
    });
  }

  function openMineLanes(state) {
    return state.pending.filter((p) => p.kind === "mine").map((p) => p.lane);
  }

  function openMineClaim(state, day) {
    if (state.pending.some((p) => p.kind === "mine")) return false;
    const lane = state.rand() < 0.5 ? "north" : "south";
    const real = state.rand() < 0.45;
    const delay = state.rand() < 0.4 ? 2 : 1;
    if (real) state.mine[lane] = clamp(state.mine[lane] + 12, 0, 95);
    const claim = {
      id: state.nextId++,
      kind: "mine",
      lane,
      real,
      createdDay: day,
      resolveDay: day + delay,
    };
    state.pending.push(claim);
    state.claims.push(claim);
    const item = {
      day,
      conf: "unconfirmed",
      kicker: "Claim",
      text:
        "Opposing channels claim mines have been laid against traffic in the " +
        laneName(lane) +
        " lane. No master report is on your desk. The handover sweep does not include this claim. It is not confirmed.",
    };
    if (state.phase === "plan" && day === state.day && !state.morningPending) {
      pushFeed(state, item);
    } else {
      claim._item = item;
    }
    return true;
  }

  function poolsFor(state) {
    const day = state.day;
    let escorts = day >= MODEL.reinforceDay ? MODEL.escortsReinforced : MODEL.escortsStart;
    let mcm = MODEL.mcm;
    state.repair.forEach((r) => {
      if (day >= r.startDay && day < r.backDay) {
        if (r.type === "escort") escorts -= 1;
        if (r.type === "mcm") mcm -= 1;
      }
    });
    return {
      escort: Math.max(0, escorts),
      mcm: Math.max(0, mcm),
      cap: day >= MODEL.reinforceDay ? MODEL.capReinforced : MODEL.capStart,
      mpa: MODEL.mpa,
      isr: MODEL.isr,
    };
  }

  function fitDist(dist, total, flex) {
    const keys = Object.keys(dist);
    const d = {};
    keys.forEach((k) => {
      d[k] = Math.max(0, Math.round(Number(dist[k]) || 0));
    });
    if (!keys.includes(flex)) d[flex] = 0;
    let sum = keys.reduce((a, k) => a + d[k], 0);
    if (!(flex in d)) {
      /* flex already included if it was a key */
    }
    sum = Object.keys(d).reduce((a, k) => a + d[k], 0);
    if (sum > total) {
      let over = sum - total;
      const take = Math.min(d[flex] || 0, over);
      d[flex] = (d[flex] || 0) - take;
      over -= take;
      while (over > 0) {
        const donor = Object.keys(d)
          .filter((k) => k !== flex && d[k] > 0)
          .sort((a, b) => d[b] - d[a])[0];
        if (!donor) break;
        d[donor] -= 1;
        over -= 1;
      }
    } else if (sum < total) {
      d[flex] = (d[flex] || 0) + (total - sum);
    }
    return d;
  }

  function suggestedOrders(pools) {
    const capBudget = pools.cap;
    return {
      escort: fitDist(
        {
          screen: Math.max(0, pools.escort - 1),
          north: pools.escort ? 1 : 0,
          south: 0,
          alongside: 0,
        },
        pools.escort,
        "alongside"
      ),
      mcm: fitDist(
        {
          north: Math.min(2, pools.mcm),
          south: Math.max(0, pools.mcm - Math.min(2, pools.mcm)),
          alongside: 0,
        },
        pools.mcm,
        "alongside"
      ),
      cap: fitDist(
        {
          convoy: Math.max(0, capBudget - 1),
          north: capBudget ? 1 : 0,
          south: 0,
          ready: 0,
        },
        capBudget,
        "ready"
      ),
      strikePackages: 0,
      strikeTarget: "launch",
      mpa: fitDist(
        { mines: Math.min(1, pools.mpa), convoy: Math.max(0, pools.mpa - 1), goa: 0, ready: 0 },
        pools.mpa,
        "ready"
      ),
      isr: fitDist(
        { launch: pools.isr ? 1 : 0, strait: Math.max(0, pools.isr - 1), gulf: 0, ready: 0 },
        pools.isr,
        "ready"
      ),
      pattern: "standard",
      sail: "mixed",
      route: "split",
    };
  }

  function fitOrders(orders, pools) {
    const o = clone(orders || suggestedOrders(pools));
    const maxPackages = Math.floor(pools.cap / 2);
    o.strikePackages = clamp(Math.round(o.strikePackages || 0), 0, maxPackages);
    if (o.strikeTarget !== "fiac") o.strikeTarget = "launch";
    if (!["dispersed", "standard", "mass"].includes(o.pattern)) o.pattern = "standard";
    if (!["escort", "mixed", "flow"].includes(o.sail)) o.sail = "mixed";
    if (!["north", "south", "split"].includes(o.route)) o.route = "split";
    o.escort = fitDist(
      o.escort || { screen: 0, north: 0, south: 0, alongside: 0 },
      pools.escort,
      "alongside"
    );
    o.mcm = fitDist(o.mcm || { north: 0, south: 0, alongside: 0 }, pools.mcm, "alongside");
    o.cap = fitDist(
      o.cap || { convoy: 0, north: 0, south: 0, ready: 0 },
      pools.cap - o.strikePackages * 2,
      "ready"
    );
    o.mpa = fitDist(o.mpa || { mines: 0, convoy: 0, goa: 0, ready: 0 }, pools.mpa, "ready");
    o.isr = fitDist(o.isr || { launch: 0, strait: 0, gulf: 0, ready: 0 }, pools.isr, "ready");
    return o;
  }

  function slotsFor(orders) {
    const per = MODEL.perEscort[orders.pattern] || 6;
    return Math.max(0, orders.escort.screen) * per;
  }

  function expectedArrivals(day) {
    return Math.max(8, Math.round(MODEL.baseShips * (1 + 0.08 * Math.sin(day / 3.5))));
  }

  function routeLooksBad(state, route) {
    if (route === "split") {
      return ["north", "south"].every((lane) => {
        const a = state.assess[lane];
        return a && a.fresh && (a.band === "HIGH" || a.band === "SEVERE");
      });
    }
    const a = state.assess[route];
    return !!(a && a.fresh && (a.band === "HIGH" || a.band === "SEVERE"));
  }

  function willingness(state, orders) {
    const recent = state.recentHits.reduce((a, b) => a + b, 0);
    let w = 1 - recent * 0.038 - Math.max(0, state.insurance - 1) * 0.42;
    if (state.escalation >= 60) w -= 0.06;
    if (state.escalation >= 80) w -= 0.07;
    if (routeLooksBad(state, orders.route)) w -= 0.07;
    return clamp(w, 0.4, 1.06);
  }

  function planTraffic(arrivals, queue, will, slots, sail, insurance) {
    const pool = arrivals + queue;
    const ready = clamp(Math.round(pool * will), 0, pool);
    const escorted = Math.min(ready, Math.max(0, slots));
    const uncovered = ready - escorted;
    let bare = 0;
    if (sail === "flow") bare = uncovered;
    else if (sail === "mixed") {
      const brave = clamp((will - 0.5) / 0.55, 0, 1);
      bare = Math.round(uncovered * (0.2 + 0.7 * brave));
    }
    const sailed = escorted + bare;
    let nextQueue = Math.max(0, pool - sailed);
    let cancelled = 0;
    if (nextQueue > 18) cancelled += Math.round((nextQueue - 18) * 0.22);
    if (insurance > 1.5 && nextQueue > 8) cancelled += Math.round(nextQueue * 0.1);
    cancelled = Math.min(cancelled, nextQueue);
    nextQueue -= cancelled;
    return { pool, ready, escorted, bare, cancelled, nextQueue, uncovered, held: ready - sailed };
  }

  function escalationMod(escalation) {
    return 1 + Math.max(0, escalation - 20) * 0.011;
  }

  function threatWeight(state, lane, orders) {
    let fiac = state.fiac / 30;
    if (orders.escort[lane] > 0) fiac *= 0.62;
    if (orders.cap[lane] > 0) fiac *= 0.82;
    const bias = lane === "north" ? 1.12 : 0.94;
    return (0.55 * (state.drone / 50) + 0.3 * (state.missile / 40) + 0.15 * fiac) * bias;
  }

  function capMod(escortedShips, capSorties) {
    if (escortedShips <= 0) return 1;
    if (capSorties <= 0) return 1.32;
    const need = Math.max(1, Math.ceil(escortedShips / 8));
    const ratio = capSorties / need;
    if (ratio >= 1.4) return 0.64;
    if (ratio >= 1) return 0.76;
    if (ratio >= 0.5) return 0.95;
    return 1.12;
  }

  function patternDensity(pattern) {
    if (pattern === "mass") return 1.12;
    if (pattern === "dispersed") return 0.88;
    return 1;
  }

  function projectileChance(state, orders, lane, escorted, escortedShips, opts) {
    const options = opts || {};
    const base = escorted ? MODEL.hitEscorted : MODEL.hitUnescorted;
    let mod = threatWeight(state, lane, orders) * escalationMod(state.escalation);
    const jammed = options.forceJam ? true : options.forceNoJam ? false : !!state.jamming;
    if (jammed) mod *= 1.18;
    if (orders.isr.launch > 0 && !jammed) mod *= 0.9;
    if (orders.isr.strait > 0 && !jammed) mod *= 0.96;
    if (escorted) {
      mod *= capMod(escortedShips, orders.cap.convoy);
      mod *= patternDensity(orders.pattern);
      if (orders.mpa.convoy > 0 && !jammed) mod *= 0.92;
    } else {
      if (orders.cap[lane] > 0) mod *= 0.88;
      if (orders.mpa.convoy > 0 && !jammed) mod *= 0.96;
    }
    return clamp(base * mod, 0.001, 0.55);
  }

  function mineChance(threat, escorted) {
    const p = (threat / 100) * 0.04;
    return escorted ? p * 0.75 : p;
  }

  function knownMineThreat(state, lane) {
    const a = state.assess[lane];
    if (!a) return null;
    if (a.fresh && a.knownThreat != null && !a.coarse) return a.knownThreat;
    if (a.coarse && a.age === 0) {
      if (a.band === "SEVERE") return 78;
      if (a.band === "HIGH") return 64;
      if (a.band === "RESIDUAL" || a.band === "CLEAR") return 16;
    }
    return null;
  }

  function splashChance(pattern) {
    if (pattern === "mass") return 0.2;
    if (pattern === "standard") return 0.08;
    return 0;
  }

  function rollSeverity(rand, weapon) {
    const r = rand();
    const lostCut = weapon === "mine" ? 0.035 : 0.012;
    const disableCut = weapon === "mine" ? 0.14 : 0.09;
    if (r < lostCut) {
      return {
        lost: true,
        disabled: true,
        delivered: false,
        injured: 1 + Math.floor(rand() * 3),
        killed: rand() < 0.55 ? 1 : 0,
      };
    }
    if (r < lostCut + disableCut) {
      return {
        lost: false,
        disabled: true,
        delivered: false,
        injured: 1 + Math.floor(rand() * 3),
        killed: rand() < 0.22 ? 1 : 0,
      };
    }
    if (r < lostCut + disableCut + 0.28) {
      return {
        lost: false,
        disabled: false,
        delivered: false,
        injured: 1 + Math.floor(rand() * 2),
        killed: 0,
      };
    }
    const continued = rand() < 0.55;
    return {
      lost: false,
      disabled: false,
      delivered: continued,
      injured: 0,
      killed: 0,
    };
  }

  function pickWeapon(state, rand, kind) {
    if (kind === "mine") return "mine";
    const d = state.drone;
    const m = state.missile;
    return rand() < d / (d + m) ? "drone" : "missile";
  }

  function clearAmount(ships, supported) {
    let c = 0;
    const base = supported ? 14 : 8;
    for (let i = 0; i < ships; i++) c += base * Math.pow(0.7, i);
    return c;
  }

  function strikeOutlook(state, orders) {
    const n = orders.strikePackages || 0;
    const view = {
      drone: state.drone,
      missile: state.missile,
      fiac: state.fiac,
      escalation: state.escalation,
      packages: n,
      isr: false,
      blind: 0,
      politicalAdd: 0,
    };
    if (!n) return view;
    const isr = orders.isr.launch > 0 && !state.jamming;
    const effect = isr ? 1 : 0.4;
    let cut = 0;
    for (let i = 0; i < n; i++) cut += effect * Math.pow(0.65, i);
    if (orders.strikeTarget === "fiac") view.fiac = clamp(view.fiac - 22 * cut, 12, 100);
    else {
      view.drone = clamp(view.drone - 28 * cut, 16, 100);
      view.missile = clamp(view.missile - 18 * cut, 12, 100);
    }
    const escGain = (isr ? 8 : 12) + (n - 1) * (isr ? 6 : 9);
    view.escalation = clamp(state.escalation + escGain, 0, 100);
    view.isr = isr;
    view.blind = isr ? 0 : n;
    view.politicalAdd = 6 * n + (isr ? 0 : 3);
    return view;
  }

  function applyStrikes(state, orders, lines) {
    const fx = strikeOutlook(state, orders);
    if (!fx.packages) return { packages: 0, blind: 0 };
    state.drone = fx.drone;
    state.missile = fx.missile;
    state.fiac = fx.fiac;
    state.escalation = fx.escalation;
    state.political = clamp(state.political + fx.politicalAdd, 0, 100);
    const n = fx.packages;
    const isr = fx.isr;
    const where =
      orders.strikeTarget === "fiac"
        ? "fast-attack boat bases on the Iranian side of the strait"
        : "military launch positions along the Qeshm coast";
    if (isr) {
      lines.push({
        kind: "warn",
        text:
          "Strike package, " +
          n +
          (n > 1 ? " packages" : " package") +
          ", on " +
          where +
          ". ISR assessment: activity there is down for now. It will not stay down. Launch crews move. Escalation is up. These were military targets.",
      });
    } else {
      lines.push({
        kind: "warn",
        text:
          "Strike package, " +
          n +
          (n > 1 ? " packages" : " package") +
          ", sent at " +
          where +
          " without a current launch-area picture. Damage assessment is uncertain. Escalation is up anyway.",
      });
    }
    return { packages: n, blind: fx.blind };
  }

  function regenThreat(state) {
    const pull = 4.5 + state.escalation / 28;
    ["drone", "missile", "fiac"].forEach((key) => {
      const base = key === "drone" ? 50 : key === "missile" ? 40 : 30;
      if (state[key] < base) state[key] = Math.min(base + state.escalation / 10, state[key] + pull);
      else state[key] = Math.min(100, state[key] + state.escalation / 45);
    });
  }

  function describeHit(h) {
    const who = h.escorted ? "Escorted" : "Unescorted";
    const splash = h.splash ? " Follow-on hit: another ship in the same group had already been found." : "";
    let weapon = "Projectile. Engine-room fire.";
    if (h.weapon === "drone") weapon = "One-way attack drone. Fire on deck.";
    if (h.weapon === "mine") weapon = "Underwater detonation, mine-like.";
    let crew = "Crew safe.";
    if (h.killed && h.injured) crew = h.injured + " injured, " + h.killed + " killed.";
    else if (h.killed) crew = h.killed + " killed.";
    else if (h.injured) crew = h.injured + " injured.";
    let end;
    if (h.lost) end = "Ship lost. " + crew + " Cargo not counted.";
    else if (h.disabled) end = "Ship disabled. " + crew + " Cargo not counted.";
    else if (h.injured) end = crew + " Diverted toward Fujairah. Cargo not counted.";
    else if (h.delivered) end = "Crew safe. Ship continued. Cargo counted.";
    else end = "Crew safe. Ship diverted. Cargo not counted.";
    return laneName(h.lane) + " lane. " + who + "." + splash + " " + weapon + " " + end;
  }

  function rollOwnForce(state, orders, lines) {
    const out = { damaged: 0, lost: 0, injured: 0, killed: 0 };
    function hurt(type, laneLabel, p) {
      if (state.rand() >= p) return;
      const killed = state.rand() < 0.04 ? 1 : 0;
      const injured = killed ? 0 : state.rand() < 0.55 ? 1 : 0;
      const lost = type === "escort" && state.escalation > 85 && state.rand() < 0.08;
      out.injured += injured;
      out.killed += killed;
      if (lost) {
        out.lost += 1;
        state.repair.push({
          type,
          startDay: state.day + 1,
          backDay: 99,
          lost: true,
        });
        lines.push({
          kind: "bad",
          text:
            laneLabel +
            " is lost. Most of the crew was recovered. " +
            (killed ? killed + " killed." : "No one killed.") +
            " The hull is gone for this watch.",
        });
      } else {
        out.damaged += 1;
        state.repair.push({
          type,
          startDay: state.day + 1,
          backDay: state.day + 4,
          lost: false,
        });
        lines.push({
          kind: "bad",
          text:
            laneLabel +
            " is withdrawing for repair, back on day " +
            (state.day + 4) +
            ". " +
            (injured ? injured + " injured." : "No one injured.") +
            (killed ? " " + killed + " killed." : " No one killed."),
        });
      }
    }
    ["north", "south"].forEach((lane) => {
      const mine = state.mine[lane];
      for (let i = 0; i < orders.escort[lane]; i++) {
        let p = 0;
        if (mine > 68 && orders.cap[lane] === 0) p += 0.045;
        if (state.escalation > 72 && orders.cap[lane] === 0) p += 0.03;
        hurt("escort", "Picket on the " + laneName(lane) + " lane", p);
      }
      if (orders.mcm[lane] > 0 && mine > 74) {
        hurt("mcm", "A hunter on the " + laneName(lane) + " lane", 0.035);
      }
    });
    if (state.escalation > 78 && orders.cap.convoy === 0 && orders.escort.screen > 0) {
      hurt("escort", "An escort on the convoy screen", 0.07);
    }
    return out;
  }

  function gulfEvent(state, orders, lines) {
    let p = 0.045 + Math.max(0, state.escalation - 28) * 0.006;
    if (orders.isr.gulf > 0 && !state.jamming) p *= 0.55;
    if (state.rand() >= p) return false;
    const watched = orders.isr.gulf > 0 && !state.jamming;
    const roll = state.rand();
    let text;
    let injured = 0;
    let insurance = 0.08;
    let political = 7;
    let esc = 4;
    if (watched || roll < 0.55) {
      text =
        "One-way drones were engaged over Bahrain. Wreckage came down offshore. No casualties reported. This is enemy action against a Gulf partner, not a target you chose.";
      insurance = 0.07;
      political = 6;
      esc = 3;
    } else if (roll < 0.85) {
      text =
        "A one-way drone impacted near a logistics pier in Bahrain. The pier is damaged. Personnel are accounted for. No casualties on the report.";
      insurance = 0.1;
      political = 8;
      esc = 5;
    } else {
      text =
        "A one-way drone reached a coast-defense site on the Arab side of the Gulf. One servicemember injured. Operations continue. You did not order this. Escalation makes it more likely.";
      injured = 1;
      insurance = 0.11;
      political = 9;
      esc = 6;
    }
    state.insurance = clamp(state.insurance + insurance, 1, 2.5);
    state.political = clamp(state.political + political, 0, 100);
    state.escalation = clamp(state.escalation + esc, 0, 100);
    state.totals.ownInjured += injured;
    lines.push({ kind: "warn", text });
    return true;
  }

  function updateMines(state, orders, trafficNorth, trafficSouth) {
    const total = Math.max(1, trafficNorth + trafficSouth);
    const supported = (orders.mpa.mines > 0 || orders.isr.strait > 0) && !state.jamming;
    ["north", "south"].forEach((lane) => {
      const share = (lane === "north" ? trafficNorth : trafficSouth) / total;
      let lay = lane === "north" ? 5.4 : 3.8;
      if (share > 0.65) lay += 2.3;
      if (state.escalation > 50) lay += 1.4;
      lay += state.rand() * 1.6;
      const cleared = clearAmount(orders.mcm[lane], supported);
      const before = state.mine[lane];
      state.mine[lane] = clamp(before + lay - cleared, 4, 95);
      state._mineDelta = state._mineDelta || {};
      state._mineDelta[lane] = { before, after: state.mine[lane], cleared, ships: orders.mcm[lane] };
    });
  }

  function updateAssess(state, orders) {
    ["north", "south"].forEach((lane) => {
      if (orders.mcm[lane] > 0) {
        state.assess[lane] = {
          band: bandOf(state.mine[lane]),
          age: 0,
          fresh: true,
          coarse: false,
          notSevere: false,
          knownThreat: Math.round(state.mine[lane]),
          source: "sweep",
        };
        return;
      }
      const picture = !state.jamming && (orders.isr.strait > 0 || orders.mpa.mines > 0);
      const prev = state.assess[lane];
      if (!picture) {
        state.assess[lane] = {
          band: prev.band,
          age: prev.age + 1,
          fresh: false,
          coarse: prev.coarse,
          notSevere: false,
          knownThreat: prev.fresh && !prev.coarse ? prev.knownThreat : prev.knownThreat,
          source: prev.source,
        };
        return;
      }
      const t = state.mine[lane];
      if (t >= 58) {
        state.assess[lane] = {
          band: bandOf(t),
          age: 0,
          fresh: false,
          coarse: true,
          notSevere: false,
          knownThreat: null,
          source: "picture",
        };
      } else if (t <= 22) {
        state.assess[lane] = {
          band: "RESIDUAL",
          age: 0,
          fresh: false,
          coarse: true,
          notSevere: true,
          knownThreat: null,
          source: "picture",
        };
      } else {
        state.assess[lane] = {
          band: prev.band,
          age: 0,
          fresh: false,
          coarse: true,
          notSevere: true,
          knownThreat: null,
          source: "picture",
        };
      }
    });
  }

  function mcmLines(state, orders, lines) {
    ["north", "south"].forEach((lane) => {
      const d = state._mineDelta[lane];
      if (!d || d.ships <= 0) return;
      if (d.cleared >= 12 && d.before > d.after + 6) {
        lines.push({
          kind: "plain",
          text:
            "Hunters on the " +
            laneName(lane) +
            " lane neutralized contacts. Sweep picture now " +
            bandOf(d.after).toLowerCase() +
            ".",
        });
      } else if (d.before < 30 && d.after <= d.before + 2) {
        lines.push({
          kind: "plain",
          text: "Hunters on the " + laneName(lane) + " lane. No new contacts worth a signal. Picture is current.",
        });
      } else {
        lines.push({
          kind: "plain",
          text:
            "Hunters worked the " +
            laneName(lane) +
            " lane. Picture now " +
            bandOf(d.after).toLowerCase() +
            ".",
        });
      }
    });
  }

  function markOverreaction(state, claim) {
    if (!claim.real) {
      const other = otherLane(claim.lane);
      const over = state.history.some((h) => {
        if (h.day < claim.createdDay || h.day >= claim.resolveDay) return false;
        const mcmOnClaim = h.orders.mcm[claim.lane] || 0;
        const mcmOther = h.orders.mcm[other] || 0;
        return mcmOnClaim >= 2 && mcmOther === 0 && h.orders.route === other;
      });
      if (over) {
        claim.overreacted = true;
        state.totals.falseChases += 1;
      }
    }
    if (claim.real) state.totals.trueClaims += 1;
    else state.totals.falseClaims += 1;
  }

  function resolvePending(state, p, items) {
    if (p.kind === "mine") {
      markOverreaction(state, p);
      const sweptSince = state.history.some(
        (h) => h.day >= p.createdDay && h.day < p.resolveDay && h.orders.mcm[p.lane] > 0
      );
      let text;
      if (!p.real) {
        text =
          "Maritime desk: no substantiation for the mine claim in the " +
          laneName(p.lane) +
          " lane. Do not treat that claim as a contact.";
      } else if (sweptSince) {
        text =
          "Maritime desk confirms a mine contact in the " +
          laneName(p.lane) +
          " lane, matching the earlier claim. Hunters have been through since. Use the current sweep picture, not the claim.";
      } else {
        text =
          "Maritime desk confirms a mine-like contact in the " +
          laneName(p.lane) +
          " lane, consistent with the earlier claim. Treat that lane as mined until hunters say otherwise.";
      }
      items.push({ day: p.resolveDay, conf: "confirmed", kicker: "Desk", text });
      return;
    }
    if (p.kind === "boom") {
      const text = p.realHit
        ? "Maritime desk: the multi-ship destruction claim is not substantiated. Losses already on your tally stand. Do not add the claim on top."
        : "Maritime desk: the multi-ship destruction claim is not substantiated. No matching loss.";
      items.push({ day: p.resolveDay, conf: "confirmed", kicker: "Desk", text });
      return;
    }
    if (p.kind === "dark") {
      const text = p.real
        ? "The silent ship is accounted for. It matches a transit that already failed to complete. AIS was off. Do not count it twice."
        : "Master of the silent ship reports through the strait. AIS was switched off on purpose. No attack.";
      items.push({ day: p.resolveDay, conf: "confirmed", kicker: "Desk", text });
      return;
    }
    if (p.kind === "jam") {
      const text = p.real
        ? "Desk, time-late: GPS interference yesterday is confirmed from plots and ships that dropped off AIS."
        : "Desk: yesterday's AIS complaints were a fault on one terminal, not strait-wide interference.";
      items.push({ day: p.resolveDay, conf: "confirmed", kicker: "Desk", text });
      return;
    }
    if (p.kind === "navaid") {
      if (p.real) {
        state.mine.north = clamp(state.mine.north + 5, 4, 95);
        state.mine.south = clamp(state.mine.south + 5, 4, 95);
        items.push({
          day: p.resolveDay,
          conf: "confirmed",
          kicker: "Desk",
          text: "Desk confirms a navigation aid on the Omani side is out. Traffic will bunch until it is restored. Both lanes are a notch more dangerous today, whether or not your picture has caught it.",
        });
      } else {
        items.push({
          day: p.resolveDay,
          conf: "confirmed",
          kicker: "Desk",
          text: "Desk: the report of an attack on an Omani navigation aid is not confirmed. The aid is on the air.",
        });
      }
      return;
    }
    if (p.kind === "piracy") {
      const spent = state.history.some((h) => h.day === p.createdDay && h.orders.mpa.goa > 0);
      const real = p.real;
      let text;
      if (real && spent) {
        text =
          "Gulf of Aden: a merchant reported a suspicious approach. No boarding. Your patrol was down there and not over the strait. The approach changed nothing in Hormuz.";
      } else if (real) {
        text =
          "Gulf of Aden: a merchant reported a suspicious approach off the Yemeni coast. No boarding. It is not a strait event.";
      } else if (spent) {
        text =
          "The Gulf of Aden skiff report is not substantiated. You had maritime patrol down there. The strait picture was thinner for it.";
      } else {
        text = "The Gulf of Aden skiff report is not substantiated. It was a distraction. Nothing to add in the strait.";
      }
      items.push({ day: p.resolveDay, conf: "confirmed", kicker: "Desk", text });
    }
  }

  function queueMorning(state, dayFacts) {
    const nextDay = state.day + 1;
    if (nextDay > MODEL.days) {
      const finalItems = [];
      state.pending.forEach((p) => resolvePending(state, p, finalItems));
      state.pending = [];
      finalItems.forEach((item) => {
        item.day = MODEL.days;
        pushFeed(state, item);
      });
      state.morningPending = { items: [], jamming: false, jammingBelief: null };
      return;
    }
    const items = [];
    state.pending = state.pending.filter((p) => {
      if (p.resolveDay !== nextDay) return true;
      resolvePending(state, p, items);
      return false;
    });

    let nextJamming = false;
    let belief = null;
    const candidates = [];
    const queuedKind = (kind) => state.pending.some((p) => p.kind === kind) || candidates.some((c) => c.kind === kind);

    if (!queuedKind("jam") && state.rand() < 0.2) {
      const real = state.rand() < 0.72;
      const known = (dayFacts.isrStrait > 0 || dayFacts.mpaConvoy > 0) && !state.jamming;
      if (real && known) {
        candidates.push({
          priority: 0,
          conf: "confirmed",
          kind: "jam",
          commit() {
            nextJamming = true;
            belief = "confirmed";
          },
          item: {
            day: nextDay,
            conf: "confirmed",
            kicker: "Desk",
            text: "GPS and AIS interference is up in the strait this morning. Navigation and the air picture will be worse today. This is confirmed.",
          },
        });
      } else if (!known) {
        candidates.push({
          priority: real ? 1 : 2,
          conf: "unconfirmed",
          kind: "jam",
          commit() {
            if (real) {
              nextJamming = true;
              belief = "reported";
            }
            state.pending.push({ kind: "jam", real, createdDay: nextDay, resolveDay: nextDay + 1 });
          },
          item: {
            day: nextDay,
            conf: "unconfirmed",
            kicker: "Wire",
            text: real
              ? "Masters report AIS positions that do not match radar. It may be jamming. It may be a bad terminal. Not confirmed."
              : "One ship reports its AIS picture jumping. Cause not known. Not confirmed as strait-wide interference.",
          },
        });
      }
    }

    if (!queuedKind("mine") && state.rand() < 0.34) {
      const lane = state.rand() < 0.55 ? "north" : "south";
      const real = state.rand() < 0.42;
      const delay = state.rand() < 0.45 ? 2 : 1;
      candidates.push({
        priority: 1,
        conf: "unconfirmed",
        kind: "mine",
        commit() {
          if (real) state.mine[lane] = clamp(state.mine[lane] + 12, 0, 95);
          const claim = { kind: "mine", lane, real, createdDay: nextDay, resolveDay: nextDay + delay };
          state.pending.push(claim);
          state.claims.push(claim);
        },
        item: {
          day: nextDay,
          conf: "unconfirmed",
          kicker: "Claim",
          text:
            "Opposing channels claim mines against traffic in the " +
            laneName(lane) +
            " lane. No master report. Not confirmed. Your sweep picture, if you have one, does not include this claim until hunters or the desk catch up.",
        },
      });
    }

    if (!queuedKind("boom") && state.rand() < 0.2) {
      const realHit = dayFacts.hits > 0 && state.rand() < 0.55;
      const delay = state.rand() < 0.5 ? 2 : 1;
      candidates.push({
        priority: 2,
        conf: "unconfirmed",
        kind: "boom",
        commit() {
          state.pending.push({ kind: "boom", realHit, createdDay: nextDay, resolveDay: nextDay + delay });
        },
        item: {
          day: nextDay,
          conf: "unconfirmed",
          kicker: "Claim",
          text: "Opposing channels claim three tankers destroyed in the strait. Your own tally is the tally. This claim is not confirmed, and it is probably inflated.",
        },
      });
    }

    if (!queuedKind("dark") && state.rand() < 0.22) {
      const real = dayFacts.unescortedMisses > 0 && state.rand() < 0.6;
      candidates.push({
        priority: 2,
        conf: "unconfirmed",
        kind: "dark",
        commit() {
          state.pending.push({ kind: "dark", real, createdDay: nextDay, resolveDay: nextDay + 1 });
        },
        item: {
          day: nextDay,
          conf: "unconfirmed",
          kicker: "Wire",
          text: "A tanker has been silent on AIS for several hours. Ships go dark on purpose in this strait, and sometimes because they were hit. Not confirmed either way.",
        },
      });
    }

    if (!queuedKind("piracy") && state.rand() < 0.18) {
      const real = state.rand() < 0.35;
      candidates.push({
        priority: 3,
        conf: "unconfirmed",
        kind: "piracy",
        commit() {
          state.pending.push({ kind: "piracy", real, createdDay: nextDay, resolveDay: nextDay + 1 });
        },
        item: {
          day: nextDay,
          conf: "unconfirmed",
          kicker: "Wire",
          text: "Suspicious skiff reported in the Gulf of Aden, off the Yemeni coast, well south of this chart. Unconfirmed. It is not, by itself, a reason to pull patrol off the strait.",
        },
      });
    }

    if (!queuedKind("navaid") && state.rand() < 0.1) {
      const real = state.rand() < 0.5;
      const delay = state.rand() < 0.4 ? 2 : 1;
      candidates.push({
        priority: 2,
        conf: "unconfirmed",
        kind: "navaid",
        commit() {
          state.pending.push({ kind: "navaid", real, createdDay: nextDay, resolveDay: nextDay + delay });
        },
        item: {
          day: nextDay,
          conf: "unconfirmed",
          kicker: "Claim",
          text: "A report says a navigation aid on the Omani side of the strait was attacked. Not confirmed.",
        },
      });
    }

    candidates.sort((a, b) => a.priority - b.priority);
    let unconfirmedLeft = 2;
    candidates.forEach((c) => {
      if (c.conf === "unconfirmed") {
        if (unconfirmedLeft <= 0) return;
        unconfirmedLeft -= 1;
      }
      c.commit();
      items.push(c.item);
    });

    if (nextDay === 5) {
      items.push({
        day: 5,
        conf: "confirmed",
        kicker: "Desk",
        text: "Carrier extension is tomorrow. One escort and two CAP sorties will show up in reserve on day 6. Plan the handoff.",
      });
    }
    if (nextDay === MODEL.reinforceDay) {
      items.push({
        day: nextDay,
        conf: "confirmed",
        kicker: "Desk",
        text: "Carrier air wing extension is on station. One additional escort and two additional CAP sorties are in reserve until you assign them.",
      });
    }

    state.repair.forEach((r) => {
      if (!r.lost && r.backDay === nextDay) {
        items.push({
          day: nextDay,
          conf: "confirmed",
          kicker: "Desk",
          text:
            (r.type === "mcm" ? "A hunter" : "An escort") +
            " is back from repair and in reserve until you assign it.",
        });
      }
    });

    state.morningPending = { items, jamming: nextJamming, jammingBelief: belief };
  }

  function beginMorning(state) {
    if (state.complete) return [];
    if (state.phase !== "result") return [];
    const pending = state.morningPending || { items: [], jamming: false, jammingBelief: null };
    state.day += 1;
    if (state.day > MODEL.days) {
      state.complete = true;
      state.phase = "end";
      state.morningPending = null;
      return [];
    }
    pending.items.forEach((item) => pushFeed(state, item));
    state.jamming = !!pending.jamming;
    state.jammingBelief = pending.jammingBelief || null;
    state.morningPending = null;
    state.phase = "plan";
    return pending.items;
  }

  function badRoute(state, orders) {
    if (orders.route === "split") return false;
    const lane = orders.route;
    const other = otherLane(lane);
    const a = state.assess[lane];
    const b = state.assess[other];
    const bad = a && a.fresh && !a.coarse && (a.band === "HIGH" || a.band === "SEVERE");
    const good = b && b.fresh && !b.coarse && (b.band === "CLEAR" || b.band === "RESIDUAL");
    return !!(bad && good);
  }

  function resolveDay(state, rawOrders) {
    if (state.phase !== "plan") throw new Error("Not awaiting orders");
    if (state.complete) throw new Error("Watch is over");
    const orders = fitOrders(rawOrders, poolsFor(state));
    const lines = [];
    state._mineDelta = {};
    state.insurance = 1 + (state.insurance - 1) * 0.9;

    const arrivals = Math.max(
      8,
      Math.round(MODEL.baseShips * (1 + 0.08 * Math.sin(state.day / 3.5)) + (state.rand() * 8 - 4))
    );
    const will = willingness(state, orders);
    const slots = slotsFor(orders);
    const traffic = planTraffic(arrivals, state.queue, will, slots, orders.sail, state.insurance);

    if (badRoute(state, orders)) state.totals.badRouteDays += 1;
    state.totals[orders.pattern === "mass" ? "massDays" : orders.pattern === "dispersed" ? "dispersedDays" : "standardDays"] += 1;
    state.totals[orders.sail === "escort" ? "sailEscort" : orders.sail === "flow" ? "sailFlow" : "sailMixed"] += 1;
    if (orders.mpa.goa > 0) state.totals.goaDays += 1;

    const strike = applyStrikes(state, orders, lines);

    const groupSize = MODEL.perEscort[orders.pattern];
    const hits = [];
    let trafficNorth = 0;
    let trafficSouth = 0;

    function laneFor(i, count) {
      if (orders.route === "north") return "north";
      if (orders.route === "south") return "south";
      return i % 2 === 0 ? "south" : "north";
    }

    function runGroup(shipCount, escorted, indexBase) {
      const lane = laneFor(indexBase, shipCount);
      if (lane === "north") trafficNorth += shipCount;
      else trafficSouth += shipCount;
      const group = [];
      let found = false;
      for (let i = 0; i < shipCount; i++) {
        const pP = projectileChance(state, orders, lane, escorted, traffic.escorted);
        const pM = mineChance(state.mine[lane], escorted);
        const hitM = state.rand() < pM;
        const hitP = state.rand() < pP;
        let kind = null;
        if (hitM && hitP) kind = state.rand() < 0.45 ? "mine" : "projectile";
        else if (hitM) kind = "mine";
        else if (hitP) kind = "projectile";
        const ship = { lane, escorted, kind, splash: false };
        if (kind === "projectile") found = true;
        group.push(ship);
      }
      if (escorted && found) {
        const splash = splashChance(orders.pattern);
        group.forEach((ship) => {
          if (ship.kind) return;
          if (state.rand() < splash) {
            ship.kind = "projectile";
            ship.splash = true;
          }
        });
      }
      group.forEach((ship) => {
        if (!ship.kind) return;
        ship.weapon = pickWeapon(state, state.rand, ship.kind);
        Object.assign(ship, rollSeverity(state.rand, ship.weapon));
        hits.push(ship);
      });
      return { lane, n: shipCount, escorted, hits: group.filter((s) => s.kind).length };
    }

    const pictureGroups = [];
    let left = traffic.escorted;
    let gi = 0;
    while (left > 0) {
      const n = Math.min(groupSize, left);
      pictureGroups.push(runGroup(n, true, gi));
      left -= n;
      gi += 1;
    }
    for (let i = 0; i < traffic.bare; i++) {
      pictureGroups.push(runGroup(1, false, gi + i));
    }

    let delivered = traffic.escorted + traffic.bare;
    hits.forEach((h) => {
      if (!h.delivered) delivered -= 1;
      state.totals.hits += 1;
      if (h.escorted) state.totals.hitsEscorted += 1;
      else state.totals.hitsUnescorted += 1;
      state.totals[h.weapon] += 1;
      state.totals.injured += h.injured;
      state.totals.killed += h.killed;
      if (h.disabled) state.totals.disabled += 1;
      if (h.lost) state.totals.lost += 1;
      state.political = clamp(state.political + h.killed * 4 + (h.lost ? 3 : 0), 0, 100);
      if (h.lost) state.escalation = clamp(state.escalation + 7, 0, 100);
      else if (h.killed) state.escalation = clamp(state.escalation + 2, 0, 100);
    });

    const barrels = delivered * MODEL.bblPerShip;
    state.totals.arrivals += arrivals;
    state.totals.escorted += traffic.escorted;
    state.totals.unescorted += traffic.bare;
    state.totals.clear += traffic.escorted + traffic.bare - hits.length;
    state.totals.delivered += delivered;
    state.totals.barrels += barrels;
    state.totals.strikes += strike.packages;
    state.totals.blindStrikes += strike.blind;
    if (orders.strikeTarget === "fiac") state.totals.fiacStrikes += strike.packages;
    else state.totals.launchStrikes += strike.packages;
    state.totals.cancelled += traffic.cancelled;

    const own = rollOwnForce(state, orders, lines);
    state.totals.ownDamaged += own.damaged;
    state.totals.ownLost += own.lost;
    state.totals.ownInjured += own.injured;
    state.totals.ownKilled += own.killed;
    if (own.killed) state.political = clamp(state.political + 6, 0, 100);

    const gulf = gulfEvent(state, orders, lines);

    updateMines(state, orders, trafficNorth, trafficSouth);
    mcmLines(state, orders, lines);
    updateAssess(state, orders);

    if (hits.length >= 2) state.escalation = clamp(state.escalation + 1.2 + hits.length * 0.7, 0, 100);
    else if (hits.length === 1) state.escalation = clamp(state.escalation + 0.6, 0, 100);
    if (strike.packages === 0) {
      const decay = hits.length >= 2 ? 1 : 3;
      if (state.escalation > 12) state.escalation = Math.max(12, state.escalation - decay);
      state.political = clamp(state.political - 1.5, 0, 100);
    }
    regenThreat(state);

    state.insurance = clamp(state.insurance + hits.length * 0.05 + hits.filter((h) => h.lost).length * 0.12, 1, 2.5);

    state.queue = traffic.nextQueue;
    state.recentHits.push(hits.length);
    if (state.recentHits.length > 3) state.recentHits.shift();

    const mb = barrels / 1e6;
    lines.unshift({
      kind: "plain",
      text:
        arrivals +
        " ships came up for the day. " +
        traffic.ready +
        " were willing to sail. " +
        traffic.escorted +
        " escorted, " +
        traffic.bare +
        " unescorted, " +
        traffic.held +
        " held. " +
        delivered +
        " delivered cargo, " +
        mb.toFixed(2) +
        " million barrels. Illustrative.",
    });

    const shown = hits.slice(0, 5);
    shown.forEach((h) => lines.push({ kind: "bad", text: describeHit(h) }));
    if (hits.length > shown.length) {
      const rest = hits.slice(shown.length);
      const inj = rest.reduce((a, h) => a + h.injured, 0);
      const kil = rest.reduce((a, h) => a + h.killed, 0);
      lines.push({
        kind: "bad",
        text:
          rest.length +
          " further hits. " +
          inj +
          " injured, " +
          kil +
          " killed among them. Same rules: a hit ship delivers cargo only if it continued.",
      });
    }
    if (!hits.length && traffic.escorted + traffic.bare > 0) {
      lines.push({ kind: "plain", text: "No ship hit today. That is luck as well as the screen. Do not budget on a clean day." });
    }
    if (orders.cap.convoy >= Math.ceil(Math.max(traffic.escorted, 1) / 8) && !hits.some((h) => h.weapon === "drone")) {
      if (state.rand() < 0.28) {
        lines.push({
          kind: "plain",
          text: "Convoy CAP engaged a one-way drone short of the merchants. It did not reach a ship.",
        });
      }
    }
    if (traffic.cancelled > 0) {
      lines.push({
        kind: "warn",
        text:
          traffic.cancelled +
          " sailings cancelled by owners, mostly out of the Fujairah holding. Those barrels will not move this watch.",
      });
    }
    if (state.jamming) {
      lines.push({
        kind: "warn",
        text: "Interference made station-keeping and the air picture worse. The hit rolls for today include that.",
      });
    }

    const feedLines = lines.filter(
      (l) => l.kind === "bad" || l.kind === "warn" || (l.kind === "plain" && /Hunters/.test(l.text))
    );
    feedLines.forEach((l) => {
      pushFeed(state, {
        day: state.day,
        conf: "confirmed",
        kicker: "Desk",
        text: l.text,
      });
    });

    const record = {
      day: state.day,
      orders: clone(orders),
      arrivals,
      ready: traffic.ready,
      escorted: traffic.escorted,
      unescorted: traffic.bare,
      held: traffic.held,
      cancelled: traffic.cancelled,
      hits: hits.length,
      hitsEscorted: hits.filter((h) => h.escorted).length,
      hitsUnescorted: hits.filter((h) => !h.escorted).length,
      injured: hits.reduce((a, h) => a + h.injured, 0),
      killed: hits.reduce((a, h) => a + h.killed, 0),
      barrels,
      mb,
      escalation: state.escalation,
      political: state.political,
      insurance: state.insurance,
      mine: { north: state.mine.north, south: state.mine.south },
      queue: state.queue,
      gulf,
      strikes: strike.packages,
      blind: strike.blind,
    };
    state.history.push(record);
    if (gulf) state.totals.gulfEvents += 1;

    state.lastPicture = {
      groups: pictureGroups.map((g) => ({ lane: g.lane, n: g.n, escorted: g.escorted, hits: g.hits })),
      queue: state.queue,
      claims: openMineLanes(state),
    };

    queueMorning(state, {
      hits: hits.length,
      unescortedMisses: hits.filter((h) => !h.escorted).length,
      isrStrait: orders.isr.strait,
      mpaConvoy: orders.mpa.convoy,
    });

    const done = state.day >= MODEL.days;
    state.phase = "result";
    if (done) state.complete = true;

    return {
      day: record.day,
      date: formatDate(record.day),
      lines,
      picture: state.lastPicture,
      done,
      mb,
      hits: hits.length,
      escorted: traffic.escorted,
      unescorted: traffic.bare,
      delivered,
      barrels,
      injured: record.injured,
      killed: record.killed,
    };
  }

  function preview(state, rawOrders) {
    const orders = fitOrders(rawOrders, poolsFor(state));
    const arrivals = expectedArrivals(state.day);
    const will = willingness(state, orders);
    const slots = slotsFor(orders);
    const traffic = planTraffic(arrivals, state.queue, will, slots, orders.sail, state.insurance);
    const per = MODEL.perEscort[orders.pattern];
    const fx = strikeOutlook(state, orders);
    const view = Object.assign({}, state, {
      drone: fx.drone,
      missile: fx.missile,
      fiac: fx.fiac,
      escalation: fx.escalation,
    });

    function laneShare(lane) {
      if (orders.route === lane) return 1;
      if (orders.route === "split") return 0.5;
      return 0;
    }

    function expectedHits(forceJam) {
      const opts = forceJam ? { forceJam: true } : { forceNoJam: true };
      let exp = 0;
      ["north", "south"].forEach((lane) => {
        const share = laneShare(lane);
        const eShips = traffic.escorted * share;
        const uShips = traffic.bare * share;
        const groups = eShips > 0 ? Math.ceil(eShips / per) : 0;
        const pE = eShips ? projectileChance(view, orders, lane, true, traffic.escorted, opts) : 0;
        const known = knownMineThreat(state, lane);
        const mE = known == null ? null : mineChance(known, true);
        const mU = known == null ? null : mineChance(known, false);
        const pU = uShips ? projectileChance(view, orders, lane, false, traffic.escorted, opts) : 0;
        if (mE == null) {
          exp += eShips * pE + uShips * pU;
        } else {
          const primaryE = 1 - (1 - pE) * (1 - mE);
          exp += eShips * primaryE + uShips * (1 - (1 - pU) * (1 - mU));
          if (groups && orders.pattern !== "dispersed") {
            const splash = splashChance(orders.pattern);
            const pGroup = 1 - Math.pow(1 - pE, Math.min(per, eShips));
            exp += groups * pGroup * Math.max(0, Math.min(per, eShips) - 1) * splash * 0.5;
          }
        }
      });
      return exp;
    }

    const mineKnown = {};
    ["north", "south"].forEach((lane) => {
      mineKnown[lane] = knownMineThreat(state, lane);
    });

    const claim = state.pending.find((p) => p.kind === "mine");
    const pEsc = {};
    const pBare = {};
    ["north", "south"].forEach((lane) => {
      const opts = state.jammingBelief === "confirmed" ? { forceJam: true } : { forceNoJam: true };
      pEsc[lane] = projectileChance(view, orders, lane, true, Math.max(traffic.escorted, 1), opts);
      pBare[lane] = projectileChance(view, orders, lane, false, Math.max(traffic.escorted, 1), opts);
    });

    let expHits = expectedHits(false);
    let expHitsIfJam = expectedHits(true);
    if (state.jammingBelief === "confirmed") expHits = expHitsIfJam;

    const roughClear = Math.max(0, traffic.escorted + traffic.bare - expHits);
    return {
      orders,
      arrivalsMid: arrivals,
      will,
      slots,
      per,
      ready: traffic.ready,
      escorted: traffic.escorted,
      bare: traffic.bare,
      held: traffic.held,
      queueAfter: traffic.nextQueue,
      pEsc,
      pBare,
      mineKnown,
      claim: claim ? { lane: claim.lane } : null,
      jammingBelief: state.jammingBelief,
      expHits,
      expHitsIfJam,
      expMb: (roughClear * MODEL.bblPerShip) / 1e6,
      badRoute: badRoute(state, orders),
      pools: poolsFor(state),
    };
  }

  function gradeWatch(state) {
    const t = state.totals;
    const days = state.history.length || 1;
    const avg = t.barrels / 1e6 / days;
    const transits = t.escorted + t.unescorted;
    const hitRate = transits ? t.hits / transits : 0;
    const peak = state.history.reduce((m, h) => Math.max(m, h.escalation), state.escalation);
    const endMine = state.history.length ? state.history[state.history.length - 1].mine : state.mine;
    const mineAvg = (endMine.north + endMine.south) / 2;
    const reasons = [];
    let score = 4;

    if (avg < 12.4) {
      score -= 1;
      reasons.push("Flow finished clearly under the 13 to 14 million barrel band.");
    }
    if (avg < 10.8) {
      score -= 1;
      reasons.push("Too much oil sat still. Holding ships is sometimes right. A watch of it is not.");
    }
    if (hitRate > 0.021) {
      score -= 1;
      reasons.push("Ships were hit too often for the traffic that sailed.");
    }
    if (hitRate > 0.035) {
      score -= 1;
      reasons.push("The hit rate was up with the unescorted baseline. The screen was not doing its job, or too many ships sailed bare.");
    }
    if (t.killed >= 4) {
      score -= 1;
      reasons.push("Crew deaths got past what a tight escort watch should accept.");
    }
    if (peak >= 62) {
      score -= 1;
      reasons.push("Escalation ran hot. Partners and owners both felt it.");
    }
    if (peak >= 85) {
      score -= 1;
      reasons.push("The exchange widened and stayed wide.");
    }
    if (mineAvg >= 60) {
      score -= 1;
      reasons.push("You left the lanes heavily mined.");
    }
    if (t.blindStrikes >= 3) {
      score -= 1;
      reasons.push("Strike packages went out without a current picture of the launch areas.");
    }
    if (t.falseChases >= 2) {
      score -= 1;
      reasons.push("Hunters were pulled off a whole lane for mine claims the desk later did not substantiate.");
    }
    if (t.ownLost > 0) {
      score -= 1;
      reasons.push("You lost one of your own ships.");
    }
    if (t.badRouteDays >= 3) {
      score -= 1;
      reasons.push("Traffic was sent down a lane your own fresh sweep called dangerous, with a cleaner lane open.");
    }

    const clean =
      avg >= 12.8 &&
      avg <= 15.2 &&
      hitRate <= 0.022 &&
      peak <= 48 &&
      mineAvg <= 46 &&
      t.blindStrikes === 0 &&
      t.killed <= 1 &&
      t.ownLost === 0 &&
      t.falseChases === 0;
    if (clean) score = Math.max(score, 4);
    if (score === 4 && !clean) score = 3;
    score = clamp(score, 0, 4);
    const letters = ["F", "D", "C", "B", "A"];
    const titles = [
      "Failed the watch",
      "Poor",
      "Flawed",
      "Acceptable, with reservations",
      "The watch held",
    ];
    return {
      letter: letters[score],
      title: titles[score],
      score,
      reasons,
      avg,
      hitRate,
      peak,
      mineAvg,
      transits,
    };
  }

  function aar(state) {
    const t = state.totals;
    const g = gradeWatch(state);
    const days = state.history.length;
    const transits = t.escorted + t.unescorted;
    const escShare = transits ? t.escorted / transits : 0;
    const avg = g.avg;
    const paras = [];

    paras.push(
      "Over " +
        days +
        " days you delivered " +
        (t.barrels / 1e6).toFixed(1) +
        " million barrels, " +
        avg.toFixed(2) +
        " million a day. The public band this watch uses is 13 to 14. The lab sketch that sits under the hit rates is illustrative, not a forecast, and a simpler 14-day draw in that sketch (generous escort slots, no mines, no owner panic) averaged about 13.6. Your number is a game result on the same order of magnitude. It is not an official flow."
    );

    const unescHitShare = t.hits ? Math.round((t.hitsUnescorted / t.hits) * 100) : 0;
    paras.push(
      transits +
        " transits sailed, " +
        Math.round(escShare * 100) +
        "% of them escorted. " +
        t.hits +
        " merchants were hit (" +
        t.hitsEscorted +
        " escorted, " +
        t.hitsUnescorted +
        " unescorted). " +
        (t.hits ? unescHitShare + "% of hits fell on unescorted ships. " : "No hits. Do not expect that twice. ") +
        "The untouched baselines in this game are 5.5% a transit unescorted and 1.2% escorted, before air cover, mines, density, and escalation. " +
        t.disabled +
        " ships were disabled or diverted without delivery, " +
        t.lost +
        " lost. Merchant crew: " +
        t.injured +
        " injured, " +
        t.killed +
        " killed. Your own force: " +
        t.ownDamaged +
        " ships out for repair, " +
        t.ownLost +
        " lost, " +
        t.ownInjured +
        " injured, " +
        t.ownKilled +
        " killed."
    );

    paras.push(
      "Convoy pattern: massed " +
        t.massDays +
        " days, standard " +
        t.standardDays +
        ", small groups " +
        t.dispersedDays +
        ". Sail authority: escort-only " +
        t.sailEscort +
        ", mixed " +
        t.sailMixed +
        ", flow-first " +
        t.sailFlow +
        ". Massed groups cover more ships with the same escorts and take follow-on hits when a group is found. Flow-first puts uncovered owners into the 5.5% world. Escort-only keeps them at Fujairah, and some of them cancel."
    );

    paras.push(
      "Strike packages: " +
        t.strikes +
        " (" +
        t.launchStrikes +
        " at launch sites, " +
        t.fiacStrikes +
        " at fast-attack bases). " +
        t.blindStrikes +
        " of them went without a launch-area ISR picture. Peak escalation " +
        Math.round(g.peak) +
        ", ending at " +
        Math.round(state.escalation) +
        ". Political cost ended at " +
        Math.round(state.political) +
        ". Gulf partners came under drone attack on " +
        t.gulfEvents +
        " day" +
        (t.gulfEvents === 1 ? "" : "s") +
        ". Strikes knock drone and missile trouble down for a short stretch. The crews reconstitute. The escalation number does not come down as fast, and it shows up as retaliation, insurance, and owners who stay alongside."
    );

    const endMine = state.history.length ? state.history[state.history.length - 1].mine : state.mine;
    paras.push(
      "Ending mine picture, truth, not what you last saw: northern lane " +
        bandOf(endMine.north).toLowerCase() +
        ", southern lane " +
        bandOf(endMine.south).toLowerCase() +
        ". Of " +
        (t.trueClaims + t.falseClaims) +
        " mine claims, " +
        t.trueClaims +
        " were later confirmed and " +
        t.falseClaims +
        " were not. You emptied the other lane for a claim that did not hold on " +
        t.falseChases +
        " occasion" +
        (t.falseChases === 1 ? "" : "s") +
        ". Maritime patrol went to the Gulf of Aden on " +
        t.goaDays +
        " day" +
        (t.goaDays === 1 ? "" : "s") +
        ". Insurance index finished at " +
        state.insurance.toFixed(2) +
        " against a watch baseline of 1.00. Owners cancelled " +
        t.cancelled +
        " sailings. " +
        state.queue +
        " ships were still holding at the end."
    );

    if (!g.reasons.length) {
      paras.push(
        "Nothing in the grade rules moved you off a clean watch. Oil moved near the band, the hit rate stayed near the escorted world, escalation stayed in bounds, and you did not chase rumours with the whole hunting force. That is the job."
      );
    } else {
      paras.push("What moved the grade: " + g.reasons.join(" "));
    }

    if (avg >= 12.8 && g.hitRate <= 0.025 && g.peak < 50) {
      paras.push("You kept the tankers moving without letting the war sprawl. Hold that standard.");
    } else if (avg >= 12.8 && g.peak >= 62) {
      paras.push(
        "The barrels got through and the campaign got bigger. Drones at Bahrain and a rising insurance index are part of the cost of the strikes, even when the targets were military."
      );
    } else if (avg < 12.4 && g.hitRate <= 0.02) {
      paras.push(
        "You protected ships by holding them back. The oil did not move at the pace the watch was written against. A queue at Fujairah is a kind of failure if it becomes the plan."
      );
    } else if (g.hitRate > 0.03 && t.unescorted > transits * 0.15) {
      paras.push(
        "Look at the unescorted share before you look at anything else. Those ships carry several times the hit rate. If you needed the barrels, you needed escorts on them, or you needed fewer of them to sail."
      );
    } else {
      paras.push(
        "Read the days, not the letter. The letter is a summary of flow, hits, escalation, mines, and whether you acted on rumours."
      );
    }

    return {
      letter: g.letter,
      title: g.title,
      paragraphs: paras,
      reasons: g.reasons,
      avg,
      hitRate: g.hitRate,
      peak: g.peak,
    };
  }

  function restore(raw) {
    const state = raw;
    if (!state.totals) state.totals = emptyTotals();
    attachRng(state);
    return state;
  }

  return {
    MODEL,
    createCampaign,
    resolveDay,
    beginMorning,
    preview,
    poolsFor,
    fitOrders,
    suggestedOrders,
    aar,
    gradeWatch,
    formatDate,
    bandOf,
    attachRng,
    restore,
    projectileChance,
    mineChance,
    clearAmount,
    willingness,
  };
});
