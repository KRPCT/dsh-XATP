/** Local DOM constructors. Provider data and project text always enter as text nodes. */
export function elements(doc) {
  function el(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }
  function button(label, onClick, className = 'x-btn') {
    const node = el('button', className, label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }
  function search(label, onInput) {
    const input = el('input', 'x-input');
    input.type = 'search';
    input.placeholder = label;
    input.setAttribute('aria-label', label);
    input.addEventListener('input', () => onInput(input.value));
    return input;
  }
  function heading(label, count) {
    const node = el('div', 'x-section-title');
    node.append(el('h2', '', label));
    if (count != null) node.append(el('span', 'x-count', count));
    return node;
  }
  return { el, button, search, heading };
}
