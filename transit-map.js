/* Leaflet UI for Transitous v6. Bus markers are estimates, never GPS fixes. */
'use strict';
window.createTransitMap = function ({ tr, fmtTime, apiBase, getLanguage }) {
  const $ = id => document.getElementById(id);
  const core = window.PassauMapCore;
  const cityBounds = [[48.53, 13.35], [48.61, 13.51]];
  let map, stopsLayer, routeLayer, busesLayer, endpointsLayer;
  let visible = false, selecting = 'from', from = null, to = null;
  let stops = [], itineraries = [], segments = [], selectedRoute = -1;
  let routeAbort, mapAbort, timer, moveTimer, lastFetch = 0, lastSuccess = 0;
  let routeVersion = 0, busMarkers = new Map(), refreshError = false;
  let routeStatus = 'mapPick', stopStatus = '', busStatus = 'mapTrackingOff';
  let destroyed = false;

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function button(text, action, className = 'map-action') {
    const node = element('button', text, className); node.type = 'button';
    node.addEventListener('click', action); return node;
  }
  function setStatus(id, key) { $(id).textContent = tr(key); }
  function pointOf(place) { const point = [place?.lat, place?.lon]; return core.validPoint(point) ? point : null; }
  async function request(path, params, signal) {
    const url = new URL(apiBase + path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(cancel, 15000);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return await response.json();
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', cancel); }
  }
  function initMap() {
    if (map) return true;
    if (!window.L) { setStatus('mapRouteStatus', 'mapUnavailable'); return false; }
    map = L.map('transitMap', { zoomControl: true, minZoom: 12, maxZoom: 18,
      maxBounds: cityBounds, maxBoundsViscosity: 0.8 }).setView([48.571, 13.449], 14);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map).on('tileerror', () => setStatus('mapTileStatus', 'mapTilesFailed'));
    stopsLayer = L.layerGroup().addTo(map); routeLayer = L.layerGroup().addTo(map);
    busesLayer = L.layerGroup().addTo(map); endpointsLayer = L.layerGroup().addTo(map);
    map.on('click', event => choose({ lat: event.latlng.lat, lon: event.latlng.lng,
      name: event.latlng.lat.toFixed(5) + ', ' + event.latlng.lng.toFixed(5) }));
    map.on('moveend', () => {
      clearTimeout(moveTimer);
      moveTimer = setTimeout(() => { if (visible && !document.hidden) refreshMap(false); }, 650);
    });
    return true;
  }
  function updateEndpoints() {
    $('mapFromValue').textContent = from?.name || tr('mapSelectPoint');
    $('mapToValue').textContent = to?.name || tr('mapSelectPoint');
    $('mapChooseFrom').setAttribute('aria-pressed', String(selecting === 'from'));
    $('mapChooseTo').setAttribute('aria-pressed', String(selecting === 'to'));
    $('mapFindRoute').disabled = !from || !to;
    if (!map) return;
    endpointsLayer.clearLayers();
    for (const [place, label] of [[from, 'A'], [to, 'B']]) {
      if (!place) continue;
      const icon = L.divIcon({ className: 'map-endpoint map-endpoint-' + label.toLowerCase(), html: '<span>' + label + '</span>', iconSize: [38, 38], iconAnchor: [19, 19] });
      const marker = L.marker(pointOf(place), { icon, title: label + ': ' + place.name }).addTo(endpointsLayer);
      marker.bindPopup(element('span', label + ': ' + place.name));
    }
  }
  function invalidateRoute() {
    routeVersion++; routeAbort?.abort(); itineraries = []; selectedRoute = -1;
    routeLayer?.clearLayers(); $('mapRouteOptions').replaceChildren(); $('mapRouteSteps').replaceChildren();
    routeStatus = 'mapPick'; setStatus('mapRouteStatus', routeStatus); updateEndpoints();
  }
  function choose(place) {
    if (!pointOf(place)) return;
    if (selecting === 'from') { from = place; selecting = 'to'; } else to = place;
    invalidateRoute(); map?.closePopup();
  }
  function stopPopup(stop) {
    const popup = element('div'); popup.append(element('strong', stop.name));
    popup.append(button(tr('mapUseFrom'), () => { selecting = 'from'; choose(stop); }),
      button(tr('mapUseTo'), () => { selecting = 'to'; choose(stop); }));
    return popup;
  }
  function renderStops() {
    if (!map) return;
    stopsLayer.clearLayers();
    const term = $('mapStopSearch').value.trim().toLocaleLowerCase();
    const matching = stops.filter(stop => stop.name.toLocaleLowerCase().includes(term));
    for (const stop of stops) {
      L.circleMarker(pointOf(stop), { radius: 5, color: '#fff', weight: 2, fillColor: '#397cf6', fillOpacity: 0.95 })
        .addTo(stopsLayer).bindPopup(stopPopup(stop));
    }
    const list = $('mapStopList'); list.replaceChildren();
    for (const stop of matching.slice(0, 40)) {
      list.append(button(stop.name, () => { choose(stop); map.panTo(pointOf(stop)); }, 'map-stop-button'));
    }
    if (!matching.length && !stopStatus) list.append(element('p', tr('mapNoStops'), 'caption'));
    setStatus('mapStopsStatus', stopStatus);
  }
  function mapParams() {
    const bounds = map.getBounds();
    return { min: Math.max(48.53, bounds.getSouth()) + ',' + Math.max(13.35, bounds.getWest()),
      max: Math.min(48.61, bounds.getNorth()) + ',' + Math.min(13.51, bounds.getEast()) };
  }
  async function refreshMap(force) {
    if (!visible || document.hidden || !map) return;
    // At most one viewport refresh per 10 seconds; bus times every 60 seconds.
    if (!force && Date.now() - lastFetch < 10000) {
      clearTimeout(moveTimer); moveTimer = setTimeout(() => refreshMap(false), 10000 - (Date.now() - lastFetch)); return;
    }
    lastFetch = Date.now(); mapAbort?.abort(); mapAbort = new AbortController();
    const signal = mapAbort.signal, params = mapParams();
    $('mapRefresh').disabled = true; stopStatus = 'mapLoading'; setStatus('mapStopsStatus', stopStatus);
    const tracking = $('mapTrack').checked;
    if (tracking) { busStatus = 'mapLoading'; setStatus('mapBusStatus', busStatus); }
    const now = Date.now();
    const results = await Promise.allSettled([
      request('/api/v6/map/stops', { ...params, grouped: true, modes: 'BUS' }, signal),
      tracking ? request('/api/v6/map/trips', { ...params, zoom: Math.max(15, map.getZoom()), precision: 5,
        startTime: new Date(now - 60000).toISOString(), endTime: new Date(now + 300000).toISOString() }, signal) : Promise.resolve([])
    ]);
    if (signal.aborted || !visible) return;
    $('mapRefresh').disabled = false;
    if (results[0].status === 'fulfilled' && Array.isArray(results[0].value)) {
      const unique = new Map();
      for (const stop of results[0].value) if (pointOf(stop) && typeof stop.name === 'string') unique.set(stop.stopId || stop.name, stop);
      stops = [...unique.values()]; stopStatus = ''; renderStops();
    } else { stopStatus = 'mapStopsFailed'; setStatus('mapStopsStatus', stopStatus); }
    if (tracking && results[1].status === 'fulfilled' && Array.isArray(results[1].value)) {
      segments = results[1].value.filter(segment => segment.mode === 'BUS').map(segment => ({ ...segment, points: core.decodePolyline(segment.polyline, 5) }));
      lastSuccess = Date.now(); refreshError = false; updateBuses();
    } else if (tracking) {
      segments = []; busesLayer.clearLayers(); busMarkers.clear(); refreshError = true;
      busStatus = 'mapBusesFailed'; setStatus('mapBusStatus', busStatus);
    }
  }
  function updateBuses() {
    if (!map || !visible || document.hidden || !$('mapTrack').checked || refreshError) return;
    const now = Date.now(), active = new Map();
    if (!lastSuccess || now - lastSuccess > 120000) {
      busesLayer.clearLayers(); busMarkers.clear(); busStatus = 'mapStale'; setStatus('mapBusStatus', busStatus); return;
    }
    for (const segment of segments) {
      const point = core.estimatePosition(segment, now);
      if (!point || !map.getBounds().contains(point)) continue;
      for (const trip of segment.trips || []) {
        if (!trip.tripId || trip.cancelled) continue;
        active.set(trip.tripId, { segment, trip, point });
      }
    }
    for (const [id, marker] of busMarkers) if (!active.has(id)) { busesLayer.removeLayer(marker); busMarkers.delete(id); }
    for (const [id, { segment, trip, point }] of active) {
      let marker = busMarkers.get(id);
      if (!marker) {
        const label = element('span', undefined, 'bus-marker-content');
        const busIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        busIcon.setAttribute('viewBox', '0 0 24 24'); busIcon.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', '#i-bus'); busIcon.append(use);
        label.append(busIcon, element('span', trip.displayName || tr('mapBus')));
        const icon = L.divIcon({ className: 'bus-estimate-marker', html: label, iconSize: [84, 34], iconAnchor: [42, 17] });
        marker = L.marker(point, { icon, title: tr('mapEstimated') + ': ' + (trip.displayName || '') }).addTo(busesLayer);
        busMarkers.set(id, marker);
      } else marker.setLatLng(point);
      const popup = element('div');
      popup.append(element('strong', trip.displayName || tr('mapBus')), element('p', tr('mapEstimated')),
        element('p', (segment.from?.name || '') + ' → ' + (segment.to?.name || '')),
        element('p', fmtTime(segment.departure) + ' – ' + fmtTime(segment.arrival)),
        element('p', tr(segment.realTime ? 'mapUpdatedTimes' : 'mapScheduledTimes')),
        button(tr('mapSegmentRoute'), () => { from = segment.from; to = segment.to; invalidateRoute(); findRoute(); }));
      if (marker.isPopupOpen()) marker.setPopupContent(popup); else marker.bindPopup(popup);
    }
    busStatus = active.size ? 'mapBusCount' : 'mapNoBuses';
    $('mapBusStatus').textContent = (active.size ? active.size + ' · ' : '') + tr(busStatus) + ' · ' + tr('mapUpdated') + ' ' + fmtTime(lastSuccess);
  }
  function pathFor(leg) {
    const shape = leg.legGeometry;
    const points = shape ? core.decodePolyline(shape.points, shape.precision ?? 6) : [];
    return { points: points.length > 1 ? points : [pointOf(leg.from), pointOf(leg.to)].filter(Boolean), approximate: points.length < 2 };
  }
  function drawRoute(index) {
    if (!map || !itineraries[index]) return;
    selectedRoute = index; routeLayer.clearLayers();
    const item = itineraries[index], allPoints = [], steps = $('mapRouteSteps'); steps.replaceChildren();
    let approximate = false;
    for (const leg of item.legs || []) {
      const path = pathFor(leg); approximate ||= path.approximate;
      if (path.points.length > 1) {
        L.polyline(path.points, { color: '#ffffff', weight: leg.mode === 'WALK' ? 7 : 10,
          opacity: 0.9, interactive: false,
          dashArray: leg.mode === 'WALK' || path.approximate ? '7 8' : null }).addTo(routeLayer);
        L.polyline(path.points, { color: leg.mode === 'WALK' ? '#9263da' : '#397cf6', weight: leg.mode === 'WALK' ? 4 : 6,
          dashArray: leg.mode === 'WALK' || path.approximate ? '7 8' : null }).addTo(routeLayer);
        allPoints.push(...path.points);
      }
      const step = element('li', undefined, 'journey-step');
      step.append(element('strong', (leg.mode === 'WALK' ? tr('walkLeg') : leg.routeShortName || leg.displayName || leg.mode) +
        ' · ' + fmtTime(leg.startTime) + ' – ' + fmtTime(leg.endTime)),
        element('span', (leg.from?.name || '') + ' → ' + (leg.to?.name || '')));
      if (leg.cancelled) step.append(element('span', tr('canceled'), 'trip-cancelled'));
      steps.append(step);
      for (const stop of [leg.from, ...(leg.intermediateStops || []), leg.to]) {
        if (pointOf(stop)) L.circleMarker(pointOf(stop), { radius: 5, weight: 2, color: '#397cf6', fillColor: '#fff', fillOpacity: 1 })
          .addTo(routeLayer).bindPopup(stopPopup(stop));
      }
    }
    if (allPoints.length) map.fitBounds(L.latLngBounds(allPoints), { padding: [35, 35], maxZoom: 16 });
    routeStatus = approximate ? 'mapApproximate' : 'mapRouteReady'; setStatus('mapRouteStatus', routeStatus);
    $('mapRouteOptions').querySelectorAll('button').forEach((node, i) => node.setAttribute('aria-pressed', String(i === index)));
    updateEndpoints();
  }
  function renderRouteOptions() {
    $('mapRouteOptions').replaceChildren();
    itineraries.slice(0, 4).forEach((item, index) => {
      const label = fmtTime(item.startTime) + ' – ' + fmtTime(item.endTime) + ' · ' + Math.round(item.duration / 60) + ' ' + tr('minutes');
      const node = button(label, () => drawRoute(index), 'connection-filter');
      node.setAttribute('aria-pressed', String(index === selectedRoute)); $('mapRouteOptions').append(node);
    });
  }
  async function findRoute() {
    if (!from || !to) { setStatus('mapRouteStatus', 'mapPick'); return; }
    if (from.lat === to.lat && from.lon === to.lon) { setStatus('mapRouteStatus', 'routeSame'); return; }
    routeAbort?.abort(); routeAbort = new AbortController();
    const signal = routeAbort.signal, version = ++routeVersion;
    routeLayer?.clearLayers(); itineraries = []; $('mapRouteOptions').replaceChildren(); $('mapRouteSteps').replaceChildren();
    routeStatus = 'looking'; setStatus('mapRouteStatus', routeStatus); $('mapFindRoute').disabled = true;
    try {
      const data = await request('/api/v6/plan', {
        fromPlace: from.stopId || from.lat + ',' + from.lon, toPlace: to.stopId || to.lat + ',' + to.lon,
        transitModes: 'BUS', detailedLegs: true, detailedTransfers: true, language: getLanguage()
      }, signal);
      if (signal.aborted || version !== routeVersion) return;
      itineraries = (data.itineraries || []).filter(item => item.legs?.length);
      if (!itineraries.length) { routeStatus = 'noJourneys'; setStatus('mapRouteStatus', routeStatus); return; }
      selectedRoute = 0; renderRouteOptions(); drawRoute(0);
    } catch (error) {
      if (signal.aborted || version !== routeVersion) return;
      routeStatus = 'apiUnavailable'; setStatus('mapRouteStatus', routeStatus);
    } finally { if (version === routeVersion) updateEndpoints(); }
  }
  function pause() {
    clearInterval(timer); clearTimeout(moveTimer); mapAbort?.abort();
    busesLayer?.clearLayers(); busMarkers.clear();
    $('mapRefresh').disabled = false;
  }
  function resume() {
    if (!visible || document.hidden || !map) return;
    pause(); refreshMap(false);
    timer = setInterval(() => {
      if (visible && !document.hidden) {
        updateBuses();
        if ($('mapTrack').checked && Date.now() - lastFetch >= 60000) refreshMap(false);
      }
    }, 5000);
  }
  function show() {
    visible = true;
    if (!initMap()) return;
    requestAnimationFrame(() => { if (visible && !destroyed) { map.invalidateSize(); updateEndpoints(); resume(); } });
  }
  function hide() {
    visible = false; pause(); routeAbort?.abort(); routeVersion++;
    if (routeStatus === 'looking') { routeStatus = 'mapPick'; setStatus('mapRouteStatus', routeStatus); }
    updateEndpoints();
  }
  function showItinerary(item) {
    if (!initMap() || !item.legs?.length) return;
    routeAbort?.abort(); routeVersion++;
    from = item.legs[0].from; to = item.legs[item.legs.length - 1].to;
    itineraries = [item]; selectedRoute = 0; renderRouteOptions(); drawRoute(0);
  }
  function translate() {
    updateEndpoints(); renderStops(); renderRouteOptions();
    if (selectedRoute >= 0) drawRoute(selectedRoute); else setStatus('mapRouteStatus', routeStatus);
    setStatus('mapBusStatus', busStatus); updateBuses();
  }
  $('mapChooseFrom').addEventListener('click', () => { selecting = 'from'; updateEndpoints(); });
  $('mapChooseTo').addEventListener('click', () => { selecting = 'to'; updateEndpoints(); });
  $('mapSwap').addEventListener('click', () => { [from, to] = [to, from]; invalidateRoute(); });
  $('mapClear').addEventListener('click', () => { from = to = null; selecting = 'from'; invalidateRoute(); });
  $('mapFindRoute').addEventListener('click', findRoute);
  $('mapRefresh').addEventListener('click', () => refreshMap(true));
  $('mapStopSearch').addEventListener('input', renderStops);
  $('mapTrack').addEventListener('change', () => {
    segments = []; busesLayer?.clearLayers(); busMarkers.clear(); refreshError = false;
    busStatus = 'mapTrackingOff'; setStatus('mapBusStatus', busStatus); refreshMap(true);
  });
  const onVisibility = () => document.hidden ? pause() : resume();
  document.addEventListener('visibilitychange', onVisibility);
  return { show, hide, showItinerary, translate, destroy() { destroyed = true; hide(); document.removeEventListener('visibilitychange', onVisibility); map?.remove(); } };
};
