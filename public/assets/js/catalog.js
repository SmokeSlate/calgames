(function () {
  const allowed = new Set(['BR', 'STRONG', 'EM', 'B', 'I', 'P', 'UL', 'OL', 'LI', 'A', 'CODE']);
  const blocked = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'TEMPLATE']);
  function text(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }
  function url(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
      const parsed = new URL(value, window.location.origin);
      return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : '';
    } catch (_) { return ''; }
  }
  function description(value) {
    const template = document.createElement('template');
    template.innerHTML = String(value || '');
    const output = document.createElement('div');
    function append(node, parent) {
      if (node.nodeType === 3) { parent.appendChild(document.createTextNode(node.textContent)); return; }
      if (node.nodeType !== 1 || blocked.has(node.tagName)) return;
      const next = allowed.has(node.tagName) ? document.createElement(node.tagName.toLowerCase()) : parent;
      if (next !== parent) {
        if (node.tagName === 'A') {
          const href = url(node.getAttribute('href'));
          if (href) next.setAttribute('href', href);
          next.setAttribute('rel', 'noopener noreferrer');
        }
        parent.appendChild(next);
      }
      for (const child of node.childNodes) append(child, next);
    }
    for (const child of template.content.childNodes) append(child, output);
    return output.innerHTML;
  }
  function plainDescription(value) {
    const output = document.createElement('div');
    output.innerHTML = description(value);
    output.querySelectorAll('br').forEach(br => br.replaceWith(document.createTextNode(' ')));
    return output.textContent;
  }
  window.CalgamesCatalog = Object.freeze({ text, url, description, plainDescription });
})();
