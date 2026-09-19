import { expect, it } from 'vitest';
import { withBusinessFocus } from './exploration-business-focus';
it('does not carry graph focus into a different query or copy duplicate or invalid values', () => {
  const href = '/zh-CN/data-foundation/explore?query=next&view=graph';
  expect(withBusinessFocus(href, '?query=old&businessKind=POLICY')).toBe(href);
  expect(
    withBusinessFocus(
      href,
      '?query=next&businessKind=POLICY&businessKind=EVENT&businessEntity=bad',
    ),
  ).toBe(href);
});

it('keeps expanded observations across tabs only within the current query', () => {
  const href = '/zh-CN/data-foundation/explore?query=next&view=records';
  expect(withBusinessFocus(href, '?query=next&businessMode=all')).toBe(
    href + '&businessMode=all',
  );
  for (const search of [
    '?query=old&businessMode=all',
    '?query=next&businessMode=all&businessMode=all',
    '?query=next&businessMode=unknown',
  ])
    expect(withBusinessFocus(href, search)).toBe(href);
});

it('retains display focus when an opened saved view becomes its authorized query', () => {
  const href = '/zh-CN/data-foundation/explore?query=next&view=records';
  const opened = { viewId: 'saved-one', queryId: 'next' };
  expect(
    withBusinessFocus(
      href,
      '?saved=saved-one&businessMode=all&businessKind=POLICY',
      opened,
    ),
  ).toBe(href + '&businessMode=all&businessKind=POLICY');
  for (const search of [
    '?saved=other&businessMode=all',
    '?saved=saved-one&saved=saved-one&businessMode=all',
    '?saved=saved-one&query=old&businessMode=all',
  ])
    expect(withBusinessFocus(href, search, opened)).toBe(href);
  expect(
    withBusinessFocus(href, '?saved=saved-one&businessMode=all', {
      ...opened,
      queryId: 'old',
    }),
  ).toBe(href);
});

it('keeps valid reading pages and presentation only inside the same query', () => {
  const href = '/zh-CN/data-foundation/explore?query=next&view=map';
  expect(
    withBusinessFocus(
      href,
      '?query=next&businessPage=3&businessPresentation=network',
    ),
  ).toBe(href + '&businessPresentation=network&businessPage=3');
  expect(
    withBusinessFocus(
      href,
      '?query=old&businessPage=3&businessPresentation=network',
    ),
  ).toBe(href);
  expect(
    withBusinessFocus(
      href,
      '?query=next&businessPage=-1&businessPresentation=invalid',
    ),
  ).toBe(href);
});

it('retains bounded global layout controls only across the same authorized query', () => {
  const href = '/zh-CN/data-foundation/explore?query=next&view=map';
  const controls =
    '&businessLayout=circular&businessGrouping=source&businessNodeSpacing=80&businessGroupSpacing=400';
  expect(withBusinessFocus(href, 'query=next' + controls)).toBe(
    href + controls,
  );
  expect(withBusinessFocus(href, 'query=old' + controls)).toBe(href);
  expect(
    withBusinessFocus(
      href,
      'query=next&businessLayout=invalid&businessNodeSpacing=900&businessGrouping=kind&businessGrouping=source',
    ),
  ).toBe(href);
});
it('retains scene, camera and exact edge selection only inside the same reauthorized query', () => {
  const href = '/zh-CN/data-foundation/explore?query=next&view=map';
  const fields =
    '&businessView=trace&businessForm=layers&businessYaw=30&businessZoom=2&businessMapLon=115.8&businessEdge=10000000-0000-4000-8000-000000000001';
  const url = new URL(
    withBusinessFocus(href, 'query=next' + fields),
    'http://local',
  );
  expect(url.searchParams.get('businessEdge')).toBe(
    '10000000-0000-4000-8000-000000000001',
  );
  expect(url.searchParams.get('businessForm')).toBe('layers');
  expect(url.searchParams.get('businessMapLon')).toBe('115.8');
  expect(withBusinessFocus(href, 'query=other' + fields)).toBe(href);
  expect(withBusinessFocus(href, 'query=next&businessEdge=broken')).toBe(href);
});

it('retains a validated calendar step only within the same query', () => {
  const href = '/zh-CN/data-foundation/explore?query=next&view=map';
  expect(withBusinessFocus(href, '?query=next&businessPeriodUnit=year')).toBe(
    href + '&businessPeriodUnit=year',
  );
  for (const query of [
    '?query=old&businessPeriodUnit=year',
    '?query=next&businessPeriodUnit=year&businessPeriodUnit=month',
    '?query=next&businessPeriodUnit=week',
  ])
    expect(withBusinessFocus(href, query)).toBe(href);
});
