const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { renderVideo } = require('./lib/ffmpegRender');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Storage for render jobs
const RENDER_DIR = path.join(__dirname, 'renders');
const TEMP_DIR = path.join(__dirname, 'temp');

[RENDER_DIR, TEMP_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Active render jobs
const jobs = new Map();

// POST /render — submit a render job
app.post('/render', async (req, res) => {
  try {
    const {
      voiceoverUrl,
      voiceoverBase64,  // alternative: send base64 directly
      clips,             // [{ url, start, length, transition }]
      musicUrl,
      subtitles,         // [{ text, start, end }]
      videoTitle,
      thumbnailUrl,
      quality            // "sd" or "hd"
    } = req.body;

    if (!voiceoverUrl && !voiceoverBase64) {
      return res.status(400).json({ error: "Voiceover (URL or base64) is required" });
    }
    if (!clips || clips.length === 0) {
      return res.status(400).json({ error: "At least one footage clip is required" });
    }

    const jobId = uuidv4();
    const jobDir = path.join(TEMP_DIR, jobId);
    fs.mkdirSync(jobDir, { recursive: true });

    const job = {
      id: jobId,
      status: 'queued',
      progress: 0,
      createdAt: new Date(),
      input: { voiceoverUrl, voiceoverBase64, clips, musicUrl, subtitles, videoTitle, thumbnailUrl, quality },
      output: null,
      error: null,
    };

    jobs.set(jobId, job);

    // Start rendering asynchronously
    renderVideo(job, jobDir, RENDER_DIR)
      .then((outputPath) => {
        job.status = 'done';
        job.progress = 100;
        job.output = `/videos/${jobId}.mp4`;
      })
      .catch((err) => {
        console.error(`Job ${jobId} failed:`, err);
        job.status = 'failed';
        job.error = err.message;
      });

    res.json({
      success: true,
      jobId,
      status: 'queued',
      message: "Render job submitted. Poll GET /status/" + jobId + " for progress.",
    });
  } catch (err) {
    res.status(500).json({ error: `Server error: ${err.message}` });
  }
});

// GET /status/:jobId — check render status
app.get('/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  res.json({
    success: true,
    jobId: job.id,
    status: job.status,       // queued | downloading | rendering | done | failed
    progress: job.progress,    // 0-100
    videoUrl: job.status === 'done' ? `${req.protocol}://${req.get('host')}${job.output}` : null,
    error: job.error,
    createdAt: job.createdAt,
    note: job.status === 'done'
      ? "Video is ready to download and publish"
      : job.status === 'failed'
      ? `Render failed: ${job.error}`
      : "Render in progress — poll again in a few seconds",
  });
});

// GET /videos/:jobId.mp4 — serve rendered video
app.get('/videos/:filename', (req, res) => {
  const filePath = path.join(RENDER_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Video not found" });
  }
  res.sendFile(filePath);
});

// GET /health — health check
app.get('/health', (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), jobs: jobs.size });
});

// Cleanup old jobs every 30 minutes
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000; // 2 hours
  for (const [id, job] of jobs) {
    if (new Date(job.createdAt).getTime() < cutoff) {
      jobs.delete(id);
      const jobDir = path.join(TEMP_DIR, id);
      if (fs.existsSync(jobDir)) fs.rmSync(jobDir, { recursive: true });
      const videoFile = path.join(RENDER_DIR, `${id}.mp4`);
      if (fs.existsSync(videoFile)) fs.unlinkSync(videoFile);
    }
  }
}, 30 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`FacelessFlow Render Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
