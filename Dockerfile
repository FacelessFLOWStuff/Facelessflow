# Use a Node.js base image with FFmpeg pre-installed
FROM node:18-slim

# Install FFmpeg and fonts for subtitle rendering
RUN apt-get update && apt-get install -y \
    ffmpeg \
    fonts-liberation \
    fonts-dejavu-core \
    fonts-freefont-ttf \
    && rm -rf /var/lib/apt/lists/*

# Install Montserrat font (used for title cards)
RUN mkdir -p /usr/share/fonts/truetype/montserrat && \
    wget -qO- "https://github.com/google/fonts/raw/main/ofl/montserrat/Montserrat%5Bwt%5D.ttf" | \
    tee /usr/share/fonts/truetype/montserrat/Montserrat-Regular.ttf > /dev/null && \
    wget -qO- "https://github.com/google/fonts/raw/main/ofl/montserrat/Montserrat-Bold.ttf" | \
    tee /usr/share/fonts/truetype/montserrat/Montserrat-Bold.ttf > /dev/null && \
    fc-cache -f

# Set FFmpeg paths
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe

# Create app directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy app files
COPY . .

# Create directories
RUN mkdir -p renders temp

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the server
CMD ["node", "server.js"]
