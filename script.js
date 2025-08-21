// =============== Helper: PM2.5 -> US AQI ===================
function pm25ToAQI(pm) {
  // US EPA breakpoints
  const bp = [
    { cLow: 0.0,   cHigh: 12.0,   iLow: 0,   iHigh: 50 },
    { cLow: 12.1,  cHigh: 35.4,   iLow: 51,  iHigh: 100 },
    { cLow: 35.5,  cHigh: 55.4,   iLow: 101, iHigh: 150 },
    { cLow: 55.5,  cHigh: 150.4,  iLow: 151, iHigh: 200 },
    { cLow: 150.5, cHigh: 250.4,  iLow: 201, iHigh: 300 },
    { cLow: 250.5, cHigh: 350.4,  iLow: 301, iHigh: 400 },
    { cLow: 350.5, cHigh: 500.4,  iLow: 401, iHigh: 500 },
  ];
  const b = bp.find(b => pm >= b.cLow && pm <= b.cHigh) || bp[bp.length - 1];
  const aqi = ((b.iHigh - b.iLow) / (b.cHigh - b.cLow)) * (pm - b.cLow) + b.iLow;
  return Math.round(aqi);
}

function aqiCategory(aqi){
  if (aqi <= 50)   return "Good";
  if (aqi <= 100)  return "Moderate";
  if (aqi <= 150)  return "Unhealthy (Sensitive)";
  if (aqi <= 200)  return "Unhealthy";
  if (aqi <= 300)  return "Very Unhealthy";
  return "Hazardous";
}

function aqiToLeafColor(aqi){
  // map 0..300 to green->yellow->red->purple
  const clamped = Math.min(300, Math.max(0, aqi));
  const hue = 120 - (clamped / 300) * 200; // 120(green) to -80(purple-ish)
  const h = Math.max(0, Math.min(360, hue));
  return `hsl(${h} 70% 45%)`;
}

function oxygenEstimate(aqi){
  // simple playful estimate (not scientific): cleaner air -> more O2 bubbles
  const base = 40;                    // g/hr
  const factor = Math.max(0.2, 1 - aqi/400);
  return Math.round(base * factor);
}

// =============== DOM ===================
const el = (id) => document.getElementById(id);
const aqiVal = el("aqiVal"), aqiCat = el("aqiCat");
const pm25El = el("pm25"), pm10El = el("pm10"), o3El = el("o3"), no2El = el("no2"), so2El = el("so2");
const gaugeFill = el("gaugeFill");
const impact = el("impact");
const statusEl = el("status");
const cityInput = el("cityInput");
const manualToggle = el("manualToggle");
const manualBox = el("manualBox");
const aqiSlider = el("aqiSlider");
const aqiSliderVal = el("aqiSliderVal");
const bubblesGroup = document.getElementById("bubbles");
const treeSvg = document.getElementById("tree");

// toggle manual
manualToggle.addEventListener("change", () => {
  manualBox.classList.toggle("hidden", !manualToggle.checked);
});

// slider display
aqiSlider.addEventListener("input", () => {
  aqiSliderVal.textContent = aqiSlider.value;
});

// manual apply
el("applyAqiBtn").addEventListener("click", () => {
  const aqi = Number(aqiSlider.value);
  applyReadings({ aqi, pm25: aqiToPM25Guess(aqi), pm10: 0, o3: 0, no2: 0, so2: 0 }, true);
});

// guess PM2.5 from AQI (inverse-ish for manual mode)
function aqiToPM25Guess(aqi){
  // rough inverse: 0..500 AQI -> 0..500 ug/m³ (not exact, good enough for demo)
  return Math.round((aqi / 500) * 200);
}

// =============== Fetching from Open-Meteo ===================
async function fetchByCity(name){
  setStatus("Searching city…");
  try{
    const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1`).then(r=>r.json());
    if(!geo?.results?.length){ setStatus("City not found."); return; }
    const { latitude, longitude, name: found } = geo.results[0];
    setStatus(`Found ${found}. Getting air data…`);
    await fetchByLatLon(latitude, longitude);
  }catch(err){ setStatus("Network error while searching city."); console.error(err); }
}

async function fetchByLatLon(lat, lon){
  try{
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=pm2_5,pm10,carbon_monoxide,ozone,nitrogen_dioxide,sulphur_dioxide&timezone=auto`;
    const data = await fetch(url).then(r=>r.json());
    const idx = data.hourly?.time?.length ? data.hourly.time.length - 1 : 0;

    const pm25 = num(data.hourly?.pm2_5?.[idx]);
    const pm10 = num(data.hourly?.pm10?.[idx]);
    const o3   = num(data.hourly?.ozone?.[idx]);
    const no2  = num(data.hourly?.nitrogen_dioxide?.[idx]);
    const so2  = num(data.hourly?.sulphur_dioxide?.[idx]);

    const aqi = pm25ToAQI(pm25);
    applyReadings({ aqi, pm25, pm10, o3, no2, so2 });
    setStatus("Live data loaded ✔");
  }catch(err){
    setStatus("Couldn’t fetch air data. Try manual mode.");
    console.error(err);
  }
}

function num(v){ return (v===null || v===undefined) ? 0 : Math.round(v); }

// =============== Apply readings to UI & Tree ===================
function applyReadings({ aqi, pm25, pm10, o3, no2, so2 }, manual=false){
  aqiVal.textContent = aqi;
  aqiCat.textContent = aqiCategory(aqi);
  pm25El.textContent = pm25;
  pm10El.textContent = pm10;
  o3El.textContent   = o3;
  no2El.textContent  = no2;
  so2El.textContent  = so2;

  // gauge (fill from left; 500 is max)
  const pct = Math.min(100, (aqi/500)*100);
  gaugeFill.style.inset = `0 ${100 - pct}% 0 0`;

  // tree color & oxygen bubbles intensity
  const clr = aqiToLeafColor(aqi);
  treeSvg.style.setProperty("--leaf", clr);
  spawnBubbles(oxygenIntensity(aqi));

  // playful O2 estimate
  impact.textContent = `Estimated O₂ release: ${oxygenEstimate(aqi)} g/hr (simulated${manual ? ", manual" : ""})`;
}

function oxygenIntensity(aqi){
  // return 0..8 bubbles per cycle
  const good = Math.max(0, 8 - Math.floor(aqi/60));
  return Math.max(1, good);
}

function spawnBubbles(count){
  bubblesGroup.innerHTML = "";
  for(let i=0;i<count;i++){
    const cx = 60 + Math.random()*80;
    const cy = 170 + Math.random()*20;
    const r = 3 + Math.random()*4;
    const dur = 3 + Math.random()*3;

    const circle = document.createElementNS("http://www.w3.org/2000/svg","circle");
    circle.setAttribute("class","bubble");
    circle.setAttribute("cx", cx);
    circle.setAttribute("cy", cy);
    circle.setAttribute("r", r);
    circle.style.animationDuration = `${dur}s`;
    circle.style.opacity = 0.25 + Math.random()*0.3;
    bubblesGroup.appendChild(circle);
  }
}

// =============== Buttons ===================
document.getElementById("searchBtn").addEventListener("click", ()=>{
  const name = cityInput.value.trim();
  if(!name) return setStatus("Type a city name first.");
  fetchByCity(name);
});

document.getElementById("locateBtn").addEventListener("click", ()=>{
  if(!("geolocation" in navigator)){
    setStatus("Geolocation not supported. Use search or manual mode.");
    return;
  }
  setStatus("Getting your location…");
  navigator.geolocation.getCurrentPosition(
    (pos)=> fetchByLatLon(pos.coords.latitude, pos.coords.longitude),
    ()=> setStatus("Location blocked. Use search or manual mode.")
  );
});

// =============== Init ===============
function setStatus(msg){ statusEl.textContent = msg; }

// default: show something nice at start
applyReadings({ aqi: 80, pm25: 20, pm10: 40, o3: 60, no2: 25, so2: 8 }, true);
setStatus("Ready. Search a city or use manual mode.");
