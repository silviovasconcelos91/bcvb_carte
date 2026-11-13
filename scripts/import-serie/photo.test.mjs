import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { processPhoto } from './photo.mjs';

const image = (width, height, background, format = 'png') =>
  sharp({ create: { width, height, channels: 4, background } })[format]().toBuffer();

async function centre(buf) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const i = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
}

test('photo paysage : carré JPEG 720 et vignette 240', async () => {
  const { full, thumb } = await processPhoto(await image(1200, 800, '#3366cc', 'jpeg'));
  const f = await sharp(full).metadata();
  const t = await sharp(thumb).metadata();
  assert.deepEqual([f.format, f.width, f.height], ['jpeg', 720, 720]);
  assert.deepEqual([t.format, t.width, t.height], ['jpeg', 240, 240]);
});

test('PNG transparent : fond blanc, pas noir', async () => {
  const { full } = await processPhoto(await image(500, 500, { r: 0, g: 0, b: 0, alpha: 0 }));
  for (const v of await centre(full)) assert.ok(v >= 250, `canal ${v} < 250`);
});

test('petite image agrandie à 720', async () => {
  const { full } = await processPhoto(await image(100, 150, '#cc3333'));
  const f = await sharp(full).metadata();
  assert.deepEqual([f.width, f.height], [720, 720]);
});
