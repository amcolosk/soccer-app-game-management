import { describe, expect, it } from 'vitest';
import { escapeHtml } from './escapeHtml';

describe('escapeHtml', () => {
  it('escapes all five HTML-significant characters', () => {
    expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('leaves plain alphanumeric/punctuation text untouched', () => {
    const input = 'Great hustle today, Team! Final score 3-2.';
    expect(escapeHtml(input)).toBe(input);
  });

  it('renders a phishing-style input inert when embedded in an HTML fragment', () => {
    const input = '<a href="evil.example">click</a>';
    const escaped = escapeHtml(input);
    expect(escaped).toBe('&lt;a href=&quot;evil.example&quot;&gt;click&lt;/a&gt;');

    const fragment = `<div>${escaped}</div>`;
    expect(fragment).not.toContain('<a ');
    expect(fragment).not.toContain('</a>');
  });
});
