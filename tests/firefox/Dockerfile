# Build only from the synthetic context produced by tools/prepareFirefoxLinuxContext.js.
# No checkout, credentials, Docker socket, host network or host IPC is required at runtime.
FROM mcr.microsoft.com/playwright:v1.56.0-noble
WORKDIR /work
COPY package.json package-lock.json ./
RUN touch /tmp/carte-empty-user.npmrc /tmp/carte-empty-global.npmrc \
    && npm ci --ignore-scripts --no-audit --no-fund --userconfig=/tmp/carte-empty-user.npmrc --globalconfig=/tmp/carte-empty-global.npmrc
COPY --chown=pwuser:pwuser . .
RUN chown pwuser:pwuser /work \
    && node -e "if(process.versions.node.split('.')[0]!=='22'||require('playwright/package.json').version!=='1.56.0')process.exit(1)"
USER pwuser
CMD ["node", "tools/diagnoseFirefox.js", "--mode=runner", "--attempts=12", "--ipc=on"]
