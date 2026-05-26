/**
 * AppSwitcher - Sidebar component for switching between apps
 *
 * Displays all available apps and allows users to switch between them.
 * Uses app manifests from auto-discovery (F2) and updates ShellStore.activeAppId.
 *
 */

import { useShellStore } from '../context';
import { useAppManifests } from '../host/hooks/useAppManifests';

/**
 * AppSwitcher - Sidebar for app navigation
 *
 * Features:
 * - Lists all discovered apps with their names and icons
 * - Highlights the currently active app
 * - Switches active app on click
 *
 * Architecture:
 * - Uses useAppManifests to get all available apps (auto-discovered)
 * - Uses ShellStore.activeAppId for current app
 * - Uses ShellStore.setActiveAppId to switch apps
 */
export function AppSwitcher() {
  const manifests = useAppManifests();
  const activeAppId = useShellStore((s) => s.activeAppId);
  const setActiveAppId = useShellStore((s) => s.setActiveAppId);

  // If no apps discovered yet, show placeholder
  if (manifests.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500 text-[13px]">
        <p>No apps available</p>
      </div>
    );
  }

  return (
    <nav className="px-2 py-3 font-sans">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.5px] text-gray-500 ml-2 mb-2">
        Apps
      </h2>
      <ul className="list-none m-0 p-0">
        {manifests.map((manifest) => {
          const isActive = manifest.id === activeAppId;

          return (
            <li key={manifest.id} className="mb-0.5">
              <button
                className={`w-full flex items-center gap-2 px-3 py-2 bg-transparent border-none rounded-md cursor-pointer text-[13px] text-left transition-colors ${
                  isActive
                    ? 'bg-blue-100 text-blue-600 font-medium'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
                onClick={() => setActiveAppId(manifest.id)}
                aria-current={isActive ? 'page' : undefined}
                title={manifest.description}
              >
                {manifest.icon && (
                  <span className="text-base w-5 text-center">{manifest.icon}</span>
                )}
                <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                  {manifest.name}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
