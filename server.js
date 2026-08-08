const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { execSync, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const RENDER_DIR = path.join(__dirname, 'renders');
const TEMP_DIR = path.join(__dirname, 'temp');
[RENDER_DIR, TEMP_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const jobs = new Map();
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

// ---- HELPERS ----

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG, args, { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { console.error('FFmpeg:', stderr); reject(new Error(stderr || err.message)); }
      else resolve(stdout);
    });
  });
}

function findBoldFont() {
  const paths = [
    '/usr/share/fonts/truetype/montserrat/Montserrat-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
  ];
  return paths.find(p => fs.existsSync(p)) || null;
}

function generateAssFile(subtitles, outputPath, w = 1920, h = 1080) {
  const header = `[Script Info]
Title: FacelessFlow Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: ${w}
PlayResY: ${h}
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,52,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,2,2,40,40,60,1
[Events]
Format: Layer, Start, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  function assTime(s) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60), cs = Math.floor((s * 100) % 100);
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }
  const events = subtitles.map(s => `Dialogue: 0,${assTime(s.start)},${assTime(s.end)},Default,,0,0,0,,${s.text.replace(/\n/g, '\\N')}`).join('\n');
  fs.writeFileSync(outputPath, header + events + '\n', 'utf-8');
  return outputPath;
}

function generateTitleFilter(title) {
  if (!title) return null;
  const fontPath = findBoldFont();
  const escaped = title.replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/,/g, '\\,');
  let f = `drawtext=text='${escaped}'`;
  if (fontPath) f += `:fontfile=${fontPath.replace(/'/g, "\\'").replace(/:/g, '\\:')}`;
  f += `:fontsize=72:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.7:boxborderw=20:enable='between(t,0,3)'`;
  return f;
}

async function downloadFile(url, dest) {
  const resp = await axios.get(url, { responseType: 'stream', timeout: 60000 });
  const writer = fs.createWriteStream(dest);
  resp.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(dest));
    writer.on('error', reject);
  });
}

// ---- RENDER PIPELINE ----

async function renderVideo(job, jobDir) {
  const { input } = job;
  
  // 1. Download assets
  console.log(`[${job.id}] Downloading assets...`);
  
  // Voiceover
  let voPath = null;
  if (input.voiceoverUrl) {
    voPath = path.join(jobDir, 'voiceover.mp3');
    await downloadFile(input.voiceoverUrl, voPath);
  } else if (input.voiceoverBase64) {
    voPath = path.join(jobDir, 'voiceover.mp3');
    fs.writeFileSync(voPath, Buffer.from(input.voiceoverBase64, 'base64'));
  }
  
  // Clips
  const clipPaths = [];
  for (let i = 0; i < input.clips.length; i++) {
    const clipPath = path.join(jobDir, `clip_${i}.mp4`);
    await downloadFile(input.clips[i].url, clipPath);
    clipPaths.push(clipPath);
  }
  
  // Music
  let musicPath = null;
  if (input.musicUrl) {
    musicPath = path.join(jobDir, 'music.mp3');
    await downloadFile(input.musicUrl, musicPath);
  }
  
  // 2. Prepare clips (trim + resize + normalize)
  console.log(`[${job.id}] Preparing clips...`);
  job.status = 'preparing';
  job.progress = 45;
  
  const preparedClips = [];
  for (let i = 0; i < clipPaths.length; i++) {
    const targetLen = input.clips[i].length || 5;
    const outPath = path.join(jobDir, `prepared_${i}.mp4`);
    await runFFmpeg([
      '-y', '-i', clipPaths[i], '-t', String(targetLen),
      '-vf', 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=25',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-an', '-movflags', '+faststart', outPath
    ]);
    preparedClips.push(outPath);
  }
  
  // 3. Concatenate
  console.log(`[${job.id}] Concatenating...`);
  job.progress = 55;
  const concatList = path.join(jobDir, 'concat.txt');
  fs.writeFileSync(concatList, preparedClips.map(p => `file '${p}'`).join('\n'));
  const concatPath = path.join(jobDir, 'concatenated.mp4');
  try {
    await runFFmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', concatPath]);
  } catch (e) {
    await runFFmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', concatList,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', concatPath]);
  }
  
  // 4. Subtitles
  const totalDuration = input.clips.reduce((s, c) => s + (c.length || 5), 0);
  const subPath = path.join(jobDir, 'subtitles.ass');
  if (input.subtitles && input.subtitles.length > 0) {
    generateAssFile(input.subtitles, subPath);
  }
  
  // 5. Mix audio
  console.log(`[${job.id}] Mixing audio...`);
  job.progress = 60;
  const audioPath = path.join(jobDir, 'mixed_audio.aac');
  if (musicPath) {
    await runFFmpeg([
      '-y', '-i', voPath, '-i', musicPath,
      '-filter_complex',
      `[1:a]volume=0.3,afade=t=in:st=0:d=2,afade=t=out:st=${Math.max(0, totalDuration - 3)}:d=3[bg];[0:a]volume=1.0[vo];[vo][bg]amix=inputs=2:duration=first:dropout_transition=0[aout]`,
      '-map', '[aout]', '-t', String(totalDuration),
      '-c:a', 'aac', '-b:a', '192k', audioPath
    ]);
  } else {
    await runFFmpeg(['-y', '-i', voPath, '-t', String(totalDuration), '-c:a', 'aac', '-b:a', '192k', audioPath]);
  }
  
  // 6. Burn overlays + finalize
  console.log(`[${job.id}] Burning overlays...`);
  job.status = 'rendering';
  job.progress = 70;
  const finalPath = path.join(RENDER_DIR, `${job.id}.mp4`);
  
  const filters = [];
  if (input.subtitles && input.subtitles.length > 0 && fs.existsSync(subPath)) {
    const esc = subPath.replace(/'/g, "\\'").replace(/:/g, '\\:');
    filters.push(`subtitles='${esc}'`);
  }
  const titleFilter = generateTitleFilter(input.videoTitle);
  if (titleFilter) filters.push(titleFilter);
  
  const ffmpegArgs = ['-y', '-i', concatPath, '-i', audioPath];
  if (filters.length > 0) ffmpegArgs.push('-vf', filters.join(','));
  ffmpegArgs.push(
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', finalPath
  );
  await runFFmpeg(ffmpegArgs);
  
  console.log(`[${job.id}] Done!`);
  job.status = 'done';
  job.progress = 100;
  try { fs.rmSync(jobDir, { recursive: true }); } catch (e) {}
  return finalPath;
}

// ---- ROUTES ----

app.get('/', (req, res) => res.json({ status: 'ok', service: 'FacelessFlow Render Server', version: '5.0' }));

app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime(), jobs: jobs.size }));

app.post('/render', async (req, res) => {
  try {
    const { voiceoverUrl, voiceoverBase64, clips, musicUrl, subtitles, videoTitle, quality } = req.body;
    if (!voiceoverUrl && !voiceoverBase64) return res.status(400).json({ error: 'Voiceover required' });
    if (!clips || !clips.length) return res.status(400).json({ error: 'Clips required' });
    
    const jobId = uuidv4();
    const jobDir = path.join(TEMP_DIR, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    
    const job = { id: jobId, status: 'queued', progress: 0, createdAt: new Date(),
      input: { voiceoverUrl, voiceoverBase64, clips, musicUrl, subtitles, videoTitle, quality }, output: null, error: null };
    jobs.set(jobId, job);
    
    renderVideo(job, jobDir)
      .then(() => { job.status = 'done'; job.progress = 100; job.output = `/videos/${jobId}.mp4`; })
      .catch(err => { console.error(`Job ${jobId} failed:`, err); job.status = 'failed'; job.error = err.message; });
    
    res.json({ success: true, jobId, status: 'queued', message: `Poll GET /status/${jobId}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ success: true, jobId: job.id, status: job.status, progress: job.progress,
    videoUrl: job.status === 'done' ? `${req.protocol}://${req.get('host')}${job.output}` : null, error: job.error });
});

app.get('/videos/:filename', (req, res) => {
  const f = path.join(RENDER_DIR, req.params.filename);
  if (!fs.existsSync(f)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(f);
});

// Cleanup old jobs every 30 min
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (new Date(job.createdAt).getTime() < cutoff) {
      jobs.delete(id);
      try { fs.rmSync(path.join(TEMP_DIR, id), { recursive: true }); } catch(e) {}
      try { fs.unlinkSync(path.join(RENDER_DIR, `${id}.mp4`)); } catch(e) {}
    }
  }
}, 30 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FacelessFlow Render Server v5 on port ${PORT}`));

process.on('uncaughtException', e => console.error('Uncaught:', e.message));
process.on('unhandledRejection', e => console.error('Unhandled:', e));
