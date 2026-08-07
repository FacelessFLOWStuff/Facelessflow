const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { downloadAssets } = require('./download');
const { generateAssFile, generateTitleFilter } = require('./subtitleGen');

// Set FFmpeg paths — in Docker these are standard locations
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE_PATH = process.env.FFPROBE_PATH || 'ffprobe';
ffmpeg.setFfmpegPath(FFMPEG_PATH);
ffmpeg.setFfprobePath(FFPROBE_PATH);

// Get video duration using ffprobe
function getDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      resolve(data.format.duration);
    });
  });
}

// Trim/extend a clip to the desired length
function prepareClip(clipPath, targetLength, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(clipPath)
      .format('mp4')
      .videoCodec('libx264')
      .audioCodec('aac')
      .duration(targetLength)
      .size('?x1080')
      .aspect('16:9')
      .fps(25)
      .outputOptions([
        '-pix_fmt yuv420p',
        '-movflags +faststart',
        '-t ' + targetLength,
      ])
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .save(outputPath);
  });
}

// Concatenate clips into a single video
function concatenateClips(clipPaths, outputPath) {
  return new Promise((resolve, reject) => {
    const listFile = path.join(path.dirname(outputPath), 'concat_list.txt');
    const listContent = clipPaths.map(p => `file '${p}'`).join('\n');
    fs.writeFileSync(listFile, listContent);

    ffmpeg()
      .input(listFile)
      .inputOptions(['-f concat', '-safe 0'])
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions(['-pix_fmt yuv420p', '-movflags +faststart'])
      .on('end', () => {
        fs.unlinkSync(listFile);
        resolve(outputPath);
      })
      .on('error', reject)
      .save(outputPath);
  });
}

// Mix voiceover and music into a single audio track
function mixAudio(voiceoverPath, musicPath, totalDuration, outputPath) {
  return new Promise((resolve, reject) => {
    let cmd = ffmpeg()
      .input(voiceoverPath);

    if (musicPath) {
      cmd = cmd.input(musicPath)
        .complexFilter([
          `[1:a]volume=0.3,afade=t=in:st=0:d=2,afade=t=out:st=${totalDuration - 3}:d=3[bg]`,
          `[0:a]volume=1.0[vo]`,
          `[vo][bg]amix=inputs=2:duration=first:dropout_transition=0[aout]`,
        ])
        .map('[aout]');
    } else {
      cmd = cmd.audioCodec('aac');
    }

    cmd
      .duration(totalDuration)
      .audioCodec('aac')
      .audioBitrate('192k')
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .save(outputPath);
  });
}

// Burn subtitles and title into the video, replace audio
function burnOverlays(videoPath, audioPath, subtitlePath, videoTitle, outputPath) {
  return new Promise((resolve, reject) => {
    const filters = [];

    // Subtitle burn-in
    if (subtitlePath && fs.existsSync(subtitlePath)) {
      const escapedSubPath = subtitlePath.replace(/'/g, "\\'").replace(/:/g, '\\:');
      filters.push(`subtitles='${escapedSubPath}'`);
    }

    // Title card overlay
    if (videoTitle) {
      const titleFilter = generateTitleFilter(videoTitle);
      if (titleFilter) filters.push(titleFilter);
    }

    let cmd = ffmpeg()
      .input(videoPath)
      .input(audioPath);

    const outputArgs = [
      '-map', '0:v',
      '-map', '1:a',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
    ];

    if (filters.length > 0) {
      cmd = cmd.videoFilter(filters.join(','));
    }

    cmd
      .outputOptions(outputArgs)
      .on('progress', (progress) => {
        // Update progress if job reference is available
        if (global._currentJob) {
          global._currentJob.status = 'rendering';
          global._currentJob.progress = Math.min(90, 50 + Math.floor(progress.percent / 2));
        }
      })
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .save(outputPath);
  });
}

// Main render function
async function renderVideo(job, jobDir, renderDir) {
  global._currentJob = job;

  // Step 1: Download all assets
  console.log(`[${job.id}] Downloading assets...`);
  const assets = await downloadAssets(job, jobDir);

  // Step 2: Prepare clips (trim/resize to target lengths)
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

  // Step 5: Mix audio (voiceover + music)
  console.log(`[${job.id}] Mixing audio...`);
  job.progress = 60;
  const mixedAudioPath = path.join(jobDir, 'mixed_audio.aac');
  await mixAudio(assets.voiceover, assets.music, totalDuration, mixedAudioPath);

  // Step 6: Burn subtitles + title, combine with mixed audio
  console.log(`[${job.id}] Burning overlays and finalizing...`);
  job.status = 'rendering';
  job.progress = 70;
  const finalPath = path.join(renderDir, `${job.id}.mp4`);
  await burnOverlays(concatenatedPath, mixedAudioPath, subtitlePath, job.input.videoTitle, finalPath);

  // Cleanup temp files
  console.log(`[${job.id}] Render complete!`);
  job.status = 'done';
  job.progress = 100;
  global._currentJob = null;

  // Clean up job directory (keep for debugging if render fails)
  try {
    fs.rmSync(jobDir, { recursive: true });
  } catch (e) {
    // ignore cleanup errors
  }

  return finalPath;
}

module.exports = { renderVideo };
