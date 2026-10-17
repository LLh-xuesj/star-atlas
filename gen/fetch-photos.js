// 生成 45 个对象的配图：从 ESA/Hubble 与 NOIRLab 官方图库取图，
// 下载 1280px 版本，转成 640/1280 WebP + 1280 JPEG，并写出 json 清单与署名文件。
// 版权：ESA/Hubble、NOIRLab 均为 CC BY 4.0，页面内必须保留 credit。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(__dirname, '.photos-cache');
const OUT = path.join(ROOT, 'assets', 'photos');

// [对象, 来源, 图片 id, 备用 id]
const SEL = [
  ['M1', 'esa', 'heic0515a'],
  ['M8', 'esa', 'heic1808a'],
  ['M11', 'esa', 'potw1912a', 'noir:noao-m11block'],
  ['M13', 'esa', 'opo0840a'],
  ['M15', 'esa', 'heic1321a'],
  ['M16', 'esa', 'heic1501a'],
  ['M17', 'esa', 'heic0206g'],
  ['M20', 'esa', 'heic2608a'],
  ['M27', 'noir', 'noao-m27-kpno-mayall-4-m', 'esa:opo0306b'],
  ['M31', 'noir', 'noao-m31fsqblock', 'esa:heic1502a'],
  ['M33', 'esa', 'heic1901a'],
  ['M42', 'esa', 'heic0601a'],
  ['M44', 'noir', 'noao-m44'],
  ['M45', 'noir', 'noao-m45', 'esa:opo0420a'],
  ['M51', 'esa', 'heic0506a'],
  ['M57', 'esa', 'heic1310a'],
  ['M63', 'esa', 'potw1536a', 'noir:noao-m63'],
  ['M64', 'noir', 'noao-02330', 'noir:noao-m64chadwell'],
  ['M65', 'esa', 'heic1006a'],
  ['M66', 'esa', 'heic1810c'],
  ['M76', 'esa', 'heic2408a'],
  ['M78', 'noir', 'noao-m78'],
  ['M81', 'noir', 'noao-m81', 'noir:noao-m81m82'],
  ['M82', 'esa', 'potw1201a'],
  ['M83', 'esa', 'opo0929a'],
  ['M87', 'esa', 'heic2411b'],
  ['M97', 'noir', 'noao0310a', 'noir:geminiann10008a'],
  ['M101', 'esa', 'heic0602a'],
  ['M104', 'esa', 'heic2506a'],
  ['M106', 'noir', 'noirlab2112a', 'noir:noao-m106'],
  ['NGC 253', 'noir', 'noao-ngc-253', 'esa:heic0819b'],
  ['NGC 891', 'noir', 'iotw2023a', 'noir:noao-n891'],
  ['NGC 4565', 'noir', 'noao-02286', 'esa:potw1433a'],
  ['NGC 6543', 'esa', 'potm2602c'],
  ['NGC 7000', 'esa', 'heic0510a'],
  ['NGC 6960', 'esa', 'heic0712g'],
  ['NGC 2237', 'esa', 'heic2505f'],
  ['NGC 869', 'esa', 'heic0108a'],
  ['NGC 5139', 'esa', 'heic2409a'],
  ['NGC 104', 'esa', 'heic1510a'],
  ['NGC 2070', 'esa', 'heic1402b'],
  ['NGC 7293', 'esa', 'opo0432d'],
  ['NGC 7331', 'noir', 'noao-n7331mortfield', 'noir:noao-02325'],
  ['NGC 5128', 'esa', 'heic1110a'],
  ['NGC 3372', 'noir', 'noao0136a', 'esa:heic0910e'],
];

const slug = id => id.toLowerCase().replace(/[^a-z0-9]+/g, '');
const pageOf = (src, id) => src === 'esa' ? `https://esahubble.org/images/${id}/` : `https://noirlab.edu/public/images/${id}/`;
const imgOf = (src, id) => src === 'esa'
  ? `https://cdn.esahubble.org/archives/images/screen/${id}.jpg`
  : `https://storage.noirlab.edu/media/archives/images/screen/${id}.jpg`;
const licOf = src => src === 'esa'
  ? { license: 'CC BY 4.0', licenseUrl: 'https://esahubble.org/public/copyright/' }
  : { license: 'CC BY 4.0', licenseUrl: 'https://noirlab.edu/public/copyright/' };

const clean = s => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

async function get(url, timeout = 30000) {
  let last;
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r;
    } catch (e) {
      last = e;
      if (i === 0) await new Promise(r => setTimeout(r, 1200));
    }
  }
  throw last;
}

function extractCredit(html, src) {
  const t = clean(html);
  let best = '';
  for (const m of t.matchAll(/Credit:\s*([^]{5,420})/gi)) {
    let c = m[1].split(/Usage of|Acknowledgment|Acknowledgement|Image processing|Licen[cs]e|CC BY/i)[0].trim();
    if (/(NASA|ESA|Hubble|STScI|NOIRLab|NSF|AURA|KPNO|Gemini|CTIO|ESO)/i.test(c) && c.length > best.length) best = c;
  }
  if (!best) best = src === 'esa' ? 'ESA/Hubble' : 'NOIRLab/NSF/AURA';
  return best;
}

function probe(file) {
  const s = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim();
  return s.split(',').map(Number);
}

function convert(src, dst, width, kind) {
  const vf = `scale='min(${width},iw)':-2`;
  const args = kind === 'webp'
    ? ['-y', '-v', 'error', '-i', src, '-vf', vf, '-c:v', 'libwebp', '-quality', width >= 1000 ? '82' : '80', dst]
    : ['-y', '-v', 'error', '-i', src, '-vf', vf, '-q:v', '3', dst];
  execFileSync('ffmpeg', args, { stdio: 'pipe' });
}

(async () => {
  fs.mkdirSync(CACHE, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = {};
  const failures = [];
  const ONLY = process.argv.slice(2);
  if (ONLY.length) {
    try { Object.assign(manifest, JSON.parse(fs.readFileSync(path.join(CACHE, 'manifest.json'), 'utf8'))); } catch {}
  }

  for (const [obj, src0, id0, fallback] of SEL) {
    if (ONLY.length && !ONLY.includes(obj)) continue;
    const tries = [[src0, id0]];
    if (fallback) { const [s, i] = fallback.split(':'); tries.push([s, i]); }
    let ok = false;
    for (const [src, id] of tries) {
      try {
        const srcFile = path.join(CACHE, `${id}.jpg`);
        if (!fs.existsSync(srcFile)) {
          const r = await get(imgOf(src, id));
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length < 20000) throw new Error('image too small (' + buf.length + 'B)');
          fs.writeFileSync(srcFile, buf);
        }
        // 元数据
        let html = '';
        try { html = await (await get(pageOf(src, id))).text(); } catch (e) { failures.push(obj + ' meta: ' + e.message); }
        const title = (html.match(/property="og:title"[^>]*content="([^"]+)"/i) || [])[1] || id;
        const credit = html ? extractCredit(html, src) : (src === 'esa' ? 'ESA/Hubble' : 'NOIRLab/NSF/AURA');
        const [w0, h0] = probe(srcFile);
        const hash = crypto.createHash('md5').update(fs.readFileSync(srcFile)).digest('hex').slice(0, 8);
        const base = `${slug(obj)}-${w0 >= 1280 ? 1280 : w0}-${hash}`;
        const f640 = path.join(OUT, `${slug(obj)}-640-${hash}.webp`);
        const f1280 = path.join(OUT, `${slug(obj)}-${w0 >= 1280 ? 1280 : w0}-${hash}.webp`);
        const fjpg = path.join(OUT, `${slug(obj)}-${w0 >= 1280 ? 1280 : w0}-${hash}.jpg`);
        if (!fs.existsSync(f1280)) convert(srcFile, f1280, 1280, 'webp');
        if (!fs.existsSync(f640)) convert(srcFile, f640, 640, 'webp');
        if (!fs.existsSync(fjpg)) convert(srcFile, fjpg, 1280, 'jpg');
        const [w, h] = probe(f1280);
        const lic = licOf(src);
        manifest[obj] = {
          w, h,
          src640: 'assets/photos/' + path.basename(f640),
          src1280: 'assets/photos/' + path.basename(f1280),
          jpg: 'assets/photos/' + path.basename(fjpg),
          title: clean(title),
          credit,
          license: lic.license,
          licenseUrl: lic.licenseUrl,
          source: pageOf(src, id),
        };
        const kb = n => Math.round(fs.statSync(n).size / 1024);
        console.log(obj.padEnd(8), `${src}/${id}`.padEnd(42), `${w}x${h}`, `${kb(f1280)}KB`, credit.slice(0, 52));
        ok = true;
        break;
      } catch (e) {
        console.log('RETRY', obj, src + '/' + id, e.message);
      }
    }
    if (!ok) {
      failures.push(obj + ' image');
      console.log('FAIL', obj);
      if (failures.length >= 6) {
        console.log('\n连续失败过多，已停止。已成功的对象可以重跑本脚本续传。');
        break;
      }
    }
  }

  // 清单
  const body = Object.entries(manifest).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
  fs.writeFileSync(path.join(ROOT, 'js', 'photos.js'),
    `// 自动生成，勿手改；由 gen/fetch-photos.js 生成（ESA/Hubble 与 NOIRLab，CC BY 4.0）\nconst PHOTOS = {\n${body}\n};\n`);

  // 署名文件
  const rows = Object.entries(manifest).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) =>
    `| ${k} | ${v.title.replace(/\|/g, '/')} | ${v.credit.replace(/\|/g, '/')} | ${v.license} | [原图](${v.source}) |`);
  fs.writeFileSync(path.join(OUT, 'CREDITS.md'),
    `# 天体照片来源与署名\n\n本目录照片来自 ESA/Hubble 与 NOIRLab，均按 **CC BY 4.0** 使用。\n` +
    `使用时必须保留下表 credit；图片可按原许可再分发。\n\n` +
    `| 对象 | 图片标题 | Credit | 许可 | 来源 |\n| --- | --- | --- | --- | --- |\n${rows.join('\n')}\n`);

  fs.writeFileSync(path.join(__dirname, '.photos-cache', 'manifest.json'), JSON.stringify(manifest, null, 1));

  // 清理不再被引用的旧转码文件
  const keep = new Set(Object.values(manifest).flatMap(v => [path.basename(v.src640), path.basename(v.src1280), path.basename(v.jpg)]));
  for (const f of fs.readdirSync(OUT)) {
    if (/\.(webp|jpe?g)$/i.test(f) && !keep.has(f)) fs.unlinkSync(path.join(OUT, f));
  }

  console.log(`\nOK ${Object.keys(manifest).length}/${SEL.length} 张；失败 ${failures.length} 项`);
  if (failures.length) console.log(failures.join('\n'));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
