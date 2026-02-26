// Cuba Ops Digital Twin – Split build (match reference app)
// - Leaflet basemap + Cuba boundary
// - Hurricanes (Observed Position + Observed Track) with popup links + track zoom
// - Landslides with rich popup
// - Flood warning locations (live via Open-Meteo Flood API), colored by severity + popup with discharge values + link
// - Major assets: schools + hospitals from OSM Overpass, different symbols, rich popup with vital tags
// - Optional local proxy via server.py to reduce CORS issues

const SERVICES = {
  cuba: "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/World_Countries_(Generalized)/FeatureServer/0",
  hurricanesObservedPosition: "https://services9.arcgis.com/RHVPKKiFTONKtxq3/ArcGIS/rest/services/Active_Hurricanes_v1/FeatureServer/1",
  hurricanesObservedTrack: "https://services9.arcgis.com/RHVPKKiFTONKtxq3/ArcGIS/rest/services/Active_Hurricanes_v1/FeatureServer/3",
  landslides: "https://maps.nccs.nasa.gov/mapping/rest/services/landslide_viewer/Landslide_Points/FeatureServer/0",
  floodApiBase: "https://flood-api.open-meteo.com/v1/flood",
  overpass: "https://overpass-api.de/api/interpreter",
  proxyBase: "/proxy?url="
};

const FLOOD_SITES = [
  { id: "HAV", name: "Havana", lat: 23.1136, lon: -82.3666 },
  { id: "SCU", name: "Santiago de Cuba", lat: 20.0208, lon: -75.8294 },
  { id: "CAM", name: "Camagüey", lat: 21.3808, lon: -77.9169 },
  { id: "HOG", name: "Holguín", lat: 20.8872, lon: -76.2631 },
  { id: "CFG", name: "Cienfuegos", lat: 22.1461, lon: -80.4356 }
];

// Demo metrics (alerts engine). Replace later with real forecasts.
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
  },
  {
    id: "cyclone",
    title: "Cyclone / Hurricane",
    evidence: ["storm.hours_to_impact", "storm.max_wind_kt_local"],
    thresholds: [
      { severity: "critical", test: m => (m.storm?.hours_to_impact ?? 9999) <= 48 || (m.storm?.max_wind_kt_local ?? 0) >= 64 },
      { severity: "warning",  test: m => (m.storm?.hours_to_impact ?? 9999) <= 72 },
      { severity: "watch",    test: m => (m.storm?.hours_to_impact ?? 9999) <= 120 }
    ]
  },
  {
    id: "heat",
    title: "Extreme Heat",
    evidence: ["met.heat_index_c_max", "met.heat_index_days_ge_41", "met.night_temp_c_min"],
    thresholds: [
      { severity: "critical", test: m => (m.met?.heat_index_c_max ?? 0) >= 43 || (m.met?.night_temp_c_min ?? 0) >= 28 },
      { severity: "warning",  test: m => (m.met?.heat_index_c_max ?? 0) >= 41 && (m.met?.heat_index_days_ge_41 ?? 0) >= 2 },
      { severity: "watch",    test: m => (m.met?.heat_index_c_max ?? 0) >= 38 }
    ]
  }
];

// Sample operational assets (no API in this demo)
const ASSET_SAMPLES = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { name: "Havana – Port", asset_type: "port" }, geometry: { type: "Point", coordinates: [-82.3666, 23.1136] } },
    { type: "Feature", properties: { name: "Santa Clara – Hospital (Ops)", asset_type: "clinic" }, geometry: { type: "Point", coordinates: [-79.9647, 22.4069] } },
    { type: "Feature", properties: { name: "Santiago – Coastal Road", asset_type: "coastal_road" }, geometry: { type: "Point", coordinates: [-75.8294, 20.0208] } }
  ]
};

const FALLBACK = {
  cuba: { type:"FeatureCollection", features:[{ type:"Feature", properties:{COUNTRY:"Cuba", _fallback:true}, geometry:{type:"Polygon",coordinates:[[[ -84.95,19.85],[-74.10,19.85],[-74.10,23.45],[-84.95,23.45],[-84.95,19.85 ]]]}}] },
  hurricanesObservedPosition: { type:"FeatureCollection", features:[
    { type:"Feature", properties:{ STORMNAME:"Sample Storm A", DTG:Date.now(), MSLP:995, INTENSITY:55, SS:1, STORMTYPE:"HU", BASIN:"AL", STORMID:"SAMPLE_A", _fallback:true }, geometry:{ type:"Point", coordinates:[-82.4, 22.9] } },
    { type:"Feature", properties:{ STORMNAME:"Sample Storm B", DTG:Date.now(), MSLP:1006, INTENSITY:40, SS:0, STORMTYPE:"TS", BASIN:"AL", STORMID:"SAMPLE_B", _fallback:true }, geometry:{ type:"Point", coordinates:[-77.8, 20.8] } }
  ]},
  hurricanesObservedTrack: { type:"FeatureCollection", features:[
    { type:"Feature", properties:{ STORMNAME:"Sample Storm A", STORMID:"SAMPLE_A", _fallback:true }, geometry:{ type:"LineString", coordinates:[[-83.1,22.2],[-82.7,22.6],[-82.4,22.9]] } },
    { type:"Feature", properties:{ STORMNAME:"Sample Storm B", STORMID:"SAMPLE_B", _fallback:true }, geometry:{ type:"LineString", coordinates:[[-78.6,20.3],[-78.1,20.6],[-77.8,20.8]] } }
  ]},
  landslides: { type:"FeatureCollection", features:[
    { type:"Feature", properties:{ event_date:"2025-09-10", country:"Cuba", trigger:"rain", fatalities:0, _fallback:true }, geometry:{ type:"Point", coordinates:[-76.0, 20.2] } },
    { type:"Feature", properties:{ event_date:"2025-05-22", country:"Cuba", trigger:"rain", fatalities:1, _fallback:true }, geometry:{ type:"Point", coordinates:[-79.9, 22.4] } }
  ]},
  floodSites: { type:"FeatureCollection", features: FLOOD_SITES.map((s,i)=>({
    type:"Feature",
    properties:{ id:s.id, name:s.name, severity: i===0?"warning":(i===1?"watch":"critical"), ratio_p75: i===0?1.15:(i===1?0.95:1.7),
      day:new Date().toISOString().slice(0,10), discharge_max:i===2?1800:900, discharge_p75:i===2?1000:850, url:"—", _fallback:true },
    geometry:{ type:"Point", coordinates:[s.lon,s.lat] }
  }))},
  osmAssets: { type:"FeatureCollection", features:[
    { type:"Feature", properties:{ kind:"hospital", name:"Hospital (sample)", operator:"", addr:"", phone:"", website:"", email:"", opening_hours:"", emergency:"", wheelchair:"", healthcare:"", osm_type:"node", osm_id:1, _fallback:true }, geometry:{ type:"Point", coordinates:[-82.381,23.135] } },
    { type:"Feature", properties:{ kind:"school", name:"School (sample)", operator:"", addr:"", phone:"", website:"", email:"", opening_hours:"", emergency:"", wheelchair:"", healthcare:"", osm_type:"node", osm_id:2, _fallback:true }, geometry:{ type:"Point", coordinates:[-79.965,22.408] } }
  ]}
};

const $ = (id) => document.getElementById(id);

function proxied(url){
  return SERVICES.proxyBase ? (SERVICES.proxyBase + encodeURIComponent(url)) : url;
}
function safeErr(e){ return (e && (e.message || String(e))) || "Unknown error"; }
function safeText(v){ if(v===null||v===undefined||v==="") return "—"; return String(v).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }
function fmtMaybeNumber(v,d=0){ const n=Number(v); return Number.isFinite(n)?n.toFixed(d):(v??"—"); }
function fmtEpoch(ms){ const n=Number(ms); if(!Number.isFinite(n)||n<=0) return "—"; try{return new Date(n).toLocaleString();}catch{return String(ms);} }

async function getJSON(url, opts={}){
  const r = await fetch(proxied(url), { headers:{ "Accept":"application/json" }, ...opts });
  if(!r.ok) throw new Error(r.status + " " + r.statusText);
  return r.json();
}

async function getWithFallback(url, fallbackFC){
  const offline = $("offline").checked;
  if (offline) return { data:fallbackFC, mode:"offline" };
  try { return { data: await getJSON(url), mode:"live" }; }
  catch (e) { return { data:fallbackFC, mode:"fallback", error:safeErr(e) }; }
}

function featureQueryGeoJSON(layerUrl, where="1=1", outFields="*"){
  const u = new URL(layerUrl.replace(/\/+$/, "") + "/query");
  u.searchParams.set("where", where);
  u.searchParams.set("outFields", outFields);
  u.searchParams.set("outSR", "4326");
  u.searchParams.set("returnGeometry", "true");
  u.searchParams.set("f", "geojson");
  return u.toString();
}

// =============== Popups ===============
function ssCategoryLabel(ss){
  const n = Number(ss);
  if(!Number.isFinite(n)) return "—";
  if(n <= 0) return "Tropical Storm";
  return `Category ${n}`;
}

function trackKeyFromProps(props){
  return String(props?.STORMID || props?.STORMNAME || "").trim();
}

function hurricanePopupHTML(props, latlng){
  const name = safeText(props?.STORMNAME || "Storm");
  const type = safeText(props?.STORMTYPE);
  const basin = safeText(props?.BASIN);
  const dtg = fmtEpoch(props?.DTG);
  const cat = ssCategoryLabel(props?.SS);
  const wind = fmtMaybeNumber(props?.INTENSITY, 0);
  const mslp = fmtMaybeNumber(props?.MSLP, 0);

  const lat = (latlng?.lat ?? props?.LAT);
  const lon = (latlng?.lng ?? props?.LON);
  const id = safeText(props?.STORMID);
  const key = trackKeyFromProps(props);

  const q = featureQueryGeoJSON(
    SERVICES.hurricanesObservedPosition,
    `STORMNAME='${String(props?.STORMNAME || "").replace(/'/g,"''")}'`,
    "STORMNAME,DTG,MSLP,INTENSITY,SS,STORMTYPE,BASIN,STORMID,LAT,LON"
  );

  const w = props?.STORMID
    ? `STORMID='${String(props.STORMID).replace(/'/g,"''")}'`
    : `STORMNAME='${String(props?.STORMNAME || "").replace(/'/g,"''")}'`;

  const trackQ = featureQueryGeoJSON(SERVICES.hurricanesObservedTrack, w, "STORMNAME,STORMID");

  return `
    <div style="min-width:260px">
      <div style="font-weight:800; font-size:14px; margin-bottom:6px">${name}</div>
      <div style="font-size:12px; color:#555; margin-bottom:8px">Near-real-time from Esri Active Hurricanes (Observed Position)</div>
      <table style="width:100%; border-collapse:collapse; font-size:12px">
        ${[
          ["Type", type],
          ["Basin", basin],
          ["Category", cat],
          ["Wind (INTENSITY)", wind + " kt"],
          ["Pressure (MSLP)", mslp + " mb"],
          ["DTG", dtg],
          ["Lat/Lon", `${fmtMaybeNumber(lat, 3)}, ${fmtMaybeNumber(lon, 3)}`],
          ["Storm ID", id]
        ].map(([k,v]) => `<tr><td style="padding:4px 6px; color:#666; width:46%">${k}</td><td style="padding:4px 6px; font-weight:600">${safeText(v)}</td></tr>`).join("")}
      </table>
      <div style="margin-top:10px; display:flex; gap:10px; align-items:center; flex-wrap:wrap; font-size:12px">
        <button type="button" data-track-key="${safeText(key)}" style="padding:6px 10px; border-radius:10px; border:1px solid #ccc; background:#fff; cursor:pointer;">Zoom to observed track</button>
        <a href="${q}" target="_blank" rel="noreferrer">Open live point query</a>
        <a href="${trackQ}" target="_blank" rel="noreferrer">Open live track query</a>
      </div>
    </div>
  `;
}

function landslidePopupHTML(props, latlng){
  const preferredKeys = [
    "event_date","date","event_time","country","admin1","admin2","place","location","trigger","landslide_type",
    "fatalities","injuries","source_name","source","url","confidence"
  ];

  const present = [];
  for (const k of preferredKeys) {
    if (props && props[k] !== undefined && props[k] !== null && props[k] !== "") present.push(k);
    if (present.length >= 10) break;
  }

  const name = safeText(props?.place || props?.location || props?.admin2 || props?.admin1 || "Landslide Event");
  const dt = props?.event_date ?? props?.date;

  const lat = (latlng?.lat ?? props?.lat ?? props?.LAT);
  const lon = (latlng?.lng ?? props?.lon ?? props?.LON);

  const rows = [
    ["Date", safeText(dt)],
    ["Country", safeText(props?.country)],
    ["Trigger", safeText(props?.trigger)],
    ["Fatalities", safeText(props?.fatalities)],
    ["Lat/Lon", `${fmtMaybeNumber(lat, 3)}, ${fmtMaybeNumber(lon, 3)}`]
  ].filter(r => r[1] !== "—");

  const shown = new Set(rows.map(r => r[0].toLowerCase()));
  const extras = present.filter(k => !shown.has(k.toLowerCase())).slice(0, 6);
  const extraRows = extras.map(k => [k, safeText(props[k])]);

  return `
    <div style="min-width:260px">
      <div style="font-weight:800; font-size:14px; margin-bottom:6px">${name}</div>
      <div style="font-size:12px; color:#555; margin-bottom:8px">NASA Landslide Viewer (Global Landslide Catalog)</div>
      <table style="width:100%; border-collapse:collapse; font-size:12px">
        ${(rows.concat(extraRows)).map(([k,v]) => `<tr><td style="padding:4px 6px; color:#666; width:46%">${safeText(k)}</td><td style="padding:4px 6px; font-weight:600">${safeText(v)}</td></tr>`).join("")}
      </table>
    </div>
  `;
}

function assetPopupHTML(props){
  const name = safeText(props?.name || "Asset");
  const type = safeText(props?.asset_type || "—");
  return `
    <div style="min-width:240px">
      <div style="font-weight:800; font-size:14px; margin-bottom:6px">${name}</div>
      <div style="font-size:12px; color:#555; margin-bottom:8px">Operational asset (sample)</div>
      <table style="width:100%; border-collapse:collapse; font-size:12px">
        <tr><td style="padding:4px 6px; color:#666; width:46%">Type</td><td style="padding:4px 6px; font-weight:600">${type}</td></tr>
      </table>
    </div>
  `;
}

// =============== Flood ===============
function floodSeverityFromRatio(r){
  const n = Number(r);
  if (!Number.isFinite(n)) return "watch";
  if (n >= 1.5) return "critical";
  if (n >= 1.1) return "warning";
  if (n >= 0.9) return "watch";
  return "watch";
}
function floodColorBySeverity(sev){
  if (sev === "critical") return "rgba(255,91,110,0.95)";
  if (sev === "warning") return "rgba(255,155,61,0.95)";
  return "rgba(255,204,102,0.95)";
}
function floodApiURL(site){
  const u = new URL(SERVICES.floodApiBase);
  u.searchParams.set("latitude", String(site.lat));
  u.searchParams.set("longitude", String(site.lon));
  u.searchParams.set("daily", "river_discharge,river_discharge_p75,river_discharge_max");
  u.searchParams.set("forecast_days", "7");
  u.searchParams.set("past_days", "0");
  u.searchParams.set("timeformat", "iso8601");
  return u.toString();
}
function floodPopupHTML(props){
  const name = safeText(props?.name || "Flood Site");
  const sev = safeText(props?.severity || "watch").toUpperCase();
  const ratio = fmtMaybeNumber(props?.ratio_p75, 2);
  const day = safeText(props?.day);
  const dmax = fmtMaybeNumber(props?.discharge_max, 0);
  const p75 = fmtMaybeNumber(props?.discharge_p75, 0);
  const url = safeText(props?.url);

  return `
    <div style="min-width:260px">
      <div style="font-weight:800; font-size:14px; margin-bottom:6px">${name}</div>
      <div style="font-size:12px; color:#555; margin-bottom:8px">River discharge flood signal (GloFAS via Open-Meteo)</div>
      <table style="width:100%; border-collapse:collapse; font-size:12px">
        <tr><td style="padding:4px 6px; color:#666; width:46%">Severity</td><td style="padding:4px 6px; font-weight:700">${sev}</td></tr>
        <tr><td style="padding:4px 6px; color:#666; width:46%">Worst day</td><td style="padding:4px 6px; font-weight:600">${day}</td></tr>
        <tr><td style="padding:4px 6px; color:#666; width:46%">Max / P75</td><td style="padding:4px 6px; font-weight:600">${ratio}</td></tr>
        <tr><td style="padding:4px 6px; color:#666; width:46%">Discharge max</td><td style="padding:4px 6px; font-weight:600">${dmax}</td></tr>
        <tr><td style="padding:4px 6px; color:#666; width:46%">Discharge P75</td><td style="padding:4px 6px; font-weight:600">${p75}</td></tr>
      </table>
      ${url !== "—" && url !== "" ? `<div style="margin-top:8px; font-size:12px"><a href="${url}" target="_blank" rel="noreferrer">Open flood API query</a></div>` : ""}
    </div>
  `;
}
function floodFeatureCollectionFromDetails(details){
  // ===== OSM performance (bbox + debounce + abort + cache) =====
const OSM_MIN_ZOOM = 7;
const OSM_DEBOUNCE_MS = 450;
const OSM_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const OSM_MAX_FEATURES_RENDER = 3000;

let osmAbort = null;
let osmTimer = null;
let osmLastKey = "";
const osmCache = new Map(); // key -> {ts, fc}

function bboxKey(bounds){
  return `${bounds.getSouth().toFixed(3)},${bounds.getWest().toFixed(3)},${bounds.getNorth().toFixed(3)},${bounds.getEast().toFixed(3)}`;
}
function cacheGet(key){
  const v = osmCache.get(key);
  if(!v) return null;
  if(Date.now() - v.ts > OSM_CACHE_TTL_MS){ osmCache.delete(key); return null; }
  return v.fc;
}
function cachePut(key, fc){
  osmCache.set(key, { ts: Date.now(), fc });
  // simple cap
  if(osmCache.size > 20){
    const first = osmCache.keys().next().value;
    osmCache.delete(first);
  }
}

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
  const offline = $("offline").checked;
  if (offline) return { mode:"offline" };

  const details = [];
  for (const s of FLOOD_SITES){
    const url = floodApiURL(s);
    const j = await getJSON(url);
    const daily = j?.daily;
    const dischargeMax = daily?.river_discharge_max;
    const p75 = daily?.river_discharge_p75;
    const time = daily?.time;

    if (!Array.isArray(dischargeMax) || !Array.isArray(p75) || dischargeMax.length === 0 || p75.length === 0) continue;

    const n = Math.min(3, dischargeMax.length, p75.length);
    let maxRatio = 0;
    let maxDay = "—";
    let maxVal = -Infinity;
    let maxP75 = -Infinity;

    for (let i=0;i<n;i++){
      const a = Number(dischargeMax[i]);
      const b = Number(p75[i]);
      if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) continue;
      const r = a / b;
      if (r > maxRatio){
        maxRatio = r;
        maxDay = time?.[i] || "—";
        maxVal = a;
        maxP75 = b;
      }
    }

    details.push({
      id: s.id,
      site: s.name,
      lat: s.lat,
      lon: s.lon,
      day: maxDay,
      discharge_max: maxVal,
      discharge_p75: maxP75,
      ratio_p75: maxRatio,
      severity: floodSeverityFromRatio(maxRatio),
      url
    });
  }

  if (details.length === 0) return { mode:"fallback", error:"No flood data returned" };
  details.sort((a,b)=>(b.ratio_p75||0)-(a.ratio_p75||0));
  const worst = details[0];
  return { mode:"live", max_ratio_p75: worst.ratio_p75, site_max: `${worst.site} (${worst.day})`, details };
}

// =============== OSM assets ===============
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
  const els = osm?.elements;
  if (!Array.isArray(els)) return { type:"FeatureCollection", features:[] };

  const feats = [];
  for (const el of els){
    const tags = el.tags || {};
    const kind = tags.amenity;
    if (kind !== "hospital" && kind !== "school") continue;

    const lat = (typeof el.lat === "number") ? el.lat : el.center?.lat;
    const lon = (typeof el.lon === "number") ? el.lon : el.center?.lon;
    if (typeof lat !== "number" || typeof lon !== "number") continue;

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
        addr: [tags["addr:street"], tags["addr:housenumber"], tags["addr:city"], tags["addr:postcode"]].filter(Boolean).join(" "),
        osm_type: el.type,
        osm_id: el.id
      },
      geometry:{ type:"Point", coordinates:[lon, lat] }
    });
  }
  return { type:"FeatureCollection", features:feats };
}

async function loadOSMAssets(){
  const offline = $("offline").checked;
  if(offline) return { data: FALLBACK.osmAssets, mode:"offline" };

  if(!map){
    return { data: FALLBACK.osmAssets, mode:"fallback", error:"Map not ready" };
  }

  const z = map.getZoom();
  if(z < OSM_MIN_ZOOM){
    return { data: { type:"FeatureCollection", features:[] }, mode:`paused(zoom<${OSM_MIN_ZOOM})` };
  }

  const bounds = map.getBounds();
  const key = bboxKey(bounds);

  // avoid refetch when key unchanged
  if(key === osmLastKey && osmAssetLayer && osmAssetLayer.getLayers().length){
    return { data: null, mode:"noop" };
  }
  osmLastKey = key;

  const cached = cacheGet(key);
  if(cached) return { data: cached, mode:"cache" };

  if(osmAbort){ try{ osmAbort.abort(); }catch{} }
  osmAbort = new AbortController();

  try{
    const ql = overpassQLForBBoxAssets(bounds);
    const r = await fetch(proxied(SERVICES.overpass), {
      method:"POST",
      headers:{ "Content-Type":"application/x-www-form-urlencoded; charset=UTF-8" },
      body:"data=" + encodeURIComponent(ql),
      signal: osmAbort.signal
    });
    if(!r.ok) throw new Error(r.status + " " + r.statusText);
    const osm = await r.json();
    let fc = osmToFeatureCollection(osm);

    // cap
    if((fc.features||[]).length > OSM_MAX_FEATURES_RENDER){
      fc = { type:"FeatureCollection", features: fc.features.slice(0, OSM_MAX_FEATURES_RENDER) };
    }
    cachePut(key, fc);
    return { data: fc, mode:"live" };
  } catch(e){
    if(e?.name === "AbortError") return { data: null, mode:"aborted" };
    return { data: FALLBACK.osmAssets, mode:"fallback", error:safeErr(e) };
  }
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

// =============== Alerts/UI ===============
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
  const wrap = $("alerts");
  wrap.innerHTML = alerts.length ? "" : "<div class='small'>No triggers fired.</div>";
  for(const a of alerts){
    wrap.insertAdjacentHTML("beforeend", `
      <div style="margin:8px 0;">
        <span class="badge ${a.severity}">${a.severity.toUpperCase()}</span>
        <b style="margin-left:8px;">${a.title}</b>
      </div>
    `);
  }
  const ev = $("evidence");
  ev.innerHTML = "";
  const uniq = new Set();
  alerts.forEach(x => x.evidence.forEach(e => uniq.add(e)));
  [...uniq].forEach(e => ev.insertAdjacentHTML("beforeend", `<li class='small'>${e}</li>`));
}
function layerMeta(label, mode, err){
  if(mode==="live") return `<span class='pill ok'>✅ ${label}: live</span>`;
  if(mode==="offline") return `<span class='pill warn2'>🟡 ${label}: offline</span>`;
  return `<span class='pill bad'>🔻 ${label}: fallback</span><span class='small muted'> ${err? "("+safeText(err)+")":""}</span>`;
}
function setDebug(html){ $("debug").innerHTML = html; }

// =============== Map ===============
let map, cubaLayer, hurricaneLayer, trackLayer, landslideLayer, floodSiteLayer, osmAssetLayer, assetLayer;
let trackIndexByStorm = new Map();

function rebuildTrackIndex(){
  trackIndexByStorm = new Map();
  trackLayer.eachLayer((l) => {
    const k = trackKeyFromProps(l.feature?.properties || {});
    if (k) trackIndexByStorm.set(k, l);
  });
}
function showTrackForStorm(key){
  if (!key) return;
  const layer = trackIndexByStorm.get(key);
  if (!layer) return;
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
    pointToLayer: (f, latlng) => L.circleMarker(latlng, {
      radius: 6,
      color: "#333",
      weight: 0.5,
      fillColor: "rgba(255,204,102,0.95)",
      fillOpacity: 0.95
    }),
    onEachFeature: (f, lyr) => {
      const html = hurricanePopupHTML(f.properties || {}, lyr.getLatLng?.());
      lyr.bindPopup(html, { maxWidth: 420 });

      lyr.on("popupopen", (evt) => {
        const el = evt.popup.getElement();
        const btn = el?.querySelector?.("button[data-track-key]");
        if (btn) {
          btn.addEventListener("click", () => {
            const k = btn.getAttribute("data-track-key");
            showTrackForStorm(k);
          });
        }
      });

      lyr.on("click", () => {
        const k = trackKeyFromProps(f.properties || {});
        showTrackForStorm(k);
      });
    }
  }).addTo(map);

  landslideLayer = L.geoJSON(null, {
    pointToLayer: (f, latlng) => L.circleMarker(latlng, {
      radius: 4,
      color: "#333",
      weight: 0.5,
      fillColor: "rgba(255,91,110,0.95)",
      fillOpacity: 0.95
    }),
    onEachFeature: (f, lyr) => {
      const html = landslidePopupHTML(f.properties || {}, lyr.getLatLng?.());
      lyr.bindPopup(html, { maxWidth: 420 });
    }
  }).addTo(map);

  assetLayer = L.geoJSON(null, {
    pointToLayer: (f, latlng) => L.circleMarker(latlng, {
      radius: 6,
      color: "#333",
      weight: 0.5,
      fillColor: "rgba(96,230,168,0.95)",
      fillOpacity: 0.95
    }),
    onEachFeature: (f, lyr) => lyr.bindPopup(assetPopupHTML(f.properties || {}), { maxWidth: 360 })
  }).addTo(map);

  floodSiteLayer = L.geoJSON(null, {
    pointToLayer: (f, latlng) => {
      const sev = f?.properties?.severity || "watch";
      return L.circleMarker(latlng, {
        radius: 7,
        color: "#333",
        weight: 0.7,
        fillColor: floodColorBySeverity(sev),
        fillOpacity: 0.95
      });
    },
    onEachFeature: (f, lyr) => lyr.bindPopup(floodPopupHTML(f.properties || {}), { maxWidth: 420 })
  }).addTo(map);

  osmAssetLayer = L.markerClusterGroup({
  chunkedLoading: true,
  removeOutsideVisibleBounds: true,
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false
}).addTo(map);

function addOSMAssetsToMap(fc){
  osmAssetLayer.clearLayers();
  const feats = fc?.features || [];
  for(const f of feats){
    const g = f.geometry;
    if(!g || g.type !== "Point") continue;
    const [lon, lat] = g.coordinates;
    const kind = f?.properties?.kind;
    const emoji = (kind === "hospital") ? "🏥" : (kind === "school") ? "🏫" : "📍";
    const div = L.divIcon({
      className: "",
      html: `<div style="width:22px;height:22px;border-radius:999px;border:1px solid #333;background:rgba(96,230,168,0.95);display:flex;align-items:center;justify-content:center;font-size:14px;">${emoji}</div>`,
      iconSize: [22,22],
      iconAnchor: [11,11]
    });
    const m = L.marker([lat, lon], { icon: div });
    m.bindPopup(osmAssetPopupHTML(f.properties || {}), { maxWidth: 420 });
    osmAssetLayer.addLayer(m);
  }
}

  map.on('moveend zoomend', ()=>{ if(osmTimer) clearTimeout(osmTimer); osmTimer=setTimeout(()=>boot().catch(showFatal), OSM_DEBOUNCE_MS); });

  return true;
}

// =============== Tests ===============
function runTests(metrics){
  const results=[];
  const assert=(name, cond)=>results.push(`${cond ? "✅" : "❌"} ${name}`);

  const a1 = buildAlerts(metrics);
  assert("Flood(precip) exists", !!a1.find(x=>x.id==="flood_local"));
  assert("Cyclone exists", !!a1.find(x=>x.id==="cyclone"));
  assert("Heat exists", !!a1.find(x=>x.id==="heat"));

  const a2 = buildAlerts({ ...metrics, forecast: { ...metrics.forecast, rain_mm_24h: 160 } });
  assert("Flood becomes CRITICAL when rain_24h >= 150", (a2.find(x=>x.id==="flood_local")?.severity === "critical"));

  const a3 = buildAlerts({ ...metrics, storm: { hours_to_impact: 36, max_wind_kt_local: 40 } });
  assert("Cyclone becomes CRITICAL when hours_to_impact <= 48", (a3.find(x=>x.id==="cyclone")?.severity === "critical"));

  const a4 = buildAlerts({ ...metrics, met: { heat_index_c_max: 41, heat_index_days_ge_41: 2, night_temp_c_min: 25 } });
  assert("Heat becomes WARNING when HI>=41 for 2 days", (a4.find(x=>x.id==="heat")?.severity === "warning"));

  const a5 = buildAlerts({ ...metrics,
    forecast:{ rain_mm_24h:0, rain_mm_72h:0 }, anomaly:{ rain_mm_14d:0 },
    storm:{ hours_to_impact:9999, max_wind_kt_local:0 },
    met:{ heat_index_c_max:20, heat_index_days_ge_41:0, night_temp_c_min:20 }
  });
  assert("No alerts when conditions are low", a5.length === 0);

  $("tests").innerHTML = `<b>Self-tests:</b><br><span class='mono'>${results.join("<br>")}</span>`;
}

// =============== Boot ===============
async function boot(){
  $("status").textContent = "Loading…";
  $("ts").textContent = "—";
  setDebug("");

  if (!map) initMap();

  const diagOn = $("diag").checked;
  const offline = $("offline").checked;

  const cubaQ = featureQueryGeoJSON(SERVICES.cuba, "COUNTRY='Cuba'");
  const posQ  = featureQueryGeoJSON(SERVICES.hurricanesObservedPosition, "1=1", "STORMNAME,DTG,MSLP,INTENSITY,SS,STORMTYPE,BASIN,STORMID,LAT,LON");
  const trackQ = featureQueryGeoJSON(SERVICES.hurricanesObservedTrack, "1=1", "STORMNAME,STORMID");
  const lsQ   = featureQueryGeoJSON(SERVICES.landslides, "1=1");

  const [cubaRes, posRes, trackRes, lsRes, osmRes] = await Promise.all([
    getWithFallback(cubaQ, FALLBACK.cuba),
    getWithFallback(posQ, FALLBACK.hurricanesObservedPosition),
    getWithFallback(trackQ, FALLBACK.hurricanesObservedTrack),
    getWithFallback(lsQ, FALLBACK.landslides),
    loadOSMAssets()
  ]);

  if (cubaLayer){
    cubaLayer.clearLayers(); cubaLayer.addData(cubaRes.data);
    try { map.fitBounds(cubaLayer.getBounds()); } catch {}
  }
  if (trackLayer){ trackLayer.clearLayers(); trackLayer.addData(trackRes.data); rebuildTrackIndex(); }
  if (hurricaneLayer){ hurricaneLayer.clearLayers(); hurricaneLayer.addData(posRes.data); }
  if (landslideLayer){ landslideLayer.clearLayers(); landslideLayer.addData(lsRes.data); }
  if (osmAssetLayer && osmRes.data) { addOSMAssetsToMap(osmRes.data); }
  if (assetLayer){ assetLayer.clearLayers(); assetLayer.addData(ASSET_SAMPLES); }

  // Flood sites (live)
  let floodLive = { mode: offline ? "offline" : "fallback" };
  let floodFC = FALLBACK.floodSites;
  if (!offline){
    try{
      floodLive = await loadLiveFloodSignals();
      if (floodLive.mode === "live" && Array.isArray(floodLive.details)){
        floodFC = floodFeatureCollectionFromDetails(floodLive.details);
      }
    }catch(e){
      floodLive = { mode:"fallback", error:safeErr(e) };
    }
  }
  if (floodSiteLayer){ floodSiteLayer.clearLayers(); floodSiteLayer.addData(floodFC); }

  // Alerts
  const metrics = JSON.parse(JSON.stringify(METRICS_BASE));
  if (floodLive.mode === "live"){
    metrics.flood_live = { max_ratio_p75: floodLive.max_ratio_p75, site_max: floodLive.site_max };
  }
  const alerts = buildAlerts(metrics);
  renderAlerts(alerts);

  // Diagnostics (match reference app)
  const netLines = [
    layerMeta("Countries", cubaRes.mode, cubaRes.error),
    layerMeta("Hurricane pos", posRes.mode, posRes.error),
    layerMeta("Hurricane track", trackRes.mode, trackRes.error),
    layerMeta("Landslides", lsRes.mode, lsRes.error),
    layerMeta("OSM assets", osmRes.mode, osmRes.error),
    (floodLive.mode === "live")
      ? `<span class='pill ok'>✅ Flood API: live</span>`
      : (offline ? `<span class='pill warn2'>🟡 Flood API: offline</span>` : `<span class='pill bad'>🔻 Flood API: fallback</span><span class='small muted'> ${floodLive.error ? "("+safeText(floodLive.error)+")" : ""}</span>`),
    `<span class='pill'>navigator.onLine: <b>${navigator.onLine ? "true" : "false"}</b></span>`,
    `<span class='pill'>Offline: <b>${offline ? "ON" : "OFF"}</b></span>`,
  ];

  const floodCount = (floodFC?.features || []).length;
  if (diagOn){
    let html = netLines.join(" ");
    html += ` <span class='pill'>Flood sites: <b>${floodCount}</b></span>`;
    if (floodLive.mode === "live"){
      html += ` <span class='pill'>Flood worst-site: <b>${safeText(floodLive.site_max)}</b> ratio <b>${fmtMaybeNumber(floodLive.max_ratio_p75, 2)}</b></span>`;
    }
    $("net").innerHTML = html;
  } else {
    $("net").textContent = "Diagnostics off";
  }

  const cCount = (cubaRes.data?.features || []).length;
  const pCount = (posRes.data?.features || []).length;
  const tCount = (trackRes.data?.features || []).length;
  const lCount = (lsRes.data?.features || []).length;
  const osmCount = (osmRes.data?.features || []).length;

  setDebug(
    `Loaded: <code>${cCount}</code> Cuba, <code>${pCount}</code> hurricane points, <code>${tCount}</code> track lines, <code>${lCount}</code> landslides, <code>${osmCount}</code> OSM assets, <code>${floodCount}</code> flood sites.` +
    (floodLive.mode === "live" ? `<br><span class='small muted'>Flood worst-site: <b>${safeText(floodLive.site_max)}</b> ratio (max/p75) <b>${fmtMaybeNumber(floodLive.max_ratio_p75, 2)}</b></span>` : "")
  );

  $("status").textContent = "Ready";
  $("ts").textContent = new Date().toLocaleString();
  runTests(metrics);
}

function showFatal(e){
  $("status").textContent = "Error";
  setDebug(`<b>Error:</b> ${safeText(safeErr(e))}`);
  console.error(e);
}

$("btnReload").addEventListener("click", () => boot().catch(showFatal));
$("offline").addEventListener("change", () => boot().catch(showFatal));
$("diag").addEventListener("change", () => boot().catch(showFatal));

try{
  const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (isLocal) SERVICES.proxyBase = "/proxy?url=";
}catch{}

boot().catch(showFatal);
