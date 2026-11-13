import sharp from 'sharp';

const PHOTO = 720; // côté du carré, comme dans la console (CardForm)
const THUMB = 240; // vignette des petits affichages

// Carré recadré sur la zone la plus saillante (en général le visage), fond blanc, plus sa vignette
export async function processPhoto(input) {
  const full = await sharp(input)
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize(PHOTO, PHOTO, { fit: 'cover', position: 'attention' })
    .jpeg({ quality: 85 })
    .toBuffer();
  const thumb = await sharp(full).resize(THUMB, THUMB).jpeg({ quality: 85 }).toBuffer();
  return { full, thumb };
}
