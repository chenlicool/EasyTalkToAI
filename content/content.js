/**
 * EasyTalk AI - Content Script
 * Injected into every page. Handles element selection, highlighting,
 * data extraction, and clipboard output.
 *
 * Single mode: Click → capture & copy
 * Multi mode:  Shift+Click → add to selection → Enter to batch copy
 */
(function () {
  'use strict';

  // ── State ──────────────────────────────────────────
  var active = false;
  var overlay = null;         // hover highlight (blue) — content box
  var overlayPadding = null;  // box model: padding layer (green)
  var overlayMargin = null;   // box model: margin layer (purple)
  var tooltip = null;         // hover label
  var toast = null;           // copy notification
  var currentTarget = null;
  var outputFormat = 'yaml';
  var tooltipFrozen = false;  // Alt key freezes tooltip for text selection
  var rafId = null;           // RAF id for mousemove throttling

  // Multi-select state
  var selections = [];        // [{ el, data, overlayEl, badgeEl, closeEl }]
  var selectionColors = [
    '#8BBF2F', // accent green (matches toggle btn)
    '#A8EA43', // bright green (matches toggle border)
    '#22C55E', // green-500
    '#34D399', // emerald-400
    '#0EA5E9', // sky-500
    '#F59E0B'  // amber-500
  ];

  // ── Init UI elements ───────────────────────────────
  function ensureUI() {
    if (!overlay) {
      overlay = createDiv('elementsnap-overlay');
      document.body.appendChild(overlay);
    }
    if (!overlayPadding) {
      overlayPadding = createDiv('elementsnap-bm-padding');
      document.body.appendChild(overlayPadding);
    }
    if (!overlayMargin) {
      overlayMargin = createDiv('elementsnap-bm-margin');
      document.body.appendChild(overlayMargin);
    }
    if (!tooltip) {
      tooltip = createDiv('elementsnap-tooltip');
      document.body.appendChild(tooltip);
    }
    if (!toast) {
      toast = createDiv('elementsnap-toast');
      document.body.appendChild(toast);
    }
  }

  function createDiv(id) {
    var d = document.createElement('div');
    d.id = id;
    return d;
  }

  // ── Activate / Deactivate ──────────────────────────
  function activate() {
    if (active) return;
    ensureUI();
    active = true;
    document.body.classList.add('elementsnap-active');
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    overlay.style.display = 'block';
    overlayPadding.style.display = 'block';
    overlayMargin.style.display = 'block';
    tooltip.style.display = 'block';
    loadSettings();
  }

  function deactivate() {
    if (!active) return;
    active = false;
    document.body.classList.remove('elementsnap-active');
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('keyup', onKeyUp, true);
    overlay.style.display = 'none';
    overlayPadding.style.display = 'none';
    overlayMargin.style.display = 'none';
    tooltip.style.display = 'none';
    currentTarget = null;
    clearSelections();
  }

  function loadSettings() {
    try {
      chrome.storage.local.get(['outputFormat'], function (result) {
        if (result.outputFormat) outputFormat = result.outputFormat;
      });
    } catch (e) { /* ignore */ }
  }

  // ── Mouse Move ─────────────────────────────────────
  function onMouseMove(e) {
    if (!active) return;

    // Alt/Option key held → freeze tooltip for text selection
    if (e.altKey) {
      if (!tooltipFrozen && currentTarget) {
        tooltipFrozen = true;
        tooltip.classList.add('es-frozen');
        overlay.classList.add('es-frozen');
        overlayPadding.classList.add('es-frozen');
        overlayMargin.classList.add('es-frozen');
      }
      return;
    }

    // Alt/Option released → unfreeze
    if (tooltipFrozen) {
      unfreezeTooltip();
    }

    var el = e.target;
    if (isOurElement(el)) return;

    // If cursor entered an iframe, hide parent overlay —
    // the iframe's own content script will handle highlighting
    if (el.tagName === 'IFRAME') {
      cancelAnimationFrame(rafId);
      rafId = null;
      currentTarget = el;
      overlay.style.display = 'none';
      overlayPadding.style.display = 'none';
      overlayMargin.style.display = 'none';
      tooltip.style.display = 'none';
      return;
    }

    currentTarget = el;
    overlay.style.display = 'block';
    overlayPadding.style.display = 'block';
    overlayMargin.style.display = 'block';
    tooltip.style.display = 'block';

    // RAF throttle: at most one updateHighlight per frame
    if (rafId) return;
    rafId = requestAnimationFrame(function () {
      updateHighlight(el, e);
      rafId = null;
    });
  }

  function updateHighlight(el, e) {
    var rect = el.getBoundingClientRect();
    var cs = getComputedStyle(el);

    // Parse box model values
    var pT = parseFloat(cs.paddingTop) || 0;
    var pR = parseFloat(cs.paddingRight) || 0;
    var pB = parseFloat(cs.paddingBottom) || 0;
    var pL = parseFloat(cs.paddingLeft) || 0;
    var bT = parseFloat(cs.borderTopWidth) || 0;
    var bR = parseFloat(cs.borderRightWidth) || 0;
    var bB = parseFloat(cs.borderBottomWidth) || 0;
    var bL = parseFloat(cs.borderLeftWidth) || 0;
    var mT = parseFloat(cs.marginTop) || 0;
    var mR = parseFloat(cs.marginRight) || 0;
    var mB = parseFloat(cs.marginBottom) || 0;
    var mL = parseFloat(cs.marginLeft) || 0;

    // ── Box Model Overlays ──────────────────────────
    // Content overlay: rect minus border and padding
    overlay.style.left   = (rect.left + bL + pL) + 'px';
    overlay.style.top    = (rect.top + bT + pT) + 'px';
    overlay.style.width  = Math.max(0, rect.width - bL - bR - pL - pR) + 'px';
    overlay.style.height = Math.max(0, rect.height - bT - bB - pT - pB) + 'px';

    // Padding overlay: thin outline at border box edge
    setBoxOverlay(overlayPadding, rect.left, rect.top, rect.width, rect.height);

    // Margin overlay: gradient frame fill (α=0.5)
    setBoxOverlay(overlayMargin, rect.left - mL, rect.top - mT,
      Math.max(0, rect.width + mL + mR), Math.max(0, rect.height + mT + mB));
    applyFrameGradient(overlayMargin, mT, mR, mB, mL, 'rgba(168, 85, 247, 0.5)');

    // ── Tooltip ─────────────────────────────────────
    var tag = el.tagName.toLowerCase();
    var dims = Math.round(rect.width) + '\u00d7' + Math.round(rect.height);
    var text = el.textContent ? el.textContent.trim().slice(0, 40) : '';
    if (text.length >= 40) text += '\u2026';

    // Style values for second row
    var textColor = cs.color;
    var fontSize = cs.fontSize;
    var fontWeight = cs.fontWeight;
    var fontFamily = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
    var bgColor = cs.backgroundColor;
    var hasBg = bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent';
    var bdWidth = bT; // use top border as representative
    var bdStyle = cs.borderTopStyle;
    var bdColor = cs.borderTopColor;
    var hasBorder = bdWidth > 0 && bdStyle !== 'none';
    var bdRadius = cs.borderRadius;
    var hasRadius = bdRadius && bdRadius !== '0px';

    // Spacing shorthands
    var padShort = boxShorthand(pT, pR, pB, pL);
    var marShort = boxShorthand(mT, mR, mB, mL);

    // Build tooltip HTML (two rows)
    var html = '';
    html += '<div class="es-row es-row-main">';
    html += '<span class="es-tag">&lt;' + tag + '&gt;</span>';
    html += escapeHtml(text || '(empty)');
    html += '<span class="es-dims">' + dims + '</span>';
    html += '</div>';

    html += '<div class="es-row-styles">';
    // Row 2: Spacing (Padding + Margin)
    html += '<div class="es-subrow">';
    html += '<span class="es-style-label">P</span>';
    html += '<span class="es-style-val">' + padShort + '</span>';
    html += '<span class="es-style-label">M</span>';
    html += '<span class="es-style-val">' + marShort + '</span>';
    html += '</div>';
    // Row 3: Dimensions (Width + Height + Border-radius)
    html += '<div class="es-subrow">';
    html += '<span class="es-style-label">W</span>';
    html += '<span class="es-style-val">' + Math.round(rect.width) + 'px</span>';
    html += '<span class="es-style-label">H</span>';
    html += '<span class="es-style-val">' + Math.round(rect.height) + 'px</span>';
    if (hasRadius) {
      html += '<span class="es-style-label">R</span>';
      html += '<span class="es-style-val">' + bdRadius + '</span>';
    }
    html += '</div>';
    // Row 4: Border (only if present)
    if (hasBorder) {
      html += '<div class="es-subrow">';
      html += '<span class="es-style-label">B</span>';
      html += '<span class="es-style-val">' + bdWidth + 'px ' + bdColor + '</span>';
      html += '</div>';
    }
    // Row 5: Colors + Typography
    html += '<div class="es-subrow">';
    html += '<span class="es-swatch" style="background-color:' + textColor + '"></span>';
    html += '<span class="es-style-val">' + rgbToHex(textColor) + '</span>';
    html += '<span class="es-style-val">' + fontSize + '/' + fontWeight + ' ' + escapeHtml(fontFamily) + '</span>';
    if (hasBg) {
      html += '<span class="es-swatch es-swatch-bg" style="background-color:' + bgColor + '"></span>';
      html += '<span class="es-style-val">' + rgbToHex(bgColor) + '</span>';
    }
    html += '</div>';
    html += '</div>';

    tooltip.innerHTML = html;

    // Position tooltip near cursor (or element if no event, e.g. unfreeze)
    var tipLeft = e ? e.clientX + 12 : rect.left;
    var tipTop = e ? e.clientY - tooltip.offsetHeight - 12 : rect.top - tooltip.offsetHeight - 6;
    if (tipTop < 4) tipTop = (e ? e.clientY : rect.bottom) + 12;
    if (tipLeft + tooltip.offsetWidth > window.innerWidth - 8) {
      tipLeft = window.innerWidth - tooltip.offsetWidth - 8;
    }
    if (tipLeft < 4) tipLeft = 4;
    if (tipTop + tooltip.offsetHeight > window.innerHeight - 8) {
      tipTop = window.innerHeight - tooltip.offsetHeight - 8;
    }

    tooltip.style.left = tipLeft + 'px';
    tooltip.style.top = tipTop + 'px';
  }

  /** Helper: set position/dimensions on a box model overlay div */
  function setBoxOverlay(div, left, top, width, height) {
    div.style.left   = left + 'px';
    div.style.top    = top + 'px';
    div.style.width  = width + 'px';
    div.style.height = height + 'px';
  }

  /**
   * Draw a frame fill: 4 linear-gradients paint top/right/bottom/left
   * strips. Center is transparent — inner layers show through.
   */
  function applyFrameGradient(div, t, r, b, l, color) {
    if (t === 0 && r === 0 && b === 0 && l === 0) {
      div.style.backgroundImage = 'none';
      return;
    }
    div.style.backgroundImage = [
      'linear-gradient(to bottom, ' + color + ', ' + color + ')',
      'linear-gradient(to bottom, ' + color + ', ' + color + ')',
      'linear-gradient(to left,   ' + color + ', ' + color + ')',
      'linear-gradient(to left,   ' + color + ', ' + color + ')'
    ].join(', ');
    div.style.backgroundSize = '100% ' + t + 'px, 100% ' + b + 'px, ' + r + 'px 100%, ' + l + 'px 100%';
    div.style.backgroundPosition = 'top, bottom, right, left';
  }

  /** Helper: compute shorthand for 4-sided spacing values */
  function boxShorthand(t, r, b, l) {
    if (t === r && r === b && b === l) return t + 'px';
    if (t === b && r === l) return t + ' ' + r;
    return t + ' ' + r + ' ' + b + ' ' + l;
  }

  // ── Click → Capture or Multi-Select ────────────────
  function onClick(e) {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    var el = currentTarget || e.target;

    if (e.shiftKey) {
      // ── Multi-select mode ──────────────────────────
      toggleSelection(el);
    } else if (selections.length > 0) {
      // ── Selections exist → click = batch copy ──────
      batchCopy();
    } else {
      // ── Single capture mode ────────────────────────
      captureSingle(el);
    }
  }

  // ── Single Capture ─────────────────────────────────
  function captureSingle(el) {
    overlay.classList.add('es-captured');
    setTimeout(function () { overlay.classList.remove('es-captured'); }, 350);

    var data = extractElementData(el);
    var text = formatOutput(data, outputFormat);
    var attrCount = data.attributes ? Object.keys(data.attributes).length : 0;
    copyToClipboard(text, function (direct) {
      showToast(el, attrCount);
    });
  }

  // ── Multi-Select Logic ─────────────────────────────
  function toggleSelection(el) {
    var existingIdx = findSelectionIndex(el);
    if (existingIdx >= 0) {
      removeSelection(existingIdx);
    } else {
      addSelection(el);
    }
  }

  function findSelectionIndex(el) {
    for (var i = 0; i < selections.length; i++) {
      if (selections[i].el === el) return i;
    }
    return -1;
  }

  function addSelection(el) {
    var idx = selections.length;
    var data = extractElementData(el);
    var color = selectionColors[idx % selectionColors.length];

    // Create selection overlay
    var selOverlay = createDiv('elementsnap-sel-overlay');
    selOverlay.className = 'es-sel-overlay';
    selOverlay.style.borderColor = color;
    selOverlay.style.background = hexToRgba(color, 0.12);

    // Number badge
    var badge = createDiv('elementsnap-sel-badge');
    badge.className = 'es-sel-badge';
    badge.textContent = idx + 1;
    badge.style.background = color;
    selOverlay.appendChild(badge);

    // Close button
    var closeBtn = createDiv('elementsnap-sel-close');
    closeBtn.className = 'es-sel-close';
    closeBtn.innerHTML = '<svg class="lucide lucide-x" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
    closeBtn.style.background = color;
    closeBtn.addEventListener('mousedown', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      removeSelection(idx);
    });
    selOverlay.appendChild(closeBtn);

    document.body.appendChild(selOverlay);

    var entry = {
      el: el,
      data: data,
      overlayEl: selOverlay,
      badgeEl: badge,
      closeEl: closeBtn
    };
    selections.push(entry);

    updateSelectionOverlay(idx);
    updateAllBadges();
  }

  function removeSelection(idx) {
    if (idx < 0 || idx >= selections.length) return;
    var entry = selections[idx];
    if (entry.overlayEl && entry.overlayEl.parentNode) {
      entry.overlayEl.parentNode.removeChild(entry.overlayEl);
    }
    selections.splice(idx, 1);
    updateAllBadges();
    refreshAllOverlays();
  }

  function clearSelections() {
    while (selections.length > 0) {
      var entry = selections.pop();
      if (entry.overlayEl && entry.overlayEl.parentNode) {
        entry.overlayEl.parentNode.removeChild(entry.overlayEl);
      }
    }
  }

  function updateAllBadges() {
    for (var i = 0; i < selections.length; i++) {
      if (selections[i].badgeEl) {
        selections[i].badgeEl.textContent = i + 1;
      }
    }
  }

  function updateSelectionOverlay(idx) {
    var entry = selections[idx];
    if (!entry || !entry.overlayEl) return;
    var rect = entry.el.getBoundingClientRect();
    var ov = entry.overlayEl;
    ov.style.left = rect.left + 'px';
    ov.style.top = rect.top + 'px';
    ov.style.width = rect.width + 'px';
    ov.style.height = rect.height + 'px';
  }

  function refreshAllOverlays() {
    for (var i = 0; i < selections.length; i++) {
      updateSelectionOverlay(i);
    }
  }

  // ════════════════════════════════════════════════════
  // ── Batch Copy ─────────────────────────────────────
  // ════════════════════════════════════════════════════
  function batchCopy() {
    if (selections.length === 0) return;

    var allText = formatBatch(selections, outputFormat);
    copyToClipboard(allText, function () {
      showBatchToast(selections.length);
    });
  }

  function formatBatch(sel, format) {
    if (format === 'json') {
      var arr = [];
      for (var i = 0; i < sel.length; i++) {
        arr.push(sel[i].data);
      }
      return JSON.stringify(arr, null, 2);
    }
    // YAML and Markdown use per-element format
    var parts = [];
    var pageUrl = sel[0] && sel[0].data && sel[0].data.pageUrl ? sel[0].data.pageUrl : '';
    if (format === 'yaml') {
      parts.push('# EasyTalk AI (' + sel.length + ' elements)');
      if (pageUrl) parts.push('# Page: ' + pageUrl);
    } else {
      parts.push('## EasyTalk AI (' + sel.length + ' elements)');
      if (pageUrl) parts.push('**Page:** `' + pageUrl + '`');
    }
    parts.push('');

    for (var j = 0; j < sel.length; j++) {
      if (format === 'yaml') {
        parts.push('# --- Element ' + (j + 1) + ' ---');
      } else {
        parts.push('### Element ' + (j + 1));
      }
      parts.push(formatOutput(sel[j].data, format));
      parts.push('');
    }
    return parts.join('\n');
  }

  // ════════════════════════════════════════════════════
  // ── Extract element data ───────────────────────────
  // ════════════════════════════════════════════════════
  function extractElementData(el) {
    var tag = el.tagName.toLowerCase();
    var rect = el.getBoundingClientRect();
    var cssSelector = ElementSnapSelector.generate(el);
    var xpathStr = ElementSnapSelector.xpath(el);

    var attrs = {};
    var priorityAttrs = [
      'type', 'name', 'value', 'placeholder', 'href', 'src', 'alt',
      'aria-label', 'aria-labelledby', 'aria-describedby',
      'data-testid', 'data-test-id', 'data-cy', 'data-qa',
      'title', 'role', 'disabled', 'readonly', 'checked', 'selected',
      'target', 'rel', 'download', 'for', 'maxlength', 'min', 'max',
      'pattern', 'required', 'autocomplete'
    ];

    for (var i = 0; i < priorityAttrs.length; i++) {
      var val = el.getAttribute(priorityAttrs[i]);
      if (val !== null && val !== '') attrs[priorityAttrs[i]] = val;
    }

    var text = el.textContent ? el.textContent.trim() : '';
    var inputValue = '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      inputValue = el.value || '';
      if (el.placeholder) attrs['placeholder'] = el.placeholder;
    }

    // Parent info
    var parent = el.parentElement;
    var parentInfo = null;
    if (parent) {
      parentInfo = {
        tag: parent.tagName.toLowerCase(),
        id: parent.id || null,
        class: getElementClassName(parent) || null
      };
    }

    // Siblings
    var siblings = [];
    if (parent) {
      var children = getElementChildren(parent);
      for (var j = 0; j < children.length; j++) {
        var child = children[j];
        if (child === el) continue;
        var siblingText = child.textContent ? child.textContent.trim().slice(0, 40) : '';
        siblings.push({
          tag: child.tagName.toLowerCase(),
          text: siblingText || '(empty)',
          id: child.id || null,
          class: getElementClassName(child) || null
        });
      }
      if (siblings.length > 8) siblings = siblings.slice(0, 8);
    }

    // Section context
    var section = el.closest('section, article, main, nav, aside, header, footer, form, [role="dialog"], [role="tabpanel"], [role="region"]');
    var sectionInfo = null;
    if (section) {
      var sectionLabel = section.getAttribute('aria-label') || section.getAttribute('aria-labelledby') || '';
      if (!sectionLabel && section.querySelector('h1,h2,h3,h4,h5,h6')) {
        sectionLabel = section.querySelector('h1,h2,h3,h4,h5,h6').textContent.trim();
      }
      sectionInfo = {
        tag: section.tagName.toLowerCase(),
        label: sectionLabel || null,
        id: section.id || null,
        class: getElementClassName(section) || null
      };
    }

    return {
      tag: tag,
      text: text || inputValue || '(no text)',
      cssSelector: cssSelector,
      xpath: xpathStr,
      id: el.id || null,
      class: getElementClassName(el) || null,
      attributes: attrs,
      dimensions: {
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      parent: parentInfo,
      siblings: siblings,
      section: sectionInfo,
      pageUrl: window.location.href,
      pageTitle: document.title || null
    };
  }

  // ── Output formatting ──────────────────────────────
  function formatOutput(data, format) {
    if (format === 'yaml') return toYAML(data);
    if (format === 'json') return JSON.stringify(data, null, 2);
    if (format === 'markdown') return toMarkdown(data);
    return toYAML(data);
  }

  function toYAML(d) {
    var lines = [];
    lines.push('Page_URL: ' + (d.pageUrl || '(unknown)'));
    if (d.pageTitle) lines.push('Page_Title: "' + d.pageTitle.replace(/"/g, '\\"') + '"');
    lines.push('Tag: ' + d.tag);
    lines.push('Text: "' + d.text.replace(/"/g, '\\"') + '"');
    lines.push('CSS_Selector: ' + d.cssSelector);
    lines.push('XPath: ' + d.xpath);
    if (d.id) lines.push('ID: ' + d.id);
    if (d.class) lines.push('Class: ' + d.class);
    lines.push('Size: ' + d.dimensions.width + 'x' + d.dimensions.height);

    var attrKeys = Object.keys(d.attributes);
    if (attrKeys.length > 0) {
      lines.push('Attributes:');
      for (var i = 0; i < attrKeys.length; i++) {
        lines.push('  ' + attrKeys[i] + ': "' + d.attributes[attrKeys[i]].replace(/"/g, '\\"') + '"');
      }
    }

    if (d.section) {
      lines.push('Section: ' + d.section.tag + (d.section.label ? ' "' + d.section.label.replace(/"/g, '\\"') + '"' : '') + (d.section.id ? ' #' + d.section.id : ''));
    }

    if (d.parent) {
      lines.push('Parent: ' + d.parent.tag + (d.parent.id ? ' #' + d.parent.id : ''));
    }

    if (d.siblings.length > 0) {
      lines.push('Siblings:');
      for (var j = 0; j < d.siblings.length; j++) {
        var s = d.siblings[j];
        lines.push('  - ' + s.tag + ': "' + s.text.replace(/"/g, '\\"') + '"' + (s.id ? ' #' + s.id : ''));
      }
    }

    return lines.join('\n');
  }

  function toMarkdown(d) {
    var md = [];
    md.push('| Property | Value |');
    md.push('|----------|-------|');
    md.push('| **Page URL** | `' + (d.pageUrl || '(unknown)') + '` |');
    if (d.pageTitle) md.push('| **Page Title** | "' + d.pageTitle + '" |');
    md.push('| **Tag** | `' + d.tag + '` |');
    md.push('| **Text** | "' + d.text + '" |');
    md.push('| **CSS Selector** | `' + d.cssSelector + '` |');
    md.push('| **XPath** | `' + d.xpath + '` |');
    if (d.id) md.push('| **ID** | `' + d.id + '` |');
    if (d.class) md.push('| **Class** | `' + d.class + '` |');
    md.push('| **Size** | ' + d.dimensions.width + '\u00d7' + d.dimensions.height + ' |');

    var attrKeys = Object.keys(d.attributes);
    if (attrKeys.length > 0) {
      md.push('');
      md.push('### Key Attributes');
      for (var i = 0; i < attrKeys.length; i++) {
        md.push('- `' + attrKeys[i] + '`: "' + d.attributes[attrKeys[i]] + '"');
      }
    }

    if (d.section) {
      md.push('');
      md.push('### Section Context');
      md.push('- **' + d.section.tag + '**' + (d.section.label ? ' \u2014 "' + d.section.label + '"' : '') + (d.section.id ? ' (`#' + d.section.id + '`)' : ''));
    }

    return md.join('\n');
  }

  // ── Clipboard ──────────────────────────────────────
  function copyToClipboard(text, onSuccess) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          if (onSuccess) onSuccess(true);
        }).catch(function () {
          fallbackCopy(text, onSuccess);
        });
        return;
      }
    } catch (e) {
      /* fall back below */
    }
    fallbackCopy(text, onSuccess);
  }

  function fallbackCopy(text, onSuccess) {
    var ta = document.createElement('textarea');
    var parent = document.body || document.documentElement;
    var copied = false;
    ta.value = text;
    ta.setAttribute('readonly', 'readonly');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '-9999px';
    parent.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      copied = document.execCommand('copy');
    } catch (e) {
      copied = false;
    }
    parent.removeChild(ta);

    if (copied) {
      if (onSuccess) onSuccess(false);
    } else {
      showErrorToast('Copy failed - please try again');
    }
  }

  function getElementClassName(el) {
    var cls = el && el.className;
    if (!cls) return '';
    if (typeof cls === 'string') return cls;
    if (typeof cls.baseVal === 'string') return cls.baseVal;
    if (el.getAttribute) return el.getAttribute('class') || '';
    return String(cls);
  }

  function getElementChildren(el) {
    var arr = [];
    if (!el || !el.children) return arr;
    for (var i = 0; i < el.children.length; i++) {
      arr.push(el.children[i]);
    }
    return arr;
  }

  // ── Toast ──────────────────────────────────────────
  var toastTimer = null;
  function showToast(el, attrCount) {
    var tag = el.tagName.toLowerCase();
    var preview = el.textContent ? el.textContent.trim().slice(0, 30) : '';
    var countBadge = (attrCount > 0) ? '<span class="es-badge es-badge-css">' + attrCount + ' attrs</span>' : '';
    toast.innerHTML =
      '<span class="es-icon"><svg class="lucide lucide-check" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>' +
      '<div class="es-toast-body">' +
      '<span class="es-toast-title">Copied &lt;' + tag + '&gt;</span>' +
      (preview ? '<span class="es-preview">' + escapeHtml(preview) + '</span>' : '') +
      countBadge +
      '</div>';

    toast.classList.add('es-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove('es-visible');
    }, 2500);
  }

  function showBatchToast(count) {
    toast.innerHTML =
      '<span class="es-icon"><svg class="lucide lucide-check" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span> Copied ' + count + ' elements';

    toast.classList.add('es-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove('es-visible');
    }, 2500);
  }

  function showErrorToast(msg) {
    toast.innerHTML =
      '<span class="es-icon es-icon-error"><svg class="lucide lucide-alert-circle" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></span> ' + msg;

    toast.classList.add('es-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove('es-visible');
    }, 3000);
  }

  // ── Keyboard ───────────────────────────────────────
  function onKeyDown(e) {
    // Cmd+C / Ctrl+C → replicate mode
    if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 'c') {
      if (currentTarget && selections.length === 0) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        replicateElement(currentTarget);
        return;
      }
      // No target → show hint
      if (!currentTarget && selections.length === 0) {
        e.preventDefault();
        showErrorToast('Hover over an element first, then press ' + (e.metaKey ? '⌘C' : 'Ctrl+C') + ' to copy its style spec');
        return;
      }
    }

    // Alt/Option: freeze tooltip for text selection (primary trigger)
    if (e.key === 'Alt' && !e.metaKey && !e.ctrlKey) {
      if (currentTarget && !tooltipFrozen) {
        tooltipFrozen = true;
        tooltip.classList.add('es-frozen');
        overlay.classList.add('es-frozen');
        overlayPadding.classList.add('es-frozen');
        overlayMargin.classList.add('es-frozen');
        e.preventDefault();
      }
      return;
    }

    if (e.key === 'Escape') {
      if (tooltipFrozen) {
        unfreezeTooltip();
        return;
      }
      if (selections.length > 0) {
        clearSelections();
      } else {
        deactivate();
      }
    } else if (e.key === 'Enter' && selections.length > 0) {
      e.preventDefault();
      batchCopy();
    }
  }

  function onKeyUp(e) {
    if (e.key === 'Alt' && tooltipFrozen) {
      unfreezeTooltip();
    }
  }

  function unfreezeTooltip() {
    tooltipFrozen = false;
    tooltip.classList.remove('es-frozen');
    overlay.classList.remove('es-frozen');
    overlayPadding.classList.remove('es-frozen');
    overlayMargin.classList.remove('es-frozen');
    if (currentTarget && !isOurElement(currentTarget)) {
      updateHighlight(currentTarget);
    }
  }

  // ════════════════════════════════════════════════════
  // ── Replicate Mode (Cmd+C) ─────────────────────────
  // ════════════════════════════════════════════════════

  /**
   * Extract the visual design spec from an element — layout, color, typography,
   * spacing, border, shadow, states, and structural skeleton.
   * Output is an AI-friendly prompt designed for pure-text models.
   */
  function replicateElement(el) {
    // Pulse visual feedback
    overlay.classList.add('es-captured');
    setTimeout(function () { overlay.classList.remove('es-captured'); }, 350);

    var visual;
    var states;
    var skeleton;
    var context;
    var keyframes;
    var animLib;
    try {
      visual = extractVisualSpec(el);
      states = extractStateSpec(el);
      skeleton = buildStructureSkeleton(el);
      context = extractContextSpec(el);
      keyframes = extractKeyframes(el);
      animLib = detectAnimationLib();
    } catch (e) {
      showErrorToast('Style capture failed - try a parent element');
      return;
    }

    var info = {
      visual: visual,
      states: states,
      skeleton: skeleton,
      context: context,
      keyframes: keyframes,
      animLib: animLib,
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: getElementClassName(el) || null,
      pageUrl: window.location.href,
      pageTitle: document.title || null
    };

    var prompt = buildReplicatePrompt(info);

    copyToClipboard(prompt, function (direct) {
      showReplicateToast(el, info);
    });
  }

  // ── 1. Visual Spec ─────────────────────────────────
  var VISUAL_PROPS = [
    // Layout
    'display', 'flex-direction', 'align-items', 'justify-content', 'gap',
    'flex-wrap', 'align-self',
    // Grid
    'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row',
    // Dimensions
    'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
    // Spacing
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    // Background
    'background-color', 'background-image', 'background-size',
    'background-position', 'background-repeat',
    // Border
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-style', 'border-radius',
    // Shadow
    'box-shadow',
    // Typography
    'color', 'font-size', 'font-weight', 'font-family',
    'line-height', 'text-align', 'letter-spacing', 'text-transform',
    'text-decoration', 'white-space', 'word-break',
    // Visual
    'opacity', 'transform', 'transition', 'animation',
    'animation-name', 'animation-duration', 'animation-delay',
    'animation-timing-function', 'animation-iteration-count',
    'animation-fill-mode', 'animation-direction', 'animation-play-state',
    'cursor',
    'overflow', 'overflow-x', 'overflow-y',
    'position', 'z-index',
    // Misc
    'outline', 'outline-offset', 'object-fit'
  ];

  function extractVisualSpec(el) {
    var cs = getComputedStyle(el);
    var spec = {};

    for (var i = 0; i < VISUAL_PROPS.length; i++) {
      var prop = VISUAL_PROPS[i];
      var val = cs.getPropertyValue(prop);
      if (!val || val === 'normal' || val === 'none' || val === 'auto' ||
          val === 'rgba(0, 0, 0, 0)' || val === '0px' || val === '0s' ||
          val === 'transparent' || val === '0' || val === 'visible' ||
          val === 'static' || val === '0 0 0 0' || val === 'start') {
        continue; // skip defaults / empty values
      }
      spec[prop] = val;
    }

    // Simplify padding/margin shorthand when all 4 sides equal
    spec = simplifyShorthand(spec, 'padding');
    spec = simplifyShorthand(spec, 'margin');

    return spec;
  }

  function simplifyShorthand(obj, prefix) {
    var t = obj[prefix + '-top'];
    var r = obj[prefix + '-right'];
    var b = obj[prefix + '-bottom'];
    var l = obj[prefix + '-left'];

    if (t === r && r === b && b === l && t !== undefined) {
      obj[prefix] = t;
      delete obj[prefix + '-top'];
      delete obj[prefix + '-right'];
      delete obj[prefix + '-bottom'];
      delete obj[prefix + '-left'];
    }
    return obj;
  }

  // ── 2. Interaction States ──────────────────────────
  function extractStateSpec(el) {
    var states = { hover: [], active: [], focus: [] };
    var classStr = getElementClassName(el);
    var classes = classStr.split(/\s+/);

    // Parse Tailwind state modifiers: hover:*, focus:*, active:*
    var stateMap = { hover: [], active: [], focus: [] };
    for (var i = 0; i < classes.length; i++) {
      var cls = classes[i];
      if (!cls) continue;

      for (var state in stateMap) {
        var prefix = state + ':';
        if (cls.indexOf(prefix) === 0) {
          stateMap[state].push(cls.slice(prefix.length));
          break;
        }
      }
    }

    for (var s in stateMap) {
      if (stateMap[s].length > 0) {
        states[s] = stateMap[s];
      }
    }

    // Also scan stylesheets for pseudo-class rules (best-effort, CORS-safe)
    try {
      var sheets = document.styleSheets;
      for (var si = 0; si < sheets.length; si++) {
        try {
          var rules = sheets[si].cssRules;
          if (!rules) continue;
          for (var ri = 0; ri < rules.length; ri++) {
            var rule = rules[ri];
            if (rule.type !== CSSRule.STYLE_RULE) continue;
            var sel = rule.selectorText;
            if (!sel) continue;

            var pseudo = null;
            if (/:hover/.test(sel)) pseudo = 'hover';
            else if (/:active/.test(sel)) pseudo = 'active';
            else if (/:focus-visible/.test(sel) || /:focus/.test(sel)) pseudo = 'focus';
            if (!pseudo) continue;

            // Check if the base selector matches our element
            var baseSel = sel.replace(/:hover|:active|:focus-visible|:focus/g, '');
            if (isAncestorOfSelf(el, baseSel)) {
              var styleObj = {};
              for (var pi = 0; pi < rule.style.length; pi++) {
                var pname = rule.style[pi];
                styleObj[pname] = rule.style.getPropertyValue(pname);
              }
              if (Object.keys(styleObj).length > 0 && !Array.isArray(states[pseudo])) {
                states[pseudo] = styleObj;
              }
            }
          }
        } catch (e) { /* CORS */ }
      }
    } catch (e) { /* ignore */ }

    return states;
  }

  function isAncestorOfSelf(el, selector) {
    try {
      return el.matches(selector) || el.closest(selector);
    } catch (e) {
      return false;
    }
  }

  // ── 3. Structure Skeleton ──────────────────────────
  var SKIP_TAGS = { script: 1, style: 1, noscript: 1, link: 1, meta: 1, br: 1 };
  var INLINE_TAGS = {
    span: 1, a: 1, strong: 1, em: 1, b: 1, i: 1, u: 1, small: 1, mark: 1,
    code: 1, kbd: 1, time: 1, abbr: 1, label: 1, sub: 1, sup: 1
  };

  function buildStructureSkeleton(el, depth) {
    if (!depth) depth = 0;
    if (depth > 5) return null; // max depth

    var tag = el.tagName.toLowerCase();
    if (SKIP_TAGS[tag]) return null;

    var node = { tag: tag };

    // Key attributes
    if (el.id) node.id = el.id;
    var className = getElementClassName(el);
    if (className) {
      var cls = className;
      if (cls.length < 120) node.class = cls;
      else node.class = cls.slice(0, 117) + '...';
    }

    // Text content (only for leaf-ish elements)
    var children = getElementChildren(el);
    if (children.length === 0) {
      var txt = el.textContent ? el.textContent.trim() : '';
      if (txt && txt.length < 200) node.text = txt;
      else if (txt) node.text = txt.slice(0, 197) + '...';

      // For img / svg / video
      if (tag === 'img') node.src = el.getAttribute('src') || '(image)';
      if (tag === 'svg') node._note = '[SVG icon]';
      if (tag === 'input') {
        node.type = el.getAttribute('type') || 'text';
        node.placeholder = el.getAttribute('placeholder') || null;
        node.value = el.value || null;
      }
    }

    // Recurse children (cap at 10)
    if (children.length > 0) {
      var childNodes = [];
      for (var i = 0; i < Math.min(children.length, 10); i++) {
        var child = buildStructureSkeleton(children[i], depth + 1);
        if (child) childNodes.push(child);
      }
      if (childNodes.length > 0) node.children = childNodes;
    }

    return node;
  }

  // ── 4. Layout Context ──────────────────────────────
  function extractContextSpec(el) {
    var parent = el.parentElement;
    var context = {};

    if (parent) {
      var pcs = getComputedStyle(parent);
      context.parentTag = parent.tagName.toLowerCase();
      context.parentDisplay = pcs.display;
      context.parentFlexDir = pcs.flexDirection;
      context.parentGap = pcs.gap !== 'normal' ? pcs.gap : null;
      context.parentPadding = pcs.padding !== '0px' ? pcs.padding : null;
      if (parent.id) context.parentId = parent.id;
      var parentClass = getElementClassName(parent);
      if (parentClass) {
        var pc = parentClass;
        context.parentClass = pc.length < 120 ? pc : pc.slice(0, 117) + '...';
      }
    }

    // Siblings summary
    if (parent) {
      var children = getElementChildren(parent);
      var siblingTags = [];
      for (var i = 0; i < Math.min(children.length, 15); i++) {
        var child = children[i];
        if (child === el) {
          siblingTags.push('◀◀◀ [THIS]');
        } else {
          var st = child.tagName.toLowerCase();
          var sid = child.id ? '#' + child.id : '';
          var stxt = child.textContent ? child.textContent.trim().slice(0, 20) : '';
          siblingTags.push(st + sid + (stxt ? ' "' + stxt + '"' : ''));
        }
      }
      context.siblingLayout = siblingTags.join(', ');
    }

    // Section ancestor
    var section = el.closest('section, article, main, nav, aside, header, footer, form, [role="dialog"]');
    if (section) {
      context.sectionTag = section.tagName.toLowerCase();
      var sl = section.getAttribute('aria-label') ||
                section.getAttribute('aria-labelledby') || '';
      if (!sl) {
        var h = section.querySelector('h1,h2,h3,h4,h5,h6');
        if (h) sl = h.textContent.trim();
      }
      if (sl) context.sectionLabel = sl;
    }

    return context;
  }

  // ── 5. CSS Animations / @keyframes ─────────────────
  function extractKeyframes(el) {
    var keyframes = {};
    var seenNames = {};

    // Collect all animation-name values from element + children
    var animNames = collectAnimationNames(el);

    // Scan all stylesheets for @keyframes rules
    try {
      var sheets = document.styleSheets;
      for (var si = 0; si < sheets.length; si++) {
        try {
          var rules = sheets[si].cssRules;
          if (!rules) continue;
          for (var ri = 0; ri < rules.length; ri++) {
            var rule = rules[ri];
            // CSSKeyframesRule type = 7
            if (rule.type === 7 || rule.constructor.name === 'CSSKeyframesRule') {
              var name = rule.name;
              // Only capture if used by our element or its subtree
              if (!animNames[name] || seenNames[name]) continue;
              seenNames[name] = 1;

              var frames = [];
              for (var ki = 0; ki < rule.cssRules.length; ki++) {
                var kf = rule.cssRules[ki];
                var kt = kf.keyText;
                var kstyle = {};
                // Only capture transform + opacity + color changes (the meaningful ones)
                var meaningfulProps = ['transform', 'opacity', 'color', 'background-color',
                  'width', 'height', 'top', 'left', 'right', 'bottom',
                  'box-shadow', 'filter', 'scale', 'rotate', 'translate'];
                for (var pi = 0; pi < meaningfulProps.length; pi++) {
                  var pv = kf.style.getPropertyValue(meaningfulProps[pi]);
                  if (pv && pv !== 'none' && pv !== 'normal' && pv !== 'auto') {
                    kstyle[meaningfulProps[pi]] = pv;
                  }
                }
                if (Object.keys(kstyle).length > 0) {
                  frames.push({ key: kt, style: kstyle });
                }
              }
              if (frames.length > 0) {
                keyframes[name] = frames;
              }
            }
          }
        } catch (e) { /* CORS */ }
      }
    } catch (e) { /* ignore */ }

    return keyframes;
  }

  function collectAnimationNames(el) {
    var names = {};
    var queue = [el];
    while (queue.length > 0) {
      var node = queue.shift();
      var aname = getComputedStyle(node).animationName;
      if (aname && aname !== 'none') {
        var parts = aname.split(/,\s*/);
        for (var pi = 0; pi < parts.length; pi++) {
          var n = parts[pi].trim();
          if (n) names[n] = 1;
        }
      }
      for (var i = 0; i < node.children.length; i++) {
        if (queue.length < 50) queue.push(node.children[i]); // cap traversal
      }
    }
    return names;
  }

  // ── 6. Animation Library Detection ─────────────────
  function detectAnimationLib() {
    var detected = [];

    // framer-motion
    if (document.querySelector('[data-framer-name], [style*="--framer"]') ||
        typeof window !== 'undefined' && (window.framerMotion || window.motion)) {
      detected.push('framer-motion');
    }

    // GSAP
    if (typeof window !== 'undefined' && (window.gsap || window.TweenMax || window.TweenLite || window.TimelineMax)) {
      detected.push('GSAP');
    }

    // anime.js
    if (typeof window !== 'undefined' && window.anime) {
      detected.push('anime.js');
    }

    // Lottie
    var lottieEl = document.querySelector('lottie-player, dotlottie-player, [data-lottie]');
    if (lottieEl || (typeof window !== 'undefined' && (window.lottie || window.bodymovin))) {
      detected.push('Lottie');
    }

    // AOS (Animate on Scroll)
    if (document.querySelector('[data-aos]')) {
      detected.push('AOS (Animate on Scroll)');
    }

    // Motion One
    if (typeof window !== 'undefined' && window.MotionOne) {
      detected.push('Motion One');
    }

    // Alpine.js
    if (document.querySelector('[x-data], [x-transition]')) {
      detected.push('Alpine.js');
    }

    // CSS-only animation (no JS lib)
    if (detected.length === 0) {
      // Check if there's likely CSS animation
      var hasAnim = document.querySelector('[class*="animate-"], [class*="anim-"]');
      if (hasAnim) detected.push('(CSS animations — no JS library detected)');
    }

    return detected;
  }

  // ── 7. Prompt Builder ──────────────────────────────
  function buildReplicatePrompt(info) {
    var lines = [];
    lines.push('# Component Replication Spec');
    lines.push('# Copy this prompt into any AI chat to replicate this component.');
    lines.push('');
    lines.push('Replicate the following UI element. Match all visual properties,');
    lines.push('spacing, typography, interaction states, and layout context exactly.');
    lines.push('');

    // --- Page Context ---
    lines.push('## Page Context');
    lines.push('');
    lines.push('- **URL**: `' + (info.pageUrl || '(unknown)') + '`');
    if (info.pageTitle) lines.push('- **Title**: ' + info.pageTitle);
    lines.push('');

    // --- Visual ---
    lines.push('## Visual Specification');
    lines.push('');
    var visualKeys = Object.keys(info.visual);
    if (visualKeys.length === 0) {
      lines.push('(No distinctive visual styles found — element may be unstyled)');
    } else {
      for (var i = 0; i < visualKeys.length; i++) {
        lines.push('- **' + visualKeys[i] + '**: `' + info.visual[visualKeys[i]] + '`');
      }
    }
    lines.push('');

    // --- States ---
    var hasStates = false;
    for (var s in info.states) {
      var sv = info.states[s];
      if (Array.isArray(sv) && sv.length > 0) hasStates = true;
      else if (typeof sv === 'object' && Object.keys(sv).length > 0) hasStates = true;
    }
    if (hasStates) {
      lines.push('## Interaction States');
      lines.push('');
      for (var state in info.states) {
        var val = info.states[state];
        if (Array.isArray(val)) {
          if (val.length > 0) {
            lines.push('**' + state + '**: ' + val.map(function (c) { return '`' + c + '`'; }).join(', '));
          }
        } else if (typeof val === 'object') {
          var kk = Object.keys(val);
          if (kk.length > 0) {
            lines.push('**' + state + '**:');
            for (var j = 0; j < kk.length; j++) {
              lines.push('  - ' + kk[j] + ': `' + val[kk[j]] + '`');
            }
          }
        }
      }
      lines.push('');
    }

    // --- CSS Animations / @keyframes ---
    var keyframeNames = Object.keys(info.keyframes);
    if (keyframeNames.length > 0) {
      lines.push('## CSS Animations (@keyframes)');
      lines.push('');
      for (var ki = 0; ki < keyframeNames.length; ki++) {
        var kname = keyframeNames[ki];
        var frames = info.keyframes[kname];
        lines.push('```css');
        lines.push('@keyframes ' + kname + ' {');
        for (var fi = 0; fi < frames.length; fi++) {
          var f = frames[fi];
          lines.push('  ' + f.key + ' {');
          var fkeys = Object.keys(f.style);
          for (var fki = 0; fki < fkeys.length; fki++) {
            lines.push('    ' + fkeys[fki] + ': ' + f.style[fkeys[fki]] + ';');
          }
          lines.push('  }');
        }
        lines.push('}');
        lines.push('```');
        lines.push('');
      }
    }

    // --- Animation Library ---
    if (info.animLib && info.animLib.length > 0) {
      lines.push('## Animation Library Detected');
      lines.push('');
      for (var ai = 0; ai < info.animLib.length; ai++) {
        lines.push('- **' + info.animLib[ai] + '**');
      }
      lines.push('');
      if (info.animLib.some(function (l) { return l !== '(CSS animations — no JS library detected)'; })) {
        lines.push('> ⚠️ This component uses JavaScript-driven animations. The static CSS spec');
        lines.push('> above captures the visual properties, but the motion/transition logic lives');
        lines.push('> in JS. You may need to inspect the source code for the full animation setup.');
        lines.push('');
      }
    }

    // --- Structure ---
    lines.push('## HTML Structure');
    lines.push('');
    lines.push('```html');
    lines.push(renderSkeletonAsHTML(info.skeleton, ''));
    lines.push('```');
    lines.push('');

    // --- Context ---
    lines.push('## Layout Context');
    lines.push('');
    if (info.context.parentTag) {
      lines.push('- **Parent**: `<'+info.context.parentTag+'>`' +
        (info.context.parentId ? ' #'+info.context.parentId : '') +
        (info.context.parentClass ? ' class="'+info.context.parentClass.split(' ').slice(0,6).join(' ')+'..."' : ''));
      lines.push('- **Parent Layout**: ' + info.context.parentDisplay +
        (info.context.parentFlexDir !== 'row' ? ' / ' + info.context.parentFlexDir : '') +
        (info.context.parentGap ? ' / gap: ' + info.context.parentGap : '') +
        (info.context.parentPadding ? ' / padding: ' + info.context.parentPadding : ''));
    }
    if (info.context.siblingLayout) {
      lines.push('- **Siblings**: ' + info.context.siblingLayout);
    }
    if (info.context.sectionTag) {
      lines.push('- **Container**: `<'+info.context.sectionTag+'>`' +
        (info.context.sectionLabel ? ' "' + info.context.sectionLabel + '"' : ''));
    }
    lines.push('');

    // --- Meta ---
    lines.push('## Meta');
    lines.push('');
    lines.push('- **Element**: `<' + info.tag + '>' + (info.id ? ' #' + info.id : '') + '`');
    if (info.classes) {
      lines.push('- **Classes**: `' + info.classes + '`');
    }

    return lines.join('\n');
  }

  function renderSkeletonAsHTML(node, indent) {
    if (!node) return '';
    var lines = [];
    var attrs = '';
    if (node.id) attrs += ' id="' + node.id + '"';
    if (node.class) attrs += ' class="' + node.class + '"';
    if (node.type) attrs += ' type="' + node.type + '"';
    if (node.placeholder) attrs += ' placeholder="' + node.placeholder + '"';
    if (node.src) attrs += ' src="' + node.src + '"';

    var isVoid = { img: 1, input: 1, br: 1, hr: 1 }[node.tag];
    var isInline = INLINE_TAGS[node.tag];

    if (!node.children || node.children.length === 0) {
      if (isVoid) {
        lines.push(indent + '<' + node.tag + attrs + ' />');
      } else if (node._note) {
        lines.push(indent + '<' + node.tag + attrs + '> ' + node._note + ' </' + node.tag + '>');
      } else if (node.text) {
        lines.push(indent + '<' + node.tag + attrs + '>' + node.text + '</' + node.tag + '>');
      } else {
        lines.push(indent + '<' + node.tag + attrs + '></' + node.tag + '>');
      }
    } else {
      lines.push(indent + '<' + node.tag + attrs + '>');
      for (var i = 0; i < node.children.length; i++) {
        lines.push(renderSkeletonAsHTML(node.children[i], indent + '  '));
      }
      lines.push(indent + '</' + node.tag + '>');
    }
    return lines.join('\n');
  }

  // ── Replicate Toast ────────────────────────────────
  function showReplicateToast(el, info) {
    var tag = el.tagName.toLowerCase();
    var preview = el.textContent ? el.textContent.trim().slice(0, 30) : '';

    // Build category badges based on what was captured
    var badges = [];

    // CSS visual props
    var cssCount = Object.keys(info.visual).length;
    if (cssCount > 0) {
      badges.push('<span class="es-badge es-badge-css">CSS ' + cssCount + ' props</span>');
    }

    // Layout context
    if (info.context.parentTag || info.context.sectionTag) {
      badges.push('<span class="es-badge es-badge-layout">Layout ✓</span>');
    }

    // Animation keyframes
    var kfCount = Object.keys(info.keyframes).length;
    if (kfCount > 0) {
      badges.push('<span class="es-badge es-badge-anim">🎬 ' + kfCount + ' @keyframes</span>');
    }

    // Interaction states
    var stateNames = [];
    for (var s in info.states) {
      var sv = info.states[s];
      var hasData = false;
      if (Array.isArray(sv) && sv.length > 0) hasData = true;
      else if (typeof sv === 'object' && Object.keys(sv).length > 0) hasData = true;
      if (hasData) stateNames.push(s);
    }
    if (stateNames.length > 0) {
      badges.push('<span class="es-badge es-badge-states">💡 ' + stateNames.join('/') + '</span>');
    }

    // Animation library (only if a real JS lib detected, not the CSS fallback)
    if (info.animLib && info.animLib.length > 0) {
      var cssOnly = (info.animLib.length === 1 && info.animLib[0].indexOf('CSS animations') === 0);
      if (!cssOnly) {
        badges.push('<span class="es-badge es-badge-lib">📦 ' + info.animLib[0] + '</span>');
      }
    }

    var badgeHtml = badges.length > 0 ? '<div class="es-toast-badges">' + badges.join('') + '</div>' : '';

    toast.innerHTML =
      '<span class="es-icon es-icon-success"><svg class="lucide lucide-check" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>' +
      '<div class="es-toast-body">' +
      '<span class="es-toast-title">Style spec copied &lt;' + tag + '&gt;</span>' +
      (preview ? '<span class="es-preview">' + escapeHtml(preview) + '</span>' : '') +
      badgeHtml +
      '</div>' +
      '<span class="es-hint"><svg class="lucide lucide-arrow-right" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg> Paste into AI</span>';

    toast.classList.add('es-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove('es-visible');
    }, 4000);
  }

  // ── Helpers ────────────────────────────────────────
  function isOurElement(el) {
    if (!el || !el.id) return false;
    return el.id.indexOf('elementsnap-') === 0;
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function hexToRgba(hex, alpha) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function rgbToHex(rgb) {
    var match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return rgb;
    var r = parseInt(match[1], 10);
    var g = parseInt(match[2], 10);
    var b = parseInt(match[3], 10);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  // Handle scroll/resize → reposition selection overlays
  window.addEventListener('scroll', function () {
    if (active && selections.length > 0) {
      refreshAllOverlays();
    }
  }, true);

  window.addEventListener('resize', function () {
    if (active && selections.length > 0) {
      refreshAllOverlays();
    }
  });

  // ── Message handlers ───────────────────────────────
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.action === 'activate') {
      activate();
      sendResponse({ success: true });
    } else if (msg.action === 'deactivate') {
      deactivate();
      sendResponse({ success: true });
    } else if (msg.action === 'toggle') {
      if (active) {
        deactivate();
        sendResponse({ success: true, state: 'inactive' });
      } else {
        activate();
        sendResponse({ success: true, state: 'active' });
      }
    } else if (msg.action === 'getState') {
      sendResponse({ success: true, active: active, selectionCount: selections.length });
    } else if (msg.action === 'formatChanged') {
      outputFormat = msg.format;
      sendResponse({ success: true });
    }
  });

  // Report readiness
  chrome.runtime.sendMessage({ action: 'contentScriptReady' }).catch(function () {});
})();
