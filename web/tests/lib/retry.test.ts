import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withRetry, computeBackoffDelay, ResolvedRetryOptions } from '../../app/lib/retry';

// Deterministic backoff for tests — remove jitter by mocking Math.random
beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(1); // always returns max delay
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Replace setTimeout with an immediate implementation so tests don't wait
vi.useFakeTimers();

describe('computeBackoffDelay', () => {
  const opts: ResolvedRetryOptions = {
    maxAttempts: 4,
    baseDelayMs: 500,
    backoffFactor: 2,
    maxDelayMs: 8000,
    isTransient: () => true,
  };

  it('returns baseDelayMs * factor^0 for attempt 0', () => {
    // Math.random mocked to 1 → delay = floor(1 * exponential) = exponential
    expect(computeBackoffDelay(0, opts)).toBe(500);
  });

  it('doubles delay on each subsequent attempt', () => {
    expect(computeBackoffDelay(1, opts)).toBe(1000);
    expect(computeBackoffDelay(2, opts)).toBe(2000);
  });

  it('caps delay at maxDelayMs', () => {
    expect(computeBackoffDelay(10, opts)).toBe(8000);
  });
});

describe('withRetry', () => {
  it('resolves immediately on the first successful attempt', async () => {
    const fn = vi.fn().mockResolvedValue('ok');

    const promise = withRetry(fn, { maxAttempts: 4, baseDelayMs: 0 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and resolves when a later attempt succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue('recovered');

    const promise = withRetry(fn, { maxAttempts: 4, baseDelayMs: 0 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws the last error after all attempts are exhausted', async () => {
    const finalError = new Error('permanent failure');
    const fn = vi.fn().mockRejectedValue(finalError);

    const promise = withRetry(fn, { maxAttempts: 3, baseDelayMs: 0 });
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow('permanent failure');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-transient errors', async () => {
    const authError = new Error('unauthorized');
    const fn = vi.fn().mockRejectedValue(authError);

    const promise = withRetry(fn, {
      maxAttempts: 4,
      baseDelayMs: 0,
      isTransient: (e) => (e as Error).message !== 'unauthorized',
    });
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow('unauthorized');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('calls onRetry with attempt number, error, and delay on each failure', async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('done');

    const promise = withRetry(fn, { maxAttempts: 4, baseDelayMs: 0, onRetry });
    await vi.runAllTimersAsync();
    await promise;

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error), expect.any(Number));
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Error), expect.any(Number));
  });

  it('respects maxAttempts of 1 (no retries)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    const promise = withRetry(fn, { maxAttempts: 1, baseDelayMs: 0 });
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
