// ==============================
  // PERFORMANCE + STABILITY UPGRADE
  // - Fetch timeouts + abort
  // - Cache (TTL)
  // - OSM optimized: viewport bbox + debounce + abort + cache + zoom threshold
  // - OSM clustering (no extra libs)
  // - Clip all point layers to the MAIN Island of Cuba
  // - Diagnostics shows whether each API is engaged (live/offline/fallback/cache)
  // ==============================

  const SERVICES = {
    cuba: "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/World_Countries_(Generalized)/FeatureServer/0",
    hurricanesObservedPosition: "https://services9.arcgis.com/RHVPKKiFTONKtxq3/ArcGIS/rest/services/Active_Hurricanes_v1/FeatureServer/1",
    hurricanesObservedTrack: "https://services9.arcgis.com/RHVPKKiFTONKtxq3/ArcGIS/rest/services/Active_Hurricanes_v1/FeatureServer/3",
    landslides: "https://maps.nccs.nasa.gov/mapping/rest/services/landslide_viewer/Landslide_Points/FeatureServer/0",
    floodApiBase: "https://flood-api.open-meteo.com/v1/flood",
    overpass: "https://overpass-api.de/api/interpreter"
  };

  // FastAPI proxy (CORS-safe). Server exposes /proxy?url=
  function proxied(url){
    return `/proxy?url=${encodeURIComponent(url)}`;
  }

  function maybeProxy(url){
    if(!url) return url;
    if(url.startsWith('/proxy')) return url;
    if(url.startsWith('http://') || url.startsWith('https://')) return proxied(url);
    return url;
  }


  const FLOOD_SITES = [
    { id: "HAV", name: "Havana", lat: 23.1136, lon: -82.3666 },
    { id: "SCU", name: "Santiago de Cuba", lat: 20.0208, lon: -75.8294 },
    { id: "CAM", name: "Camagüey", lat: 21.3808, lon: -77.9169 },
    { id: "HOG", name: "Holguín", lat: 20.8872, lon: -76.2631 },
    { id: "CFG", name: "Cienfuegos", lat: 22.1461, lon: -80.4356 }
  };

  const METRICS_BASE = {
    forecast: { rain_mm_24h: 120, rain_mm_72h: 180 },
    anomaly:  { rain_mm_14d: 90 },
    met:      { heat_index_c_max: 39, heat_index_days_ge_41: 0, night_temp_c_min: 26 },
    storm:    { hours_to_impact: 60, max_wind_kt_local: 55 }
  };

  const RULES = [
    {
      id: "flood_local",
      title: "Flood (Precip – heuristic)",
      evidence: ["forecast.rain_mm_24h", "forecast.rain_mm_72h", "anomaly.rain_mm_14d"],
      thresholds: [
        { severity: "critical", test: m => (m.forecast?.rain_mm_24h ?? 0) >= 150 || ((m.forecast?.rain_mm_24h ?? 0) >= 100 && (m.anomaly?.rain_mm_14d ?? 0) >= 75) },
        { severity: "warning",  test: m => (m.forecast?.rain_mm_24h ?? 0) >= 100 || (m.forecast?.rain_mm_72h ?? 0) >= 150 },
        { severity: "watch",    test: m => (m.forecast?.rain_mm_24h ?? 0) >= 50 }
      ]
    },
    {
      id: "flood_live",
      title: "Flood (Rivers – live)",
      evidence: ["flood_live.max_ratio_p75", "flood_live.site_max"],
      thresholds: [
        { severity: "critical", test: m => (m.flood_live?.max_ratio_p75 ?? 0) >= 1.5 },
        { severity: "warning",  test: m => (m.flood_live?.max_ratio_p75 ?? 0) >= 1.1 },
        { severity: "watch",    test: m => (m.flood_live?.max_ratio_p75 ?? 0) >= 0.9 }
      ]
    }
  ];

  const FALLBACK = {
    cuba: {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: { COUNTRY: "Cuba", _fallback: true },
        geometry: { type: "Polygon", coordinates: [[[ -84.95,19.85],[-74.10,19.85],[-74.10,23.45],[-84.95,23.45],[-84.95,19.85 ]]] }
      }]
    },
    hurricanesObservedPosition: {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { STORMNAME: "Sample Storm A", DTG: Date.now(), MSLP: 995, INTENSITY: 55, SS: 1, STORMTYPE: "HU", BASIN: "AL", STORMID: "SAMPLE_A", _fallback: true }, geometry: { type: "Point", coordinates: [-82.4, 22.9] } },
        { type: "Feature", properties: { STORMNAME: "Sample Storm B", DTG: Date.now(), MSLP: 1006, INTENSITY: 40, SS: 0, STORMTYPE: "TS", BASIN: "AL", STORMID: "SAMPLE_B", _fallback: true }, geometry: { type: "Point", coordinates: [-77.8, 20.8] } }
      ]
    },
    hurricanesObservedTrack: {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { STORMNAME: "Sample Storm A", STORMID: "SAMPLE_A", _fallback: true }, geometry: { type: "LineString", coordinates: [[-83.1, 22.2], [-82.7, 22.6], [-82.4, 22.9]] } },
        { type: "Feature", properties: { STORMNAME: "Sample Storm B", STORMID: "SAMPLE_B", _fallback: true }, geometry: { type: "LineString", coordinates: [[-78.6, 20.3], [-78.1, 20.6], [-77.8, 20.8]] } }
      ]
    },
    landslides: {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { event_date: "2025-09-10", country: "Cuba", trigger: "rain", fatalities: 0, _fallback: true }, geometry: { type: "Point", coordinates: [-76.0, 20.2] } },
        { type: "Feature", properties: { event_date: "2025-05-22", country: "Cuba", trigger: "rain", fatalities: 1, _fallback: true }, geometry: { type: "Point", coordinates: [-79.9, 22.4] } }
      ]
    },
    osmAssets: {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { kind: "hospital", name: "Hospital (sample)", operator: "", addr: "", osm_type: "node", osm_id: 1, _fallback: true }, geometry: { type: "Point", coordinates: [-82.381, 23.135] } },
        { type: "Feature", properties: { kind: "school", name: "School (sample)", operator: "", addr: "", osm_type: "node", osm_id: 2, _fallback: true }, geometry: { type: "Point", coordinates: [-79.965, 22.408] } }
      ]
    },
    floodSites: {
      type: "FeatureCollection",
      features: FLOOD_SITES.map((s, i) => ({
        type: "Feature",
        properties: {
          id: s.id,
          name: s.name,
          severity: i === 0 ? "warning" : (i === 1 ? "watch" : "critical"),
          ratio_p75: i === 0 ? 1.15 : (i === 1 ? 0.95 : 1.7),
          day: new Date().toISOString().slice(0,10),
          discharge_max: i === 2 ? 1800 : 900,
          discharge_p75: i === 2 ? 1000 : 850,
          url: "—",
          _fallback: true
        },
        geometry: { type: "Point", coordinates: [s.lon, s.lat] }
      }))
    }
  };

  const $ = (id) => document.getElementById(id);

  function safeErr(e){ return (e && (e.message || String(e))) || "Unknown error"; }
  function safeText(v){ if(v===null||v===undefined||v==="") return "—"; return String(v).replace(/[&<>]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }
  function fmtMaybeNumber(v,d=0){ const n=Number(v); return Number.isFinite(n)?n.toFixed(d):(v??"—"); }

  // --- geometry helpers (main Island of Cuba mask) ---
  let islandMask = null; // GeoJSON Polygon (largest part of Cuba multipolygon)

  function ringArea(coords){
    let a = 0;
    for (let i=0;i<coords.length;i++){
      const [x1,y1] = coords[i];
      const [x2,y2] = coords[(i+1)%coords.length];
      a += (x1*y2 - x2*y1);
    }
    return Math.abs(a/2);
  }

  function polygonArea(poly){
    if(!Array.isArray(poly) || poly.length===0) return 0;
    let a = ringArea(poly[0]);
    for (let i=1;i<poly.length;i++) a -= ringArea(poly[i]);
    return Math.max(0, a);
  }

  function extractMainIsland(cubaGeoJSON){
    const feats = cubaGeoJSON?.features || [];
    if(!feats.length) return null;
    const g = feats[0]?.geometry;
    if(!g) return null;
    if(g.type === "Polygon") return g;
    if(g.type === "MultiPolygon"){
      let best = null, bestA = -1;
      for (const poly of g.coordinates){
        const a = polygonArea(poly);
        if (a > bestA){ bestA = a; best = poly; }
      }
      return best ? { type:"Polygon", coordinates: best } : null;
    }
    return null;
  }

  function pointInRing(pt, ring){
    const x = pt[0], y = pt[1];
    let inside = false;
    for (let i=0, j=ring.length-1; i<ring.length; j=i++){
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersect = ((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi+0.0) + xi);
      if(intersect) inside = !inside;
    }
    return inside;
  }

  function pointInPolygon(pt, polygon){
    const rings = polygon?.coordinates;
    if(!rings || !rings.length) return false;
    if(!pointInRing(pt, rings[0])) return false;
    for (let i=1;i<rings.length;i++) if(pointInRing(pt, rings[i])) return false;
    return true;
  }

  function filterFeatureCollectionToIsland(fc, mask){
    if(!mask || !fc || fc.type !== "FeatureCollection") return fc;
    const out = [];
    for (const f of (fc.features||[])){
      const g = f.geometry;
      if(!g) continue;
      if(g.type === "Point"){
        if(pointInPolygon(g.coordinates, mask)) out.push(f);
      } else if (g.type === "LineString"){
        const coords = g.coordinates || [];
        if(coords.some(pt => pointInPolygon(pt, mask))) out.push(f);
      } else {
        out.push(f);
      }
    }
    return { type:"FeatureCollection", features: out };
  }

  // --- fetch utilities ---
  const CACHE_TTL_MS = 2 * 60 * 1000; // 2 min
  const cache = new Map(); // url -> {ts,data}

  function cacheGet(url){
    const v = cache.get(url);
    if(!v) return null;
    if(Date.now() - v.ts > CACHE_TTL_MS){ cache.delete(url); return null; }
    return v.data;
  }

  function cachePut(url, data){ cache.set(url, { ts: Date.now(), data }); }

  async function fetchJSON(url, { timeoutMs=12000, signal=null, method="GET", headers={}, body=null } = {}){
    const ctrl = new AbortController();
    const timer = setTimeout(()=>ctrl.abort(), timeoutMs);

    const combinedSignal = (signal && typeof AbortSignal !== "undefined" && AbortSignal.any)
      ? AbortSignal.any([ctrl.signal, signal])
      : (signal || ctrl.signal);

    try{
      const r = await fetch(maybeProxy(url), {
        method,
        headers: { "Accept":"application/json", ...headers },
        body,
        signal: combinedSignal
      });
      if(!r.ok) throw new Error(r.status + " " + r.statusText);
      return await r.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function getJSONCached(url, timeoutMs=12000){
    const cached = cacheGet(url);
    if(cached) return cached;
    const data = await fetchJSON(url, { timeoutMs });
    cachePut(url, data);
    return data;
  }

  function featureQueryGeoJSON(layerUrl, where="1=1", outFields="*"){
    const u = new URL(layerUrl.replace(/\/+$/, "") + "/query");
    u.searchParams.set("where", where);
    u.searchParams.set("outFields", outFields);
    u.searchParams.set("outSR", "4326");
    u.searchParams.set("returnGeometry", "true");
    u.searchParams.set("f", "geojson");
    const out = u.toString();
    return maybeProxy(out);
  }

  async function getWithFallback(url, fallbackFC){
    const offline = $("offline").checked;
    if (offline) return { data: fallbackFC, mode: "offline" };
    try { return { data: await getJSONCached(url), mode: "live" }; }
    catch (e) { return { data: fallbackFC, mode: "fallback", error: safeErr(e) }; }
  }

  // --- Alerts ---
  function buildAlerts(metrics){
    const out=[];
    for(const r of RULES){
      let sev=null;
      for(const t of r.thresholds){ if(t.test(metrics)){ sev=t.severity; break; } }
      if(sev) out.push({ id:r.id, title:r.title, severity:sev, evidence:r.evidence });
    }
    const rank={critical:0, warning:1, watch:2};
    out.sort((a,b)=>rank[a.severity]-rank[b.severity]);
    return out;
  }

  function renderAlerts(alerts){
    const wrap=$("alerts");
    wrap.innerHTML = alerts.length ? "" : "<div class='small'>No triggers fired.</div>";
    for(const a of alerts){
      wrap.insertAdjacentHTML("beforeend", `<div style="margin:8px 0;"><span class="badge ${a.severity}">${a.severity.toUpperCase()}</span><b style="margin-left:8px;">${a.title}</b></div>`);
    }
    const ev=$("evidence");
    ev.innerHTML="";
    const uniq=new Set();
    alerts.forEach(x=>x.evidence.forEach(e=>uniq.add(e)));
    [...uniq].forEach(e=>ev.insertAdjacentHTML("beforeend", `<li class='small'>${e}</li>`));
  }

  function layerMeta(label, mode, err){
    if(mode==="live") return `<span class='pill ok'>✅ ${label}: live</span>`;
    if(mode==="offline") return `<span class='pill warn2'>🟡 ${label}: offline</span>`;
    return `<span class='pill bad'>🔻 ${label}: fallback</span><span class='small muted'> ${err?"("+safeText(err)+")":""}</span>`;
  }

  // --- Flood ---
  function floodApiURL(site){
    const u=new URL(SERVICES.floodApiBase);
    u.searchParams.set("latitude", String(site.lat));
    u.searchParams.set("longitude", String(site.lon));
    u.searchParams.set("daily", "river_discharge,river_discharge_p75,river_discharge_max");
    u.searchParams.set("forecast_days", "7");
    u.searchParams.set("past_days", "0");
    u.searchParams.set("timeformat", "iso8601");
    const out = u.toString();
    return maybeProxy(out);
  }

  function floodSeverityFromRatio(r){
    const n=Number(r);
    if(!Number.isFinite(n)) return "watch";
    if(n>=1.5) return "critical";
    if(n>=1.1) return "warning";
    if(n>=0.9) return "watch";
    return "watch";
  }

  function floodColorBySeverity(sev){
    if(sev==="critical") return "rgba(255,91,110,0.95)";
    if(sev==="warning") return "rgba(255,155,61,0.95)";
    return "rgba(255,204,102,0.95)";
  }

  function floodPopupHTML(p){
    const url = safeText(p?.url);
    return `
      <div style="min-width:260px">
        <div style="font-weight:800; font-size:14px; margin-bottom:6px">${safeText(p?.name||"Flood Site")}</div>
        <div style="font-size:12px; color:#555; margin-bottom:8px">Flood signal (GloFAS via Open-Meteo)</div>
        <table style="width:100%; border-collapse:collapse; font-size:12px">
          <tr><td style="padding:4px 6px; color:#666; width:46%">Severity</td><td style="padding:4px 6px; font-weight:700">${safeText(p?.severity||"watch").toUpperCase()}</td></tr>
          <tr><td style="padding:4px 6px; color:#666; width:46%">Worst day</td><td style="padding:4px 6px; font-weight:600">${safeText(p?.day)}</td></tr>
          <tr><td style="padding:4px 6px; color:#666; width:46%">Max / P75</td><td style="padding:4px 6px; font-weight:600">${fmtMaybeNumber(p?.ratio_p75,2)}</td></tr>
          <tr><td style="padding:4px 6px; color:#666; width:46%">Discharge max</td><td style="padding:4px 6px; font-weight:600">${fmtMaybeNumber(p?.discharge_max,0)}</td></tr>
          <tr><td style="padding:4px 6px; color:#666; width:46%">Discharge P75</td><td style="padding:4px 6px; font-weight:600">${fmtMaybeNumber(p?.discharge_p75,0)}</td></tr>
        </table>
        ${url && url !== "—" ? `<div style="margin-top:8px; font-size:12px"><a href="${url}" target="_blank" rel="noreferrer">Open flood API query</a></div>` : ""}
      </div>
    `;
  }

  function floodFeatureCollectionFromDetails(details){
    return {
      type:"FeatureCollection",
      features: details.map(d=>({
        type:"Feature",
        properties:{
          id:d.id,
          name:d.site,
          severity:d.severity,
          ratio_p75:d.ratio_p75,
          day:d.day,
          discharge_max:d.discharge_max,
          discharge_p75:d.discharge_p75,
          url:d.url
        },
        geometry:{ type:"Point", coordinates:[d.lon,d.lat] }
      }))
    };
  }

  async function loadLiveFloodSignals(){
    const offline=$("offline").checked;
    if(offline) return { mode:"offline" };

    const details=[];
    await Promise.all(FLOOD_SITES.map(async (s) => {
      const url = floodApiURL(s);
      try {
        const j = await getJSONCached(url, 12000);
        const dm=j?.daily?.river_discharge_max;
        const p75=j?.daily?.river_discharge_p75;
        const time=j?.daily?.time;
        if(!Array.isArray(dm)||!Array.isArray(p75)||dm.length===0||p75.length===0) return;

        const n=Math.min(3, dm.length, p75.length);
        let maxRatio=0, maxDay="—", maxVal=-Infinity, maxP75=-Infinity;
        for(let i=0;i<n;i++){
          const a=Number(dm[i]), b=Number(p75[i]);
          if(!Number.isFinite(a)||!Number.isFinite(b)||b<=0) continue;
          const r=a/b;
          if(r>maxRatio){ maxRatio=r; maxDay=time?.[i]||"—"; maxVal=a; maxP75=b; }
        }
        details.push({ id:s.id, site:s.name, lat:s.lat, lon:s.lon, day:maxDay, discharge_max:maxVal, discharge_p75:maxP75, ratio_p75:maxRatio, severity:floodSeverityFromRatio(maxRatio), url });
      } catch {}
    }));

    if(details.length===0) return { mode:"fallback", error:"No flood data returned" };
    details.sort((a,b)=>(b.ratio_p75||0)-(a.ratio_p75||0));
    return { mode:"live", max_ratio_p75: details[0].ratio_p75, site_max: `${details[0].site} (${details[0].day})`, details };
  }

  // --- OSM optimized (viewport bbox) ---
  const OSM_MIN_ZOOM = 7;
  const OSM_DEBOUNCE_MS = 450;
  const OSM_CACHE_MAX = 15;
  const OSM_MAX_FEATURES_RENDER = 2500;

  let osmAbort = null;
  let osmDebounceTimer = null;
  let osmLastKey = "";
  const osmCache = new Map(); // key -> FeatureCollection

  function bboxKey(bounds){
    return `${bounds.getSouth().toFixed(3)},${bounds.getWest().toFixed(3)},${bounds.getNorth().toFixed(3)},${bounds.getEast().toFixed(3)}`;
  }

  function overpassQLForBBoxAssets(bounds){
    const s = bounds.getSouth();
    const w = bounds.getWest();
    const n = bounds.getNorth();
    const e = bounds.getEast();
    return `
[out:json][timeout:25];
(
  nwr["amenity"="hospital"](${s},${w},${n},${e});
  nwr["amenity"="school"](${s},${w},${n},${e});
);
out center tags;
`;
  }

  function osmToFeatureCollection(osm){
    const els=osm?.elements;
    if(!Array.isArray(els)) return { type:"FeatureCollection", features:[] };
    const feats=[];
    for(const el of els){
      const tags=el.tags||{};
      const kind=tags.amenity;
      if(kind!=="hospital" && kind!=="school") continue;
      const lat=(typeof el.lat==="number")?el.lat:el.center?.lat;
      const lon=(typeof el.lon==="number")?el.lon:el.center?.lon;
      if(typeof lat!=="number"||typeof lon!=="number") continue;

      feats.push({
        type:"Feature",
        properties:{
          kind,
          name: tags.name || tags["name:en"] || tags.operator || kind,
          operator: tags.operator || "",
          phone: tags.phone || tags["contact:phone"] || "",
          website: tags.website || tags["contact:website"] || "",
          email: tags.email || tags["contact:email"] || "",
          opening_hours: tags.opening_hours || "",
          healthcare: tags.healthcare || tags["healthcare:speciality"] || "",
          emergency: tags.emergency || "",
          wheelchair: tags.wheelchair || "",
          addr: [tags["addr:street"],tags["addr:housenumber"],tags["addr:city"],tags["addr:postcode"]].filter(Boolean).join(" "),
          osm_type: el.type,
          osm_id: el.id
        },
        geometry:{ type:"Point", coordinates:[lon,lat] }
      });
      if (feats.length >= OSM_MAX_FEATURES_RENDER) break;
    }
    return { type:"FeatureCollection", features:feats };
  }

  function osmCachePut(key, fc){
    osmCache.set(key, fc);
    while(osmCache.size > OSM_CACHE_MAX){
      const first = osmCache.keys().next().value;
      osmCache.delete(first);
    }
  }

  async function loadOSMForBounds(bounds){
    const offline=$("offline").checked;
    if(offline) return { data:FALLBACK.osmAssets, mode:"offline" };

    const key = bboxKey(bounds);
    if (osmCache.has(key)) return { data: osmCache.get(key), mode:"cache" };

    if (osmAbort){ try{ osmAbort.abort(); }catch{} }
    osmAbort = new AbortController();

    try{
      const ql = overpassQLForBBoxAssets(bounds);
      const r = await fetchJSON(SERVICES.overpass, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: "data=" + encodeURIComponent(ql),
        timeoutMs: 15000,
        signal: osmAbort.signal
      });
      const fc = osmToFeatureCollection(r);
      osmCachePut(key, fc);
      return { data: fc, mode:"live" };
    } catch(e){
      if (e?.name === "AbortError") return { data: null, mode:"aborted" };
      return { data: FALLBACK.osmAssets, mode:"fallback", error:safeErr(e) };
    }
  }

  function osmAssetPopupHTML(props){
    const kindRaw = (props?.kind || "asset");
    const kindTitle = kindRaw === "school" ? "School" : (kindRaw === "hospital" ? "Hospital" : "Asset");
    const icon = kindRaw === "hospital" ? "🏥" : (kindRaw === "school" ? "🏫" : "📍");

    const name = safeText(props?.name || kindTitle);
    const op = safeText(props?.operator || "");
    const addr = safeText(props?.addr || "");
    const phone = safeText(props?.phone || "");
    const website = safeText(props?.website || "");
    const email = safeText(props?.email || "");
    const oh = safeText(props?.opening_hours || "");
    const healthcare = safeText(props?.healthcare || "");
    const emergency = safeText(props?.emergency || "");
    const wheelchair = safeText(props?.wheelchair || "");
    const id = safeText(props?.osm_type && props?.osm_id ? `${props.osm_type}/${props.osm_id}` : "—");

    const rows = [
      ["Asset type", kindTitle],
      ["Operator", op],
      ["Address", addr],
      ["Phone", phone],
      ["Website", website],
      ["Email", email],
      ["Opening hours", oh],
      ["Healthcare", healthcare],
      ["Emergency", emergency],
      ["Wheelchair", wheelchair],
      ["OSM", id]
    ].filter(([,v]) => v && v !== "—");

    return `
      <div style="min-width:260px">
        <div style="font-weight:800; font-size:14px; margin-bottom:6px">${icon} ${name}</div>
        <div style="font-size:12px; color:#555; margin-bottom:8px">Asset (${kindTitle}) • OpenStreetMap via Overpass</div>
        <table style="width:100%; border-collapse:collapse; font-size:12px">
          ${rows.map(([k,v]) => `<tr><td style="padding:4px 6px; color:#666; width:40%">${safeText(k)}</td><td style="padding:4px 6px; font-weight:600; word-break:break-word">${safeText(v)}</td></tr>`).join("")}
        </table>
      </div>
    `;
  }

  // ==============================
  // MAP
  // ==============================
  let map, cubaLayer, hurricaneLayer, trackLayer, landslideLayer, floodSiteLayer, osmAssetLayer, osmClusterLayer;
  let osmHealth = { mode: "—", error: "" };
  let trackIndexByStorm = new Map();
  let mapReady = false;
  let fitDone = false;
  let osmHandlersBound = false;

  function rebuildTrackIndex(){
    trackIndexByStorm = new Map();
    if(!trackLayer) return;
    trackLayer.eachLayer(l=>{
      const k = trackKeyFromProps(l.feature?.properties||{});
      if(k) trackIndexByStorm.set(k, l);
    });
  }

  function showTrackForStorm(key){
    const layer = trackIndexByStorm.get(key);
    if(!layer) return;
    try{
      layer.setStyle?.({ weight:5, opacity:0.95 });
      setTimeout(()=>layer.setStyle?.({ weight:3, opacity:0.75 }), 2500);
    }catch{}
    try{ map.fitBounds(layer.getBounds(), { padding:[30,30] }); }catch{}
  }

  function initMap(){
    const mapEl = document.getElementById("map");
    if(typeof L === "undefined"){
      mapEl.innerHTML = `<div style="padding:12px" class="small"><b>Map disabled:</b> Leaflet CDN blocked. UI still runs.</div>`;
      return false;
    }

    map = L.map("map", { zoomControl:true }).setView([21.8, -79.5], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom:19 }).addTo(map);

    cubaLayer = L.geoJSON(null, {
      style:{ weight:2, color:"rgba(85,199,255,0.9)", fillColor:"rgba(85,199,255,0.12)", fillOpacity:0.12 }
    }).addTo(map);

    trackLayer = L.geoJSON(null, {
      style:{ color:"rgba(255,204,102,0.85)", weight:3, opacity:0.75 }
    }).addTo(map);

    hurricaneLayer = L.geoJSON(null, {
      pointToLayer:(f,latlng)=>L.circleMarker(latlng,{ radius:6, color:"#333", weight:0.5, fillColor:"rgba(255,204,102,0.95)", fillOpacity:0.95 }),
      onEachFeature:(f,lyr)=>{
        lyr.bindPopup(`<div><b>${safeText(f.properties?.STORMNAME||"Storm")}</b><div class='small muted'>Click to highlight track</div></div>`);
        lyr.on("click", ()=>showTrackForStorm(trackKeyFromProps(f.properties||{})));
      }
    }).addTo(map);

    landslideLayer = L.geoJSON(null, {
      pointToLayer:(f,latlng)=>L.circleMarker(latlng,{ radius:4, color:"#333", weight:0.5, fillColor:"rgba(255,91,110,0.95)", fillOpacity:0.95 }),
      onEachFeature:(f,lyr)=>lyr.bindPopup("Landslide")
    }).addTo(map);

    floodSiteLayer = L.geoJSON(null, {
      pointToLayer:(f,latlng)=>L.circleMarker(latlng,{ radius:7, color:"#333", weight:0.7, fillColor:floodColorBySeverity(f.properties?.severity||"watch"), fillOpacity:0.95 }),
      onEachFeature:(f,lyr)=>lyr.bindPopup(floodPopupHTML(f.properties||{}), { maxWidth:420 })
    }).addTo(map);

    osmClusterLayer = L.layerGroup().addTo(map);
    osmAssetLayer = L.layerGroup().addTo(map);

    function makeAssetMarker(latlng, kind){
      const emoji = (kind === "hospital") ? "🏥" : (kind === "school") ? "🏫" : "📍";
      const div = L.divIcon({
        className: "",
        html: `<div style="width:22px;height:22px;border-radius:999px;border:1px solid #333;background:rgba(96,230,168,0.95);display:flex;align-items:center;justify-content:center;font-size:14px;">${emoji}</div>`,
        iconSize: [22,22],
        iconAnchor: [11,11]
      });
      return L.marker(latlng, { icon: div });
    }

    function makeClusterMarker(latlng, count){
      const size = count >= 100 ? 34 : (count >= 10 ? 30 : 26);
      const div = L.divIcon({
        className: "",
        html: `<div style="width:${size}px;height:${size}px;border-radius:999px;border:1px solid #333;background:rgba(96,230,168,0.95);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;">${count}</div>`,
        iconSize: [size,size],
        iconAnchor: [size/2,size/2]
      });
      return L.marker(latlng, { icon: div });
    }

    window.__renderOSMAssets = function renderOSMAssets(featureCollection){
      if (!map || !osmAssetLayer || !osmClusterLayer) return;
      osmAssetLayer.clearLayers();
      osmClusterLayer.clearLayers();

      const feats = featureCollection?.features || [];
      if (!feats.length) return;

      const z = map.getZoom();
      const showIndividual = (z >= 12) || (feats.length <= 250);
      if (showIndividual){
        for (const f of feats){
          const g = f.geometry;
          if (!g || g.type !== "Point") continue;
          const [lon,lat] = g.coordinates;
          const m = makeAssetMarker([lat,lon], f.properties?.kind);
          m.bindPopup(osmAssetPopupHTML(f.properties || {}), { maxWidth: 420 });
          osmAssetLayer.addLayer(m);
        }
        return;
      }

      const clusterPx = (z <= 7) ? 90 : (z <= 9) ? 75 : 60;
      const buckets = new Map();

      for (const f of feats){
        const g = f.geometry;
        if (!g || g.type !== "Point") continue;
        const [lon,lat] = g.coordinates;
        const p = map.project([lat,lon], z);
        const key = `${Math.floor(p.x/clusterPx)}:${Math.floor(p.y/clusterPx)}`;
        let b = buckets.get(key);
        if (!b){ b = { count:0, sumLat:0, sumLon:0, samples:[] }; buckets.set(key,b); }
        b.count++;
        b.sumLat += lat;
        b.sumLon += lon;
        if (b.samples.length < 8) b.samples.push(f);
      }

      for (const b of buckets.values()){
        const clat = b.sumLat / b.count;
        const clon = b.sumLon / b.count;
        if (b.count === 1){
          const f = b.samples[0];
          const m = makeAssetMarker([clat,clon], f.properties?.kind);
          m.bindPopup(osmAssetPopupHTML(f.properties || {}), { maxWidth: 420 });
          osmAssetLayer.addLayer(m);
        } else {
          const m = makeClusterMarker([clat,clon], b.count);
          m.on('click', () => map.setView([clat,clon], Math.min(map.getZoom()+2, 14)));
          const sampleList = b.samples.map(s => {
            const kind = s.properties?.kind === 'hospital' ? '🏥 Hospital' : '🏫 School';
            const name = safeText(s.properties?.name || '—');
            return `<li style="margin:2px 0;">${kind}: ${name}</li>`;
          }).join('');
          m.bindPopup(`<div style="min-width:240px"><b>Cluster: ${b.count} assets</b><div class="small muted">Click marker to zoom in</div><ul style="padding-left:18px; margin:8px 0;">${sampleList}</ul></div>`, { maxWidth: 420 });
          osmClusterLayer.addLayer(m);
        }
      }
    };

    mapReady = true;

    if (!osmHandlersBound) {
      osmHandlersBound = true;
      map.on('moveend zoomend', () => scheduleOSMUpdate(false));
    }

    return true;
  }

  function setDebug(html){ $("debug").innerHTML = html; }

  function runTests(metrics){
    const results=[];
    const assert=(n,c)=>results.push(`${c?"✅":"❌"} ${n}`);
    const alerts=buildAlerts(metrics);
    const floodLocal=alerts.find(x=>x.id==="flood_local");
    assert("Flood(precip) exists", !!floodLocal);
    assert("Flood(precip) is WARNING", floodLocal?.severity==="warning");
    $("tests").innerHTML = `<b>Self-tests:</b><br><span class='mono'>${results.join("<br>")}</span>`;
  }

  async function scheduleOSMUpdate(force){
    if (!mapReady || !osmAssetLayer) return;

    if (osmDebounceTimer) clearTimeout(osmDebounceTimer);
    osmDebounceTimer = setTimeout(async () => {
      try{
        const offline=$("offline").checked;
        if (offline) {
          osmAssetLayer?.clearLayers?.();
          osmClusterLayer?.clearLayers?.();
          osmLastKey = "";
          osmHealth = { mode: "offline", error: "" };
          return;
        }

        const z = map.getZoom();
        if (z < OSM_MIN_ZOOM) {
          osmAssetLayer?.clearLayers?.();
          osmClusterLayer?.clearLayers?.();
          osmLastKey = "";
          osmHealth = { mode: `paused(zoom<${OSM_MIN_ZOOM})`, error: "" };
          setDebug(`OSM assets paused (zoom < ${OSM_MIN_ZOOM}). Zoom in to load schools/hospitals.`);
          return;
        }

        const bounds = map.getBounds();
        const key = bboxKey(bounds);
        if (!force && key === osmLastKey && (osmAssetLayer.getLayers().length || osmClusterLayer.getLayers().length)) return;
        osmLastKey = key;

        const res = await loadOSMForBounds(bounds);
        if (res.data) {
          const clipped = filterFeatureCollectionToIsland(res.data, islandMask);
          window.__renderOSMAssets(clipped);
        }
        osmHealth = { mode: res.mode || "ok", error: res.error || "" };
      }catch(e){
        console.warn("OSM update failed", e);
      }
    }, OSM_DEBOUNCE_MS);
  }

  async function boot(){
    $("status").textContent = "Loading…";
    $("ts").textContent = "—";
    setDebug("");

    const diagOn = $("diag").checked;
    const offline = $("offline").checked;

    if(!map && !initMap()){
      // No-map mode: still render alerts + diagnostics
    }

    const cubaQ  = featureQueryGeoJSON(SERVICES.cuba, "COUNTRY='Cuba'");
    const posQ   = featureQueryGeoJSON(SERVICES.hurricanesObservedPosition, "1=1", "STORMNAME,DTG,MSLP,INTENSITY,SS,STORMTYPE,BASIN,STORMID");
    const trackQ = featureQueryGeoJSON(SERVICES.hurricanesObservedTrack, "1=1", "STORMNAME,STORMID");
    const lsQ    = featureQueryGeoJSON(SERVICES.landslides, "1=1");

    const [cubaRes, posRes, trackRes, lsRes] = await Promise.all([
      getWithFallback(cubaQ, FALLBACK.cuba),
      getWithFallback(posQ, FALLBACK.hurricanesObservedPosition),
      getWithFallback(trackQ, FALLBACK.hurricanesObservedTrack),
      getWithFallback(lsQ, FALLBACK.landslides)
    ]);

    islandMask = extractMainIsland(cubaRes.data);

    if(cubaLayer){
      cubaLayer.clearLayers();
      cubaLayer.addData(cubaRes.data);
      if(!fitDone){
        try{ map.fitBounds(cubaLayer.getBounds()); fitDone = true; }catch{}
      }
    }

    const posFiltered   = filterFeatureCollectionToIsland(posRes.data, islandMask);
    const trackFiltered = filterFeatureCollectionToIsland(trackRes.data, islandMask);
    const lsFiltered    = filterFeatureCollectionToIsland(lsRes.data, islandMask);

    if(trackLayer){ trackLayer.clearLayers(); trackLayer.addData(trackFiltered); rebuildTrackIndex(); }
    if(hurricaneLayer){ hurricaneLayer.clearLayers(); hurricaneLayer.addData(posFiltered); }
    if(landslideLayer){ landslideLayer.clearLayers(); landslideLayer.addData(lsFiltered); }

    // Flood sites
    let floodLive={ mode: offline?"offline":"fallback" };
    let floodFC = FALLBACK.floodSites;
    if(!offline){
      try{
        floodLive = await loadLiveFloodSignals();
        if(floodLive.mode==="live" && Array.isArray(floodLive.details)) floodFC=floodFeatureCollectionFromDetails(floodLive.details);
      }catch(e){
        floodLive = { mode:"fallback", error:safeErr(e) };
      }
    }

    const floodFiltered = filterFeatureCollectionToIsland(floodFC, islandMask);
    if(floodSiteLayer){ floodSiteLayer.clearLayers(); floodSiteLayer.addData(floodFiltered); }

    // OSM viewport loader (debounced)
    scheduleOSMUpdate(true);

    // Alerts
    const metrics = JSON.parse(JSON.stringify(METRICS_BASE));
    if(floodLive.mode==="live") metrics.flood_live = { max_ratio_p75: floodLive.max_ratio_p75, site_max: floodLive.site_max };
    const alerts = buildAlerts(metrics);
    renderAlerts(alerts);

    const netLines = [
      layerMeta("Cuba boundary (ArcGIS)", cubaRes.mode, cubaRes.error),
      layerMeta("Hurricane points (ArcGIS)", posRes.mode, posRes.error),
      layerMeta("Storm track (ArcGIS)", trackRes.mode, trackRes.error),
      layerMeta("Landslides (NASA ArcGIS)", lsRes.mode, lsRes.error),
      (floodLive.mode==="live")
        ? `<span class='pill ok'>✅ Flood API (Open-Meteo): live</span>`
        : (offline ? `<span class='pill warn2'>🟡 Flood API (Open-Meteo): offline</span>` : `<span class='pill bad'>🔻 Flood API (Open-Meteo): fallback</span><span class='small muted'> ${floodLive.error?"("+safeText(floodLive.error)+")":""}</span>`),
      `<span class='pill'>Basemap (OSM tiles): <b>${navigator.onLine?"online":"offline"}</b></span>`,
      `<span class='pill'>Offline toggle: <b>${offline?"ON":"OFF"}</b></span>`
    ];

    const floodCount = (floodFiltered?.features || []).length;
    const osmCountNow = (osmAssetLayer ? osmAssetLayer.getLayers().length : 0) + (osmClusterLayer ? osmClusterLayer.getLayers().length : 0);

    const osmPill = (function(){
      const m = osmHealth?.mode || "—";
      if (m === "live" || m === "cache") return `<span class='pill ok'>✅ OSM Overpass: ${safeText(m)}</span>`;
      if (m === "offline") return `<span class='pill warn2'>🟡 OSM Overpass: offline</span>`;
      if (String(m).startsWith("paused")) return `<span class='pill warn2'>🟡 OSM Overpass: ${safeText(m)}</span>`;
      if (m === "aborted") return `<span class='pill warn2'>🟡 OSM Overpass: aborted</span>`;
      return `<span class='pill bad'>🔻 OSM Overpass: ${safeText(m)}</span><span class='small muted'> ${osmHealth?.error? "("+safeText(osmHealth.error)+")" : ""}</span>`;
    })();

    let diagHtml = netLines.join(" ");
    if (diagOn) {
      diagHtml += ` <span class='pill'>Flood sites (main island): <b>${floodCount}</b></span>`;
      diagHtml += ` <span class='pill'>OSM assets (main island): <b>${osmCountNow}</b></span>`;
      if (floodLive.mode === "live") {
        diagHtml += ` <span class='pill'>Worst: <b>${safeText(floodLive.site_max)}</b> ratio <b>${fmtMaybeNumber(floodLive.max_ratio_p75,2)}</b></span>`;
      }
      diagHtml += ` ${osmPill}`;
      $("net").innerHTML = diagHtml;
    } else {
      $("net").textContent = "Diagnostics off";
    }

    setDebug(`Loaded. All point layers are clipped to the <b>main Island of Cuba</b>. OSM clusters for speed (zoom ≥ ${OSM_MIN_ZOOM} to load).`);

    $("status").textContent = "Ready";
    $("ts").textContent = new Date().toLocaleString();

    runTests(metrics);
  }

  function showFatal(e){
    $("status").textContent = "Error";
    setDebug(`<b>Error:</b> <span class='mono'>${safeText(safeErr(e))}</span>`);
    console.error(e);
  }

  $("btnReload").addEventListener("click", ()=>boot().catch(showFatal));
  $("offline").addEventListener("change", ()=>{
    osmCache.clear();
    osmLastKey = "";
    osmHealth = { mode: $("offline").checked ? "offline" : "—", error: "" };
    boot().catch(showFatal);
  });
  $("diag").addEventListener("change", ()=>boot().catch(showFatal));

  boot().catch(showFatal);