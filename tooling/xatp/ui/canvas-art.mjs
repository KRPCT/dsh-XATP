// Local shot sketch of a single workspace window. All marks represent layout, not study results.
export const boardSketch = `<svg class="xc-sketch" viewBox="0 0 480 194" role="img" aria-label="天坛 Agent 单屏构图草图，左侧坐标草稿与右侧原文标注处于同一工作区">
<defs>
  <linearGradient id="xc-screen" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#b8c6b2"/><stop offset="1" stop-color="#839b8e"/></linearGradient>
  <pattern id="xc-grid" width="17" height="17" patternUnits="userSpaceOnUse"><path d="M17 0H0v17" fill="none" stroke="#b7bbb0" stroke-width=".65"/></pattern>
</defs>
<rect width="480" height="194" fill="url(#xc-screen)"/>
<g fill="none" stroke="#6d8a79" opacity=".65" stroke-width=".8"><path d="M6 17h13m-6-6v13m447-7h13m-6-6v13M7 174h13m-7-7v13m448-6h13m-7-7v13"/><path d="M0 43h480M0 155h480" opacity=".35"/></g>
<rect x="37" y="16" width="409" height="161" rx="5" fill="#324a40" opacity=".32"/>
<rect x="34" y="13" width="409" height="161" rx="5" fill="#eeeae0" stroke="#687b6d"/>
<path d="M39 13h399q5 0 5 5v15H34V18q0-5 5-5Z" fill="#334a40"/>
<g fill="#b0bcb0"><circle cx="45" cy="23" r="1.8"/><circle cx="52" cy="23" r="1.8"/><circle cx="59" cy="23" r="1.8"/></g>
<g font-family="system-ui,sans-serif"><text x="73" y="26.7" fill="#f0f2e8" font-size="9.5" font-weight="600">天坛 Agent</text><text x="397" y="26" fill="#c8d2c7" font-size="8">工作区</text>
<path d="M281 33v141" stroke="#b8bcb0"/><text x="49" y="50" font-size="10.8" fill="#3d4b40" font-weight="650">模型草稿</text><text x="295" y="50" font-size="10.8" fill="#3d4b40" font-weight="650">原文证据</text>
<rect x="49" y="58" width="216" height="99" rx="3" fill="#e5e5d9"/><rect x="49" y="58" width="216" height="99" rx="3" fill="url(#xc-grid)"/>
<path d="M68 71v70h181" fill="none" stroke="#67766a" stroke-width="1.2"/><path d="m65 75 3-5 3 5m172 63 6 3-6 3" fill="none" stroke="#67766a"/>
<rect x="91" y="81" width="102" height="38" rx="2" stroke="#59785e" stroke-dasharray="3 2" fill="#d5dfcd"/>
<g fill="#526e58"><rect x="88.5" y="78.5" width="5" height="5"/><rect x="190.5" y="78.5" width="5" height="5"/><rect x="88.5" y="116.5" width="5" height="5"/><rect x="190.5" y="116.5" width="5" height="5"/></g>
<text x="104" y="103" font-size="9.5" fill="#4b6550">已选草稿区域</text><text x="86" y="134" font-size="7.5" fill="#657064">保留坐标位置</text>
<g fill="#a8ada1"><rect x="295" y="61" width="105" height="2"/><rect x="295" y="68" width="122" height="2"/><rect x="295" y="75" width="84" height="2"/></g>
<rect x="293" y="87" width="134" height="23" rx="2" fill="#e5cf94"/><text x="300" y="102" font-size="9" fill="#665637">原文标注位置</text>
<g fill="#acb0a3"><rect x="295" y="120" width="118" height="2"/><rect x="295" y="127" width="96" height="2"/><rect x="295" y="134" width="122" height="2"/></g>
<path d="M194 99h99" stroke="#9b874f" fill="none" stroke-dasharray="3 3"/><circle cx="293" cy="99" r="2.6" fill="#99814c"/>
</g></svg>`;
const strokes = {
  add:'M12 5v14M5 12h14', folder:'M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z', media:'M4 4h16v16H4zM4 16l5-5 4 4 3-3 4 4M15 8h.01', history:'M3 11a9 9 0 1 1 2 7M3 4v7h7m2-4v5l3 2', cut:'m8 9 12 11m-12-5L20 3M8 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm0 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z', cursor:'m5 3 14 10-7 1-3 7z', hand:'M6 13V8a1.5 1.5 0 0 1 3 0v4-7a1.5 1.5 0 0 1 3 0v7-8a1.5 1.5 0 0 1 3 0v8-6a1.5 1.5 0 0 1 3 0v7l1-2a1.5 1.5 0 0 1 3 1l-4 7c-1 2-3 3-6 3s-4-1-6-3l-4-5a1.4 1.4 0 0 1 2-2z', minus:'M5 12h14', fit:'M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6', wire:'M4 6h4c5 0 2 12 8 12h4M4 3v6m16 6v6', sun:'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z', undo:'M3 10h11a6 6 0 0 1 0 12M3 10l5-5m-5 5 5 5', redo:'M21 10H10a6 6 0 0 0 0 12m11-12-5-5m5 5-5 5', back:'m14 5-7 7 7 7', close:'m6 6 12 12M18 6 6 18', text:'M4 6h16M12 6v13m-4 0h8', video:'M3 6h13v12H3zM16 10l5-3v10l-5-3', film:'M3 5h18v14H3zM7 5v14m10-14v14M3 9h4m-4 6h4m10-6h4m-4 6h4', play:'m7 4 13 8-13 8z', assistant:'M12 3c1 5 4 8 9 9-5 1-8 4-9 9-1-5-4-8-9-9 5-1 8-4 9-9Z', browser:'M3 4h18v16H3zM3 9h18M6 6.5h.01m3 0h.01', arrow:'M12 20V4m-6 6 6-6 6 6', done:'m4 12 5 5L20 6', clock:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-5v5l4 2', save:'M4 3h13l3 3v15H4zM8 3v6h8V3M8 20v-7h8v7', audio:'M4 10v4m4-8v12m4-16v20m4-16v12m4-8v4', upload:'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6', panel:'M3 4h18v16H3zM15 4v16', menu:'M4 7h16M4 12h16M4 17h16', grip:'M8 7h.1m4 0h.1m4 0h.1M8 12h.1m4 0h.1m4 0h.1', link:'m8 16 8-8m-7 0 3-3a5 5 0 0 1 7 7l-3 3M8 9l-3 3a5 5 0 0 0 7 7l3-3', archive:'M3 4h18v4H3zM5 8v12h14V8m-10 5h6'
};
export function icon(doc,name,size=18) {
  const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width',size);svg.setAttribute('height',size);
  svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.65');
  svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');
  const path=doc.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',strokes[name] || strokes.film);
  svg.append(path);return svg;
}
