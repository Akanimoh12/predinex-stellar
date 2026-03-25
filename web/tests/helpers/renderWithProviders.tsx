import React from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { ToastProvider } from '../../providers/ToastProvider';

function AllProviders({ children }: { children: React.ReactNode }) {
    return <ToastProvider>{children}</ToastProvider>;
}

export function renderWithProviders(
    ui: React.ReactElement,
    options?: Omit<RenderOptions, 'wrapper'>
) {
    return render(ui, { wrapper: AllProviders, ...options });
}
