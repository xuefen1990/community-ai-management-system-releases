import path from 'node:path';
import { constants as fsConstants } from 'node:fs';
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';

const ASAR_PROLOGUE_SIZE = 16;

export function safeOutputPath(rootDirectory, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new Error('ASAR entry path must be a non-empty string');
  }

  if (path.isAbsolute(relativePath)) {
    throw new Error(`Absolute ASAR entry path is not allowed: ${relativePath}`);
  }

  const normalizedRoot = path.resolve(rootDirectory);
  const resolvedPath = path.resolve(normalizedRoot, relativePath);
  const rootPrefix = `${normalizedRoot}${path.sep}`;

  if (resolvedPath !== normalizedRoot && !resolvedPath.startsWith(rootPrefix)) {
    throw new Error(`ASAR entry escapes output directory: ${relativePath}`);
  }

  return resolvedPath;
}

async function readExactly(fileHandle, buffer, offset, length, position) {
  let totalBytesRead = 0;

  while (totalBytesRead < length) {
    const { bytesRead } = await fileHandle.read(
      buffer,
      offset + totalBytesRead,
      length - totalBytesRead,
      position + totalBytesRead,
    );

    if (bytesRead === 0) {
      throw new Error('Unexpected end of ASAR file');
    }

    totalBytesRead += bytesRead;
  }
}

export async function readAsarHeader(asarPath) {
  const fileHandle = await open(asarPath, 'r');

  try {
    const stats = await fileHandle.stat();
    if (stats.size < ASAR_PROLOGUE_SIZE) {
      throw new Error('ASAR file is smaller than its required header');
    }

    const prologue = Buffer.alloc(ASAR_PROLOGUE_SIZE);
    await readExactly(fileHandle, prologue, 0, prologue.length, 0);

    const picklePayloadSize = prologue.readUInt32LE(4);
    const jsonSize = prologue.readUInt32LE(12);
    const contentOffset = picklePayloadSize + 8;

    if (jsonSize === 0 || contentOffset < ASAR_PROLOGUE_SIZE) {
      throw new Error('ASAR header contains invalid sizes');
    }

    if (ASAR_PROLOGUE_SIZE + jsonSize > stats.size || contentOffset > stats.size) {
      throw new Error('ASAR header extends beyond the archive');
    }

    const jsonBuffer = Buffer.alloc(jsonSize);
    await readExactly(fileHandle, jsonBuffer, 0, jsonSize, ASAR_PROLOGUE_SIZE);

    const jsonText = jsonBuffer.toString('utf8').replace(/\0+$/u, '').trimEnd();
    let header;

    try {
      header = JSON.parse(jsonText);
    } catch (error) {
      throw new Error(`Unable to parse ASAR header JSON: ${error.message}`);
    }

    if (!header || typeof header !== 'object' || !header.files) {
      throw new Error('ASAR header does not contain a files tree');
    }

    return {
      header,
      contentOffset,
      archiveSize: stats.size,
      jsonSize,
    };
  } finally {
    await fileHandle.close();
  }
}

export function collectAsarEntries(header) {
  const directories = [];
  const files = [];
  const links = [];

  function visit(node, relativeDirectory = '') {
    if (!node || typeof node !== 'object' || !node.files) {
      throw new Error(`Invalid ASAR directory node at ${relativeDirectory || '.'}`);
    }

    for (const [name, entry] of Object.entries(node.files)) {
      if (name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
        throw new Error(`Unsafe ASAR entry name: ${name}`);
      }

      const relativePath = relativeDirectory
        ? path.posix.join(relativeDirectory, name)
        : name;

      if (entry.files) {
        directories.push(relativePath);
        visit(entry, relativePath);
      } else if (typeof entry.link === 'string') {
        links.push({ relativePath, link: entry.link });
      } else {
        const size = Number(entry.size);
        const offset = Number(entry.offset ?? 0);

        if (!Number.isSafeInteger(size) || size < 0) {
          throw new Error(`Invalid size for ASAR entry: ${relativePath}`);
        }

        if (!entry.unpacked && (!Number.isSafeInteger(offset) || offset < 0)) {
          throw new Error(`Invalid offset for ASAR entry: ${relativePath}`);
        }

        files.push({
          relativePath,
          size,
          offset,
          unpacked: Boolean(entry.unpacked),
          executable: Boolean(entry.executable),
        });
      }
    }
  }

  visit(header);
  return { directories, files, links };
}

async function directoryIsEmpty(directoryPath) {
  try {
    return (await readdir(directoryPath)).length === 0;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
}

async function ensureSourceReadable(sourcePath) {
  await access(sourcePath, fsConstants.R_OK);
  const stats = await lstat(sourcePath);
  if (!stats.isFile()) {
    throw new Error(`Expected a regular unpacked file: ${sourcePath}`);
  }
}

export async function extractAsar(asarPath, outputDirectory) {
  const absoluteAsarPath = path.resolve(asarPath);
  const absoluteOutputDirectory = path.resolve(outputDirectory);
  const temporaryDirectory = `${absoluteOutputDirectory}.extracting`;

  if (!(await directoryIsEmpty(absoluteOutputDirectory))) {
    throw new Error(`Output directory must not exist or must be empty: ${absoluteOutputDirectory}`);
  }

  await rm(temporaryDirectory, { recursive: true, force: true });
  await mkdir(temporaryDirectory, { recursive: true });

  const { header, contentOffset, archiveSize } = await readAsarHeader(absoluteAsarPath);
  const entries = collectAsarEntries(header);
  const archiveHandle = await open(absoluteAsarPath, 'r');
  const unpackedRoot = `${absoluteAsarPath}.unpacked`;
  let totalBytes = 0;

  try {
    for (const relativeDirectory of entries.directories) {
      await mkdir(safeOutputPath(temporaryDirectory, relativeDirectory), { recursive: true });
    }

    for (const entry of entries.files) {
      const destinationPath = safeOutputPath(temporaryDirectory, entry.relativePath);
      await mkdir(path.dirname(destinationPath), { recursive: true });

      if (entry.unpacked) {
        const sourcePath = safeOutputPath(unpackedRoot, entry.relativePath);
        await ensureSourceReadable(sourcePath);
        await copyFile(sourcePath, destinationPath);
        const copied = await readFile(destinationPath);
        if (copied.length !== entry.size) {
          throw new Error(`Unpacked file size mismatch: ${entry.relativePath}`);
        }
      } else {
        const absoluteOffset = contentOffset + entry.offset;
        if (absoluteOffset < contentOffset || absoluteOffset + entry.size > archiveSize) {
          throw new Error(`ASAR entry exceeds archive bounds: ${entry.relativePath}`);
        }

        const contents = Buffer.alloc(entry.size);
        if (entry.size > 0) {
          await readExactly(archiveHandle, contents, 0, entry.size, absoluteOffset);
        }
        await writeFile(destinationPath, contents);
      }

      if (entry.executable) {
        await chmod(destinationPath, 0o755);
      }

      totalBytes += entry.size;
    }

    for (const entry of entries.links) {
      const destinationPath = safeOutputPath(temporaryDirectory, entry.relativePath);
      const targetPath = safeOutputPath(temporaryDirectory, entry.link);
      const relativeTarget = path.relative(path.dirname(destinationPath), targetPath);
      await mkdir(path.dirname(destinationPath), { recursive: true });
      await symlink(relativeTarget, destinationPath);
    }
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  } finally {
    await archiveHandle.close();
  }

  await rm(absoluteOutputDirectory, { recursive: true, force: true });
  await rename(temporaryDirectory, absoluteOutputDirectory);

  return {
    outputDirectory: absoluteOutputDirectory,
    directories: entries.directories.length,
    files: entries.files.length,
    links: entries.links.length,
    totalBytes,
  };
}

