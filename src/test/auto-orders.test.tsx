import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';

// Mocks must be set before importing the module under test
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({
  toast: { error: (...a: any[]) => toastError(...a), success: (...a: any[]) => toastSuccess(...a) },
}));

import { StoreProvider, useStore, isAutoProduct, AUTO_PRODUCT_TYPES } from '@/contexts/StoreContext';

const makeProduct = (overrides: Partial<any> = {}) => ({
  id: overrides.id ?? 'p-' + Math.random().toString(36).slice(2, 8),
  title: 'Item',
  price: 10,
  is_active: true,
  product_type: null,
  ...overrides,
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <StoreProvider>{children}</StoreProvider>
);

beforeEach(() => {
  localStorage.clear();
  toastError.mockClear();
  toastSuccess.mockClear();
});

describe('Auto-order detection', () => {
  it('flags premium_term and stars as auto, others as regular', () => {
    for (const t of AUTO_PRODUCT_TYPES) {
      expect(isAutoProduct({ product_type: t })).toBe(true);
    }
    expect(isAutoProduct({ product_type: 'digital' })).toBe(false);
    expect(isAutoProduct({})).toBe(false);
    expect(isAutoProduct(null)).toBe(false);
  });
});

describe('Cart: auto vs regular mixing rules', () => {
  it('rejects adding a regular product when cart has an auto item', () => {
    const { result } = renderHook(() => useStore(), { wrapper });
    const auto = makeProduct({ product_type: 'stars', price: 1.5 });
    const regular = makeProduct({ product_type: 'digital', price: 5 });

    let ok1 = false, ok2 = true;
    act(() => { ok1 = result.current.addToCart(auto, { recipientUsername: 'alice' }); });
    expect(ok1).toBe(true);
    expect(result.current.cart).toHaveLength(1);

    act(() => { ok2 = result.current.addToCart(regular); });
    expect(ok2).toBe(false);
    expect(result.current.cart).toHaveLength(1);
    expect(toastError).toHaveBeenCalled();
  });

  it('rejects adding an auto product when cart has a regular item', () => {
    const { result } = renderHook(() => useStore(), { wrapper });
    const regular = makeProduct({ product_type: 'digital' });
    const auto = makeProduct({ product_type: 'premium_term' });

    act(() => { result.current.addToCart(regular); });
    let ok = true;
    act(() => { ok = result.current.addToCart(auto, { recipientUsername: 'bob_user' }); });
    expect(ok).toBe(false);
    expect(result.current.cart).toHaveLength(1);
  });

  it('creates separate cart lines for each auto purchase (different recipient)', () => {
    const { result } = renderHook(() => useStore(), { wrapper });
    const stars = makeProduct({ id: 'stars-1', product_type: 'stars', price: 5 });

    act(() => { result.current.addToCart(stars, { recipientUsername: 'alice' }); });
    act(() => { result.current.addToCart(stars, { recipientUsername: 'bob123' }); });

    expect(result.current.cart).toHaveLength(2);
    expect(result.current.cart[0].recipientUsername).toBe('alice');
    expect(result.current.cart[1].recipientUsername).toBe('bob123');
    expect(result.current.cart[0].lineId).toBeDefined();
    expect(result.current.cart[0].lineId).not.toBe(result.current.cart[1].lineId);
    expect(result.current.cart[0].quantity).toBe(1);
  });

  it('merges quantities for regular products with same id', () => {
    const { result } = renderHook(() => useStore(), { wrapper });
    const p = makeProduct({ id: 'reg-1', product_type: 'digital' });
    act(() => { result.current.addToCart(p); });
    act(() => { result.current.addToCart(p); });
    expect(result.current.cart).toHaveLength(1);
    expect(result.current.cart[0].quantity).toBe(2);
  });

  it('clearCart empties cart and persistence', () => {
    const { result } = renderHook(() => useStore(), { wrapper });
    act(() => { result.current.addToCart(makeProduct({ product_type: 'digital' })); });
    expect(result.current.cart).toHaveLength(1);
    act(() => { result.current.clearCart(); });
    expect(result.current.cart).toHaveLength(0);
  });
});

describe('@username validation (mirrors SpecialProductCards regex)', () => {
  const USERNAME_RE = /^[A-Za-z0-9_]{5,32}$/;
  const normalize = (raw: string) => {
    const cleaned = raw.trim().replace(/^@+/, '');
    return USERNAME_RE.test(cleaned) ? cleaned : null;
  };

  it('accepts valid usernames (5-32 chars, alnum + underscore)', () => {
    expect(normalize('alice')).toBe('alice');
    expect(normalize('@alice_99')).toBe('alice_99');
    expect(normalize('  @bob_user  ')).toBe('bob_user');
    expect(normalize('A'.repeat(32))).toBe('A'.repeat(32));
  });

  it('rejects too short, too long, or invalid chars', () => {
    expect(normalize('abc')).toBeNull();           // too short
    expect(normalize('a'.repeat(33))).toBeNull();   // too long
    expect(normalize('alice!')).toBeNull();         // invalid char
    expect(normalize('alice user')).toBeNull();     // space
    expect(normalize('')).toBeNull();
    expect(normalize('@@@')).toBeNull();
  });
});
