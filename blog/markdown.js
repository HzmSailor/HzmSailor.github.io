import {Marked} from './vendor/marked.esm.js';
import DOMPurify from './vendor/purify.es.mjs';

const parser = new Marked({gfm: true, breaks: false, renderer: {html() { return ''; }}});
export function renderMarkdown(element, source) {
  // Raw HTML is omitted. Sanitize the generated HTML as a second boundary,
  // including DOM-clobbering names and controls that imitate the account UI.
  element.innerHTML = DOMPurify.sanitize(parser.parse(source || ''), {
    USE_PROFILES: {html: true}, FORBID_ATTR: ['id', 'name', 'style'],
    FORBID_TAGS: ['form', 'input', 'button', 'textarea', 'select', 'iframe', 'style', 'object', 'embed'],
  });
  element.querySelectorAll('a').forEach(link => {
    link.rel = 'noopener noreferrer';
    link.target = '_blank';
  });
  element.querySelectorAll('img').forEach(image => { image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; });
}
