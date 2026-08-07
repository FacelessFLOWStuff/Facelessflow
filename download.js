const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Download a file from URL to local path
async function downloadFile(url, outputPath, isBase64 = false) {
  if (isBase64) {
    const buffer = Buffer.from(url, 'base64');
    fs.writeFileSync(outputPath, buffer);
    return outputPath;
  }

  const response = await axios({
    method: 'GET',
    url,
    responseType: 'stream',
    timeout: 60000,
  });

  const writer = fs.createWriteStream(outputPath);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(outputPath));
    writer.on('error', reject);
  });
}

// Download all assets for a render job
async function downloadAssets(job, jobDir) {
  const { input } = job;
  const assets = {};

  job.status = 'downloading';
  job.progress = 5;

  // Download voiceover
  let voPath = path.join(jobDir, 'voiceover.mp3');
  if (input.voiceoverBase64) {
    fs.writeFileSync(voPath, Buffer.from(input.voiceoverBase64, 'base64'));
  } else if (input.voiceoverUrl) {
    await downloadFile(input.voiceoverUrl, voPath);
  }
  assets.voiceover = voPath;
  job.progress = 15;

  // Download footage clips
  assets.clips = [];
  for (let i = 0; i < input.clips.length; i++) {
    const clip = input.clips[i];
    const clipPath = path.join(jobDir, `clip_${i}.mp4`);
    await downloadFile(clip.url, clipPath);
    assets.clips.push({
      path: clipPath,
      start: clip.start || 0,
      length: clip.length || 5,
      transition: clip.transition || 'fade',
    });
    job.progress = 15 + Math.floor((i + 1) / input.clips.length * 20);
  }

  // Download music (optional)
  if (input.musicUrl) {
    const musicPath = path.join(jobDir, 'music.mp3');
    try {
      await downloadFile(input.musicUrl, musicPath);
      assets.music = musicPath;
    } catch (err) {
      console.warn('Music download failed, skipping:', err.message);
    }
  }
  job.progress = 40;

  // Download thumbnail (optional, for poster)
  if (input.thumbnailUrl) {
    const thumbPath = path.join(jobDir, 'thumbnail.jpg');
    try {
      await downloadFile(input.thumbnailUrl, thumbPath);
      assets.thumbnail = thumbPath;
    } catch (err) {
      console.warn('Thumbnail download failed:', err.message);
    }
  }

  return assets;
}

module.exports = { downloadFile, downloadAssets };
