import sharp from 'sharp';

const SRC = 'public/assets/iportal-creative-single.png';
const OUT = 'public/assets/iportal-creative-linkedin-web.png';

// Measured content geometry of the single-panel email creative (559 x 706):
//   browser chrome  y 3..34        preheader line y 48..64
//   Barclays lockup y 102..118     hero panel     x 44..524, y 139..452
//   headline        y 473..513     salutation     y 531..538
//
// LinkedIn sponsored content — web is 1200 × 627 (aspect ≈ 1.914).
// A landscape strip the exact width of the navy hero keeps "A step change in digital
// banking" and the flight-path device intact. Vertical placement is centred on the
// hero so the browser chrome and long email body stay out of frame.
const CROP = { left: 44, top: 170, width: 481, height: 251 };
const TARGET = { width: 1200, height: 627 };

const meta = await sharp(SRC).metadata();
if (CROP.left + CROP.width > meta.width || CROP.top + CROP.height > meta.height) {
  throw new Error('crop falls outside the source image');
}

await sharp(SRC)
  .extract(CROP)
  .resize(TARGET.width, TARGET.height, { fit: 'cover', position: 'center', kernel: 'lanczos3' })
  .png({ compressionLevel: 9 })
  .toFile(OUT);

const out = await sharp(OUT).metadata();
console.log(
  JSON.stringify(
    {
      source: { w: meta.width, h: meta.height },
      crop: CROP,
      cropAspect: CROP.width / CROP.height,
      targetAspect: TARGET.width / TARGET.height,
      out: { w: out.width, h: out.height, format: out.format }
    },
    null,
    2
  )
);
