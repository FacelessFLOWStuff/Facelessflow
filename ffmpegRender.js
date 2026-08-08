const { execSync, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { downloadAssets } = require('./download');
const { generateAssFile, generateTitleFilter } = require('./subtitleGen');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

// Run FFmpeg synchronously (used for short operations)
function runFFmpegSync(args) {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        console.error('FFmpeg error:', stderr);
        reject(new Error(stderr || err.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

// Get duration of a media file
function getDuration(filePath) {
  try {
    const output = execSync(`${FFPROBE} -v quiet -print_format json -show_format "${filePath}"`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
    const data = JSON.parse(output);
    return parseFloat(data.format.duration);
  } catch (err) {
    return null;
  }
}

// Prepare a single clip: trim to target length, resize to 1920x1080, 25fps
async function prepareClip(clipPath, targetLength, outputPath) {
  const args = [
    '-y',
    '-i', clipPath,
    '-t', String(targetLength),
    '-vf', 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=25',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-an',
    '-movflags', '+faststart',
    outputPath,
  ];
  await runFFmpegSync(args);
  return outputPath;
}

// Concatenate clips using the concat demuxer
async function concatenateClips(clipPaths, outputPath) {
  const listFile = path.join(path.dirname(outputPath), 'concat_list.txt');
  const listContent = clipPaths.map(p => `file '${p}'`).join('\n');
  fs.writeFileSync(listFile, listContent);

  const args = [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listFile,
    '-c', 'copy',
    outputPath,
  ];
  
  try {
    await runFFmpegSync(args);
  } catch (err) {
    // If copy fails (different codecs), re-encode
    const args2 = [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outputPath,
    ];
    await runFFmpegSync(args2);
  }
  
  fs.unlinkSync(listFile);
  return outputPath;
}

// Mix voiceover and music into one audio track
async function mixAudio(voiceoverPath, musicPath, totalDuration, outputPath) {
  if (!musicPath) {
    // Just copy voiceover with proper encoding
    const args = [
      '-y',
      '-i', voiceoverPath,
      '-t', String(totalDuration),
      '-c:a', 'aac',
      '-b:a', '192k',
      outputPath,
    ];
    await runFFmpegSync(args);
    return outputPath;
  }

  // Mix voiceover (100%) + music (30% with fade in/out)
  const args = [
    '-y',
    '-i', voiceoverPath,
    '-i', musicPath,
    '-filter_complex',
    `[1:a]volume=0.3,afade=t=in:st=0:d=2,afade=t=out:st=${Math.max(0, totalDuration - 3)}:d=3[bg];[0:a]volume=1.0[vo];[vo][bg]amix=inputs=2:duration=first:dropout_transition=0[aout]`,
    '-map', '[aout]',
    '-t', String(totalDuration),
    '-c:a', 'aac',
    '-b:a', '192k',
    outputPath,
  ];
  await runFFmpegSync(args);
  return outputPath;
}

// Burn subtitles + title into video, replace audio with mixed audio
async function burnOverlays(videoPath, audioPath, subtitlePath, videoTitle, outputPath) {
  const filters = [];

  // Subtitle burn-in
  if (subtitlePath && fs.existsSync(subtitlePath)) {
    const escaped = subtitlePath.replace(/'/g, "\\'").replace(/:/g, '\\:');
    filters.push(`subtitles='${escaped}'`);
  }

  // Title card overlay
  if (videoTitle) {
    const titleFilter = generateTitleFilter(videoTitle);
    if (titleFilter) filters.push(titleFilter);
  }

  const args = [
    '-y',
    '-i', videoPath,
    '-i', audioPath,
  ];

  if (filters.length > 0) {
    args.push('-vf', filters.join(','));
  }

  args.push(
    '-map', '0:v',
    '-map', '1:a',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    '-shortest',
    outputPath,
  );

  await runFFmpegSync(args);
  return outputPath;
}

// Main render function
async function renderVideo(job, jobDir, renderDir) {
  // Step 1: Download all assets
  console.log(`[${job.id}] Downloading assets...`);
  const assets = await downloadAssets(job, jobDir);

  // Step 2: Prepare clips
  console.log(`[${job.id}] Preparing clips...`);
  job.status = 'preparing';
  job.progress = 45;

  const preparedClips = [];
  for (let i = 0; i < assets.clips.length; i++) {
    const clip = assets.clips[i];
    const preparedPath = path.join(jobDir, `prepared_${i}.mp4`);
    await prepareClip(clip.path, clip.length, preparedPath);
    preparedClips.push(preparedPath);
  }

  // Step 3: Concatenate clips
  console.log(`[${job.id}] Concatenating clips...`);
  job.progress = 55;
  const concatenatedPath = path.join(jobDir, 'concatenated.mp4');
  await concatenateClips(preparedClips, concatenatedPath);

  // Step 4: Generate subtitle file
  const totalDuration = assets.clips.reduce((sum, c) => sum + c.length, 0);
  const subtitlePath = path.join(jobDir, 'subtitles.ass');
  if (job.input.subtitles && job.input.subtitles.length > 0) {
    generateAssFile(job.input.subtitles, subtitlePath);
  }

  // Step 5: Mix audio
  console.log(`[${job.id}] Mixing audio...`);
  job.progress = 60;
  const mixedAudioPath = path.join(jobDir, 'mixed_audio.aac');
  await mixAudio(assets.voiceover, assets.music, totalDuration, mixedAudioPath);

  // Step 6: Burn overlays and finalize
  console.log(`[${job.id}] Burning overlays and finalizing...`);
  job.status = 'rendering';
  job.progress = 70;
  const finalPath = path.join(renderDir, `${job.id}.mp4`);
  await burnOverlays(concatenatedPath, mixedAudioPath, subtitlePath, job.input.videoTitle, finalPath);

  console.log(`[${job.id}] Render complete!`);
  job.status = 'done';
  job.progress = 100;

  // Cleanup
  try { fs.rmSync(jobDir, { recursive: true }); } catch (e) {}

  return finalPath;
}

module.exports = { renderVideo };
