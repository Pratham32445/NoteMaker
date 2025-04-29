FROM oven/bun:1

USER root

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

RUN bun install

CMD ["bun", "run", "index.ts"]