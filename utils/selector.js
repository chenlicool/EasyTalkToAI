/**
 * ElementSnap - Smart Selector Engine
 * Generates the most stable, human-readable unique selector for any DOM element.
 * Priority: id > data-testid > aria-label > unique class combo > nth-child path
 */
var ElementSnapSelector = (function () {
  'use strict';

  /**
   * Generate the best possible unique CSS selector for an element.
   * @param {Element} el
   * @returns {string}
   */
  function generate(el) {
    if (!el || el === document.documentElement) return 'html';
    if (el === document.body) return 'body';

    // Priority 1: id
    if (el.id && isIdUnique(el.id)) {
      return '#' + CSS.escape(el.id);
    }

    // Priority 2: common test attributes
    var testAttrs = [
      'data-testid', 'data-test-id', 'data-cy', 'data-qa',
      'data-test', 'data-testing', 'data-e2e'
    ];
    for (var i = 0; i < testAttrs.length; i++) {
      var val = el.getAttribute(testAttrs[i]);
      if (val && isAttrUnique(testAttrs[i], val, el.tagName)) {
        return '[' + testAttrs[i] + '="' + CSS.escape(val) + '"]';
      }
    }

    // Priority 3: aria-label
    var ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && isAttrUnique('aria-label', ariaLabel, el.tagName)) {
      return el.tagName.toLowerCase() + '[aria-label="' + CSS.escape(ariaLabel) + '"]';
    }

    // Priority 4: name attribute
    var name = el.getAttribute('name');
    if (name && isAttrUnique('name', name, el.tagName)) {
      return el.tagName.toLowerCase() + '[name="' + CSS.escape(name) + '"]';
    }

    // Priority 5: unique class combination
    if (el.classList.length > 0) {
      var classSelector = buildUniqueClassSelector(el);
      if (classSelector) return classSelector;
    }

    // Priority 6: role + accessible name combo
    var role = el.getAttribute('role');
    var accName = el.getAttribute('aria-labelledby') || el.textContent.trim().slice(0, 30);
    if (role && accName) {
      var roleSel = '[role="' + role + '"]';
      var matches = document.querySelectorAll(roleSel);
      if (matches.length === 1) return roleSel;
    }

    // Fallback: nth-child path (guaranteed unique)
    return buildNthPath(el);
  }

  function isIdUnique(id) {
    return document.querySelectorAll('#' + CSS.escape(id)).length === 1;
  }

  function isAttrUnique(attr, value, tag) {
    var sel = tag.toLowerCase() + '[' + attr + '="' + CSS.escape(value) + '"]';
    return document.querySelectorAll(sel).length === 1;
  }

  function buildUniqueClassSelector(el) {
    var classes = Array.from(el.classList).filter(function (c) {
      return !c.match(/^(hover|focus|active|selected|open|show|hide|visible|hidden|animating|transitioning|loading|disabled|enabled|expanded|collapsed)$/);
    });
    var tag = el.tagName.toLowerCase();

    var MAX_ATTEMPTS = 200;
    var attempts = 0;

    for (var len = classes.length; len >= 1; len--) {
      var combos = getCombinations(classes, len);
      for (var i = 0; i < combos.length; i++) {
        attempts++;
        if (attempts > MAX_ATTEMPTS) return null;
        var sel = tag + '.' + combos[i].map(function (c) { return CSS.escape(c); }).join('.');
        if (document.querySelectorAll(sel).length === 1) {
          return sel;
        }
      }
    }
    return null;
  }

  function getCombinations(arr, k) {
    if (k === 1) return arr.map(function (x) { return [x]; });
    var result = [];
    for (var i = 0; i <= arr.length - k; i++) {
      var rest = getCombinations(arr.slice(i + 1), k - 1);
      for (var j = 0; j < rest.length; j++) {
        result.push([arr[i]].concat(rest[j]));
      }
    }
    return result;
  }

  function buildNthPath(el) {
    var path = [];
    var current = el;
    while (current && current !== document.body && current !== document.documentElement) {
      var tag = current.tagName.toLowerCase();
      var parent = current.parentElement;
      if (!parent) break;

      if (current.id) {
        path.unshift('#' + CSS.escape(current.id));
        break;
      }

      var siblings = Array.from(parent.children).filter(function (c) {
        return c.tagName === current.tagName;
      });
      if (siblings.length > 1) {
        var index = siblings.indexOf(current) + 1;
        tag += ':nth-of-type(' + index + ')';
      }
      path.unshift(tag);
      current = parent;
    }
    return path.join(' > ');
  }

  /**
   * Generate an XPath for the element.
   * @param {Element} el
   * @returns {string}
   */
  function xpath(el) {
    if (el.id) return '//*[@id="' + el.id + '"]';
    var parts = [];
    var current = el;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      var index = 1;
      var sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) index++;
        sibling = sibling.previousElementSibling;
      }
      var tag = current.tagName.toLowerCase();
      var part = tag + '[' + index + ']';
      parts.unshift(part);
      current = current.parentElement;
    }
    return '/' + parts.join('/');
  }

  return {
    generate: generate,
    xpath: xpath
  };
})();
