import { describe, expect, it } from 'vitest';
import { formatTimecode, markerRatio, parseTimecode, clampToDuration } from '../lib/timecode';

describe('parseTimecode', () => {
  it('«00:01:24» → 84', () => {
    expect(parseTimecode('00:01:24')).toBe(84);
  });
  it('«01:24» → 84', () => {
    expect(parseTimecode('01:24')).toBe(84);
  });
  it('«84» → 84 (сам секунди)', () => {
    expect(parseTimecode('84')).toBe(84);
  });
  it('дробові частки: «01:24,5» → 84.5', () => {
    expect(parseTimecode('01:24,5')).toBeCloseTo(84.5, 5);
  });
  it('години: «01:02:03» → 3723', () => {
    expect(parseTimecode('01:02:03')).toBe(3723);
  });
  it('сміття/некоректний вхід → null', () => {
    expect(parseTimecode('abc')).toBeNull();
    expect(parseTimecode('')).toBeNull();
    expect(parseTimecode('1:2:3:4')).toBeNull();
    expect(parseTimecode('-5')).toBeNull();
  });
});

describe('formatTimecode', () => {
  it('до години: MM:SS', () => {
    expect(formatTimecode(84)).toBe('01:24');
    expect(formatTimecode(0)).toBe('00:00');
    expect(formatTimecode(5)).toBe('00:05');
  });
  it('після год: HH:MM:SS', () => {
    expect(formatTimecode(3723)).toBe('01:02:03');
    expect(formatTimecode(3661)).toBe('01:01:01');
  });
  it('округляє дробову частку вниз', () => {
    expect(formatTimecode(84.99)).toBe('01:24');
  });
  it('відʼємні значення → 00:00', () => {
    expect(formatTimecode(-4)).toBe('00:00');
  });
});

describe('markerRatio', () => {
  it('нормалізує до 0..1', () => {
    expect(markerRatio(42, 120)).toBeCloseTo(0.35, 6);
    expect(markerRatio(0, 120)).toBe(0);
    expect(markerRatio(120, 120)).toBe(1);
  });
  it('clamp: перевищення тривалості → 1; duration невідомий → 0', () => {
    expect(markerRatio(999, 120)).toBe(1);
    expect(markerRatio(50, null)).toBe(0);
    expect(markerRatio(50, 0)).toBe(0);
  });
});

describe('clampToDuration', () => {
  it('обрізає виходження за duration + tolerance', () => {
    expect(clampToDuration(126, 125)).toBeCloseTo(125.5, 6);
    expect(clampToDuration(-3, 120)).toBe(0);
    expect(clampToDuration(120, null)).toBe(120);
  });
});
