import { expect, it } from 'vitest';
import { fromAmap, toAmap, amapCoordinates } from './amap-coordinates';

it.each([
  [
    [116.3913, 39.9075],
    [116.39754, 39.908901],
  ],
  [
    [121.4737, 31.2304],
    [121.478223, 31.228458],
  ],
  [
    [-77.1276, 38.9498],
    [-77.1276, 38.9498],
  ],
])('agrees with the official AMap GPS conversion for %j', (input, official) => {
  const actual = toAmap(input);
  expect(Math.abs(actual[0] - official[0])).toBeLessThan(0.00001);
  expect(Math.abs(actual[1] - official[1])).toBeLessThan(0.00001);
  const restored = fromAmap(actual);
  expect(restored[0]).toBeCloseTo(input[0], 6);
  expect(restored[1]).toBeCloseTo(input[1], 6);
});

it('does not mutate authority coordinates, lose elevation, or apply a second offset', () => {
  const input = [
    [
      [116.3913, 39.9075, 12],
      [116.4, 39.9, 13],
    ],
  ];
  const snapshot = structuredClone(input);
  const display = amapCoordinates(input);
  expect(input).toEqual(snapshot);
  expect(display).not.toEqual(input);
  const position = toAmap(input[0][0]);
  expect(position[2]).toBe(12);
  expect(toAmap(position, 'GCJ-02')).toEqual(position);
  expect(() => toAmap([Infinity, 40])).toThrow();
});

it('rejects malformed and out-of-range geometry while accepting empty rings', () => {
  for (const position of [[], [116], [181, 40], [116, 91], [116, NaN]])
    expect(() => toAmap(position)).toThrow();
  expect(amapCoordinates([])).toEqual([]);
  expect(() => amapCoordinates(null)).toThrow();
  expect(() => amapCoordinates([116, 'bad'])).toThrow();
});
