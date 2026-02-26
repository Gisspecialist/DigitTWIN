:root{
  --cuba-fill: rgba(85,199,255,0.12);
  --cuba-stroke: rgba(85,199,255,0.9);
  --storm: rgba(255,204,102,0.95);
  --track: rgba(255,204,102,0.35);
  --slide: rgba(255,91,110,0.95);
  --asset: rgba(96,230,168,0.95);
}

html,body{height:100%; margin:0; font-family:system-ui,Segoe UI,Roboto,Arial;}
.wrap{display:grid; grid-template-columns:380px 1fr; height:100%;}
.panel{padding:12px; border-right:1px solid #ddd; overflow:auto; background:#fff;}
.mapWrap{position:relative; height:100%; min-height:360px;}
.map{position:absolute; inset:0;}

.h2{margin:0 0 10px 0;}
.h3{margin:0 0 8px 0;}
.card{border:1px solid #ddd; border-radius:12px; padding:10px; margin-bottom:10px; background:#fff;}
.row{display:flex; gap:8px; flex-wrap:wrap; align-items:center;}
.row-between{justify-content:space-between;}
button{padding:8px 10px; border-radius:10px; border:1px solid #ccc; background:#fff; cursor:pointer;}
button:hover{border-color:#999;}
.small{font-size:12px; color:#444; line-height:1.35;}
.muted{color:#666;}
.pill{display:inline-flex; align-items:center; gap:6px; padding:6px 10px; border:1px solid #ddd; border-radius:999px; font-size:12px; background:#fff;}
.divider{height:1px; background:#eee; margin:10px 0;}
.mt6{margin-top:6px;}
.mt8{margin-top:8px;}
.mt10{margin-top:10px;}
.mono{font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;}
code{background:#f6f6f6; padding:2px 4px; border-radius:6px;}

.badge{display:inline-block; padding:3px 8px; border-radius:999px; border:1px solid #ccc; font-size:12px;}
.critical{background:#ffe5e8; border-color:#ff5b6e;}
.warning{background:#fff0e0; border-color:#ff9b3d;}
.watch{background:#fff8db; border-color:#ffcc66;}

.legend{
  position:absolute; right:12px; bottom:12px;
  background:#fff; border:1px solid #ddd; border-radius:12px;
  padding:10px; font-size:12px; z-index:999;
  box-shadow: 0 6px 24px rgba(0,0,0,0.08);
}
.legendTitle{font-weight:700; margin-bottom:6px;}
.legendRow{display:flex; align-items:center; gap:8px; margin:6px 0;}
.swatch{width:12px; height:12px; border-radius:3px; border:1px solid #333;}
.swatch.cuba{background: var(--cuba-fill);}
.swatch.storm{background: var(--storm);}
.swatch.track{background: var(--track);}
.swatch.flood{background: var(--cuba-stroke);}
.swatch.slide{background: var(--slide);}
.swatch.asset{background: var(--asset);}
.iconLegend{display:inline-flex; width:16px; height:16px; align-items:center; justify-content:center; border:1px solid #333; border-radius:4px; font-size:12px; line-height:1;}

.leaflet-control-attribution{background:rgba(255,255,255,0.85)!important; border:1px solid #ddd!important; border-radius:10px; padding:4px 8px;}
