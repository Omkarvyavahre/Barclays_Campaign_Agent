import sharp from 'sharp';

const SRC = 'public/assets/iportal-creative-single.png';
const OUT = 'public/assets/iportal-creative-linkedin-mobile.png';

// Measured content geometry of the single-panel email creative (559 x 706):
//   browser chrome  y 3..34        preheader line y 48..64
//   Barclays lockup y 102..118     hero panel     x 44..524, y 139..452
//   headline        y 473..513     salutation     y 531..538
// A square the exact width of the hero keeps every word of "A step change in digital
// banking" intact. Both edges land in measured gaps: below the browser chrome and above
// the salutation, so no line of copy is sliced.
const CROP = { left: 44, top: 42, width: 481, height: 481 };
const TARGET = 1080;

const meta = await sharp(SRC).metadata();
if (CROP.left + CROP.width > meta.width || CROP.top + CROP.height > meta.height) {
  throw new Error('crop falls outside the source image');
}

await sharp(SRC)
  .extract(CROP)
  .resize(TARGET, TARGET, { fit: 'cover', position: 'center', kernel: 'lanczos3' })
  .png({ compressionLevel: 9 })
  .toFile(OUT);

const out = await sharp(OUT).metadata();
console.log(JSON.stringify({ source: { w: meta.width, h: meta.height }, crop: CROP, out: { w: out.width, h: out.height, format: out.format } }, null, 2));
