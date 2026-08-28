// excalidraw-svg.mjs
//
// Self-contained renderer: an excalidraw scene (elements array, standard
// excalidraw JSON) to an inline SVG string. Used by the Display node to embed
// diagrams (`{{excalidraw:<nodeId>}}` placeholders expand to these SVGs at
// serve time) so reports stay static and need no CDN or runtime JS.
// Simplified rendering (shapes + text + arrows; no roughness/hand-drawn
// effect). Deterministic: same scene -> same SVG.

function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function colorOf(el, fallback = '#1e1e1e') {
  const c = String(el.strokeColor || fallback);
  return /^#[0-9a-f]{3,8}$/i.test(c) ? c : fallback;
}

// Fill used by the compact UI preview: plain backgroundColor values
// (hex / rgb() / rgba() / CSS named colors) render as-is; anything else
// (including 'transparent') falls back to no fill.
function plainFillOf(el) {
  const raw = String(el.backgroundColor ?? '');
  if (!raw || raw === 'transparent' || raw === 'none') return 'none';
  if (/^#[0-9a-fA-F]{3,8}$/.test(raw)) return raw;
  if (/^rgba?\(/i.test(raw)) return raw;
  if (/^[a-zA-Z-]+$/.test(raw)) return raw;
  return 'none';
}

function sceneBounds(elements) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const el of elements) {
    const x = Number(el.x) || 0;
    const y = Number(el.y) || 0;
    const w = Number(el.width) || 0;
    const h = Number(el.height) || 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
    for (const p of el.points || []) {
      const px = Number(p[0] || 0) + x;
      const py = Number(p[1] || 0) + y;
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, width: 300, height: 200 };
  return { minX, minY, width: Math.max(maxX - minX, 1), height: Math.max(maxY - minY, 1) };
}

function shapeSvg(el, indent, options = {}) {
  const w = Number(el.width) || 0;
  const h = Number(el.height) || 0;
  const fill = options.fillMode === 'plain'
    ? ` fill="${plainFillOf(el)}"`
    : (el.fillStyle === 'solid' ? ` fill="${colorOf(el, el.backgroundColor || '#ffffff')}"` : ' fill="none"');
  const stroke = ` stroke="${colorOf(el)}" stroke-width="${Number(el.strokeWidth) || 2}" stroke-linejoin="round"`;
  const opacity = Number(el.opacity) >= 0 ? ` opacity="${Number(el.opacity)}"` : '';
  const pad = '  '.repeat(indent);
  if (el.type === 'ellipse') {
    return `${pad}<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}"${fill}${stroke}${opacity}/>`;
  }
  if (el.type === 'diamond') {
    const pts = `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`;
    return `${pad}<polygon points="${pts}"${fill}${stroke}${opacity}/>`;
  }
  if (el.type === 'arrow' || el.type === 'line') {
    const points = (el.points || []).map((p) => `${Number(p[0]) || 0},${Number(p[1]) || 0}`).join(' ');
    if (!points) return '';
    const marker = el.type === 'arrow'
      ? ` marker-end="url(#ex-arrow-${el.id || 'a'})"`
      : '';
    return `${pad}<polyline points="${points}" fill="none"${stroke}${opacity}${marker}/>`;
  }
  if (el.type === 'text') {
    const size = Number(el.fontSize) || 20;
    const anchor = el.textAlign === 'center' ? 'middle' : el.textAlign === 'right' ? 'end' : 'start';
    const lines = String(el.text || '').split('\n');
    const lineHeight = Math.round(size * 1.2);
    return lines.map((line, i) => (
      `${pad}<text x="${w / 2}" y="${(i + 1) * lineHeight}" font-family="sans-serif" font-size="${size}" text-anchor="${anchor}" fill="${colorOf(el)}"${opacity}>${esc(line)}</text>`
    )).join('\n');
  }
  if (el.type === 'freedraw') {
    const points = (el.points || []).map((p) => `${Number(p[0]) || 0},${Number(p[1]) || 0}`).join(' ');
    return points ? `${pad}<polyline points="${points}" fill="none"${stroke}${opacity}/>` : '';
  }
  // rectangle + fallback
  return `${pad}<rect width="${w}" height="${h}"${fill}${stroke}${opacity}/>`;
}

// Renders a scene to a standalone inline <svg> (no <html> wrapper) with the
// element transforms applied (translate to center + rotation).
// `fit: 'contain'` makes the svg fill its container (letterboxed via
// preserveAspectRatio) for live UI previews; the default keeps width-capped
// sizing for static report embeds. `fillMode: 'plain'` maps backgroundColor
// straight to fill instead of excalidraw's fillStyle semantics.
export function renderSceneSvg(elements, { width = 800, fit = 'width', fillMode = 'excalidraw' } = {}) {
  const list = Array.isArray(elements) ? elements : [];
  const bounds = sceneBounds(list);
  const pad = 24;
  const scale = Math.min(width / (bounds.width + pad * 2), 3);
  const height = Math.max(1, Math.round((bounds.height + pad * 2) * scale));
  const parts = [];
  const svgStyle = fit === 'contain'
    ? ' style="width:100%;height:100%"'
    : ` style="max-width:${width}px;height:auto"`;
  const fitAttr = fit === 'contain' ? ' preserveAspectRatio="xMidYMid meet"' : '';
  parts.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '
    + `${Math.round((bounds.width + pad * 2) * scale)} ${height}" width="100%"${fitAttr}${svgStyle}>`);
  parts.push('  <defs><marker id="ex-arrow-a" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#1e1e1e"/></marker></defs>');
  for (const el of list) {
    const x = Number(el.x) || 0;
    const y = Number(el.y) || 0;
    const w = Number(el.width) || 0;
    const h = Number(el.height) || 0;
    const angle = Number(el.angle) || 0;
    const inner = shapeSvg(el, 3, { fillMode });
    if (!inner) continue;
    const hooks = (el['data-testid'] || el['data-element-type'])
      ? ` data-testid="${esc(el['data-testid'] ?? '')}" data-element-type="${esc(el['data-element-type'] ?? '')}"`
      : '';
    // Each shape is drawn with its top-left at the local origin, so recenter
    // it on the origin (translate -w/2,-h/2) before scale/rotate; the outer
    // translate places that origin at the element's scene center. This keeps
    // unrotated elements from drifting down-right by half their size.
    parts.push(`  <g${hooks} transform="translate(${(x + w / 2 - bounds.minX + pad) * scale} ${(y + h / 2 - bounds.minY + pad) * scale}) rotate(${angle}) scale(${scale}) translate(${-w / 2} ${-h / 2})">`);
    parts.push(inner);
    parts.push('  </g>');
  }
  parts.push('</svg>');
  return parts.join('\n');
}
