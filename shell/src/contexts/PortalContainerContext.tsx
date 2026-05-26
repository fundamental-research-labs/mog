import { createContext, useContext, useRef, type RefObject } from 'react';

const PortalContainerContext = createContext<RefObject<HTMLDivElement | null>>({ current: null });

export const usePortalContainer = () => {
  const ref = useContext(PortalContainerContext);
  return ref.current;
};

export function PortalContainerProvider({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <PortalContainerContext value={ref}>
      {children}
      <div
        ref={ref}
        data-mog-engine=""
        style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999 }}
      />
    </PortalContainerContext>
  );
}
