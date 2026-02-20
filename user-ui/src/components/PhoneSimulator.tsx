import type { ReactNode } from 'react';
import { PhoneStatusBar } from './PhoneStatusBar.tsx';

interface PhoneSimulatorProps {
  children: ReactNode;
}

export function PhoneSimulator({ children }: PhoneSimulatorProps) {
  return (
    <div className="phone-frame">
      <div className="phone-screen">
        <div className="phone-dynamic-island" />
        <PhoneStatusBar />
        {children}
        <div className="phone-home-indicator" />
      </div>
    </div>
  );
}
