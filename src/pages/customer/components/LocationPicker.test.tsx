// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import LocationPicker from './LocationPicker';
import { getPlaceDetails, searchPlaces } from '@/lib/places';

vi.mock('@/lib/places', () => ({ hasPlacesApi: () => true, searchPlaces: vi.fn(), getPlaceDetails: vi.fn() }));
const props = { searchQuery: '', onSearchChange: vi.fn(), locating: false, locationError: '', recent: [], onUseCurrent: vi.fn(), onSelect: vi.fn() };
const place = { id: 'p', name: 'Левски', address: 'Левски', lat: 43.35, lng: 25.14 };
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('address lookup', () => {
  it('does not replace newer results with a delayed earlier search', async () => {
    let first!: (value: Awaited<ReturnType<typeof searchPlaces>>) => void;
    vi.mocked(searchPlaces).mockReturnValueOnce(new Promise(resolve => { first = resolve; }))
      .mockResolvedValueOnce([{ place_id: 'new', description: 'Нов адрес' }]);
    const view = render(<LocationPicker {...props} searchQuery="София" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(301); });
    view.rerender(<LocationPicker {...props} searchQuery="Левски" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(301); });
    expect(screen.getByRole('button', { name: 'Нов адрес' })).toBeTruthy();
    await act(async () => { first([{ place_id: 'old', description: 'Стар адрес' }]); });
    expect(screen.queryByRole('button', { name: 'Стар адрес' })).toBeNull();
  });
  it('ignores place details after changing steps', async () => {
    let details!: (value: typeof place) => void;
    vi.mocked(searchPlaces).mockResolvedValue([{ place_id: 'p', description: 'Левски' }]);
    vi.mocked(getPlaceDetails).mockReturnValue(new Promise(resolve => { details = resolve; }));
    const view = render(<LocationPicker {...props} searchQuery="Левски" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(301); });
    fireEvent.click(screen.getByRole('button', { name: 'Левски' }));
    view.unmount();
    await act(async () => { details(place); });
    expect(props.onSelect).not.toHaveBeenCalled();
  });
  it('shows a retry action for a network error, rather than claiming no addresses exist', async () => {
    vi.mocked(searchPlaces).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
    render(<LocationPicker {...props} searchQuery="Левски" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(301); });
    expect(screen.getByRole('alert').textContent).toContain('Грешка');
    fireEvent.click(screen.getByRole('button', { name: 'Опитай отново' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(301); });
    expect(searchPlaces).toHaveBeenCalledTimes(2);
  });
  it('requests GPS only for pickup and leaves the keyboard closed on entry', () => {
    render(<LocationPicker {...props} showCurrentLocation={false} />);
    expect(screen.queryByRole('button', { name: 'От моята локация' })).toBeNull();
    expect(document.activeElement).not.toBe(screen.getByRole('searchbox'));
  });
});
