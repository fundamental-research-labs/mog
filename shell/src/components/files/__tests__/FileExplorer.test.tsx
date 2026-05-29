import { fireEvent, render, screen } from '@testing-library/react';
import { createTestPlatformIdentity } from '@mog/platform/identity';
import { PlatformIdentityProvider } from '../../../context/platform-identity-context';
import { FileExplorer } from '../FileExplorer';
import type { FileExplorerProps } from '../types';

const platformIdentity = createTestPlatformIdentity();

function renderFileExplorer(props: Partial<FileExplorerProps> = {}) {
  const defaultProps: FileExplorerProps = {
    projectName: null,
    projectPath: null,
    fileTree: [],
    activeFilePath: null,
    onFileClick: jest.fn(),
    onToggleFolder: jest.fn(),
    onRefresh: jest.fn(),
  };

  return render(
    <PlatformIdentityProvider value={platformIdentity}>
      <FileExplorer {...defaultProps} {...props} />
    </PlatformIdentityProvider>,
  );
}

describe('FileExplorer', () => {
  it('passes null to New Spreadsheet from the no-project sidebar state', () => {
    const onNewSpreadsheet = jest.fn().mockResolvedValue(undefined);

    renderFileExplorer({ onNewSpreadsheet });

    fireEvent.click(screen.getByRole('button', { name: 'New Spreadsheet' }));

    expect(onNewSpreadsheet).toHaveBeenCalledTimes(1);
    expect(onNewSpreadsheet).toHaveBeenCalledWith(null);
  });

  it('passes the project path to New Spreadsheet from the project sidebar state', () => {
    const onNewSpreadsheet = jest.fn().mockResolvedValue(undefined);

    renderFileExplorer({
      projectName: 'Workspace',
      projectPath: '/workspace',
      onNewSpreadsheet,
    });

    fireEvent.click(screen.getByRole('button', { name: 'New Spreadsheet' }));

    expect(onNewSpreadsheet).toHaveBeenCalledTimes(1);
    expect(onNewSpreadsheet).toHaveBeenCalledWith('/workspace');
  });

  it('passes the selected folder path to New Spreadsheet from a folder context menu', async () => {
    const onNewSpreadsheet = jest.fn().mockResolvedValue(undefined);

    renderFileExplorer({
      projectName: 'Workspace',
      projectPath: '/workspace',
      fileTree: [
        {
          name: 'Reports',
          path: '/workspace/Reports',
          isDirectory: true,
        },
      ],
      onNewSpreadsheet,
    });

    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'Reports' }));
    fireEvent.click(await screen.findByText('New Spreadsheet'));

    expect(onNewSpreadsheet).toHaveBeenCalledTimes(1);
    expect(onNewSpreadsheet).toHaveBeenCalledWith('/workspace/Reports');
  });
});
