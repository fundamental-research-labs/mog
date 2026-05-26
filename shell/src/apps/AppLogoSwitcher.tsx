import { useCallback, useEffect, useRef, useState } from 'react';
import { useShellStore } from '../context';
import { useAppManifests } from '../host/hooks/useAppManifests';
import { MogLogo } from './MogLogo';

/**
 * AppLogoSwitcher — compact app switcher; click the logo to toggle the app list.
 *
 * Click-only by design: the expanded panel overlaps adjacent app chrome
 * (e.g. the spreadsheet's File tab), so hover-to-expand would intercept
 * legitimate clicks whenever the cursor passed near the logo. Matches
 * standard OS launcher behavior (Dock, Start menu).
 */
export function AppLogoSwitcher() {
  const manifests = useAppManifests();
  const activeAppId = useShellStore((s) => s.activeAppId);
  const setActiveAppId = useShellStore((s) => s.setActiveAppId);

  const [isOpen, setIsOpen] = useState(false);
  const [hoveredAppId, setHoveredAppId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Find current app manifest
  const currentApp = manifests.find((m) => m.id === activeAppId) ?? manifests[0];

  // Handle click to toggle panel
  const handleLogoClick = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  // Close panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setHoveredAppId(null);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Handle app selection
  const handleAppClick = useCallback(
    (appId: string) => {
      setActiveAppId(appId);
      setIsOpen(false);
    },
    [setActiveAppId],
  );

  // If no apps, show nothing
  if (!currentApp) {
    return null;
  }

  return (
    <div ref={containerRef} className="relative w-full shrink-0">
      {/* Current app logo */}
      <div
        className={`flex items-center justify-center p-3 cursor-pointer transition-colors ${isOpen ? 'bg-black/[0.04]' : ''}`}
        onClick={handleLogoClick}
        title={`Current: ${currentApp.name}. Click to switch apps.`}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            handleLogoClick();
          }
        }}
      >
        <div className={`transition-all ${isOpen ? 'scale-105 shadow-md rounded-[10px]' : ''}`}>
          <MogLogo size={40} className="rounded-[10px]" />
        </div>
      </div>

      {/* Expanded panel (toggled by clicking the logo) */}
      <div
        className={`absolute top-0 left-full w-[200px] bg-white rounded-r-lg shadow-[4px_0_16px_rgba(0,0,0,0.12)] border border-gray-200 border-l-0 z-ss-popover font-sans transition-all ${
          isOpen
            ? 'opacity-100 translate-x-0 pointer-events-auto'
            : 'opacity-0 -translate-x-2 pointer-events-none'
        }`}
      >
        <div className="px-4 py-3 border-b border-gray-200 text-[11px] font-semibold uppercase tracking-[0.5px] text-gray-500">
          Switch App
        </div>
        <ul className="list-none m-0 p-2">
          {manifests.map((manifest) => {
            const isActive = manifest.id === activeAppId;
            const isItemHovered = hoveredAppId === manifest.id;

            return (
              <li
                key={manifest.id}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-md cursor-pointer transition-colors ${
                  isActive ? 'bg-blue-100' : isItemHovered ? 'bg-gray-100' : 'bg-transparent'
                }`}
                onClick={() => handleAppClick(manifest.id)}
                onMouseEnter={() => setHoveredAppId(manifest.id)}
                onMouseLeave={() => setHoveredAppId(null)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    handleAppClick(manifest.id);
                  }
                }}
              >
                <div
                  className={`w-7 h-7 flex items-center justify-center text-base rounded-md shrink-0 ${
                    isActive ? 'bg-blue-200' : 'bg-gray-100'
                  }`}
                >
                  {manifest.icon ?? '📄'}
                </div>
                <span
                  className={`flex-1 text-[13px] font-medium whitespace-nowrap overflow-hidden text-ellipsis ${
                    isActive ? 'text-blue-600' : 'text-gray-700'
                  }`}
                >
                  {manifest.name}
                </span>
                {isActive && <div className="w-1.5 h-1.5 rounded-full bg-blue-600" />}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
