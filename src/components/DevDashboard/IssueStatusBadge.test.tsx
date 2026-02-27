import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { IssueStatusBadge } from './IssueStatusBadge';

function renderBadge(value: string, variant: 'status' | 'severity' | 'type') {
  const { container } = render(
    <IssueStatusBadge value={value as any} variant={variant} />,
  );
  const span = container.querySelector('span');
  if (!span) throw new Error('Expected a <span> element');
  return span;
}

describe('IssueStatusBadge – status variant', () => {
  it.each([
    ['OPEN',        'dev-badge--status-open'],
    ['IN_PROGRESS', 'dev-badge--status-in-progress'],
    ['FIXED',       'dev-badge--status-fixed'],
    ['DEPLOYED',    'dev-badge--status-deployed'],
    ['CLOSED',      'dev-badge--status-closed'],
  ])('value=%s renders className containing %s', (value, expectedClass) => {
    const span = renderBadge(value, 'status');
    expect(span.className).toContain(expectedClass);
  });

  it('always includes the base dev-badge class', () => {
    const span = renderBadge('OPEN', 'status');
    expect(span.className).toContain('dev-badge');
  });
});

describe('IssueStatusBadge – severity variant', () => {
  it.each([
    ['low',             'dev-badge--severity-low'],
    ['medium',          'dev-badge--severity-medium'],
    ['high',            'dev-badge--severity-high'],
    ['feature-request', 'dev-badge--severity-feature-request'],
  ])('value=%s renders className containing %s', (value, expectedClass) => {
    const span = renderBadge(value, 'severity');
    expect(span.className).toContain(expectedClass);
  });
});

describe('IssueStatusBadge – type variant', () => {
  it.each([
    ['BUG',             'dev-badge--type-bug'],
    ['FEATURE_REQUEST', 'dev-badge--type-feature-request'],
  ])('value=%s renders className containing %s', (value, expectedClass) => {
    const span = renderBadge(value, 'type');
    expect(span.className).toContain(expectedClass);
  });
});

describe('IssueStatusBadge – label text', () => {
  it('renders "IN_PROGRESS" as "IN PROGRESS" (underscores → spaces)', () => {
    const span = renderBadge('IN_PROGRESS', 'status');
    expect(span.textContent).toBe('IN PROGRESS');
  });

  it('renders "FEATURE_REQUEST" as "FEATURE REQUEST"', () => {
    const span = renderBadge('FEATURE_REQUEST', 'type');
    expect(span.textContent).toBe('FEATURE REQUEST');
  });

  it('renders "OPEN" unchanged when no underscores', () => {
    const span = renderBadge('OPEN', 'status');
    expect(span.textContent).toBe('OPEN');
  });

  it('renders "BUG" unchanged', () => {
    const span = renderBadge('BUG', 'type');
    expect(span.textContent).toBe('BUG');
  });

  it('renders "feature-request" with its original hyphen intact', () => {
    const span = renderBadge('feature-request', 'severity');
    expect(span.textContent).toBe('feature-request');
  });
});
