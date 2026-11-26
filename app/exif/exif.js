/**
 * Just enough of EXIF to caption a photo: camera, lens, focal length,
 * aperture, shutter speed, ISO and when it was taken, read straight out of a
 * JPEG's APP1 segment (TIFF header, IFD0, then the Exif sub-IFD). Nothing
 * leaves the browser.
 */

const TAGS = {
  0x010f: 'make',
  0x0110: 'model',
  0x8769: 'exifIfd',
  0x829a: 'exposure',
  0x829d: 'fnumber',
  0x8827: 'iso',
  0x9003: 'taken',
  0x920a: 'focal',
  0xa405: 'focal35',
  0xa433: 'lensMake',
  0xa434: 'lens',
};

function readIfd(view, tiff, at, little, out) {
  const n = view.getUint16(at, little);
  for (let k = 0; k < n; k += 1) {
    const e = at + 2 + k * 12;
    const tag = view.getUint16(e, little);
    const name = TAGS[tag];
    if (!name) continue;
    const type = view.getUint16(e + 2, little);
    const count = view.getUint32(e + 4, little);
    const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }[type] ?? 1;
    const ptr = size * count > 4 ? tiff + view.getUint32(e + 8, little) : e + 8;
    let v;
    if (type === 2) {
      v = '';
      for (let c = 0; c < count; c += 1) { const ch = view.getUint8(ptr + c); if (ch) v += String.fromCharCode(ch); }
      v = v.trim();
    } else if ((type === 3 || type === 4) && count === 2) {
      // a fraction written as two plain numbers, as some editors do
      const get = (o) => (type === 3 ? view.getUint16(ptr + o * 2, little) : view.getUint32(ptr + o * 4, little));
      const num = get(0);
      const den = get(1);
      v = den ? num / den : null;
      if (name === 'exposure') out.exposureRaw = [num, den];
    } else if (type === 3) v = view.getUint16(ptr, little);
    else if (type === 4) v = view.getUint32(ptr, little);
    else if (type === 5 || type === 10) {
      const num = type === 5 ? view.getUint32(ptr, little) : view.getInt32(ptr, little);
      const den = type === 5 ? view.getUint32(ptr + 4, little) : view.getInt32(ptr + 4, little);
      v = den ? num / den : null;
      if (name === 'exposure') out.exposureRaw = [num, den];
    } else continue;
    out[name] = v;
  }
}

/** The caption fields of a JPEG file (an ArrayBuffer), or {} when it carries none. */
export function readExif(buf) {
  const view = new DataView(buf);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return {};
  let at = 2;
  while (at + 4 < view.byteLength) {
    const marker = view.getUint16(at);
    const len = view.getUint16(at + 2);
    if (marker === 0xffe1 && view.getUint32(at + 4) === 0x45786966) { // "Exif"
      const tiff = at + 10;
      const little = view.getUint16(tiff) === 0x4949;
      const out = {};
      try {
        readIfd(view, tiff, tiff + view.getUint32(tiff + 4, little), little, out);
        if (out.exifIfd) readIfd(view, tiff, tiff + out.exifIfd, little, out);
      } catch { /* a cut-off or odd file: keep what was read */ }
      delete out.exifIfd;
      return out;
    }
    if (marker === 0xffda) break; // image data: no EXIF before it
    at += 2 + len;
  }
  return {};
}

const trimZero = (n) => String(Math.round(n * 10) / 10).replace(/\.0$/, '');

/** The lines a frame shows, from what readExif found. */
export function caption(x) {
  const make = x.make ?? '';
  const model = x.model ?? '';
  // "Apple iPhone 16 Pro" not "Apple Apple iPhone…"; makes often repeat inside the model
  const camera = model && make && !model.toLowerCase().startsWith(make.split(' ')[0].toLowerCase()) ? `${make} ${model}` : (model || make);
  const shutter = x.exposureRaw
    ? (x.exposure >= 1 ? `${trimZero(x.exposure)}s` : `1/${Math.round(x.exposureRaw[1] / x.exposureRaw[0])}s`)
    : null;
  const settings = [
    x.focal35 ? `${x.focal35}mm` : x.focal ? `${trimZero(x.focal)}mm` : null,
    x.fnumber ? `f/${trimZero(x.fnumber)}` : null,
    shutter,
    x.iso ? `ISO${x.iso}` : null,
  ].filter(Boolean).join('  ');
  const taken = x.taken ? x.taken.replace(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}).*$/, '$1.$2.$3 $4:$5') : '';
  return { camera, lens: x.lens ?? '', settings, taken };
}
