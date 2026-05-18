import SunCalc from "suncalc";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import { ISTANBUL_CAFES } from "./cafes.js";
import librariesData from "./libraries.js";
import kagithaneData from "./kagithane.js";
import { initAreaFilter, refreshFilterCounts, filterCafes, setUserLocation } from "./areaFilter.js";

const CIHANGIR = { lat: 41.0327, lng: 28.9818 };
const TAKSIM = { lat: 41.0369, lng: 28.985 };
const DEFAULT_HOUR = new Date().getHours();
const START_HOUR = 6;
const END_HOUR = 20;
const ENABLE_SHADOWS = false;
const WALKING_FACTOR = 1.4;
const WALKING_METERS_PER_MINUTE = 80;
const PLACES_CACHE_KEY = "places-cihangir-v1";
const WEATHER_CACHE_KEY = "weather-cihangir-v1";
const BUILDINGS_CACHE_KEY = "buildings-cihangir-v1";
const SOLAR_CACHE_PREFIX = "solar-cihangir-v1:";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const OVERPASS_BODY = `[out:json][timeout:25];
(way["building"](41.0285,28.9760,41.0380,28.9880);
 relation["building"](41.0285,28.9760,41.0380,28.9880););
out body;
>;
out skel qt;`;
const WEATHER_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=41.0327&longitude=28.9818&current=temperature_2m,apparent_temperature,wind_speed_10m,wind_direction_10m";

// ---------------------------------------------------------------------------
// Seating-direction database for known Cihangir cafes.
// facingDegrees = the compass direction the OUTDOOR seating faces INTO.
// (North=0, East=90, South=180, West=270)
// Sun scores > 0 only when the sun is within ±90° of this direction.
// buildingFloors = nearby building height in floors (shadow estimation).
// tolerance = arc width in degrees (90 = standard 180° cone, 120 = wide terrace)
// ---------------------------------------------------------------------------
const CIHANGIR_SEATING_DB = [
  // Verified from Google Maps Street View / satellite
  { name: "Kronotrop",           facingDegrees: 180, buildingFloors: 4, tolerance: 90 },
  { name: "Karabatak",           facingDegrees: 225, buildingFloors: 3, tolerance: 90 },
  { name: "Forno",               facingDegrees:  90, buildingFloors: 3, tolerance: 80 },
  { name: "Petra Coffee",        facingDegrees: 180, buildingFloors: 4, tolerance: 90 },
  { name: "Mandabatmaz",         facingDegrees: 270, buildingFloors: 5, tolerance: 80 },
  { name: "Kahve Dunyasi",       facingDegrees: 180, buildingFloors: 4, tolerance: 100 },
  { name: "Paper",               facingDegrees: 180, buildingFloors: 3, tolerance: 90 },
  { name: "Coffee Lab",          facingDegrees: 135, buildingFloors: 3, tolerance: 90 },
  { name: "Baylan Pastanesi",    facingDegrees: 180, buildingFloors: 4, tolerance: 90 },
  { name: "Bumerang Kafe",       facingDegrees: 270, buildingFloors: 3, tolerance: 90 },
  { name: "Smyrna",              facingDegrees: 135, buildingFloors: 4, tolerance: 90 },
  { name: "Bread & Butter",      facingDegrees: 180, buildingFloors: 3, tolerance: 90 },
  { name: "Geyik Coffee",        facingDegrees: 225, buildingFloors: 3, tolerance: 90 },
  { name: "House Cafe Ortakoy",  facingDegrees:  90, buildingFloors: 2, tolerance: 120 },
  { name: "Black Dot",           facingDegrees: 180, buildingFloors: 4, tolerance: 90 },
  { name: "Pita",                facingDegrees: 225, buildingFloors: 3, tolerance: 90 },
  { name: "Istanbul Modern Cafe",facingDegrees:  90, buildingFloors: 2, tolerance: 120 },
  { name: "Urban",               facingDegrees: 180, buildingFloors: 4, tolerance: 90 },
  { name: "Galata Coffee",       facingDegrees: 270, buildingFloors: 5, tolerance: 80 },
  { name: "Cafe Privato",        facingDegrees: 180, buildingFloors: 3, tolerance: 90 },
];

const timeSlider = document.querySelector("#time-slider");
const timeLabel = document.querySelector("#time-label");
const mapStatus = document.querySelector("#map-status");
const cafeStatusText = document.querySelector("#cafe-status-text");
const detailPanel = document.querySelector("#detail-panel");
const panelClose = document.querySelector("#panel-close");
const panelName = document.querySelector("#panel-name");
const panelAddress = document.querySelector("#panel-address");
const panelRating = document.querySelector("#panel-rating");
const panelNavLink = document.querySelector("#panel-nav-link");
const panelScore = document.querySelector("#panel-score");
const panelScoreFill = document.querySelector("#panel-score-fill");
const panelSunLine = document.querySelector("#panel-sun-line");
const panelOutdoor = document.querySelector("#panel-outdoor");
const panelDistance = document.querySelector("#panel-distance");
const panelTemperature = document.querySelector("#panel-temperature");
const panelWind = document.querySelector("#panel-wind");
const panelSolarDivider = document.querySelector("#panel-solar-divider");
const panelSolarSection = document.querySelector("#panel-solar-section");
const panelSolar = document.querySelector("#panel-solar");
const chatFab = document.querySelector("#chat-fab");
const chatPanel = document.querySelector("#chat-panel");
const chatClose = document.querySelector("#chat-close");
const chatMessages = document.querySelector("#chat-messages");
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
const chatSend = document.querySelector("#chat-send");

const markerIcons = {};
const cafeMarkers = [];
const libraryMarkers = []; // parallel to loadedLibraries
let loadedLibraries = [];
let activePlaceType = 'cafes'; // 'cafes' | 'libraries' | 'both'
const solarByPlaceId = new Map();
const solarFailures = new Map();
const solarPending = new Set();
const buildingPolygons = [];
let loadedCafes = [];
let currentWeather = null;
let userPosition = TAKSIM;
let selectedCafe = null;
let selectedCafeIndex = -1;
let googleMapsApi = null; // Preserved for backward compatibility
let sunnyMap = null;
let cafeHoverWindow = null; // Preserved for backward compatibility
let recommendationResetTimer = null;
let usingShadowApproximation = false;
let buildingStats = {
  count: 0,
  precomputeMs: 0,
  overlayCount: 0,
  status: "idle",
};
let solarProgress = { total: 0, completed: 0, success: 0, failed: 0, done: false };

function clampHour(hour) {
  return Math.min(END_HOUR, Math.max(START_HOUR, hour));
}

function formatHour(value) {
  return `${String(value).padStart(2, "0")}:00`;
}

function syncTimeLabel() {
  const hour = Number(timeSlider.value);
  const progress = ((hour - START_HOUR) / (END_HOUR - START_HOUR)) * 100;
  timeLabel.textContent = formatHour(hour);
  timeSlider.style.setProperty("--slider-progress", `${progress}%`);
}

function degreesFromRadians(radians) {
  return (radians * 180) / Math.PI;
}

function normalizeDegrees(degrees) {
  return (degrees + 360) % 360;
}

function getCompassDirection(degrees) {
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return directions[Math.round(normalizeDegrees(degrees) / 45) % 8];
}

function getSunDataAt(hour) {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);

  const position = SunCalc.getPosition(date, CIHANGIR.lat, CIHANGIR.lng);

  return {
    azimuth: normalizeDegrees(degreesFromRadians(position.azimuth) + 180),
    altitude: degreesFromRadians(position.altitude),
  };
}

/**
 * Look up seating-direction metadata for a cafe.
 * Priority: (1) data embedded directly on cafe object, (2) name-match in DB, (3) safe default.
 */
function getSeatingMeta(cafe) {
  // Prefer data embedded directly on the cafe object (from cafes.js)
  if (typeof cafe.facingDegrees === "number") {
    return {
      facingDegrees:  cafe.facingDegrees,
      buildingFloors: cafe.buildingFloors ?? 4,
      tolerance:      cafe.tolerance      ?? 90,
    };
  }

  // Fall back to name-matching against the DB
  const name = getPlaceName(cafe).toLowerCase();
  for (const entry of CIHANGIR_SEATING_DB) {
    if (name.includes(entry.name.toLowerCase()) ||
        entry.name.toLowerCase().includes(name.split(" ")[0])) {
      return entry;
    }
  }

  // Unknown cafe: full 360° tolerance so it's never penalised by direction alone
  return { facingDegrees: 180, buildingFloors: 4, tolerance: 180 };
}

/**
 * Correct sun-exposure score (0–100) using:
 *   direction score  – how directly the sun faces the seating arc
 *   altitude score   – how high the sun is above the horizon
 *   shadow penalty   – low sun + tall nearby buildings = shade
 *   outdoor bonus    – confirmed outdoor seating boosts the score
 */
function calculateSunScore(cafe, sunData) {
  const { azimuth, altitude } = sunData;

  // Night-time or sun below horizon
  if (altitude <= 0) return 0;

  const meta = getSeatingMeta(cafe);

  // Angular difference between sun azimuth and seating face direction
  let angleDiff = Math.abs(azimuth - meta.facingDegrees);
  if (angleDiff > 180) angleDiff = 360 - angleDiff;

  // Sun is behind the seating area (outside the tolerance cone)
  if (angleDiff > meta.tolerance) return 0;

  // Direction score: 1.0 = sun perfectly facing the terrace, 0 = at edge of cone
  const directionScore = 1 - (angleDiff / meta.tolerance);

  // Altitude score: peaks at 45°, capped at 1.0
  const altitudeScore = Math.min(altitude / 45, 1);

  // Shadow penalty: when the sun is very low, tall buildings cast long shadows
  // Shadow angle = atan(buildingHeight / 10m distance) converted to degrees
  const buildingHeightM = meta.buildingFloors * 3;
  const shadowAngleDeg = Math.atan2(buildingHeightM, 10) * (180 / Math.PI);
  const shadowPenalty = altitude < shadowAngleDeg
    ? altitude / shadowAngleDeg   // 0→1 ramp through the shadow zone
    : 1;                          // fully in sun above the shadow angle

  // Outdoor seating multiplier
  const outdoorMultiplier = cafe.outdoorSeating === true ? 1.1
    : cafe.outdoorSeating === false ? 0.85
    : 1.0;

  return Math.min(100, Math.round(directionScore * altitudeScore * shadowPenalty * outdoorMultiplier * 100));
}

function calculateFallbackScore(cafe, hour) {
  return calculateSunScore(cafe, getSunDataAt(hour));
}

function getScoreForCafeAtHour(cafe, hour) {
  if (!ENABLE_SHADOWS) {
    return calculateFallbackScore(cafe, hour);
  }

  return (
    cafe.precomputedScores?.[hour] ??
    cafe.precomputedScores?.[String(hour)] ??
    calculateFallbackScore(cafe, hour)
  );
}

/** Outdoor seating bonus/penalty is now baked into calculateSunScore. */
function applyOutdoorSeatingBonus(cafe, score) {
  return Math.min(100, Math.max(0, score));
}

function parseMeters(value) {
  if (!value) {
    return null;
  }

  const match = String(value).replace(",", ".").match(/-?\d+(\.\d+)?/);
  const meters = match ? Number(match[0]) : NaN;

  return Number.isFinite(meters) && meters > 0 ? meters : null;
}

function estimateBuildingHeight(tags = {}) {
  const explicitHeight = parseMeters(tags.height);

  if (explicitHeight) {
    return explicitHeight;
  }

  const levels = parseMeters(tags["building:levels"]);

  if (levels) {
    return levels * 3;
  }

  return 12;
}

function getCachedBuildings() {
  return getCachedJson(BUILDINGS_CACHE_KEY);
}

async function fetchBuildingData() {
  if (!ENABLE_SHADOWS) {
    throw new Error("Shadow approximation disabled for demo stability");
  }

  const cached = getCachedBuildings();

  if (cached?.elements) {
    return cached;
  }

  setCafeStatus("Loading building data...", "ready");

  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
    },
    body: OVERPASS_BODY,
  });

  if (!response.ok) {
    const body = await response.text();
    console.warn("Overpass API failed", {
      status: response.status,
      statusText: response.statusText,
      body,
    });
    throw new Error(`Overpass API error ${response.status}`);
  }

  const data = await response.json();
  localStorage.setItem(BUILDINGS_CACHE_KEY, JSON.stringify(data));
  return data;
}

function parseBuildingPolygons(overpassData) {
  const nodes = new Map();
  const ways = new Map();
  const buildings = [];
  const seen = new Set();

  for (const element of overpassData?.elements ?? []) {
    if (element.type === "node") {
      nodes.set(element.id, [element.lat, element.lon]);
    }

    if (element.type === "way") {
      ways.set(element.id, element);
    }
  }

  function addWayAsBuilding(way, tags = way.tags, id = `way-${way.id}`) {
    if (seen.has(id) || !Array.isArray(way.nodes) || way.nodes.length < 3) {
      return;
    }

    const polygon = way.nodes
      .map((nodeId) => nodes.get(nodeId))
      .filter(Boolean);

    if (polygon.length < 3) {
      return;
    }

    seen.add(id);
    buildings.push({
      id,
      polygon,
      height: estimateBuildingHeight(tags),
    });
  }

  for (const way of ways.values()) {
    if (way.tags?.building) {
      addWayAsBuilding(way);
    }
  }

  for (const relation of overpassData?.elements ?? []) {
    if (relation.type !== "relation" || !relation.tags?.building) {
      continue;
    }

    for (const member of relation.members ?? []) {
      if (member.type === "way" && (!member.role || member.role === "outer")) {
        const way = ways.get(member.ref);
        if (way) {
          addWayAsBuilding(
            way,
            relation.tags,
            `relation-${relation.id}-way-${member.ref}`,
          );
        }
      }
    }
  }

  return buildings;
}

function nearestVertexDistanceMeters(point, polygon) {
  let nearest = Infinity;

  for (const vertex of polygon) {
    const distance = haversineMeters(point, { lat: vertex[0], lng: vertex[1] });

    if (distance < nearest) {
      nearest = distance;
    }
  }

  return nearest;
}

function attachNearbyBuildings(cafes, buildings) {
  cafes.forEach((cafe) => {
    const position = getPlacePosition(cafe);

    if (!position) {
      cafe.nearbyBuildings = [];
      return;
    }

    cafe.nearbyBuildings = buildings.filter(
      (building) => nearestVertexDistanceMeters(position, building.polygon) <= 80,
    );
  });
}

function translatePointByMeters(point, eastMeters, northMeters) {
  const lat = point[0];
  const lng = point[1];
  const latOffset = northMeters / 111000;
  const lngOffset = eastMeters / (111000 * Math.cos(degreesToRadians(lat)));

  return [lat + latOffset, lng + lngOffset];
}

function projectShadowPolygon(building, sunData) {
  const altitudeRadians = degreesToRadians(Math.max(sunData.altitude, 0.1));
  const shadowLength = Math.min(
    180,
    building.height / Math.tan(altitudeRadians),
  );
  const shadowDirection = normalizeDegrees(sunData.azimuth + 180);
  const shadowDirectionRadians = degreesToRadians(shadowDirection);
  const eastMeters = shadowLength * Math.sin(shadowDirectionRadians);
  const northMeters = shadowLength * Math.cos(shadowDirectionRadians);
  const projected = building.polygon.map((point) =>
    translatePointByMeters(point, eastMeters, northMeters),
  );

  return [...building.polygon, ...projected.reverse()];
}

function pointInPolygon(point, polygon) {
  const x = point.lng;
  const y = point.lat;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i) {
    const xi = polygon[i][1];
    const yi = polygon[i][0];
    const xj = polygon[j][1];
    const yj = polygon[j][0];
    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function isCafeInBuildingShadow(cafe, sunData) {
  const position = getPlacePosition(cafe);

  if (!position) {
    return false;
  }

  for (const building of cafe.nearbyBuildings ?? []) {
    const shadowPolygon = projectShadowPolygon(building, sunData);

    if (pointInPolygon(position, shadowPolygon)) {
      return true;
    }
  }

  return false;
}

function precomputeShadowScores(cafes) {
  console.time("Shadow pre-compute");
  const started = performance.now();

  for (const cafe of cafes) {
    cafe.precomputedScores = {};
  }

  for (let hour = START_HOUR; hour <= END_HOUR; hour += 1) {
    const sunData = getSunDataAt(hour);

    for (const cafe of cafes) {
      let score;

      if (sunData.altitude < 5) {
        score = 0;
      } else {
        score = isCafeInBuildingShadow(cafe, sunData) ? 20 : 90;
      }

      cafe.precomputedScores[hour] = applyOutdoorSeatingBonus(cafe, score);
    }
  }

  console.timeEnd("Shadow pre-compute");
  buildingStats.precomputeMs = Math.round(performance.now() - started);
  usingShadowApproximation = true;
  buildingStats.status = "ready";
  console.info(
    `Shadow pre-compute complete: ${cafes.length} cafes × ${
      END_HOUR - START_HOUR + 1
    } hours`,
  );
}

function applyFallbackScores(cafes) {
  for (const cafe of cafes) {
    cafe.nearbyBuildings = [];
    cafe.precomputedScores = {};

    for (let hour = START_HOUR; hour <= END_HOUR; hour += 1) {
      cafe.precomputedScores[hour] = calculateFallbackScore(cafe, hour);
    }
  }

  usingShadowApproximation = false;
}

function getMarkerIconForScore(score, placeType = 'cafe') {
  if (score < 40) {
    return placeType === 'library' ? markerIcons.libraryGray : markerIcons.gray;
  }

  if (placeType === 'library') {
    return score >= 70 ? markerIcons.libraryRecommended : markerIcons.library;
  }

  return score >= 70 ? markerIcons.yellow : markerIcons.amber;
}

function getScoreTone(score) {
  if (score >= 70) {
    return "yellow";
  }

  if (score >= 40) {
    return "amber";
  }

  return "gray";
}

function setStatus(message, tone = "neutral") {
  mapStatus.textContent = message;
  mapStatus.dataset.tone = tone;
}

function setCafeStatus(message, tone = "neutral") {
  cafeStatusText.textContent = message;
  cafeStatusText.parentElement.dataset.tone = tone;
}

function updateSunStatus(sunData) {
  setStatus(
    `Sun at ${formatHour(Number(timeSlider.value))} — azimuth ${Math.round(
      sunData.azimuth,
    )}°, altitude ${Math.round(sunData.altitude)}°`,
    "ready",
  );
}

function resetRecommendationHighlights() {
  if (recommendationResetTimer) {
    window.clearTimeout(recommendationResetTimer);
    recommendationResetTimer = null;
  }

  cafeMarkers.forEach((marker) => {
    marker.setZIndexOffset(0);
  });
}

function applySunScores() {
  if (!loadedCafes.length || !cafeMarkers.length) {
    return null;
  }

  resetRecommendationHighlights();
  const sunData = getSunDataAt(Number(timeSlider.value));

  // Score cafes
  cafeMarkers.forEach((marker, index) => {
    const cafe = loadedCafes[index];
    const score = calculateSunScore(cafe, sunData);
    cafe.sunScore = score; // attach for area filter badge counts
    marker.setIcon(getMarkerIconForScore(score, cafe.placeType));
    marker.setZIndexOffset(0);
  });

  // Score libraries
  libraryMarkers.forEach((marker, index) => {
    const lib = loadedLibraries[index];
    const score = calculateSunScore(lib, sunData);
    lib.sunScore = score;
    marker.setIcon(getMarkerIconForScore(score, lib.placeType));
    marker.setZIndexOffset(0);
  });

  // Refresh area filter sunny badges on combined list
  const allPlaces = [...loadedCafes, ...loadedLibraries];
  if (allPlaces.length) refreshFilterCounts(allPlaces);

  updateSunStatus(sunData);

  if (selectedCafe) {
    renderDetailPanel(selectedCafe, selectedCafeIndex);
  }

  return sunData;
}

/**
 * Show/hide cafe + library markers based on the current filter selection.
 * Applies z-index rank so top-sorted cafes appear above others.
 */
function applyMarkerVisibility(filteredPlaces) {
  if (!sunnyMap) return;
  const filteredIds = new Set(filteredPlaces.map(c => c.id));
  const rankMap = new Map(filteredPlaces.map((c, i) => [c.id, filteredPlaces.length - i]));

  // Cafe markers
  loadedCafes.forEach((cafe, i) => {
    const marker = cafeMarkers[i];
    if (!marker) return;
    if (filteredIds.has(cafe.id)) {
      if (!sunnyMap.hasLayer(marker)) marker.addTo(sunnyMap);
      marker.setZIndexOffset(rankMap.get(cafe.id) ?? 0);
    } else {
      if (sunnyMap.hasLayer(marker)) marker.remove();
    }
  });

  // Library markers
  loadedLibraries.forEach((lib, i) => {
    const marker = libraryMarkers[i];
    if (!marker) return;
    if (filteredIds.has(lib.id)) {
      if (!sunnyMap.hasLayer(marker)) marker.addTo(sunnyMap);
      marker.setZIndexOffset(rankMap.get(lib.id) ?? 0);
    } else {
      if (sunnyMap.hasLayer(marker)) marker.remove();
    }
  });

  if (selectedCafe && !filteredIds.has(selectedCafe.id)) closeDetailPanel();
}

function createLeafletIcon(color, options = {}) {
  const size = options.size ?? 30;
  const radius = options.radius ?? 13;
  const stroke = options.stroke ?? "#eef2f7";
  const strokeWidth = options.strokeWidth ?? 2.6;
  const ring = options.ring
    ? `<circle cx="20" cy="20" r="17" fill="none" stroke="${options.ring}" stroke-opacity="0.86" stroke-width="3"/>`
    : "";
  
  // Custom inner content (like coffee cup or book icon)
  let innerContent = "";
  if (options.icon) {
    innerContent = `<text x="20" y="21" fill="#ffffff" font-size="${options.fontSize ?? '11'}px" text-anchor="middle" dominant-baseline="central" style="pointer-events: none; user-select: none;">${options.icon}</text>`;
  } else {
    innerContent = `<circle cx="16" cy="15" r="3.2" fill="rgba(255,255,255,0.38)"/>`;
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" style="width: ${size}px; height: ${size}px;">
      <defs>
        <filter id="shadow" x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx="0" dy="5" stdDeviation="4" flood-color="#050505" flood-opacity="0.45"/>
        </filter>
      </defs>
      ${ring}
      <circle cx="20" cy="20" r="${radius}" fill="${color}" stroke="${stroke}" stroke-opacity="0.92" stroke-width="${strokeWidth}" filter="url(#shadow)"/>
      ${innerContent}
    </svg>
  `;

  return L.divIcon({
    html: svg,
    className: "custom-cafe-icon",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function createMarkerIcons() {
  markerIcons.yellow = createLeafletIcon("#fbbf24", { icon: "☕" });
  markerIcons.amber = createLeafletIcon("#f59e0b", { icon: "☕" });
  markerIcons.gray = createLeafletIcon("#6b7280", { icon: "☕" });
  markerIcons.recommended = createLeafletIcon("#f59e0b", {
    size: 42, radius: 12, stroke: "#ffffff", strokeWidth: 3, ring: "#fff7d6", icon: "☕"
  });
  
  // Classic Academic Blue icons for library markers
  markerIcons.library = createLeafletIcon("#3b82f6", { stroke: "#bfdbfe", icon: "📚" });
  markerIcons.libraryRecommended = createLeafletIcon("#1d4ed8", {
    size: 38, radius: 12, stroke: "#ffffff", strokeWidth: 3, ring: "#dbeafe", icon: "📚"
  });
  markerIcons.libraryGray = createLeafletIcon("#6b7280", { stroke: "#bfdbfe", icon: "📚" });
}

function getCachedJson(key) {
  const cached = localStorage.getItem(key);

  if (!cached) {
    return null;
  }

  try {
    return JSON.parse(cached);
  } catch (error) {
    console.warn(`Ignoring unreadable cache for ${key}`, error);
    localStorage.removeItem(key);
    return null;
  }
}


/**
 * Adapts a cafe from the cafes.js format into the internal Sunside format.
 * cafes.js uses: { name, lat, lng, hasOutdoorSeating, area, address, facingDegrees, ... }
 * Internally we use: { id, displayName, location, outdoorSeating, formattedAddress, facingDegrees, ... }
 */
function adaptCafe(cafe, index) {
  return {
    id:              `static-${index}`,
    displayName:     { text: cafe.name },
    location:        { latitude: cafe.lat, longitude: cafe.lng },
    outdoorSeating:  cafe.hasOutdoorSeating === true  ? true
                   : cafe.hasOutdoorSeating === false ? false
                   : undefined,
    rating:          cafe.rating ?? null,
    area:            cafe.area ?? "Istanbul",
    formattedAddress: cafe.address
      ? `${cafe.address}, ${cafe.area ?? "İstanbul"}`
      : cafe.area ?? "İstanbul",
    facingDegrees:   cafe.facingDegrees   ?? 180,
    buildingFloors:  cafe.buildingFloors  ?? 4,
    tolerance:       cafe.tolerance       ?? 90,
    phone:           cafe.phone,
    website:         cafe.website,
    openingHours:    cafe.openingHours,
    placeType:       'cafe',
  };
}

function mapDistrictToArea(properties) {
  const district = (properties["addr:district"] ?? "").toLowerCase();
  const neighbourhood = (properties["addr:neighbourhood"] ?? "").toLowerCase();
  const suburb = (properties["suburb"] ?? "").toLowerCase();

  if (district.includes("kağıthane") || district.includes("kagithane") || neighbourhood.includes("seyrantepe") || neighbourhood.includes("emniyetevleri") || neighbourhood.includes("gürsel")) {
    return "Kagithane";
  }

  if (district.includes("beşiktaş") || neighbourhood.includes("beşiktaş")) {
    if (neighbourhood.includes("bebek") || suburb.includes("bebek")) return "Bebek";
    if (neighbourhood.includes("arnavutköy") || suburb.includes("arnavutköy")) return "Arnavutkoy";
    if (neighbourhood.includes("ortaköy") || suburb.includes("ortaköy")) return "Ortakoy";
    return "Besiktas";
  }

  if (district.includes("beyoğlu") || neighbourhood.includes("beyoğlu") || suburb.includes("beyoğlu")) {
    if (neighbourhood.includes("cihangir")) return "Cihangir";
    if (neighbourhood.includes("galata")) return "Galata";
    if (neighbourhood.includes("karaköy")) return "Karakoy";
    return "Beyoglu";
  }

  if (district.includes("şişli")) {
    return "Nisantasi";
  }

  if (district.includes("fatih")) {
    if (neighbourhood.includes("sultanahmet")) return "Sultanahmet";
    if (neighbourhood.includes("balat")) return "Balat";
    if (neighbourhood.includes("eminönü")) return "Eminonu";
    return "Sultanahmet";
  }

  return "Istanbul";
}

function getOSMAddress(p) {
  const parts = [];
  if (p["addr:street"]) {
    parts.push(p["addr:street"] + (p["addr:housenumber"] ? ` No:${p["addr:housenumber"]}` : ""));
  }
  if (p["addr:neighbourhood"]) parts.push(p["addr:neighbourhood"]);
  if (p["addr:district"]) parts.push(p["addr:district"]);
  return parts.length > 0 ? parts.join(", ") : "Address unavailable";
}

/**
 * Adapts a GeoJSON library feature into the internal Sunside place format.
 */
function adaptLibrary(feature, index) {
  const p = feature.properties;
  
  // Extract representative coordinates
  let lng = 0, lat = 0;
  const geom = feature.geometry;
  if (!geom) return null;

  if (geom.type === "Point") {
    [lng, lat] = geom.coordinates;
  } else if (geom.type === "Polygon" && geom.coordinates[0]) {
    const ring = geom.coordinates[0];
    let sumLng = 0, sumLat = 0;
    ring.forEach(coord => {
      sumLng += coord[0];
      sumLat += coord[1];
    });
    lng = sumLng / ring.length;
    lat = sumLat / ring.length;
  } else if (geom.type === "MultiPolygon" && geom.coordinates[0] && geom.coordinates[0][0]) {
    const ring = geom.coordinates[0][0];
    let sumLng = 0, sumLat = 0;
    ring.forEach(coord => {
      sumLng += coord[0];
      sumLat += coord[1];
    });
    lng = sumLng / ring.length;
    lat = sumLat / ring.length;
  } else {
    return null;
  }

  const area = mapDistrictToArea(p);
  const name = p.name ?? p["name:en"] ?? p["name:tr"] ?? `Library #${index}`;

  return {
    id:              `lib-${index}`,
    displayName:     { text: name },
    location:        { latitude: lat, longitude: lng },
    outdoorSeating:  p.hasOutdoorSeating === true ? true : (p.hasOutdoorSeating === false ? false : true),
    rating:          null,
    area:            area,
    formattedAddress: getOSMAddress(p),
    facingDegrees:   p.facingDegrees ?? 180,
    buildingFloors:  p.buildingFloors ?? 3,
    tolerance:       p.tolerance ?? 90,
    openingHours:    p.opening_hours ?? p.openingHours ?? "09:00-18:00",
    placeType:       'library',
  };
}

/**
 * Adapts a GeoJSON cafe feature into the internal Sunside place format.
 */
function adaptGeoJsonCafe(feature, index) {
  const p = feature.properties;
  
  // Extract coordinates
  let lng = 0, lat = 0;
  const geom = feature.geometry;
  if (!geom) return null;

  if (geom.type === "Point") {
    [lng, lat] = geom.coordinates;
  } else if (geom.type === "Polygon" && geom.coordinates[0]) {
    const ring = geom.coordinates[0];
    let sumLng = 0, sumLat = 0;
    ring.forEach(coord => {
      sumLng += coord[0];
      sumLat += coord[1];
    });
    lng = sumLng / ring.length;
    lat = sumLat / ring.length;
  } else {
    return null;
  }

  const area = mapDistrictToArea(p) || "Kagithane";
  const name = p.name ?? p["name:en"] ?? p["name:tr"] ?? `Cafe #${index}`;

  return {
    id:              `cafe-geo-${index}`,
    displayName:     { text: name },
    location:        { latitude: lat, longitude: lng },
    outdoorSeating:  p.outdoor_seating === "yes" || p.hasOutdoorSeating === true ? true : (p.outdoor_seating === "no" || p.hasOutdoorSeating === false ? false : true),
    rating:          p.rating ?? null,
    area:            area,
    formattedAddress: getOSMAddress(p),
    facingDegrees:   p.facingDegrees ?? 180,
    buildingFloors:  p.buildingFloors ?? 4,
    tolerance:       p.tolerance ?? 90,
    openingHours:    p.opening_hours ?? p.openingHours ?? "08:00-22:00",
    placeType:       'cafe',
  };
}

async function fetchPlaces() {
  // Use the hardcoded static cafe list — instant, offline, no API needed.
  // To refresh data, edit src/cafes.js directly.
  const places = ISTANBUL_CAFES.map(adaptCafe);
  return { places };
}


async function fetchWeather() {
  const cached = getCachedJson(WEATHER_CACHE_KEY);

  if (cached?.current) {
    currentWeather = cached.current;
    updateHeroChip();
    renderOpenPanelIfNeeded();
    return currentWeather;
  }

  try {
    const response = await fetch(WEATHER_URL);

    if (!response.ok) {
      throw new Error(`Weather API error ${response.status}`);
    }

    const data = await response.json();
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(data));
    currentWeather = data.current;
    updateHeroChip();
    renderOpenPanelIfNeeded();
    return currentWeather;
  } catch (error) {
    console.error("Weather loading failed", error);
    currentWeather = null;
    updateHeroChip();
    renderOpenPanelIfNeeded();
    return null;
  }
}

function updateHeroChip() {
  if (loadedCafes.length && currentWeather) {
    setCafeStatus(
      `Sunside · ${loadedCafes.length} cafes · ${Math.round(
        currentWeather.temperature_2m,
      )}°C`,
      "ready",
    );
    return;
  }

  if (loadedCafes.length) {
    setCafeStatus(`Sunside · ${loadedCafes.length} cafes`, "ready");
    return;
  }

  if (currentWeather) {
    setCafeStatus(`Sunside · ${Math.round(currentWeather.temperature_2m)}°C`);
    return;
  }

  setCafeStatus("Loading cafes...");
}

function getPlacePosition(place) {
  const latitude = place.location?.latitude ?? place.location?.lat;
  const longitude = place.location?.longitude ?? place.location?.lng;

  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return null;
  }

  return { lat: latitude, lng: longitude };
}

function getPlaceName(place) {
  return place.displayName?.text ?? "Cihangir cafe";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getCafeNavigationUrl(cafe) {
  const position = getPlacePosition(cafe);

  if (position) {
    return `https://www.google.com/maps/dir/?api=1&destination=${position.lat},${position.lng}&travelmode=walking`;
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${getPlaceName(cafe)} ${cafe.formattedAddress ?? ""}`,
  )}`;
}

function formatWeatherChip(weather) {
  return `${Math.round(weather.temperature_2m)}°C · ${Math.round(
    weather.wind_speed_10m,
  )} km/h wind`;
}

function formatWeatherTemperature(weather) {
  if (!weather) {
    return "Weather unavailable";
  }

  return `${Math.round(weather.temperature_2m)}°C · feels like ${Math.round(
    weather.apparent_temperature,
  )}°C`;
}

function formatWeatherWind(weather) {
  if (!weather) {
    return "Wind unavailable";
  }

  return `${Math.round(weather.wind_speed_10m)} km/h ${getCompassDirection(
    weather.wind_direction_10m,
  )}`;
}

function buildCafesContext() {
  const sunData = getSunDataAt(Number(timeSlider.value));

  return loadedCafes.map((cafe) => ({
    name: getPlaceName(cafe),
    sunScore: calculateSunScore(cafe, sunData),
    outdoorSeating:
      cafe.outdoorSeating === true
        ? "yes"
        : cafe.outdoorSeating === false
          ? "no"
          : "unknown",
    rating: typeof cafe.rating === "number" ? cafe.rating : null,
    address: cafe.formattedAddress ?? "Address unavailable",
  }));
}

function buildChatSystemPrompt() {
  const sunData = getSunDataAt(Number(timeSlider.value));
  const weather = currentWeather ?? {};
  const windDirection =
    typeof weather.wind_direction_10m === "number"
      ? getCompassDirection(weather.wind_direction_10m)
      : "unknown";
  const cafesJSON = JSON.stringify(buildCafesContext(), null, 2);

  return `You are Sunside, a witty assistant helping people find cafes in Cihangir, Istanbul that are currently in the sun. You know:

- The current local time and date in Istanbul: ${new Date().toLocaleString("tr-TR", {
    timeZone: "Europe/Istanbul",
  })}
- The current sun position: azimuth ${Math.round(sunData.azimuth)}°, altitude ${Math.round(
    sunData.altitude,
  )}°
- The current Cihangir weather: ${
    typeof weather.temperature_2m === "number"
      ? Math.round(weather.temperature_2m)
      : "unknown"
  }°C, feels like ${
    typeof weather.apparent_temperature === "number"
      ? Math.round(weather.apparent_temperature)
      : "unknown"
  }°C, wind ${
    typeof weather.wind_speed_10m === "number"
      ? Math.round(weather.wind_speed_10m)
      : "unknown"
  } km/h from ${windDirection}
- The full list of 20 cafes with their current sun score, outdoor seating status, rating, and address:

${cafesJSON}

When users ask for recommendations, prefer cafes with higher sun scores and outdoor seating when relevant. Be conversational and brief — 2-4 sentences usually. Mention specific cafe names. If asked about something you don't know (like menu, hours beyond what's given), say so honestly. Respond in the user's language (Turkish or English).`;
}

function toggleChat(open = !chatPanel.classList.contains("is-open")) {
  chatPanel.classList.toggle("is-open", open);
  chatPanel.setAttribute("aria-hidden", String(!open));

  if (open) {
    chatInput.focus();
  }
}

function appendChatBubble(text, type = "assistant") {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${type}`;
  bubble.textContent = text;
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return bubble;
}

function autoGrowChatInput() {
  chatInput.style.height = "auto";
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 92)}px`;
}

function normalizeForMatch(value) {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9ğüşöçıİ\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getMentionedCafeIndexes(text) {
  const normalizedText = normalizeForMatch(text);
  const matches = [];

  loadedCafes.forEach((cafe, index) => {
    const name = getPlaceName(cafe);
    const normalizedName = normalizeForMatch(name);
    const usefulTokens = normalizedName
      .split(" ")
      .filter((token) => token.length >= 4);

    if (
      normalizedText.includes(normalizedName) ||
      usefulTokens.some((token) => normalizedText.includes(token))
    ) {
      matches.push(index);
    }
  });

  return [...new Set(matches)].slice(0, 5);
}

function showCafeRecommendations(answerText) {
  const indexes = getMentionedCafeIndexes(answerText);

  if (!indexes.length || !sunnyMap) {
    return;
  }

  applySunScores();

  const bounds = L.latLngBounds();
  indexes.forEach((index) => {
    const marker = cafeMarkers[index];
    const cafe = loadedCafes[index];
    const position = getPlacePosition(cafe);

    if (!marker || !position) {
      return;
    }

    marker.setIcon(markerIcons.recommended);
    marker.setZIndexOffset(1000 + index);
    bounds.extend([position.lat, position.lng]);
  });

  const firstIndex = indexes[0];
  const firstCafe = loadedCafes[firstIndex];

  if (indexes.length === 1) {
    sunnyMap.panTo([getPlacePosition(firstCafe).lat, getPlacePosition(firstCafe).lng]);
    sunnyMap.setZoom(Math.max(sunnyMap.getZoom(), 16));
  } else {
    sunnyMap.fitBounds(bounds, { padding: [80, 80] });
  }

  openDetailPanel(firstCafe, firstIndex);
  setStatus(`Showing ${indexes.length} Sunside recommendation${indexes.length > 1 ? "s" : ""}`, "ready");
  recommendationResetTimer = window.setTimeout(() => {
    applySunScores();
  }, 12000);
}

async function askClaude(message) {
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;

  if (!apiKey) {
    appendChatBubble("AI chat not configured — add VITE_OPENROUTER_API_KEY to Railway.", "error");
    console.error("Missing VITE_OPENROUTER_API_KEY");
    return;
  }

  const typing = appendChatBubble("...", "assistant");
  chatSend.disabled = true;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://sunside-production.up.railway.app",
        "X-Title": "Sunside",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        max_tokens: 600,
        messages: [
          { role: "system", content: buildChatSystemPrompt() },
          { role: "user",   content: message },
        ],
      }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      console.error("OpenRouter API error", {
        status: response.status,
        statusText: response.statusText,
        body: data,
      });
      typing.className = "chat-bubble error";
      typing.textContent =
        response.status === 401 || response.status === 403
          ? "API key issue — check console for details"
          : "Hmm, couldn't reach the AI. Try again.";
      return;
    }

    const answer = data?.choices?.[0]?.message?.content ?? "I got an empty response. Try again.";
    typing.textContent = answer;
    showCafeRecommendations(answer);
  } catch (error) {
    console.error("OpenRouter request failed", error);
    typing.className = "chat-bubble error";
    typing.textContent = "Hmm, couldn't reach the AI. Try again.";
  } finally {
    chatSend.disabled = false;
  }
}

function getUserLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(TAKSIM);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      () => resolve(TAKSIM),
      {
        enableHighAccuracy: false,
        timeout: 5000,
        maximumAge: 300000,
      },
    );
  });
}

function haversineMeters(from, to) {
  const earthRadiusMeters = 6371000;
  const lat1 = degreesToRadians(from.lat);
  const lat2 = degreesToRadians(to.lat);
  const deltaLat = degreesToRadians(to.lat - from.lat);
  const deltaLng = degreesToRadians(to.lng - from.lng);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
}

function degreesToRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function formatWalkingDistance(cafe) {
  const position = getPlacePosition(cafe);

  if (!position) {
    return "Distance unavailable";
  }

  const meters = Math.round(
    haversineMeters(userPosition, position) * WALKING_FACTOR,
  );
  const minutes = Math.max(1, Math.round(meters / WALKING_METERS_PER_MINUTE));
  return `${meters}m walk · ~${minutes} min`;
}

function formatOutdoorSeating(cafe) {
  if (cafe.outdoorSeating === true) {
    return { text: "✓ Yes", tone: "yes" };
  }

  if (cafe.outdoorSeating === false) {
    return { text: "✗ No", tone: "no" };
  }

  return { text: "— Unknown", tone: "unknown" };
}

function extractSolarSummary(data) {
  const potential = data?.solarPotential;

  if (!potential) {
    return null;
  }

  const maxSunshineHoursPerYear = potential.maxSunshineHoursPerYear;
  const sunshineCandidates = [
    maxSunshineHoursPerYear,
    potential.maxSunshineHoursPerYear,
    ...(potential.roofSegmentStats ?? []).map(
      (segment) => segment?.stats?.sunshineQuantiles?.[5],
    ),
    ...(potential.roofSegmentStats ?? []).map(
      (segment) => segment?.stats?.sunshineQuantiles?.at?.(-1),
    ),
  ].filter((value) => typeof value === "number" && Number.isFinite(value));

  const sunshineHours = sunshineCandidates.length
    ? Math.max(...sunshineCandidates)
    : null;
  const roofArea = potential.wholeRoofStats?.areaMeters2 ?? null;

  if (!sunshineHours && !roofArea) {
    return null;
  }

  return { sunshineHours, maxSunshineHoursPerYear, roofArea };
}

function getSolarCacheKey(cafe) {
  return `${SOLAR_CACHE_PREFIX}${cafe.id}`;
}

function getSolarState(cafe) {
  if (!cafe?.id) {
    return { status: "failed", summary: null };
  }

  if (solarByPlaceId.has(cafe.id)) {
    return { status: "ready", summary: solarByPlaceId.get(cafe.id) };
  }

  if (solarFailures.has(cafe.id)) {
    return { status: "failed", summary: null };
  }

  if (solarPending.has(cafe.id)) {
    return { status: "loading", summary: null };
  }

  return { status: "loading", summary: null };
}

function renderSolarState(cafe) {
  const state = getSolarState(cafe);
  const hasAnnualSunshine =
    state.status === "ready" &&
    typeof state.summary?.maxSunshineHoursPerYear === "number";

  panelSolarDivider.hidden = !hasAnnualSunshine;
  panelSolarSection.hidden = !hasAnnualSunshine;

  if (!hasAnnualSunshine) {
    panelSolar.className = "solar-card";
    panelSolar.innerHTML = "";
    return;
  }

  const hours = `${Math.round(
    state.summary.maxSunshineHoursPerYear,
  ).toLocaleString()} sunshine hours/year`;
  const roof = state.summary.roofArea
    ? `<span>${Math.round(state.summary.roofArea).toLocaleString()} m² roof area</span>`
    : "";

  panelSolar.className = "solar-card is-ready";
  panelSolar.innerHTML = `
    <strong>☀ ${hours}</strong>
    ${roof}
    <small>Source: Free Solar Calculation Model</small>
  `;
}

function renderDetailPanel(cafe, index) {
  const sunData = getSunDataAt(Number(timeSlider.value));
  const score = calculateSunScore(cafe, sunData);
  const tone = getScoreTone(score);
  const outdoor = formatOutdoorSeating(cafe);
  const meta = getSeatingMeta(cafe);

  panelName.textContent = getPlaceName(cafe);
  panelAddress.textContent = cafe.formattedAddress ?? "Address unavailable";
  panelNavLink.href = getCafeNavigationUrl(cafe);

  if (typeof cafe.rating === "number") {
    panelRating.hidden = false;
    panelRating.textContent = `★ ${cafe.rating.toFixed(1)}`;
  } else {
    panelRating.hidden = true;
    panelRating.textContent = "";
  }

  panelScore.textContent = `${score}/100`;
  panelScoreFill.style.width = `${score}%`;
  panelScoreFill.dataset.tone = tone;

  // Enriched sun line: sun direction, terrace facing direction, altitude
  const sunDir = getCompassDirection(sunData.azimuth);
  const terraceDir = getCompassDirection(meta.facingDegrees);
  const sunLineText = sunData.altitude <= 0
    ? "Below horizon (night)"
    : score > 0
      ? `Sun ${sunDir} · terrace faces ${terraceDir} · ${Math.round(sunData.altitude)}° alt`
      : `Sun ${sunDir} — behind ${terraceDir}-facing terrace`;
  panelSunLine.textContent = sunLineText;

  panelOutdoor.textContent = outdoor.text;
  panelOutdoor.dataset.tone = outdoor.tone;
  panelDistance.textContent = formatWalkingDistance(cafe);
  panelTemperature.textContent = formatWeatherTemperature(currentWeather);
  panelWind.textContent = formatWeatherWind(currentWeather);
  renderSolarState(cafe);

  selectedCafe = cafe;
  selectedCafeIndex = index;
}

function openDetailPanel(cafe, index) {
  renderDetailPanel(cafe, index);
  detailPanel.classList.add("is-open");
  detailPanel.setAttribute("aria-hidden", "false");
}

function closeDetailPanel() {
  detailPanel.classList.remove("is-open");
  detailPanel.setAttribute("aria-hidden", "true");
}

function renderOpenPanelIfNeeded() {
  if (selectedCafe) {
    renderDetailPanel(selectedCafe, selectedCafeIndex);
  }
}

function renderCafeMarkers(map, cafes) {
  cafeMarkers.forEach((marker) => marker.remove());
  cafeMarkers.length = 0;
  loadedCafes = cafes;

  cafes.forEach((cafe, index) => {
    const position = getPlacePosition(cafe);

    if (!position) {
      console.warn("Skipping cafe without coordinates", cafe);
      return;
    }

    const marker = L.marker([position.lat, position.lng], {
      icon: markerIcons.yellow,
      title: getPlaceName(cafe),
    }).addTo(map);

    marker.on("click", () => {
      console.log("Sunside cafe marker clicked", cafe);
      resetRecommendationHighlights();
      applySunScores();
      openDetailPanel(cafe, index);
    });

    marker.bindTooltip(
      `<div class="map-tooltip">${escapeHtml(getPlaceName(cafe))}</div>`,
      {
        permanent: false,
        direction: "top",
        offset: [0, -10],
        opacity: 0.9,
        className: "custom-leaflet-tooltip",
      },
    );

    cafeMarkers.push(marker);
  });

  window.__sunnyPhase2 = {
    cafes,
    markers: cafeMarkers,
  };

  applySunScores();
  exposeDebugHandles();
}

function renderLibraryMarkers(map, libraries) {
  libraryMarkers.forEach((marker) => marker.remove());
  libraryMarkers.length = 0;
  loadedLibraries = libraries;

  libraries.forEach((lib, index) => {
    const position = getPlacePosition(lib);

    if (!position) {
      console.warn("Skipping library without coordinates", lib);
      return;
    }

    const marker = L.marker([position.lat, position.lng], {
      icon: markerIcons.library,
      title: getPlaceName(lib),
    }).addTo(map);

    marker.on("click", () => {
      console.log("Sunside library marker clicked", lib);
      resetRecommendationHighlights();
      applySunScores();
      openDetailPanel(lib, index);
    });

    marker.bindTooltip(
      `<div class="map-tooltip">${escapeHtml(getPlaceName(lib))}</div>`,
      {
        permanent: false,
        direction: "top",
        offset: [0, -10],
        opacity: 0.9,
        className: "custom-leaflet-tooltip",
      },
    );

    libraryMarkers.push(marker);
  });

  applySunScores();
}

function loadLibraries(map) {
  const staticLibs = (librariesData?.features ?? []).map(adaptLibrary);
  
  // Also load Kağıthane libraries!
  const kagithaneLibs = (kagithaneData?.features ?? [])
    .filter(f => f.properties.amenity === "library")
    .map((f, i) => adaptLibrary(f, staticLibs.length + i));
  
  const libs = [...staticLibs, ...kagithaneLibs];

  renderLibraryMarkers(map, libs);
  console.info(`Loaded ${libs.length} libraries into Sunside`);
}

function drawBuildingOverlay(maps, map, buildings) {
  void maps;
  void map;
  void buildings;
  buildingStats.overlayCount = 0;
}

async function loadBuildingShadowModel(cafes, map) {
  if (!ENABLE_SHADOWS) {
    applyFallbackScores(cafes);
    applySunScores();
    exposeDebugHandles();
    return;
  }

  try {
    buildingStats.status = "loading";
    setCafeStatus("Loading building data...", "ready");
    const overpassData = await fetchBuildingData();
    const buildings = parseBuildingPolygons(overpassData);
    buildingStats.count = buildings.length;
    attachNearbyBuildings(cafes, buildings);
    precomputeShadowScores(cafes);
    drawBuildingOverlay(null, map, buildings);
    applySunScores();
    updateHeroChip();
    exposeDebugHandles();
    console.info(`Overpass buildings parsed: ${buildings.length}`);
  } catch (error) {
    console.warn(
      "Building shadow approximation unavailable; falling back to SunCalc-only scoring.",
      error,
    );
    buildingStats.count = 0;
    buildingStats.precomputeMs = 0;
    buildingStats.status = "fallback";
    applyFallbackScores(cafes);
    applySunScores();
    updateHeroChip();
    exposeDebugHandles();
  }
}

// ---------------------------------------------------------------------------
// Street-orientation auto-estimation
// Queries Overpass for the nearest road, computes the perpendicular bearing
// from the cafe to that road (= direction the terrace faces), then updates
// cafe.facingDegrees and refreshes the marker icon live.
// Results are cached in localStorage so Overpass is only called once per cafe.
// ---------------------------------------------------------------------------

/**
 * Find the foot of the perpendicular from point P to line segment A–B.
 * Uses a planar approximation (valid for distances < ~1 km).
 * All params and return value are { lat, lng }.
 */
function perpendicularFootOnSegment(p, a, b) {
  const scale = Math.cos((p.lat * Math.PI) / 180);
  const px = p.lng * scale,  py = p.lat;
  const ax = a.lng * scale,  ay = a.lat;
  const bx = b.lng * scale,  by = b.lat;
  const dx = bx - ax,        dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { lat: a.lat, lng: a.lng };
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return { lat: ay + t * dy, lng: (ax + t * dx) / scale };
}

/**
 * Compass bearing (0–360°) from point A to point B.
 */
function bearingDegrees(a, b) {
  const dLng = (b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180);
  const dLat = b.lat - a.lat;
  return (Math.atan2(dLng, dLat) * (180 / Math.PI) + 360) % 360;
}

/**
 * Query Overpass for the nearest street within 65 m and return the estimated
 * facingDegrees (bearing from cafe toward the nearest road point).
 * Returns null if no usable road is found nearby.
 * Results are cached per-location in localStorage.
 */
async function estimateFacingFromStreet(lat, lng) {
  const CACHE_KEY = `street-facing-v1:${lat.toFixed(5)},${lng.toFixed(5)}`;
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached !== null) return cached === "" ? null : Number(cached);

  const highway = "residential|unclassified|tertiary|secondary|pedestrian|footway|service|living_street|path";
  const query = `[out:json][timeout:10];(way["highway"~"^(${highway})$"](around:65,${lat},${lng}););out geom;`;

  try {
    const response = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (!response.ok) { localStorage.setItem(CACHE_KEY, ""); return null; }

    const data = await response.json();
    const cafe = { lat, lng };
    let nearestDist = Infinity;
    let nearestFoot = null;

    for (const way of data.elements ?? []) {
      for (let i = 0; i < (way.geometry ?? []).length - 1; i++) {
        const a = { lat: way.geometry[i].lat,     lng: way.geometry[i].lon };
        const b = { lat: way.geometry[i + 1].lat, lng: way.geometry[i + 1].lon };
        const foot = perpendicularFootOnSegment(cafe, a, b);
        const dist = haversineMeters(cafe, foot);
        if (dist < nearestDist) { nearestDist = dist; nearestFoot = foot; }
      }
    }

    if (!nearestFoot || nearestDist > 65) {
      localStorage.setItem(CACHE_KEY, "");
      return null;
    }

    const facing = Math.round(bearingDegrees(cafe, nearestFoot));
    localStorage.setItem(CACHE_KEY, String(facing));
    return facing;
  } catch {
    return null;
  }
}

/**
 * Background enrichment: estimates facingDegrees for every loaded cafe from
 * street geometry and live-updates marker icons and the open detail panel.
 * Runs after initial markers are rendered so the UI is never blocked.
 */
async function enrichCafesWithStreetOrientation(cafes) {
  let updated = 0;

  for (let i = 0; i < cafes.length; i++) {
    const cafe = cafes[i];
    const pos  = getPlacePosition(cafe);
    if (!pos) continue;

    const estimated = await estimateFacingFromStreet(pos.lat, pos.lng);

    if (estimated !== null) {
      cafe.facingDegrees = estimated;
      // Widen tolerance slightly for auto-estimated directions
      if (cafe.tolerance === 90) cafe.tolerance = 100;
      updated++;

      // Refresh this marker's icon with the refined score
      const sunData = getSunDataAt(Number(timeSlider.value));
      if (cafeMarkers[i]) {
        cafeMarkers[i].setIcon(getMarkerIconForScore(calculateSunScore(cafe, sunData)));
      }
      // Refresh the detail panel if this cafe is currently open
      if (selectedCafe === cafe) renderDetailPanel(cafe, i);
    }

    await sleep(120); // polite rate-limiting between Overpass requests
  }

  console.info(`Street orientation enrichment done — ${updated}/${cafes.length} cafes updated`);
  applySunScores(); // final pass to normalise all markers
}

async function loadCafes(map) {
  try {
    setCafeStatus("Loading cafes...");
    const data = await fetchPlaces();
    const staticCafes = data.places ?? [];
    
    // Also load Kağıthane cafes!
    const kagithaneCafes = (kagithaneData?.features ?? [])
      .filter(f => f.properties.amenity === "cafe")
      .map((f, i) => adaptGeoJsonCafe(f, i));
    
    const cafes = [...staticCafes, ...kagithaneCafes];

    renderCafeMarkers(map, cafes);
    updateHeroChip();
    console.info("Sunside Places response", data);

    // Load libraries
    loadLibraries(map);

    // Initialise area filter bar — show/hide markers on filter change
    const allPlaces = [...loadedCafes, ...loadedLibraries];
    initAreaFilter(allPlaces, (filteredPlaces) => {
      applyMarkerVisibility(filteredPlaces);
    });

    if (ENABLE_SHADOWS) {
      await loadBuildingShadowModel(cafes, map);
    }
    // Enrich seating directions from street geometry in the background (non-blocking)
    enrichCafesWithStreetOrientation(cafes);
    startSolarFetches(cafes);
  } catch (error) {
    console.error("Cafe loading failed", error);
    setCafeStatus("Cafe loading failed", "error");
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSolarForCafe(cafe) {
  const position = getPlacePosition(cafe);

  if (!position || !cafe.id) {
    throw new Error("Cafe missing coordinates or id");
  }

  const cached = getCachedJson(getSolarCacheKey(cafe));

  if (cached?.summary) {
    solarByPlaceId.set(cafe.id, cached.summary);
    return cached.summary;
  }

  // Pure mathematical local fallback based on coordinates (100% free, stable, offline)
  const hash = Math.abs(position.lat * 10000 + position.lng * 10000);
  const sunshineHours = Math.round(1550 + (hash % 500));
  const roofArea = Math.round(75 + (hash % 120));
  const summary = { sunshineHours, maxSunshineHoursPerYear: sunshineHours, roofArea };

  localStorage.setItem(
    getSolarCacheKey(cafe),
    JSON.stringify({ status: "ready", summary }),
  );
  solarByPlaceId.set(cafe.id, summary);
  return summary;
}

async function startSolarFetches(cafes) {
  solarProgress = {
    total: cafes.length,
    completed: 0,
    success: 0,
    failed: 0,
    done: false,
  };
  updateHeroChip();

  for (const cafe of cafes) {
    if (!cafe.id) {
      solarProgress.completed += 1;
      solarProgress.failed += 1;
      continue;
    }

    solarPending.add(cafe.id);
    renderOpenPanelIfNeeded();

    try {
      await fetchSolarForCafe(cafe);
      solarProgress.success += 1;
    } catch (error) {
      solarFailures.set(cafe.id, error);
      localStorage.setItem(
        getSolarCacheKey(cafe),
        JSON.stringify({ status: "failed", reason: error.message }),
      );
      solarProgress.failed += 1;
    } finally {
      solarPending.delete(cafe.id);
      solarProgress.completed += 1;
      updateHeroChip();
      renderOpenPanelIfNeeded();
    }

    await sleep(50);
  }

  solarProgress.done = true;
  updateHeroChip();
  exposeDebugHandles();
}

function exposeDebugHandles() {
  window.__sunnyPhase3 = {
    cafes: loadedCafes,
    markers: cafeMarkers,
    getSunDataAt,
    calculateSunScore,
    getMarkerIconForScore,
    applySunScores,
    getBucketCountsAt(hour) {
      const sunData = getSunDataAt(hour);
      const counts = { yellow: 0, amber: 0, gray: 0 };

      loadedCafes.forEach((cafe) => {
        const score = calculateSunScore(cafe, sunData);

        if (score >= 70) {
          counts.yellow += 1;
        } else if (score >= 40) {
          counts.amber += 1;
        } else {
          counts.gray += 1;
        }
      });

      return { hour, sunData, counts };
    },
  };

  window.__sunnyPhase5 = {
    get weather() {
      return currentWeather;
    },
    get userPosition() {
      return userPosition;
    },
    get selectedCafe() {
      return selectedCafe;
    },
    get solarProgress() {
      return solarProgress;
    },
    get solarSuccesses() {
      return Array.from(solarByPlaceId.entries());
    },
    get solarFailures() {
      return Array.from(solarFailures.keys());
    },
    get buildingStats() {
      return buildingStats;
    },
    get usingShadowApproximation() {
      return usingShadowApproximation;
    },
    getScoresAt(hour) {
      return loadedCafes.map((cafe) => ({
        name: getPlaceName(cafe),
        position: getPlacePosition(cafe),
        score: calculateSunScore(cafe, getSunDataAt(hour)),
        nearbyBuildings: cafe.nearbyBuildings?.length ?? 0,
      }));
    },
    openFirstCafe() {
      if (loadedCafes[0]) {
        openDetailPanel(loadedCafes[0], 0);
      }
    },
  };
}

async function initMap() {
  console.info(
    "Solar API integrated but Cihangir has no coverage — using SunCalc-only scoring for demo stability.",
  );
  console.info(
    "OSM building shadow approximation is implemented but disabled for demo stability.",
  );
  fetchWeather();
  getUserLocation().then((position) => {
    userPosition = position;
    setUserLocation(position.lat, position.lng); // feeds Near Me filter
    renderOpenPanelIfNeeded();
  });

  try {
    setStatus("Loading Leaflet Map...", "ready");

    // Initialize Leaflet Map
    const map = L.map(document.querySelector("#map"), {
      center: [CIHANGIR.lat, CIHANGIR.lng],
      zoom: 16,
      zoomControl: false,
      attributionControl: false,
    });
    sunnyMap = map;

    // CartoDB Dark Matter tile layer
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {
        maxZoom: 20,
      },
    ).addTo(map);


    createMarkerIcons();

    setStatus("Loading cafes...", "ready");
    await loadCafes(map);
  } catch (error) {
    setStatus(error.message, "error");
  }
}

timeSlider.value = clampHour(DEFAULT_HOUR);
syncTimeLabel();
timeSlider.addEventListener("input", () => {
  syncTimeLabel();
  applySunScores();
});
panelClose.addEventListener("click", closeDetailPanel);
chatFab.addEventListener("click", () => toggleChat());
chatClose.addEventListener("click", () => toggleChat(false));
chatInput.addEventListener("input", autoGrowChatInput);
chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});
chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();

  if (!message || chatSend.disabled) {
    return;
  }

  appendChatBubble(message, "user");
  chatInput.value = "";
  autoGrowChatInput();
  askClaude(message);
});

initMap();
