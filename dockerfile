FROM selenium/standalone-chrome:4.31.0-20250414

USER root
RUN apt-get update && \
    apt-get install -y ffmpeg xvfb fluxbox x11vnc curl jq pulseaudio && \
    rm -rf /var/lib/apt/lists/*

USER seluser

ENV DISPLAY=:99 \
    SCREEN_RES=1280x720x24 \
    SE_NODE_OVERRIDE_MAX_SESSIONS=true \
    SE_NODE_MAX_SESSIONS=1

WORKDIR /app

RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/home/seluser/.bun/bin:${PATH}"

COPY --chown=seluser:seluser . .

RUN bun install

COPY --chown=seluser:seluser entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
