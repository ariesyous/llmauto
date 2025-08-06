FROM ghcr.io/open-webui/open-webui:main

WORKDIR /app

# Copy custom entrypoint
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Override default entrypoint
ENTRYPOINT ["/app/entrypoint.sh"]