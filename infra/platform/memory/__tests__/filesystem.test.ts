import type { DirPath, FilePath, WatchEvent } from '@mog-sdk/contracts/filesystem';
import {
  DirectoryExistsError,
  DirectoryNotEmptyError,
  DirectoryNotFoundError,
  FileExistsError,
  FileNotFoundError,
  IsDirectoryError,
  NotDirectoryError,
} from '@mog/platform/filesystem-errors';
import { MemoryFileSystem } from '../filesystem';

describe('MemoryFileSystem', () => {
  let fs: MemoryFileSystem;

  beforeEach(() => {
    fs = new MemoryFileSystem();
  });

  // ============================================================
  // Read/Write Operations
  // ============================================================

  describe('read/write', () => {
    it('should write and read text content', async () => {
      await fs.mkdir('/docs' as DirPath);
      await fs.write('/docs/test.txt' as FilePath, 'Hello World');

      const content = await fs.readText('/docs/test.txt' as FilePath);
      expect(content).toBe('Hello World');
    });

    it('should write and read binary content', async () => {
      await fs.mkdir('/data' as DirPath);
      const binary = new Uint8Array([0x00, 0x01, 0x02, 0xff]);
      await fs.write('/data/binary.bin' as FilePath, binary);

      const content = await fs.read('/data/binary.bin' as FilePath);
      expect(content).toEqual(binary);
    });

    it('should overwrite existing file', async () => {
      await fs.mkdir('/docs' as DirPath);
      await fs.write('/docs/test.txt' as FilePath, 'First');
      await fs.write('/docs/test.txt' as FilePath, 'Second');

      const content = await fs.readText('/docs/test.txt' as FilePath);
      expect(content).toBe('Second');
    });

    it('should throw FileNotFoundError when reading non-existent file', async () => {
      await expect(fs.read('/nonexistent.txt' as FilePath)).rejects.toThrow(FileNotFoundError);
    });

    it('should throw DirectoryNotFoundError when writing to non-existent parent', async () => {
      await expect(fs.write('/nonexistent/file.txt' as FilePath, 'data')).rejects.toThrow(
        DirectoryNotFoundError,
      );
    });

    it('should throw IsDirectoryError when reading a directory', async () => {
      await fs.mkdir('/docs' as DirPath);
      await expect(fs.read('/docs' as FilePath)).rejects.toThrow(IsDirectoryError);
    });

    it('should throw IsDirectoryError when writing to a directory', async () => {
      await fs.mkdir('/docs' as DirPath);
      await expect(fs.write('/docs' as FilePath, 'data')).rejects.toThrow(IsDirectoryError);
    });

    it('should write files directly in root', async () => {
      await fs.write('/root-file.txt' as FilePath, 'Root content');
      const content = await fs.readText('/root-file.txt' as FilePath);
      expect(content).toBe('Root content');
    });
  });

  // ============================================================
  // Append Operations
  // ============================================================

  describe('append', () => {
    it('should append to existing file', async () => {
      await fs.mkdir('/docs' as DirPath);
      await fs.write('/docs/log.txt' as FilePath, 'Line 1\n');
      await fs.append('/docs/log.txt' as FilePath, 'Line 2\n');
      await fs.append('/docs/log.txt' as FilePath, 'Line 3\n');

      const content = await fs.readText('/docs/log.txt' as FilePath);
      expect(content).toBe('Line 1\nLine 2\nLine 3\n');
    });

    it('should create file if it does not exist', async () => {
      await fs.mkdir('/docs' as DirPath);
      await fs.append('/docs/new.txt' as FilePath, 'Created via append');

      const content = await fs.readText('/docs/new.txt' as FilePath);
      expect(content).toBe('Created via append');
    });

    it('should append binary content', async () => {
      await fs.mkdir('/data' as DirPath);
      await fs.write('/data/binary.bin' as FilePath, new Uint8Array([0x01, 0x02]));
      await fs.append('/data/binary.bin' as FilePath, new Uint8Array([0x03, 0x04]));

      const content = await fs.read('/data/binary.bin' as FilePath);
      expect(content).toEqual(new Uint8Array([0x01, 0x02, 0x03, 0x04]));
    });

    it('should throw DirectoryNotFoundError when appending to non-existent parent', async () => {
      await expect(fs.append('/nonexistent/file.txt' as FilePath, 'data')).rejects.toThrow(
        DirectoryNotFoundError,
      );
    });

    it('should throw IsDirectoryError when appending to a directory', async () => {
      await fs.mkdir('/docs' as DirPath);
      await expect(fs.append('/docs' as FilePath, 'data')).rejects.toThrow(IsDirectoryError);
    });
  });

  // ============================================================
  // Delete Operations
  // ============================================================

  describe('delete', () => {
    it('should delete a file', async () => {
      await fs.mkdir('/docs' as DirPath);
      await fs.write('/docs/test.txt' as FilePath, 'data');
      await fs.delete('/docs/test.txt' as FilePath);

      await expect(fs.exists('/docs/test.txt' as FilePath)).resolves.toBe(false);
    });

    it('should throw FileNotFoundError when deleting non-existent file', async () => {
      await expect(fs.delete('/nonexistent.txt' as FilePath)).rejects.toThrow(FileNotFoundError);
    });

    it('should throw IsDirectoryError when deleting a directory with delete()', async () => {
      await fs.mkdir('/docs' as DirPath);
      await expect(fs.delete('/docs' as FilePath)).rejects.toThrow(IsDirectoryError);
    });

    it('should remove file from parent directory listing', async () => {
      await fs.mkdir('/docs' as DirPath);
      await fs.write('/docs/test.txt' as FilePath, 'data');
      await fs.delete('/docs/test.txt' as FilePath);

      const entries = await fs.list('/docs' as DirPath);
      expect(entries).toHaveLength(0);
    });
  });

  // ============================================================
  // exists and stat
  // ============================================================

  describe('exists', () => {
    it('should return true for existing file', async () => {
      await fs.mkdir('/docs' as DirPath);
      await fs.write('/docs/test.txt' as FilePath, 'data');

      await expect(fs.exists('/docs/test.txt' as FilePath)).resolves.toBe(true);
    });

    it('should return true for existing directory', async () => {
      await fs.mkdir('/docs' as DirPath);

      await expect(fs.exists('/docs' as DirPath)).resolves.toBe(true);
    });

    it('should return false for non-existent path', async () => {
      await expect(fs.exists('/nonexistent' as FilePath)).resolves.toBe(false);
    });

    it('should return true for root directory', async () => {
      await expect(fs.exists('/' as DirPath)).resolves.toBe(true);
    });
  });

  describe('stat', () => {
    it('should return file stats', async () => {
      await fs.mkdir('/docs' as DirPath);
      await fs.write('/docs/test.txt' as FilePath, 'Hello');

      const stat = await fs.stat('/docs/test.txt' as FilePath);
      expect(stat.isFile).toBe(true);
      expect(stat.isDirectory).toBe(false);
      expect(stat.isSymlink).toBe(false);
      expect(stat.size).toBe(5); // 'Hello' is 5 bytes
      expect(stat.created).toBeLessThanOrEqual(Date.now());
      expect(stat.modified).toBeLessThanOrEqual(Date.now());
    });

    it('should return directory stats', async () => {
      await fs.mkdir('/docs' as DirPath);

      const stat = await fs.stat('/docs' as DirPath);
      expect(stat.isFile).toBe(false);
      expect(stat.isDirectory).toBe(true);
      expect(stat.isSymlink).toBe(false);
      expect(stat.size).toBe(0);
    });

    it('should throw FileNotFoundError for non-existent path', async () => {
      await expect(fs.stat('/nonexistent' as FilePath)).rejects.toThrow(FileNotFoundError);
    });
  });

  // ============================================================
  // mkdir Operations
  // ============================================================

  describe('mkdir', () => {
    it('should create a directory', async () => {
      await fs.mkdir('/docs' as DirPath);

      await expect(fs.exists('/docs' as DirPath)).resolves.toBe(true);
      const stat = await fs.stat('/docs' as DirPath);
      expect(stat.isDirectory).toBe(true);
    });

    it('should throw DirectoryExistsError when directory already exists', async () => {
      await fs.mkdir('/docs' as DirPath);

      await expect(fs.mkdir('/docs' as DirPath)).rejects.toThrow(DirectoryExistsError);
    });

    it('should throw DirectoryNotFoundError when parent does not exist', async () => {
      await expect(fs.mkdir('/a/b/c' as DirPath)).rejects.toThrow(DirectoryNotFoundError);
    });

    it('should create parent directories with recursive option', async () => {
      await fs.mkdir('/a/b/c' as DirPath, { recursive: true });

      await expect(fs.exists('/a' as DirPath)).resolves.toBe(true);
      await expect(fs.exists('/a/b' as DirPath)).resolves.toBe(true);
      await expect(fs.exists('/a/b/c' as DirPath)).resolves.toBe(true);
    });

    it('should add directory to parent listing', async () => {
      await fs.mkdir('/docs' as DirPath);

      const entries = await fs.list('/' as DirPath);
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('docs');
      expect(entries[0].isDirectory).toBe(true);
    });
  });

  // ============================================================
  // rmdir Operations
  // ============================================================

  describe('rmdir', () => {
    it('should remove an empty directory', async () => {
      await fs.mkdir('/docs' as DirPath);
      await fs.rmdir('/docs' as DirPath);

      await expect(fs.exists('/docs' as DirPath)).resolves.toBe(false);
    });

    it('should throw DirectoryNotFoundError when directory does not exist', async () => {
      await expect(fs.rmdir('/nonexistent' as DirPath)).rejects.toThrow(DirectoryNotFoundError);
    });

    it('should throw NotDirectoryError when path is a file', async () => {
      await fs.mkdir('/docs' as DirPath);
      await fs.write('/docs/test.txt' as FilePath, 'data');

      await expect(fs.rmdir('/docs/test.txt' as DirPath)).rejects.toThrow(NotDirectoryError);
    });

    it('should throw DirectoryNotEmptyError when directory is not empty', async () => {
      await fs.mkdir('/docs' as DirPath);
      await fs.write('/docs/test.txt' as FilePath, 'data');

      await expect(fs.rmdir('/docs' as DirPath)).rejects.toThrow(DirectoryNotEmptyError);
    });

    it('should remove directory and contents with recursive option', async () => {
      await fs.mkdir('/docs' as DirPath);
      await fs.mkdir('/docs/sub' as DirPath);
      await fs.write('/docs/test.txt' as FilePath, 'data');
      await fs.write('/docs/sub/nested.txt' as FilePath, 'nested');

      await fs.rmdir('/docs' as DirPath, { recursive: true });

      await expect(fs.exists('/docs' as DirPath)).resolves.toBe(false);
      await expect(fs.exists('/docs/sub' as DirPath)).resolves.toBe(false);
      await expect(fs.exists('/docs/test.txt' as FilePath)).resolves.toBe(false);
      await expect(fs.exists('/docs/sub/nested.txt' as FilePath)).resolves.toBe(false);
    });

    it('should remove directory from parent listing', async () => {
      await fs.mkdir('/docs' as DirPath);
      await fs.rmdir('/docs' as DirPath);

      const entries = await fs.list('/' as DirPath);
      expect(entries).toHaveLength(0);
    });
  });

  // ============================================================
  // list Operations
  // ============================================================

  describe('list', () => {
    it('should list directory contents', async () => {
      await fs.mkdir('/docs' as DirPath);
      await fs.mkdir('/docs/sub' as DirPath);
      await fs.write('/docs/a.txt' as FilePath, 'a');
      await fs.write('/docs/b.txt' as FilePath, 'b');

      const entries = await fs.list('/docs' as DirPath);
      expect(entries).toHaveLength(3);
      expect(entries[0].name).toBe('a.txt');
      expect(entries[0].isFile).toBe(true);
      expect(entries[1].name).toBe('b.txt');
      expect(entries[1].isFile).toBe(true);
      expect(entries[2].name).toBe('sub');
      expect(entries[2].isDirectory).toBe(true);
    });

    it('should return entries sorted by name', async () => {
      await fs.mkdir('/docs' as DirPath);
      await fs.write('/docs/z.txt' as FilePath, 'z');
      await fs.write('/docs/a.txt' as FilePath, 'a');
      await fs.write('/docs/m.txt' as FilePath, 'm');

      const entries = await fs.list('/docs' as DirPath);
      expect(entries.map((e) => e.name)).toEqual(['a.txt', 'm.txt', 'z.txt']);
    });

    it('should throw DirectoryNotFoundError when directory does not exist', async () => {
      await expect(fs.list('/nonexistent' as DirPath)).rejects.toThrow(DirectoryNotFoundError);
    });

    it('should throw NotDirectoryError when path is a file', async () => {
      await fs.mkdir('/docs' as DirPath);
      await fs.write('/docs/test.txt' as FilePath, 'data');

      await expect(fs.list('/docs/test.txt' as DirPath)).rejects.toThrow(NotDirectoryError);
    });

    it('should return empty array for empty directory', async () => {
      await fs.mkdir('/empty' as DirPath);

      const entries = await fs.list('/empty' as DirPath);
      expect(entries).toHaveLength(0);
    });
  });

  // ============================================================
  // rename Operations
  // ============================================================

  describe('rename', () => {
    it('should rename a file', async () => {
      await fs.mkdir('/docs' as DirPath);
      await fs.write('/docs/old.txt' as FilePath, 'data');

      await fs.rename('/docs/old.txt' as FilePath, '/docs/new.txt' as FilePath);

      await expect(fs.exists('/docs/old.txt' as FilePath)).resolves.toBe(false);
      await expect(fs.exists('/docs/new.txt' as FilePath)).resolves.toBe(true);
      const content = await fs.readText('/docs/new.txt' as FilePath);
      expect(content).toBe('data');
    });

    it('should move a file to different directory', async () => {
      await fs.mkdir('/src' as DirPath);
      await fs.mkdir('/dest' as DirPath);
      await fs.write('/src/file.txt' as FilePath, 'data');

      await fs.rename('/src/file.txt' as FilePath, '/dest/file.txt' as FilePath);

      await expect(fs.exists('/src/file.txt' as FilePath)).resolves.toBe(false);
      await expect(fs.exists('/dest/file.txt' as FilePath)).resolves.toBe(true);
    });

    it('should throw FileNotFoundError when source does not exist', async () => {
      await fs.mkdir('/docs' as DirPath);

      await expect(
        fs.rename('/docs/nonexistent.txt' as FilePath, '/docs/new.txt' as FilePath),
      ).rejects.toThrow(FileNotFoundError);
    });

    it('should throw FileExistsError when destination already exists', async () => {
      await fs.mkdir('/docs' as DirPath);
      await fs.write('/docs/a.txt' as FilePath, 'a');
      await fs.write('/docs/b.txt' as FilePath, 'b');

      await expect(fs.rename('/docs/a.txt' as FilePath, '/docs/b.txt' as FilePath)).rejects.toThrow(
        FileExistsError,
      );
    });

    it('should throw DirectoryNotFoundError when destination parent does not exist', async () => {
      await fs.mkdir('/src' as DirPath);
      await fs.write('/src/file.txt' as FilePath, 'data');

      await expect(
        fs.rename('/src/file.txt' as FilePath, '/nonexistent/file.txt' as FilePath),
      ).rejects.toThrow(DirectoryNotFoundError);
    });

    it('should update parent directory listings', async () => {
      await fs.mkdir('/src' as DirPath);
      await fs.mkdir('/dest' as DirPath);
      await fs.write('/src/file.txt' as FilePath, 'data');

      await fs.rename('/src/file.txt' as FilePath, '/dest/file.txt' as FilePath);

      const srcEntries = await fs.list('/src' as DirPath);
      expect(srcEntries).toHaveLength(0);

      const destEntries = await fs.list('/dest' as DirPath);
      expect(destEntries).toHaveLength(1);
      expect(destEntries[0].name).toBe('file.txt');
    });
  });

  // ============================================================
  // copy Operations
  // ============================================================

  describe('copy', () => {
    it('should copy a file', async () => {
      await fs.mkdir('/docs' as DirPath);
      await fs.write('/docs/original.txt' as FilePath, 'data');

      await fs.copy('/docs/original.txt' as FilePath, '/docs/copy.txt' as FilePath);

      await expect(fs.exists('/docs/original.txt' as FilePath)).resolves.toBe(true);
      await expect(fs.exists('/docs/copy.txt' as FilePath)).resolves.toBe(true);
      const content = await fs.readText('/docs/copy.txt' as FilePath);
      expect(content).toBe('data');
    });

    it('should copy a file to different directory', async () => {
      await fs.mkdir('/src' as DirPath);
      await fs.mkdir('/dest' as DirPath);
      await fs.write('/src/file.txt' as FilePath, 'data');

      await fs.copy('/src/file.txt' as FilePath, '/dest/file.txt' as FilePath);

      await expect(fs.exists('/src/file.txt' as FilePath)).resolves.toBe(true);
      await expect(fs.exists('/dest/file.txt' as FilePath)).resolves.toBe(true);
    });

    it('should throw FileNotFoundError when source does not exist', async () => {
      await fs.mkdir('/docs' as DirPath);

      await expect(
        fs.copy('/docs/nonexistent.txt' as FilePath, '/docs/copy.txt' as FilePath),
      ).rejects.toThrow(FileNotFoundError);
    });

    it('should throw FileExistsError when destination already exists', async () => {
      await fs.mkdir('/docs' as DirPath);
      await fs.write('/docs/a.txt' as FilePath, 'a');
      await fs.write('/docs/b.txt' as FilePath, 'b');

      await expect(fs.copy('/docs/a.txt' as FilePath, '/docs/b.txt' as FilePath)).rejects.toThrow(
        FileExistsError,
      );
    });

    it('should throw IsDirectoryError when copying a directory', async () => {
      await fs.mkdir('/src' as DirPath);
      await fs.mkdir('/dest' as DirPath);

      await expect(fs.copy('/src' as FilePath, '/dest/copy' as FilePath)).rejects.toThrow(
        IsDirectoryError,
      );
    });

    it('should throw DirectoryNotFoundError when destination parent does not exist', async () => {
      await fs.mkdir('/src' as DirPath);
      await fs.write('/src/file.txt' as FilePath, 'data');

      await expect(
        fs.copy('/src/file.txt' as FilePath, '/nonexistent/file.txt' as FilePath),
      ).rejects.toThrow(DirectoryNotFoundError);
    });
  });

  // ============================================================
  // watch Operations
  // ============================================================

  describe('watch', () => {
    it('should notify on file creation', async () => {
      await fs.mkdir('/docs' as DirPath);

      const events: WatchEvent[] = [];
      fs.watch('/docs' as DirPath, (event) => events.push(event));

      await fs.write('/docs/test.txt' as FilePath, 'data');

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('create');
      if (events[0].type === 'create') {
        expect(events[0].path).toBe('/docs/test.txt');
      }
    });

    it('should notify on file modification', async () => {
      await fs.mkdir('/docs' as DirPath);
      await fs.write('/docs/test.txt' as FilePath, 'data');

      const events: WatchEvent[] = [];
      fs.watch('/docs/test.txt' as FilePath, (event) => events.push(event));

      await fs.write('/docs/test.txt' as FilePath, 'new data');

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('modify');
    });

    it('should notify on file deletion', async () => {
      await fs.mkdir('/docs' as DirPath);
      await fs.write('/docs/test.txt' as FilePath, 'data');

      const events: WatchEvent[] = [];
      fs.watch('/docs' as DirPath, (event) => events.push(event));

      await fs.delete('/docs/test.txt' as FilePath);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('delete');
    });

    it('should notify on append', async () => {
      await fs.mkdir('/docs' as DirPath);
      await fs.write('/docs/test.txt' as FilePath, 'data');

      const events: WatchEvent[] = [];
      fs.watch('/docs/test.txt' as FilePath, (event) => events.push(event));

      await fs.append('/docs/test.txt' as FilePath, ' more');

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('modify');
    });

    it('should notify on rename (both delete and create)', async () => {
      await fs.mkdir('/docs' as DirPath);
      await fs.write('/docs/old.txt' as FilePath, 'data');

      const events: WatchEvent[] = [];
      fs.watch('/docs' as DirPath, (event) => events.push(event));

      await fs.rename('/docs/old.txt' as FilePath, '/docs/new.txt' as FilePath);

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('delete');
      if (events[0].type === 'delete') {
        expect(events[0].path).toBe('/docs/old.txt');
      }
      expect(events[1].type).toBe('create');
      if (events[1].type === 'create') {
        expect(events[1].path).toBe('/docs/new.txt');
      }
    });

    it('should allow unsubscribing', async () => {
      await fs.mkdir('/docs' as DirPath);

      const events: WatchEvent[] = [];
      const unsubscribe = fs.watch('/docs' as DirPath, (event) => events.push(event));

      await fs.write('/docs/a.txt' as FilePath, 'a');
      unsubscribe();
      await fs.write('/docs/b.txt' as FilePath, 'b');

      expect(events).toHaveLength(1);
    });

    it('should support multiple watchers', async () => {
      await fs.mkdir('/docs' as DirPath);

      const events1: WatchEvent[] = [];
      const events2: WatchEvent[] = [];
      fs.watch('/docs' as DirPath, (event) => events1.push(event));
      fs.watch('/docs' as DirPath, (event) => events2.push(event));

      await fs.write('/docs/test.txt' as FilePath, 'data');

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
    });

    it('should notify file watcher and parent directory watcher', async () => {
      await fs.mkdir('/docs' as DirPath);
      await fs.write('/docs/test.txt' as FilePath, 'data');

      const fileEvents: WatchEvent[] = [];
      const dirEvents: WatchEvent[] = [];
      fs.watch('/docs/test.txt' as FilePath, (event) => fileEvents.push(event));
      fs.watch('/docs' as DirPath, (event) => dirEvents.push(event));

      await fs.write('/docs/test.txt' as FilePath, 'new data');

      expect(fileEvents).toHaveLength(1);
      expect(dirEvents).toHaveLength(1);
    });
  });

  // ============================================================
  // Test Helpers
  // ============================================================

  describe('test helpers', () => {
    it('clear() should reset filesystem', async () => {
      await fs.mkdir('/docs' as DirPath);
      await fs.write('/docs/test.txt' as FilePath, 'data');

      fs.clear();

      await expect(fs.exists('/docs' as DirPath)).resolves.toBe(false);
      await expect(fs.exists('/' as DirPath)).resolves.toBe(true);
      expect(fs.size()).toBe(0);
    });

    it('size() should return number of files and directories', async () => {
      expect(fs.size()).toBe(0);

      await fs.mkdir('/docs' as DirPath);
      expect(fs.size()).toBe(1);

      await fs.write('/docs/test.txt' as FilePath, 'data');
      expect(fs.size()).toBe(2);

      await fs.mkdir('/docs/sub' as DirPath);
      expect(fs.size()).toBe(3);
    });

    it('dump() should return filesystem structure', async () => {
      await fs.mkdir('/docs' as DirPath);
      await fs.write('/docs/test.txt' as FilePath, 'data');

      const structure = fs.dump();
      expect(structure).toEqual({
        '/docs': 'directory',
        '/docs/test.txt': 'file',
      });
    });
  });

  // ============================================================
  // Path Normalization
  // ============================================================

  describe('path normalization', () => {
    it('should handle paths with trailing slashes', async () => {
      await fs.mkdir('/docs/' as DirPath);

      await expect(fs.exists('/docs' as DirPath)).resolves.toBe(true);
    });

    it('should handle paths with multiple slashes', async () => {
      await fs.mkdir('/docs' as DirPath);
      await fs.write('/docs//test.txt' as FilePath, 'data');

      await expect(fs.exists('/docs/test.txt' as FilePath)).resolves.toBe(true);
    });

    it('should handle backslashes (Windows paths)', async () => {
      await fs.mkdir('/docs' as DirPath);
      await fs.write('/docs\\test.txt' as FilePath, 'data');

      await expect(fs.exists('/docs/test.txt' as FilePath)).resolves.toBe(true);
    });
  });
});
