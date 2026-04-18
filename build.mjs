#!/usr/bin/env node
/**
 * build.mjs
 * -------------------------------------------------------------
 * Scans `photos/` for raw collection folders and generates:
 *   - photos/optimized/<collection>/<name>-thumb.webp  (small, for home/collections grid)
 *   - photos/optimized/<collection>/<name>-full.webp   (large, for carousel)
 *   - photos.json                                       (manifest consumed by the site)
 *
 * Folder structure expected (you create this):
 *   photos/
 *     <collection-slug>/
 *       <any-name>.jpg | .jpeg | .png | .webp | .tif | .tiff
 *     <another-collection-slug>/
 *       ...
 *
 * The collection "slug" is the folder name. The display name defaults to the
 * slug with hyphens replaced by spaces; override in `collections.json`
 * (optional, next to this script):
 *
 *   [
 *     { "id": "quiet-cities", "name": "quiet cities" },
 *     { "id": "portraits",    "name": "portraits"    }
 *   ]
 *
 * Only collections listed in collections.json are kept, in that order.
 * If collections.json is absent, all top-level folders are used, alphabetical.
 *
 * Usage:
 *   npm install sharp
 *   node build.mjs
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const PHOTOS_DIR = path.join(ROOT, 'photos');
const OPT_DIR = path.join(PHOTOS_DIR, 'optimized');
const MANIFEST = path.join(ROOT, 'photos.json');
const COLLECTIONS_CONFIG = path.join(ROOT, 'collections.json');

const EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);

// Output sizes (all portrait-friendly — we cover-crop to these heights).
const THUMB = { width: 640,  quality: 78 };
const FULL  = { width: 1600, quality: 82 };

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function loadCollectionsConfig() {
  if (!(await exists(COLLECTIONS_CONFIG))) return null;
  try {
    const raw = await fs.readFile(COLLECTIONS_CONFIG, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[build] collections.json exists but could not be parsed:', err.message);
    return null;
  }
}

async function main() {
  if (!(await exists(PHOTOS_DIR))) {
    console.error('[build] No photos/ folder found next to build.mjs. Create it and add subfolders per collection.');
    process.exit(1);
  }

  const entries = await fs.readdir(PHOTOS_DIR, { withFileTypes: true });
  const folderSlugs = entries
    .filter(e => e.isDirectory() && e.name !== 'optimized')
    .map(e => e.name);

  const config = await loadCollectionsConfig();
  let collectionList;
  if (config) {
    // Keep order + filter to configured collections that actually exist on disk.
    collectionList = config
      .filter(c => folderSlugs.includes(c.id))
      .map(c => ({ id: c.id, name: c.name || prettify(c.id) }));
    // Warn about configured collections missing from disk.
    for (const c of config) {
      if (!folderSlugs.includes(c.id)) {
        console.warn(`[build] collections.json lists "${c.id}" but photos/${c.id} is missing.`);
      }
    }
  } else {
    collectionList = folderSlugs.sort().map(id => ({ id, name: prettify(id) }));
  }

  if (collectionList.length === 0) {
    console.error('[build] No collection folders found. Add folders under photos/ (e.g. photos/quiet-cities/).');
    process.exit(1);
  }

  await fs.mkdir(OPT_DIR, { recursive: true });

  const manifestCollections = [];
  let totalPhotos = 0;

  for (const col of collectionList) {
    const srcDir = path.join(PHOTOS_DIR, col.id);
    const dstDir = path.join(OPT_DIR, col.id);
    await fs.mkdir(dstDir, { recursive: true });

    const files = (await fs.readdir(srcDir))
      .filter(f => EXTS.has(path.extname(f).toLowerCase()))
      .sort();

    const photos = [];
    for (const file of files) {
      const base = path.basename(file, path.extname(file));
      const slug = slugify(base);
      const srcPath = path.join(srcDir, file);
      const thumbOut = path.join(dstDir, `${slug}-thumb.webp`);
      const fullOut  = path.join(dstDir, `${slug}-full.webp`);

      // Re-generate only if source is newer than outputs.
      const srcStat = await fs.stat(srcPath);
      const needsThumb = await isOutdated(thumbOut, srcStat.mtimeMs);
      const needsFull  = await isOutdated(fullOut, srcStat.mtimeMs);

      // Read dimensions; swap for EXIF-rotated originals so aspect matches the rotated output.
      const meta = await sharp(srcPath).metadata();
      const rotated = meta.orientation >= 5 && meta.orientation <= 8;
      const w = rotated ? meta.height : meta.width;
      const h = rotated ? meta.width  : meta.height;
      const ratio = w / h;

      if (needsThumb) {
        await sharp(srcPath)
          .rotate()
          .resize({ width: THUMB.width, withoutEnlargement: true })
          .webp({ quality: THUMB.quality })
          .toFile(thumbOut);
      }
      if (needsFull) {
        await sharp(srcPath)
          .rotate()
          .resize({ width: FULL.width, withoutEnlargement: true })
          .webp({ quality: FULL.quality })
          .toFile(fullOut);
      }

      if (needsThumb || needsFull) {
        console.log(`  ✓ ${col.id}/${file}`);
      }

      photos.push({
        id: `${col.id}-${slug}`,
        src:   `photos/optimized/${col.id}/${slug}-full.webp`,
        thumb: `photos/optimized/${col.id}/${slug}-thumb.webp`,
        ratio,
        alt: '',
      });
    }

    manifestCollections.push({ id: col.id, name: col.name, photos });
    totalPhotos += photos.length;
    console.log(`[build] ${col.id}: ${photos.length} photo(s)`);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    collections: manifestCollections,
  };
  await fs.writeFile(MANIFEST, JSON.stringify(manifest, null, 2));
  console.log(`[build] Wrote photos.json (${totalPhotos} photos across ${manifestCollections.length} collection(s)).`);
}

async function isOutdated(dst, srcMtime) {
  try {
    const s = await fs.stat(dst);
    return s.mtimeMs < srcMtime;
  } catch {
    return true;
  }
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function prettify(s) {
  return s.replace(/-/g, ' ');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
